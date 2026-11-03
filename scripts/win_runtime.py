"""Offline Windows runtime for the setup .exe (ADR-215), prepared on the build box:

- python/  : python.org embeddable CPython 3.12.10 win_amd64 (size + MD5 checked against python.org's published
             values), with python312._pth enabling site-packages and the app source (services/api, workers);
- wheels/  : win_amd64 / cp312 wheels for exactly the packages uv.lock pins for Windows (markers evaluated for
             x86_64-pc-windows-msvc, no re-resolution), the plugin wheels, pip, and install.txt (pins, --no-deps).
             A pinned package without a Windows wheel is built from its sdist only if the result is pure Python
             (py3-none-any, no native files) and is listed in the report; anything else stops the build.
Completeness: the wheel set is resolved for win_amd64 with `uv pip install --dry-run --no-index` and must equal the
lock. Downloads are cached in ~/.cache/researchos-build (outside the repo). No paid services, no credentials.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path.home() / ".cache" / "researchos-build"
PY_VERSION = "3.12.10"
PY_URL = f"https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-embed-amd64.zip"
PY_SIZE, PY_MD5 = 11133606, "fe8ef205f2e9c3ba44d0cf9954e1abd3"  # python.org downloads API, release 1007
PIP = "pip==26.2.1"
PLATFORM = ["--platform", "win_amd64", "--python-version", "3.12", "--implementation", "cp", "--abi", "cp312"]
PTH = "python312.zip\n.\nLib\\site-packages\n..\\services\\api\n..\\workers\nimport site\n"


def _run(cmd: list[str], **kw: Any) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kw)


def _pip() -> str:
    venv = CACHE / "pipvenv"
    if not (venv / "bin" / "pip").is_file():
        _run(["uv", "venv", "-q", "--seed", str(venv)])
    return str(venv / "bin" / "pip")


def python_runtime(dest: Path) -> dict[str, Any]:
    z = CACHE / Path(PY_URL).name
    if not z.is_file():
        CACHE.mkdir(parents=True, exist_ok=True)
        _run(["curl", "-sSfL", "-m", "300", "-o", str(z), PY_URL])
    data = z.read_bytes()
    if len(data) != PY_SIZE or hashlib.md5(data).hexdigest() != PY_MD5:  # noqa: S324 - comparing a published MD5
        raise SystemExit(f"{z.name}: size/MD5 differ from python.org's published values; delete it and retry")
    zipfile.ZipFile(z).extractall(dest)
    (dest / "python312._pth").write_text(PTH, encoding="ascii")
    (dest / "Lib" / "site-packages").mkdir(parents=True, exist_ok=True)
    return {"python": PY_VERSION, "url": PY_URL, "sha256": hashlib.sha256(data).hexdigest()}


def requirements(python_platform: str = "x86_64-pc-windows-msvc", name: str = "win") -> list[str]:
    """Pins from uv.lock with markers evaluated for `python_platform` / CPython 3.12 (no re-resolution); also used
    by build_mac_app.py."""
    CACHE.mkdir(parents=True, exist_ok=True)
    allreq, req = CACHE / "req-all.txt", CACHE / f"req-{name}.txt"
    out = _run(["uv", "export", "--frozen", "--no-dev", "--extra", "experiments", "--extra", "plugins",
                "--no-emit-workspace", "--no-hashes", "--format", "requirements-txt", "-q"], cwd=ROOT).stdout
    allreq.write_text(out, encoding="utf-8")
    _run(["uv", "pip", "compile", str(allreq), "--no-deps", "--python-platform", python_platform,
          "--python-version", "3.12", "--no-header", "--no-annotate", "-q", "-o", str(req)], cwd=ROOT)
    return [ln.strip() for ln in req.read_text().splitlines() if ln.strip() and not ln.startswith("#")]


def project_wheels() -> Path:
    """The workspace wheels (researchos + the merged plugins), freshly built into the cache."""
    project = CACHE / "project-wheels"
    shutil.rmtree(project, ignore_errors=True)
    _run(["uv", "build", "-q", "--wheel", "--all-packages", "-o", str(project)], cwd=ROOT)
    return project


def _key(name: str, version: str) -> str:
    return re.sub(r"[-_.]+", "_", name).lower() + "-" + version


def install_lines(pins: list[str], wheel_names: list[str]) -> list[str]:
    """install.txt: every line `name==version`, resolved through --find-links. A bare wheel file name would be resolved
    against pip's working directory (the install dir), not the wheel dir, and fail."""
    return pins + [f"{w.split('-')[0].replace('_', '-')}=={w.split('-')[1]}" for w in wheel_names]


def _is_pure(wheel: Path) -> bool:
    names = zipfile.ZipFile(wheel).namelist()
    return wheel.name.endswith("-py3-none-any.whl") and not any(n.endswith((".so", ".pyd", ".dll")) for n in names)


def wheels(dest: Path, pins: list[str]) -> dict[str, Any]:
    pip, cache = _pip(), CACHE / "wheels-win"
    cache.mkdir(parents=True, exist_ok=True)
    dest.mkdir(parents=True, exist_ok=True)
    built, fatal = [], []
    for pin in pins:
        r = subprocess.run([pip, "download", "-q", "--no-deps", "--only-binary=:all:", *PLATFORM, "-d", str(cache),
                            pin], capture_output=True, text=True)
        if r.returncode == 0:
            continue
        sd = CACHE / "sdist-built"
        sd.mkdir(exist_ok=True)
        r2 = subprocess.run([pip, "wheel", "-q", "--no-deps", "--no-binary=:all:", "-w", str(sd), pin],
                            capture_output=True, text=True)
        whl = [w for w in sd.glob("*.whl") if _key(*w.name.split("-")[:2]) == _key(*pin.split("=="))]
        if r2.returncode == 0 and whl and _is_pure(whl[0]):
            shutil.copy2(whl[0], cache / whl[0].name)
            built.append(pin)
        else:
            fatal.append(pin)
    if fatal:
        raise SystemExit(f"no Windows wheel and not pure Python (cannot ship offline): {fatal}")
    project = project_wheels()
    _run([pip, "download", "-q", "--no-deps", "--only-binary=:all:", "-d", str(dest), PIP])
    wanted = {_key(*p.split("==")) for p in pins}
    copied = set()
    for w in cache.glob("*.whl"):
        k = _key(*w.name.split("-")[:2])
        if k in wanted:
            shutil.copy2(w, dest / w.name)
            copied.add(k)
    if copied != wanted:
        raise SystemExit(f"pins without a wheel in the bundle: {sorted(wanted - copied)}")
    plugins = sorted(w.name for w in project.glob("researchos_plugin_*.whl"))
    for name in plugins:
        shutil.copy2(project / name, dest / name)
    (dest / "install.txt").write_text("\n".join(install_lines(pins, plugins)) + "\n", encoding="utf-8")
    pip_whl = next(w.name for w in dest.glob("pip-*.whl"))
    return {"pins": len(pins), "plugins": plugins, "built_from_sdist_pure_python": built, "pip": pip_whl,
            "wheel_files": len(list(dest.glob("*.whl")))}


def verify(wheel_dir: Path, pins: list[str]) -> None:
    """The shipped wheels (plus a researchos wheel for its extras) resolve for win_amd64 offline, equal to the lock."""
    with_core = CACHE / "verify-links"
    shutil.rmtree(with_core, ignore_errors=True)
    shutil.copytree(wheel_dir, with_core)
    shutil.copy2(next((CACHE / "project-wheels").glob("researchos-*.whl")), with_core)
    out = _run(["uv", "pip", "install", "--dry-run", "--no-index", "--find-links", str(with_core),
                "--python-platform", "x86_64-pc-windows-msvc", "--python-version", "3.12",
                "--target", str(CACHE / "verify-target"), "researchos[experiments,plugins]"], cwd=ROOT)
    got = {ln.strip()[2:] for ln in (out.stdout + out.stderr).splitlines() if ln.strip().startswith("+ ")}
    third = {g for g in got if not g.startswith("researchos")}
    if third != {p.lower() for p in pins} and third != set(pins):
        raise SystemExit(f"Windows resolution differs from uv.lock: {sorted(third ^ set(pins))[:10]}")
    # the exact setup command: install.txt, --no-index --no-deps, against the shipped wheel dir only
    _run(["uv", "pip", "install", "--dry-run", "--no-index", "--no-deps", "--find-links", str(wheel_dir),
          "--python-platform", "x86_64-pc-windows-msvc", "--python-version", "3.12",
          "--target", str(CACHE / "verify-target"), "-r", str(wheel_dir / "install.txt")], cwd=ROOT)


def prepare(stage: Path) -> dict[str, Any]:
    report = python_runtime(stage / "python")
    pins = requirements()
    report.update(wheels(stage / "wheels", pins))
    verify(stage / "wheels", pins)
    report["resolution"] = "win_amd64 offline resolution equals uv.lock"
    return report


if __name__ == "__main__":
    print(prepare(Path(sys.argv[1])))

"""Build ResearchOS.app for Apple Silicon (ADR-264; owner scope: darwin-arm64 only) on a macOS machine (the
macos-15 CI runner, .github/workflows/mac-build.yml). macOS NOT RUN on the dev box (Linux): tests check the layout,
Info.plist, launcher and packaging commands with the macOS-only tools stubbed.

Layout: ResearchOS.app/Contents/{Info.plist, MacOS/ResearchOS (packaging/macos/launcher.sh),
Resources/{python (python-build-standalone CPython, sha256 pinned), app (build_package.stage_app: the same file list
as the Windows setup), ResearchOS.icns}}. Dependencies: the uv.lock pins for aarch64-apple-darwin (win_runtime.
requirements) plus the merged plugin wheels, installed with `uv pip install --no-deps` into the bundled Python; the
installed set must equal them. Then bytecode is compiled, the bundle ad-hoc signed (`codesign -s -`), zipped with
`ditto` (the update asset) and put in a .dmg with an /Applications link. Next to each: <asset>.sha256, plus
ResearchOS-<v>-mac-arm64.build.json. The web build must exist.

Usage: python scripts/build_mac_app.py [--out-dir DIR]
"""

from __future__ import annotations

import hashlib
import json
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_package  # noqa: E402
import win_runtime  # noqa: E402

ARCH, TRIPLE = "arm64", "aarch64-apple-darwin"
PY_VERSION, PBS_RELEASE = "3.12.15", "20261021"
PY_NAME = f"cpython-{PY_VERSION}+{PBS_RELEASE}-{TRIPLE}-install_only.tar.gz"
PY_URL = ("https://github.com/astral-sh/python-build-standalone/releases/download/"
          f"{PBS_RELEASE}/{PY_NAME.replace('+', '%2B')}")
PY_SHA256 = "a18cc33862b53bd54a148c710def5375c1b47470cccedf817a19c2d211764584"  # the release's SHA256SUMS
BUNDLE_ID = "io.github.felix1451991535.researchos"
LAUNCHER = ROOT / "packaging" / "macos" / "launcher.sh"
ICON = ROOT / "scripts" / "researchos.ico"
SITE = Path("lib") / "python3.12" / "site-packages"
# the app source on sys.path, relative to site-packages (Resources/python/lib/python3.12/site-packages)
PTH = "../../../../app/services/api\n../../../../app/workers\n"
ACCEPTANCE = {"mac_install": "macOS NOT RUN (built and smoke-tested on the CI runner only)",
              "gatekeeper_first_open": "NOT RUN", "update_on_mac": "NOT RUN", "gpu": "NOT RUN"}
ICNS_TYPES = {16: b"icp4", 32: b"icp5", 64: b"icp6", 128: b"ic07", 256: b"ic08"}  # PNG payloads

Runner = Callable[[list[str]], str]


def _run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, cwd=ROOT).stdout


def asset_name(version: str) -> str:
    return f"ResearchOS-{version}-mac-{ARCH}"


def info_plist(version: str) -> dict[str, object]:
    return {"CFBundleName": "Research OS", "CFBundleDisplayName": "Research OS", "CFBundleIdentifier": BUNDLE_ID,
            "CFBundleExecutable": "ResearchOS", "CFBundleIconFile": "ResearchOS", "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": version, "CFBundleVersion": version, "LSMinimumSystemVersion": "11.0",
            "LSArchitecturePriority": [ARCH], "NSHighResolutionCapable": True}


def icns(ico: Path) -> bytes:
    """An .icns from the PNG images inside the Windows .ico (no image library needed)."""
    data = ico.read_bytes()
    count = struct.unpack("<H", data[4:6])[0]
    chunks = []
    for i in range(count):
        w, _h, _c, _r, _p, _b, size, off = struct.unpack("<BBBBHHII", data[6 + 16 * i:22 + 16 * i])
        png = data[off:off + size]
        kind = ICNS_TYPES.get(w or 256)
        if kind and png.startswith(b"\x89PNG"):
            chunks.append(kind + struct.pack(">I", 8 + len(png)) + png)
    body = b"".join(chunks)
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def python_tarball() -> Path:
    tgz = win_runtime.CACHE / PY_NAME
    if not tgz.is_file():
        win_runtime.CACHE.mkdir(parents=True, exist_ok=True)
        _run(["curl", "-sSfL", "-m", "300", "-o", str(tgz), PY_URL])
    if hashlib.sha256(tgz.read_bytes()).hexdigest() != PY_SHA256:
        raise SystemExit(f"{tgz.name}: sha256 differs from the pinned value; delete it and retry")
    return tgz


def assemble(app: Path, version: str, commit: str, python_tgz: Path) -> dict[str, object]:
    """The bundle without dependencies: plist, launcher, icon, app payload, bundled Python + the .pth."""
    contents = app / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    res = contents / "Resources"
    res.mkdir()
    (contents / "Info.plist").write_bytes(plistlib.dumps(info_plist(version)))
    exe = contents / "MacOS" / "ResearchOS"
    shutil.copyfile(LAUNCHER, exe)
    exe.chmod(0o755)
    (res / "ResearchOS.icns").write_bytes(icns(ICON))
    manifest = build_package.stage_app(res / "app", commit, ACCEPTANCE)
    with tarfile.open(python_tgz) as t:
        t.extractall(res, filter="data")  # the tarball's top directory is python/
    (res / "python" / SITE / "researchos-app.pth").write_text(PTH, encoding="ascii")
    return manifest


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()  # PEP 503


def _pin(line: str) -> tuple[str, str]:
    m = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s;]+)", line.strip())
    if not m:
        raise SystemExit(f"not an exact pin: {line!r}")
    return _norm(m[1]), m[2]


def installed(py: Path, run: Runner) -> set[tuple[str, str]]:
    """(normalised name, version) of every installed distribution. Not `uv pip freeze`: it prints a local wheel install
    as `name @ file:///...` without a version (the plugin wheels; macos-15 run 41572280122)."""
    return {(_norm(d["name"]), d["version"])
            for d in json.loads(run(["uv", "pip", "list", "--python", str(py), "--format", "json"]))}


def install_deps(res: Path, pins: list[str], project: Path, run: Runner) -> dict[str, object]:
    """Lock pins + plugin wheels into the bundled Python; the newly installed set must equal them exactly."""
    py = res / "python" / "bin" / "python3"
    plugins = sorted(project.glob("researchos_plugin_*.whl"))
    want = {_pin(p) for p in pins} | {(_norm(w.name.split("-")[0]), w.name.split("-")[1]) for w in plugins}
    before = installed(py, run)
    req = project / "requirements-mac.txt"
    req.write_text("\n".join(pins) + "\n", encoding="utf-8")
    run(["uv", "pip", "install", "--python", str(py), "--no-deps", "-r", str(req)])
    if plugins:
        run(["uv", "pip", "install", "--python", str(py), "--no-deps", *map(str, plugins)])
    got = installed(py, run) - before
    if got != want:
        diff = sorted(f"{'missing' if x in want else 'extra'} {x[0]}=={x[1]}" for x in got ^ want)
        raise SystemExit(f"installed set differs from uv.lock: {diff[:10]}")
    run([str(py), "-m", "compileall", "-q", "--invalidation-mode", "checked-hash", str(res / "app"),
         str(res / "python" / SITE)])
    return {"pins": len(pins), "plugins": [w.name for w in plugins], "resolution": f"{TRIPLE} install equals uv.lock"}


def _sha_file(p: Path) -> str:
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    p.with_name(p.name + ".sha256").write_text(f"{digest}  {p.name}\n", encoding="ascii")
    return digest


def package(app: Path, out_dir: Path, version: str, run: Runner) -> dict[str, dict[str, object]]:
    """Ad-hoc sign, then the update zip and the download dmg (with an /Applications link), each with a .sha256."""
    run(["codesign", "--force", "--deep", "-s", "-", str(app)])
    run(["codesign", "--verify", "--deep", "--strict", str(app)])
    name = asset_name(version)
    zip_path, dmg = out_dir / f"{name}.zip", out_dir / f"{name}.dmg"
    run(["ditto", "-c", "-k", "--keepParent", str(app), str(zip_path)])
    with tempfile.TemporaryDirectory() as td:
        stage = Path(td) / "dmg"
        stage.mkdir()
        run(["ditto", str(app), str(stage / app.name)])
        (stage / "Applications").symlink_to("/Applications")
        run(["hdiutil", "create", "-volname", "Research OS", "-srcfolder", str(stage), "-ov", "-format", "UDZO",
             str(dmg)])
    return {p.name: {"size": p.stat().st_size, "sha256": _sha_file(p)} for p in (zip_path, dmg)}


def main(argv: list[str] | None = None, run: Runner = _run) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if sys.platform != "darwin" and run is _run:
        print("build_mac_app.py runs on macOS (codesign, ditto, hdiutil)", file=sys.stderr)
        return 2
    if not (ROOT / "apps/web/dist/index.html").is_file():
        print("web build missing: cd apps/web && pnpm install && pnpm run build", file=sys.stderr)
        return 2
    out_dir = Path(args[args.index("--out-dir") + 1]) if "--out-dir" in args else ROOT / "release"
    out_dir.mkdir(parents=True, exist_ok=True)
    version, commit = build_package.version(), run(["git", "rev-parse", "--short", "HEAD"]).strip()
    with tempfile.TemporaryDirectory() as td:
        app = Path(td) / "ResearchOS.app"
        manifest = assemble(app, version, commit, python_tarball())
        deps = install_deps(app / "Contents" / "Resources", win_runtime.requirements(TRIPLE, f"mac-{ARCH}"),
                            win_runtime.project_wheels(), run)
        assets = package(app, out_dir, version, run)
    report = {"version": version, "git": commit, "arch": ARCH, "assets": assets,
              "runtime": {"python": PY_VERSION, "url": PY_URL, "sha256": PY_SHA256, **deps},
              "app_files": len(manifest["files"]),  # type: ignore[arg-type]
              "signature": "ad-hoc (codesign -s -), not notarized", "acceptance": ACCEPTANCE}
    (out_dir / f"{asset_name(version)}.build.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    for n, a in assets.items():
        print(f"{out_dir / n} ({a['size']} bytes, sha256 {a['sha256']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

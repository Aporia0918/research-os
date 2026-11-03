"""Build the single-file Windows installer release/ResearchOS-Setup-<version>.exe (ADR-212/215):
NSIS per-user setup with the app, an embedded CPython 3.12 and every win_amd64 wheel it needs (offline install, no
download on the target machine), built with makensis -V2 -WX. Next to it: ResearchOS-Setup-<version>.build.json
(git, runtime, wheel report incl. packages built from pure-Python sdists, exe sha256, acceptance status).

The web build must exist. Usage: python scripts/build_package.py [--out-dir DIR] [--stage-only DIR]
(--stage-only writes the app payload + PACKAGE_MANIFEST.json without the runtime or the exe; used by tests)."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import win_runtime  # noqa: E402

# the app as installed into <dir>\app (plugins ship as wheels; tests/examples are not part of the product)
INCLUDE = ["services", "workers", "templates", "packages", "scripts", "apps/web/dist", "pyproject.toml", "uv.lock",
           "docs/OPS.md", "docs/ARCHITECTURE.md", "docs/PLUGIN_DEV.md", "packaging/README_INSTALL.md"]
NSI = ROOT / "packaging" / "windows" / "ResearchOS-Setup.nsi"
ACCEPTANCE = {"windows_install": "NOT RUN", "setup_exe": "NOT RUN on Windows (compiled only)", "gpu": "NOT RUN",
              "ipad": "NOT RUN"}
SKIP = ("__pycache__", ".pyc", ".mypy_cache", ".ruff_cache", "node_modules")


def files() -> list[tuple[Path, str]]:
    out: list[tuple[Path, str]] = []
    for inc in INCLUDE:
        p = ROOT / inc
        items = [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file())
        out += [(x, x.relative_to(ROOT).as_posix()) for x in items if not any(s in x.as_posix() for s in SKIP)]
    return out


def version() -> str:
    return next(line.split('"')[1] for line in (ROOT / "pyproject.toml").read_text().splitlines()
                if line.startswith("version"))


def stage_app(dest: Path, commit: str, acceptance: dict[str, str] = ACCEPTANCE) -> dict[str, object]:
    """The app payload + PACKAGE_MANIFEST.json (also the macOS bundle's Resources/app, build_mac_app.py)."""
    fs = files()
    for p, arc in fs:
        (dest / arc).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dest / arc)
    manifest = {"version": version(), "git": commit, "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "files": {arc: hashlib.sha256(p.read_bytes()).hexdigest() for p, arc in fs},
                "acceptance": acceptance}
    (dest / "PACKAGE_MANIFEST.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not (ROOT / "apps/web/dist/index.html").is_file():
        print("web build missing: cd apps/web && pnpm install && pnpm run build", file=sys.stderr)
        return 2
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                            text=True).stdout.strip()
    if "--stage-only" in args:
        stage_app(Path(args[args.index("--stage-only") + 1]), commit)
        return 0
    makensis = shutil.which("makensis")
    if makensis is None:
        print("makensis not found: install NSIS 3", file=sys.stderr)
        return 2
    out_dir = Path(args[args.index("--out-dir") + 1]) if "--out-dir" in args else ROOT / "release"
    out_dir.mkdir(parents=True, exist_ok=True)
    v = version()
    exe = out_dir / f"ResearchOS-Setup-{v}.exe"
    with tempfile.TemporaryDirectory() as td:
        app = Path(td) / "app"
        manifest = stage_app(app, commit)
        runtime = win_runtime.prepare(Path(td))
        subprocess.run([makensis, "-V2", "-WX", f"-DVERSION={v}", f"-DAPPDIR={app}", f"-DPYDIR={Path(td) / 'python'}",
                        f"-DWHEELDIR={Path(td) / 'wheels'}", f"-DPIPWHEEL={runtime['pip']}", f"-DOUTFILE={exe}",
                        str(NSI)], check=True)
    data = exe.read_bytes()
    report = {"exe": exe.name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "git": commit,
              "version": v, "app_files": len(manifest["files"]),  # type: ignore[arg-type]
              "runtime": runtime, "acceptance": ACCEPTANCE}
    exe.with_suffix(".build.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"{exe} ({len(data)} bytes, sha256 {report['sha256']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

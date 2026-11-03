"""macOS .app assembly (ADR-264), Linux-runnable: layout, Info.plist, icon, launcher and the packaging commands with
the macOS-only tools (codesign, ditto, hdiutil, the bundled Python) stubbed. macOS NOT RUN here; the CI workflow
builds and smoke-tests the real bundle on a macos-15 runner."""

from __future__ import annotations

import io
import json
import os
import plistlib
import re
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

from tests.test_package_layout import ROOT, _load

bm = _load("build_mac_app")


def _fake_python(tmp: Path) -> Path:
    tgz = tmp / "py.tar.gz"
    with tarfile.open(tgz, "w:gz") as t:
        for name in ("python/bin/python3.12", "python/lib/python3.12/site-packages/README.txt"):
            info = tarfile.TarInfo(name)
            info.size, info.mode = 2, 0o755
            t.addfile(info, io.BytesIO(b"x\n"))
        link = tarfile.TarInfo("python/bin/python3")
        link.type, link.linkname = tarfile.SYMTYPE, "python3.12"
        t.addfile(link)
    return tgz


@pytest.fixture(scope="module")
def app(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if not (ROOT / "apps/web/dist/index.html").is_file():
        pytest.skip("web build missing")
    tmp = tmp_path_factory.mktemp("mac")
    out = tmp / "ResearchOS.app"
    bm.assemble(out, "9.8.7", "abc1234", _fake_python(tmp))  # type: ignore[attr-defined]
    return out


def test_bundle_layout(app: Path) -> None:
    c = app / "Contents"
    for need in ("Info.plist", "MacOS/ResearchOS", "Resources/ResearchOS.icns", "Resources/python/bin/python3",
                 "Resources/app/scripts/start.sh", "Resources/app/apps/web/dist/index.html",
                 "Resources/app/services/api/researchos/__init__.py", "Resources/app/pyproject.toml",
                 "Resources/app/PACKAGE_MANIFEST.json"):
        assert (c / need).exists(), need
    assert (c / "MacOS" / "ResearchOS").stat().st_mode & 0o111
    for absent in ("plugins", "tests", "examples", "data", ".venv", "release"):
        assert not (c / "Resources" / "app" / absent).exists(), absent


def test_app_payload_is_the_windows_file_list(app: Path) -> None:
    m = json.loads((app / "Contents/Resources/app/PACKAGE_MANIFEST.json").read_text())
    assert set(m["files"]) == {arc for _p, arc in _load("build_package").files()}  # type: ignore[attr-defined]
    assert m["version"] == _load("build_package").version()  # type: ignore[attr-defined]
    assert all("NOT RUN" in v for v in m["acceptance"].values())


def test_bundled_python_finds_the_app_source(app: Path) -> None:
    site = app / "Contents/Resources/python/lib/python3.12/site-packages"
    for line in (site / "researchos-app.pth").read_text().splitlines():
        assert (site / line).resolve().is_dir(), line  # services/api and workers, relative = relocatable


def test_info_plist(app: Path) -> None:
    p = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    assert p["CFBundleExecutable"] == "ResearchOS" and p["CFBundleIconFile"] == "ResearchOS"
    assert p["CFBundleShortVersionString"] == p["CFBundleVersion"] == "9.8.7"
    assert p["CFBundlePackageType"] == "APPL" and p["LSArchitecturePriority"] == ["arm64"]
    assert "LSUIElement" not in p  # a Dock icon (plan)


def test_icns_is_well_formed(app: Path) -> None:
    data = (app / "Contents/Resources/ResearchOS.icns").read_bytes()
    assert data[:4] == b"icns" and int.from_bytes(data[4:8], "big") == len(data)
    kinds, off = [], 8
    while off < len(data):
        kinds.append(data[off:off + 4])
        off += int.from_bytes(data[off + 4:off + 8], "big")
    assert off == len(data) and {b"ic07", b"ic08"} <= set(kinds)


def test_launcher_static() -> None:
    src = bm.LAUNCHER.read_text()  # type: ignore[attr-defined]
    subprocess.run(["sh", "-n", str(bm.LAUNCHER)], check=True)  # type: ignore[attr-defined]
    assert src.startswith("#!/bin/sh\n")
    assert '"$HOME/Library/Application Support/ResearchOS"' in src and '"$HOME/Library/Logs/ResearchOS"' in src
    assert 'Resources/python/bin/python3"' in src and "Resources/app/scripts/start.sh" in src
    assert "api/v1/health" in src and 'open "$URL"' in src and "osascript" in src
    assert src.index("if ! up; then") < src.index("scripts/start.sh\" >>")  # already running -> only open the browser


def test_start_sh_takes_the_bundled_python_and_log_dir() -> None:
    src = (ROOT / "scripts/start.sh").read_text()
    assert 'PY="${RESEARCHOS_PYTHON:-.venv/bin/python}"' in src
    assert 'LOGS="${RESEARCHOS_LOG_DIR:-$RESEARCHOS_DATA_DIR/logs}"' in src


def test_python_pin() -> None:
    assert re.fullmatch(r"[0-9a-f]{64}", bm.PY_SHA256)  # type: ignore[attr-defined]
    assert bm.PY_URL.startswith("https://github.com/astral-sh/python-build-standalone/releases/download/")  # type: ignore[attr-defined]
    assert "aarch64-apple-darwin-install_only.tar.gz" in bm.PY_URL and "x86_64" not in bm.PY_URL  # type: ignore[attr-defined]


class _FakeUv:
    """The bundled Python's package set as real uv reports it: `uv pip freeze` prints a local wheel install as
    `name @ file:///...` (no `==`; seen on the first macos-15 run 41572280122 and reproduced with uv 0.13.5 on
    Linux), `uv pip list --format json` gives name + version for everything."""

    def __init__(self, installed: dict[str, str]) -> None:
        self.installed, self.wheels, self.calls = dict(installed), set[str](), list[list[str]]()

    def __call__(self, cmd: list[str]) -> str:
        self.calls.append(cmd)
        if cmd[:3] == ["uv", "pip", "freeze"]:
            return "\n".join(f"{n} @ file:///tmp/w/{n}-{v}.whl" if n in self.wheels else f"{n}=={v}"
                             for n, v in self.installed.items())
        if cmd[:3] == ["uv", "pip", "list"]:
            assert cmd[cmd.index("--format") + 1] == "json"
            return json.dumps([{"name": n, "version": v} for n, v in self.installed.items()])
        if cmd[:3] == ["uv", "pip", "install"]:
            if "-r" in cmd:
                for ln in Path(cmd[cmd.index("-r") + 1]).read_text().split():
                    name, _, ver = ln.partition("==")
                    self.installed[name.split("[")[0]] = ver
            for w in (Path(c).name for c in cmd if c.endswith(".whl")):
                name, ver = w.split("-")[:2]
                self.installed[name.replace("_", "-")] = ver
                self.wheels.add(name.replace("_", "-"))
        return ""


def test_install_deps_requires_the_lock_set(tmp_path: Path) -> None:
    res, project = tmp_path / "Resources", tmp_path / "wheels"
    project.mkdir()
    (project / "researchos_plugin_x-0.1.0-py3-none-any.whl").write_bytes(b"")
    run = _FakeUv({"pip": "25.0"})
    rep = bm.install_deps(res, ["numpy==2.5.4", "ruamel-yaml==0.18.6"], project, run)  # type: ignore[attr-defined]
    assert rep["pins"] == 2 and rep["plugins"] == ["researchos_plugin_x-0.1.0-py3-none-any.whl"]
    installs = [c for c in run.calls if c[:3] == ["uv", "pip", "install"]]
    assert all("--no-deps" in c and str(res / "python/bin/python3") in c for c in installs)
    assert any(c[1:3] == ["-m", "compileall"] for c in run.calls)


def test_install_deps_matches_local_wheels_reported_as_file_urls(tmp_path: Path) -> None:
    """The real freeze form of the 7 plugin wheels (`name @ file://`) and a differently spelled installed name
    (Ruamel.YAML vs the lock's ruamel-yaml) still equal the lock set."""
    res, project = tmp_path / "Resources", tmp_path / "wheels"
    project.mkdir()
    for n in ("diag_stats", "har_datasets"):
        (project / f"researchos_plugin_{n}-0.1.0-py3-none-any.whl").write_bytes(b"")
    run = _FakeUv({"pip": "25.0"})
    real_install = run.__call__

    def spelled(cmd: list[str]) -> str:
        out = real_install(cmd)
        if "ruamel-yaml" in run.installed:
            run.installed["Ruamel.YAML"] = run.installed.pop("ruamel-yaml")
        return out

    rep = bm.install_deps(res, ["numpy==2.5.4", "ruamel-yaml==0.18.6"], project, spelled)  # type: ignore[attr-defined]
    assert len(rep["plugins"]) == 2 and run.wheels == {"researchos-plugin-diag-stats", "researchos-plugin-har-datasets"}


@pytest.mark.parametrize("change", ["extra", "missing", "version"])
def test_install_deps_still_demands_exact_equality(tmp_path: Path, change: str) -> None:
    res, project = tmp_path / "Resources", tmp_path / "wheels"
    project.mkdir()
    (project / "researchos_plugin_x-0.1.0-py3-none-any.whl").write_bytes(b"")
    run = _FakeUv({"pip": "25.0"})
    real = run.__call__

    def tamper(cmd: list[str]) -> str:
        out = real(cmd)
        if cmd[:3] == ["uv", "pip", "install"] and "-r" not in cmd:  # after both installs
            if change == "extra":
                run.installed["idna"] = "3.0"
            elif change == "missing":
                del run.installed["numpy"]
            else:
                run.installed["researchos-plugin-x"] = "0.1.1"
        return out

    with pytest.raises(SystemExit, match="differs from uv.lock"):
        bm.install_deps(res, ["numpy==2.5.4"], project, tamper)  # type: ignore[attr-defined]


def test_install_deps_rejects_a_pin_that_is_not_exact(tmp_path: Path) -> None:
    project = tmp_path / "wheels"
    project.mkdir()
    with pytest.raises(SystemExit, match="not an exact pin"):
        bm.install_deps(tmp_path / "Resources", ["numpy>=2"], project, _FakeUv({}))  # type: ignore[attr-defined]


def test_package_signs_then_zips_and_makes_a_dmg(tmp_path: Path) -> None:
    app = tmp_path / "ResearchOS.app"
    app.mkdir()
    calls: list[list[str]] = []

    def run(cmd: list[str]) -> str:
        calls.append(cmd)
        if cmd[0] == "ditto" and cmd[1] == "-c":
            Path(cmd[-1]).write_bytes(b"zip")
        if cmd[0] == "hdiutil":
            assert (Path(cmd[cmd.index("-srcfolder") + 1]) / "Applications").readlink() == Path("/Applications")
            Path(cmd[-1]).write_bytes(b"dmg")
        return ""

    assets = bm.package(app, tmp_path, "9.8.7", run)  # type: ignore[attr-defined]
    assert [c[0] for c in calls] == ["codesign", "codesign", "ditto", "ditto", "hdiutil"]
    assert calls[0] == ["codesign", "--force", "--deep", "-s", "-", str(app)]
    assert calls[2] == ["ditto", "-c", "-k", "--keepParent", str(app), str(tmp_path / "ResearchOS-9.8.7-mac-arm64.zip")]
    assert set(assets) == {"ResearchOS-9.8.7-mac-arm64.zip", "ResearchOS-9.8.7-mac-arm64.dmg"}
    for name, a in assets.items():
        assert (tmp_path / f"{name}.sha256").read_text() == f"{a['sha256']}  {name}\n"


def test_refuses_to_run_off_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bm.sys, "platform", "linux")  # type: ignore[attr-defined]
    assert bm.main([]) == 2  # type: ignore[attr-defined]


WORKFLOW = ROOT / ".github" / "workflows" / "mac-build.yml"


def test_ci_workflow_builds_arm64_only_and_publishes_nothing() -> None:
    import yaml

    wf = yaml.safe_load(WORKFLOW.read_text())
    on = wf[True]  # YAML 1.1 reads the `on:` key as a boolean
    assert set(on) == {"workflow_dispatch", "push"} and on["push"] == {"tags": ["v*"]}
    assert wf["permissions"] == {"contents": "read"}
    (job,) = wf["jobs"].values()
    assert job["runs-on"] == "macos-15" and "strategy" not in job
    text = WORKFLOW.read_text()
    for banned in ("secrets.", "x86_64", "intel", "gh release", "softprops", "contents: write", "latest.json"):
        assert banned not in text.lower(), banned
    uses = [s["uses"] for s in job["steps"] if "uses" in s]
    assert uses and all(re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", u) for u in uses)  # pinned to commits
    run = "\n".join(s.get("run", "") for s in job["steps"])
    assert "scripts/build_mac_app.py" in run and "api/v1/health" in run and "stop.sh" in run
    assert "RESEARCHOS_HEADLESS=1" in run and "codesign --verify" in run


def test_ci_log_dump_redacts_the_setup_token(tmp_path: Path) -> None:
    """ADR-270: start.sh prints the smoke instance's setup token into launcher.log; the always-run dump step must not
    show it in the public CI log. Runs the step's own command on fake logs (sh here; macOS bash/BSD sed NOT RUN)."""
    import yaml

    (job,) = yaml.safe_load(WORKFLOW.read_text())["jobs"].values()
    (dump,) = [s for s in job["steps"] if s.get("if") == "always()"]
    logs = tmp_path / "smoke" / "Library" / "Logs" / "ResearchOS"
    logs.mkdir(parents=True)
    secret = "Zq3-SECRET_token.value"
    (logs / "launcher.log").write_text(f"2026-11-01T10:00:00 starting server\nFirst-run setup token: {secret}\n"
                                       "Research OS started.\n", encoding="utf-8")
    (logs / "api.out").write_text("INFO uvicorn running\n", encoding="utf-8")
    out = subprocess.run(["sh", "-c", dump["run"]], env={**os.environ, "RUNNER_TEMP": str(tmp_path)},
                         capture_output=True, text=True, check=True).stdout
    assert secret not in out and "First-run setup token: [redacted]" in out
    assert "starting server" in out and "Research OS started." in out and "uvicorn running" in out


def test_ci_workflow_is_part_of_the_public_export() -> None:
    be = _load_public("build_export")
    assert not be.denied(".github/workflows/mac-build.yml")  # type: ignore[attr-defined]


def _load_public(name: str) -> object:
    import importlib.util
    spec = importlib.util.spec_from_file_location(f"public_{name}", ROOT / "scripts" / "public" / f"{name}.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses resolve their module by name
    spec.loader.exec_module(mod)
    return mod

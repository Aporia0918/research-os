"""Portable Windows folder (ADR-278): what can be checked on Linux without the runtime download. The real build and
a headless start on Windows run in .github/workflows/desktop-windows.yml."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github" / "workflows" / "desktop-windows.yml").read_text(encoding="utf-8")


def _portable() -> ModuleType:
    sys.path.insert(0, str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location("build_portable", ROOT / "scripts" / "build_portable.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_launchers_are_ascii_and_start_the_hidden_launcher() -> None:
    bp = _portable()
    assert set(bp.LAUNCHERS) == {"Start-ResearchOS.bat", "Start-with-phone.bat", "Stop-ResearchOS.bat"}
    for name, (script, args) in bp.LAUNCHERS.items():
        bat = bp.BAT.format(script=script, args=args)
        bat.encode("ascii")  # cmd reads .bat in the console code page
        assert name.isascii() and "-WindowStyle Hidden" in bat and f"%~dp0app\\scripts\\{script}" in bat
        assert name in bp.README
    assert bp.LAUNCHERS["Start-with-phone.bat"] == ("launch.ps1", " -Phone")
    assert "%~dp0data" in bp.LAUNCHERS["Stop-ResearchOS.bat"][1]  # the data folder next to app/, not the default


def test_readme_opens_in_notepad_and_is_honest() -> None:
    bp = _portable()
    assert "没有在真实的 Windows 电脑上试过" in bp.README


def test_non_ascii_powershell_carries_a_bom() -> None:
    """Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI: the Chinese in a dialog would come out garbled."""
    for f in (ROOT / "scripts").glob("*.ps1"):
        b = f.read_bytes()
        assert b.isascii() or b.startswith(b"\xef\xbb\xbf"), f.name


def test_phone_mode_turns_on_only_what_pairing_needs() -> None:
    ps = (ROOT / "scripts" / "launch.ps1").read_text(encoding="utf-8-sig")
    assert "param([switch]$Phone)" in ps
    for env in ("RESEARCHOS_HOST", "RESEARCHOS_ALLOW_INSECURE_LAN", "RESEARCHOS_MOBILE_APP_ORIGINS",
                "RESEARCHOS_PUBLIC_ORIGINS"):
        assert f"$env:{env}" in ps
    assert "if (-not $Headless) { Start-Process $url }" in ps


def test_workflow_publishes_an_artifact_only_after_a_windows_start() -> None:
    assert "windows-latest" in WORKFLOW and "RESEARCHOS_HEADLESS" in WORKFLOW and "api/v1/health" in WORKFLOW
    assert "upload-artifact" in WORKFLOW
    for never in ("release", "gh release", "softprops", "secrets."):
        assert never not in WORKFLOW.lower().replace("releases", ""), never


def test_cli_helper_returns_only_the_exit_code() -> None:
    """Found by the first Windows run: `migrate` prints a line, and a function returns its pipeline output too."""
    common = (ROOT / "scripts" / "_common.ps1").read_text(encoding="utf-8")
    assert "@CliArgs | Write-Host; return $LASTEXITCODE" in common

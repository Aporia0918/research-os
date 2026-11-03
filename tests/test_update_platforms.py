"""Multi-platform update feed (ADR-266): the top level stays the Windows installer for installed 0.1.3/0.1.4 clients;
`platforms` carries the Mac zips under the same rules, inside the one signature over the whole file."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from researchos.kernel.config import REPO_ROOT as ROOT
from researchos.kernel.config import Settings
from researchos.platform import macos
from researchos.services.ops.update_feed import UpdateError, asset_name, current_platform, parse_release
from researchos.services.ops.updater import Updater
from tests.fake_release import CUR, TRUSTED, FakeRelease, bump, signed_feed
from tests.fixtures import update_feed_v0_1_3 as v013
from tests.fixtures import update_feed_v0_1_4 as v014

FEED = "https://github.com/owner/research-os/releases/latest/download/latest.json"
DL = "https://github.com/owner/research-os/releases/download/v9.9.9/"
EXE_SHA, ZIP_SHA = hashlib.sha256(b"exe").hexdigest(), hashlib.sha256(b"zip").hexdigest()


def _feed(**platforms: Any) -> dict[str, Any]:
    meta: dict[str, Any] = {"version": "9.9.9", "asset": "ResearchOS-Setup-9.9.9.exe", "sha256": EXE_SHA,
                            "url": DL + "ResearchOS-Setup-9.9.9.exe", "notes": "n", "notes_zh": "说明"}
    if platforms:
        meta["platforms"] = platforms
    return meta


def _mac(asset: str = "ResearchOS-9.9.9-mac-arm64.zip", **over: str) -> dict[str, str]:
    return {"asset": asset, "sha256": ZIP_SHA, "url": DL + asset, **over}


def _parse(meta: dict[str, Any], platform: str) -> Any:
    raw, sig = signed_feed(meta)
    return parse_release(raw, FEED, sig, TRUSTED, platform)


def _code(meta: dict[str, Any], platform: str) -> str:
    with pytest.raises(UpdateError) as e:
        _parse(meta, platform)
    return e.value.code


def test_a_shipped_0_1_4_client_still_gets_the_exe_from_a_multi_platform_feed() -> None:
    raw, sig = signed_feed(_feed(**{"darwin-arm64": _mac(), "darwin-x86_64": _mac("ResearchOS-9.9.9-mac-x86_64.zip")}))
    old = v014.parse_release(raw, FEED, sig, TRUSTED)
    assert (old.version, old.asset, old.sha256, old.url) == ("9.9.9", "ResearchOS-Setup-9.9.9.exe", EXE_SHA,
                                                             DL + "ResearchOS-Setup-9.9.9.exe")
    new = parse_release(raw, FEED, sig, TRUSTED, "win32")
    assert (new.asset, new.sha256, new.url, new.notes_zh) == (old.asset, old.sha256, old.url, old.notes_zh)


def test_a_shipped_0_1_3_client_still_gets_the_exe_from_a_multi_platform_feed() -> None:
    """0.1.3 (2400c6c) predates update_feed.py and signing: parse_release(raw, feed_url) in updater.py (ADR-270)."""
    raw, sig = signed_feed(_feed(**{"darwin-arm64": _mac(), "darwin-x86_64": _mac("ResearchOS-9.9.9-mac-x86_64.zip")}))
    assert b'"platforms"' in raw and len(raw) <= v013.MAX_FEED_BYTES  # 0.1.3 refuses a larger feed
    old = v013.parse_release(raw, FEED)
    assert (old.version, old.asset, old.sha256, old.url) == ("9.9.9", "ResearchOS-Setup-9.9.9.exe", EXE_SHA,
                                                             DL + "ResearchOS-Setup-9.9.9.exe")
    assert v013.is_newer(old.version, "0.1.3")
    new = parse_release(raw, FEED, sig, TRUSTED, "win32")
    assert (new.asset, new.sha256, new.url, new.notes) == (old.asset, old.sha256, old.url, old.notes)


def test_a_mac_client_reads_only_its_platform_entry() -> None:
    rel = _parse(_feed(**{"darwin-arm64": _mac()}), "darwin-arm64")
    assert (rel.version, rel.asset, rel.sha256, rel.url) == ("9.9.9", "ResearchOS-9.9.9-mac-arm64.zip", ZIP_SHA,
                                                             DL + "ResearchOS-9.9.9-mac-arm64.zip")
    assert (rel.notes, rel.notes_zh) == ("n", "说明")


def test_a_missing_platform_never_falls_back_to_the_exe() -> None:
    assert _code(_feed(), "darwin-arm64") == "update_platform_missing"
    assert _code(_feed(**{"darwin-x86_64": _mac("ResearchOS-9.9.9-mac-x86_64.zip")}), "darwin-arm64") \
        == "update_platform_missing"
    assert _parse(_feed(), "linux").asset == "ResearchOS-Setup-9.9.9.exe"  # dev checkout: shows the version only


def test_a_tampered_mac_sha256_breaks_the_signature() -> None:
    raw, sig = signed_feed(_feed(**{"darwin-arm64": _mac()}))
    d = json.loads(raw)
    d["platforms"]["darwin-arm64"]["sha256"] = hashlib.sha256(b"evil").hexdigest()
    for platform in ("darwin-arm64", "win32"):
        with pytest.raises(UpdateError) as e:
            parse_release(json.dumps(d).encode(), FEED, sig, TRUSTED, platform)
        assert e.value.code == "update_bad_signature"


@pytest.mark.parametrize("entry", [
    _mac(sha256="xyz"),
    _mac(url="http://github.com/owner/research-os/releases/download/v9.9.9/ResearchOS-9.9.9-mac-arm64.zip"),
    _mac(url="https://evil.example.org/ResearchOS-9.9.9-mac-arm64.zip"),
    _mac("ResearchOS-9.9.8-mac-arm64.zip"),
    _mac("ResearchOS-Setup-9.9.9.exe"),
    {"asset": "ResearchOS-9.9.9-mac-arm64.zip", "url": DL + "ResearchOS-9.9.9-mac-arm64.zip"},
    "ResearchOS-9.9.9-mac-arm64.zip",
])
def test_mac_entries_follow_the_url_host_and_name_rules(entry: Any) -> None:
    meta = _feed(**{"darwin-arm64": entry})
    assert _code(meta, "darwin-arm64") == "update_bad_metadata"
    assert _code(meta, "win32") == "update_bad_metadata"  # one bad entry makes the whole signed feed invalid


def test_platforms_must_be_an_object_and_unknown_keys_are_left_to_later_clients() -> None:
    meta = _feed()
    meta["platforms"] = ["darwin-arm64"]
    assert _code(meta, "darwin-arm64") == "update_bad_metadata"
    assert _parse(_feed(**{"linux-x86_64": {"anything": 1}, "darwin-arm64": _mac()}), "darwin-arm64").asset \
        == "ResearchOS-9.9.9-mac-arm64.zip"


def test_platform_keys_and_asset_names() -> None:
    assert current_platform("darwin", "arm64") == "darwin-arm64"
    assert current_platform("darwin", "x86_64") == "darwin-x86_64"
    assert current_platform("win32", "AMD64") == "win32" and current_platform("linux", "x86_64") == "linux"
    assert asset_name("1.2.3") == asset_name("1.2.3", "win32") == "ResearchOS-Setup-1.2.3.exe"
    assert asset_name("1.2.3", "darwin-arm64") == "ResearchOS-1.2.3-mac-arm64.zip"


def test_the_mac_build_names_its_zip_like_the_feed() -> None:
    from tests.test_package_layout import _load
    assert _load("build_mac_app").asset_name("1.2.3") + ".zip" == asset_name("1.2.3", "darwin-arm64")  # type: ignore[attr-defined]


def test_a_mac_updater_reports_a_release_without_its_platform(settings: Settings, tmp_path: Path) -> None:
    rel = FakeRelease()
    try:
        rel.publish(bump(CUR, 1))  # a Windows-only release
        settings.update_feed_url, settings.update_timeout_s = rel.feed, 2.0
        settings.ensure_dirs()
        u = Updater(settings, download_dir=tmp_path / "dl", platform="darwin-arm64", trusted_keys=TRUSTED)
        with pytest.raises(UpdateError) as e:
            u.check()
        assert e.value.code == "update_platform_missing"
        assert u.status()["state"] == "error" and u.status()["latest"] is None
        assert not any(".exe" in h and "latest.json" not in h for h in rel.hits)  # never downloads the .exe
    finally:
        rel.srv.shutdown()


def _mac_app(root: Path) -> Path:
    """<root>/ResearchOS.app with the app root inside; returns the app root (Contents/Resources/app)."""
    app_root = root / "ResearchOS.app" / "Contents" / "Resources" / "app"
    (app_root / "scripts").mkdir(parents=True)
    shutil.copyfile(ROOT / "scripts" / "apply_update.sh", app_root / "scripts" / "apply_update.sh")
    return app_root


def test_updatable_bundle_needs_a_writable_folder_outside_dmg_and_translocation(tmp_path: Path) -> None:
    root = _mac_app(tmp_path / "Applications")
    assert macos.updatable_bundle(root) == tmp_path / "Applications" / "ResearchOS.app"
    assert macos.updatable_bundle(tmp_path / "checkout") is None
    trans = Path("/private/var/folders/x/T/AppTranslocation/ABC/d/ResearchOS.app/Contents/Resources/app")
    assert macos.updatable_bundle(trans) is None
    assert macos.updatable_bundle(Path("/Volumes/Research OS/ResearchOS.app/Contents/Resources/app")) is None
    (tmp_path / "Applications").chmod(0o555)
    try:
        if not os.access(tmp_path / "Applications", os.W_OK):  # root ignores the mode
            assert macos.updatable_bundle(root) is None
    finally:
        (tmp_path / "Applications").chmod(0o755)


def test_a_mac_install_hands_over_to_apply_update_sh(settings: Settings, tmp_path: Path) -> None:
    rel, calls = FakeRelease(), []
    try:
        settings.update_feed_url = rel.feed
        settings.ensure_dirs()
        root = _mac_app(tmp_path / "Applications")
        u = Updater(settings, download_dir=tmp_path / "dl", platform="darwin-arm64", app_root=root,
                    spawn=lambda cmd, env: calls.append((list(cmd), env)), trusted_keys=TRUSTED)
        assert u.status()["can_install"]
        v = bump(CUR, 1)
        rel.publish(v, mac_zip=b"PK mac zip")
        u.check()
        u.start_download()
        u.wait(10)
        assert u.installer == tmp_path / "dl" / f"ResearchOS-{v}-mac-arm64.zip"
        assert u.install()["state"] == "installing"
    finally:
        rel.srv.shutdown()
    (cmd, env), = calls
    assert cmd == ["/bin/sh", str(tmp_path / "dl" / "apply_update.sh"), str(u.installer),
                   str(tmp_path / "Applications" / "ResearchOS.app"), str(os.getpid()), v,
                   f"http://127.0.0.1:{settings.port}/api/v1/health", str(settings.data_dir),
                   str(settings.logs_dir / "update.log"), hashlib.sha256(b"PK mac zip").hexdigest()]
    assert (tmp_path / "dl" / "apply_update.sh").read_bytes() == (ROOT / "scripts" / "apply_update.sh").read_bytes()
    assert not any("KEY" in k.upper() or k.upper().startswith("RESEARCHOS_") for k in env)
    assert not any(h.endswith(".exe") for h in rel.hits)


def test_a_mac_copy_that_cannot_be_replaced_refuses_to_install(settings: Settings, tmp_path: Path) -> None:
    u = Updater(settings, platform="darwin-arm64", app_root=tmp_path / "checkout", trusted_keys=TRUSTED)
    assert u.status()["can_install"] is False


def test_apply_update_sh_static() -> None:
    """The Mac helper (ADR-267); its behaviour runs in scripts/release/e2e_check.py (mac-* scenarios)."""
    path = ROOT / "scripts" / "apply_update.sh"
    subprocess.run(["sh", "-n", str(path)], check=True)
    src = path.read_text(encoding="utf-8")
    assert src.startswith("#!/bin/sh\n") and "set -u" in src
    assert 'ditto -x -k "$PRIV/update.zip" "$STAGE"' in src and 'STAGE="$PARENT/.ResearchOS-update-$VERSION"' in src
    assert src.index('mv "$APP" "$PREV"') < src.index('mv "$NEW" "$APP"') < src.index('if wait_version "$VERSION"')
    assert src.index("health check OK") > src.index('rm -rf "$PREV"')  # .prev goes only after success
    assert "Contents/Resources/app/pyproject.toml" in src  # the unpacked app's version is checked before the swap
    # ADR-270: the private copy's sha256 must equal the signed feed's before anything is unpacked
    # the rollback waits for the failed version's processes before it moves anything, then health-checks the old one
    assert src.index("rolling back") < src.index("if ! stop_and_wait; then") < src.index('mv "$APP" "$FAILED"') \
        < src.index('wait_version "$OLD"') and "kill -9" not in src
    # every move of the swap and the rollback is checked; a failed one never reaches "restored" or `open`
    assert 'mv "$PREV" "$APP" && give_up' in src and 'if ! mv "$APP" "$FAILED"; then' in src \
        and 'if ! mv "$PREV" "$APP"; then' in src and 'mv "$APP" "$FAILED" && mv' not in src
    assert src.index('[ "$GOT_SHA" = "$SHA256" ]') < src.index('ditto -x -k "$PRIV') and "SHA256=${8:-}" in src

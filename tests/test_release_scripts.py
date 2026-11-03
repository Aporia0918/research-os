"""Release scripts (ADR-225/228): signing-key generation, signed manifest builder, publish dry run + preflight, version
bump rewrite and the local update e2e check with a small fake installer (offline, no git tag, no gh call). A test
signing key is generated per test and trusted only for that test (the embedded keys are not touched)."""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

import researchos
from researchos.kernel.config import Settings
from researchos.services.ops import update_signing
from researchos.services.ops.update_feed import asset_name, parse_release
from tests.fixtures import update_feed_v0_1_3 as v013
from tests.fixtures import update_feed_v0_1_4 as v014

ROOT = Path(__file__).resolve().parents[1]
REL = ROOT / "scripts" / "release"
V = researchos.__version__


def _load(name: str) -> ModuleType:
    sys.path.insert(0, str(REL))
    spec = importlib.util.spec_from_file_location(name, REL / f"{name}.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


common, manifest, publish, bump, e2e, keygen = (_load(n) for n in ("_common", "manifest", "publish", "bump_version",
                                                                   "e2e_check", "keygen"))


@pytest.fixture()
def key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A fresh signing key outside the repo, trusted for this test only."""
    path = tmp_path / "keys" / "release.pem"
    kid, pub = keygen.write_key(path)
    monkeypatch.setitem(update_signing.TRUSTED_KEYS, kid, pub)
    return path


def _sig(d: Path) -> bytes:
    return (d / "latest.json.sig").read_bytes()


@pytest.fixture()
def exe(tmp_path: Path) -> Path:
    p = tmp_path / asset_name(V)
    p.write_bytes(b"MZ fake installer for the release tests")
    return p


def test_repo_and_download_url_come_from_the_default_feed() -> None:
    owner_repo = common.github_repo()
    assert Settings.update_feed_url == f"https://github.com/{owner_repo}/releases/latest/download/latest.json"
    assert common.download_url("9.9.9") == (f"https://github.com/{owner_repo}/releases/download/v9.9.9/"
                                            "ResearchOS-Setup-9.9.9.exe")
    with pytest.raises(ValueError):
        common.github_repo("https://example.org/a/b/latest.json")


def test_manifest_writes_sha256_and_a_signed_feed_the_updater_accepts(exe: Path, key: Path) -> None:
    zh = exe.parent / "notes.zh.md"
    zh.write_text("修复\n", encoding="utf-8")
    assert manifest.main(["--exe", str(exe), "--key", str(key), "--notes", "fixes", "--notes-zh-file", str(zh)]) == 0
    rel = parse_release((exe.parent / "latest.json").read_bytes(), Settings.update_feed_url, _sig(exe.parent))
    digest = rel.sha256
    assert (rel.version, rel.asset, rel.notes, rel.notes_zh, rel.url) == (V, exe.name, "fixes", "修复",
                                                                         common.download_url(V))
    assert (exe.parent / f"{exe.name}.sha256").read_text(encoding="utf-8") == f"{digest}  {exe.name}\n"


def test_manifest_refuses_an_exe_of_another_version(tmp_path: Path, key: Path) -> None:
    other = tmp_path / asset_name("0.0.1")
    other.write_bytes(b"x")
    assert manifest.main(["--exe", str(other), "--key", str(key), "--notes", "n"]) == 1
    assert not (tmp_path / "latest.json").exists()


def test_manifest_refuses_a_key_the_app_does_not_trust(exe: Path, tmp_path: Path) -> None:
    untrusted = tmp_path / "other.pem"
    keygen.write_key(untrusted)  # not added to TRUSTED_KEYS
    assert manifest.main(["--exe", str(exe), "--key", str(untrusted), "--notes", "n"]) == 1
    assert not (exe.parent / "latest.json").exists() and not (exe.parent / "latest.json.sig").exists()
    assert manifest.main(["--exe", str(exe), "--key", str(tmp_path / "missing.pem"), "--notes", "n"]) == 2


def test_keygen_writes_outside_the_repo_only_and_never_overwrites(tmp_path: Path) -> None:
    path = tmp_path / "k" / "release.pem"
    kid, pub = keygen.write_key(path)
    assert path.stat().st_mode & 0o777 == 0o600 and b"PRIVATE KEY" in path.read_bytes()
    assert update_signing.key_id(update_signing.load_private(path.read_bytes()).public_key()) == kid
    with pytest.raises(FileExistsError):
        keygen.write_key(path)
    with pytest.raises(ValueError, match="outside the repo"):
        keygen.write_key(ROOT / "data" / "never.pem")
    assert not (ROOT / "data" / "never.pem").exists()


def test_publish_is_a_dry_run_without_yes(exe: Path, key: Path, monkeypatch: pytest.MonkeyPatch,
                                          capsys: pytest.CaptureFixture[str]) -> None:
    manifest.main(["--exe", str(exe), "--key", str(key), "--notes-file", str(_notes(exe.parent))])
    monkeypatch.setattr(publish, "git_problems", lambda tag: [])

    def forbidden(*a: object, **k: object) -> None:
        raise AssertionError("dry run executed a command")

    monkeypatch.setattr(subprocess, "run", forbidden)
    assert publish.main(["--dir", str(exe.parent)]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out and f"gh release create v{V} --repo {common.github_repo()}" in out
    assert "--notes 'line one'" in out and str(exe.parent / "latest.json") in out
    assert str(exe.parent / "latest.json.sig") in out


def test_publish_preflight_catches_a_stale_sha256_file(exe: Path, key: Path) -> None:
    manifest.main(["--exe", str(exe), "--key", str(key), "--notes", "n"])
    exe.write_bytes(b"rebuilt after the manifest")
    problems = publish.file_problems(publish.files(exe.parent, V, ["win32"]), V, ["win32"])
    assert any("sha256 does not match" in p for p in problems) and len(problems) == 2


def test_publish_preflight_refuses_an_unsigned_or_tampered_feed(exe: Path, key: Path) -> None:
    manifest.main(["--exe", str(exe), "--key", str(key), "--notes", "n"])
    latest = exe.parent / "latest.json"
    latest.write_bytes(latest.read_bytes().replace(b'"n"', b'"N"'))
    (problem,) = publish.file_problems(publish.files(exe.parent, V, ["win32"]), V, ["win32"])
    assert "signature is not valid" in problem
    (exe.parent / "latest.json.sig").unlink()
    assert publish.file_problems(publish.files(exe.parent, V, ["win32"]), V, ["win32"]) == [
        f"missing {exe.parent / 'latest.json.sig'}"]


def test_bump_rewrites_every_derived_copy(tmp_path: Path) -> None:
    for name in bump.REWRITES:
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, tmp_path / name)
    bump.rewrite(tmp_path, "98.7.6")
    assert bump.current(tmp_path) == "98.7.6"
    assert '"version": "98.7.6"' in (tmp_path / "apps/web/package.json").read_text(encoding="utf-8")
    assert '"version": "98.7.6"' in (tmp_path / "packages/contracts/openapi.json").read_text(encoding="utf-8")
    assert 'name = "researchos"\nversion = "98.7.6"' in (tmp_path / "uv.lock").read_text(encoding="utf-8")
    with pytest.raises(ValueError):
        bump.check_new("1.2.3", "1.2.3")


def test_local_update_e2e_with_a_fake_installer(tmp_path: Path) -> None:
    steps = {s.name: s.status for s in e2e.run(None, tmp_path)}
    assert steps == {
        "signed: check -> available": "PASS",
        "signed: download -> sha256 verified -> ready": "PASS",
        "unsigned: check -> update_unsigned": "PASS",
        "tampered-signature: check -> update_bad_signature": "PASS",
        "tampered-sha256: check -> available": "PASS",
        "tampered-sha256: download -> update_checksum_mismatch": "PASS",
        "tampered-sha256: installer deleted": "PASS",
        "mirror-down: check -> update_mirror_failed": "PASS",
        "mirror-down: retry without the mirror -> available": "PASS",
        "truncated: check -> available": "PASS",
        "truncated: download -> update_incomplete": "PASS",
        "truncated: nothing left in the download dir": "PASS",
        "asset-missing: check -> available": "PASS",
        "asset-missing: download -> update_asset_missing": "PASS",
        "asset-missing: nothing left in the download dir": "PASS",
        "racing-clicks: check -> available": "PASS",
        "racing-clicks: two clicks -> one download + update_busy": "PASS",
        "racing-clicks: the one download -> ready": "PASS",
        "mac-signed: check -> available": "PASS",
        "mac-signed: zip download -> sha256 verified -> ready": "PASS",
        "mac-signed: apply_update.sh -> the new version answers": "PASS",
        "mac-signed: app replaced, .prev and the unpack folder removed": "PASS",
        "mac-signed: update.log records the health check": "PASS",
        "mac-tampered: check -> available": "PASS",
        "mac-tampered: zip download -> update_checksum_mismatch": "PASS",
        "mac-tampered: the installed app is untouched and still answers": "PASS",
        "mac-rollback: check -> available": "PASS",
        "mac-rollback: zip download -> sha256 verified -> ready": "PASS",
        "mac-rollback: apply_update.sh -> health check fails -> exit 2": "PASS",
        "mac-rollback: previous app restored and answering": "PASS",
        "mac-rollback: the failed app kept as .failed, no .prev": "PASS",
        "mac-rollback: update.log records the rollback": "PASS",
        "mac-rollback: the restored version is health-checked": "PASS",
        "mac-rollback-slow: check -> available": "PASS",
        "mac-rollback-slow: zip download -> sha256 verified -> ready": "PASS",
        "mac-rollback-slow: apply_update.sh -> health check fails -> exit 2": "PASS",
        "mac-rollback-slow: previous app restored and answering": "PASS",
        "mac-rollback-slow: the failed app kept as .failed, no .prev": "PASS",
        "mac-rollback-slow: update.log records the rollback": "PASS",
        "mac-rollback-slow: the restored version is health-checked": "PASS",
        "mac-rollback-slow: the restore waits until the failed server has exited": "PASS",
        "mac-rollback-mv-fail: check -> available": "PASS",
        "mac-rollback-mv-fail: zip download -> sha256 verified -> ready": "PASS",
        "mac-rollback-mv-fail: apply_update.sh -> a move fails -> exit 3": "PASS",
        "mac-rollback-mv-fail: update.log reports the real state, not a restore": "PASS",
        "mac-rollback-mv-fail: nothing at the app path is opened after the failed move": "PASS",
        "mac-rollback-mv-fail: the recovery dirs are kept": "PASS",
        "mac-swap-mv-fail: check -> available": "PASS",
        "mac-swap-mv-fail: zip download -> sha256 verified -> ready": "PASS",
        "mac-swap-mv-fail: apply_update.sh -> a move fails -> exit 3": "PASS",
        "mac-swap-mv-fail: update.log reports the real state, not a restore": "PASS",
        "mac-swap-mv-fail: nothing at the app path is opened after the failed move": "PASS",
        "mac-swap-mv-fail: the recovery dirs are kept": "PASS",
        "mac-zip-swapped: check -> available": "PASS",
        "mac-zip-swapped: zip download -> sha256 verified -> ready": "PASS",
        "mac-zip-swapped: apply_update.sh refuses before unpacking -> exit 1": "PASS",
        "mac-zip-swapped: the old app is intact and answering again": "PASS",
        "mac-zip-swapped: update.log says why": "PASS",
        "mac-no-digest: check -> available": "PASS",
        "mac-no-digest: zip download -> sha256 verified -> ready": "PASS",
        "mac-no-digest: apply_update.sh refuses before unpacking -> exit 1": "PASS",
        "mac-no-digest: the old app is intact and answering again": "PASS",
        "mac-no-digest: update.log says why": "PASS",
        "install (silent setup hand-off)": "NOT RUN",
    }


def test_e2e_reports_fail_when_the_served_installer_differs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    real = e2e.good_run
    monkeypatch.setattr(e2e, "good_run", lambda up, digest: real(up, "0" * 64))
    assert not e2e.report(e2e.run(None, tmp_path))


def _notes(d: Path) -> Path:
    p = d / "notes.md"
    p.write_text("line one\n", encoding="utf-8")
    return p


def _zip(d: Path, name: str = f"ResearchOS-{V}-mac-arm64.zip") -> Path:
    p = d / name
    p.write_bytes(b"PK fake mac app zip")
    return p


def test_a_windows_only_manifest_has_no_platforms_key(exe: Path, key: Path) -> None:
    assert manifest.main(["--exe", str(exe), "--key", str(key), "--notes", "n"]) == 0
    assert list(json.loads((exe.parent / "latest.json").read_bytes())) == ["version", "asset", "sha256", "url",
                                                                           "notes", "notes_zh"]


def test_manifest_adds_the_mac_zip_and_publish_uploads_it(exe: Path, key: Path, monkeypatch: pytest.MonkeyPatch,
                                                          capsys: pytest.CaptureFixture[str]) -> None:
    z = _zip(exe.parent)
    assert manifest.main(["--exe", str(exe), "--mac-zip", str(z), "--key", str(key), "--notes", "n"]) == 0
    raw, sig = (exe.parent / "latest.json").read_bytes(), _sig(exe.parent)
    mac = parse_release(raw, Settings.update_feed_url, sig, platform="darwin-arm64")
    assert (mac.asset, mac.url) == (z.name, common.download_url(V, platform="darwin-arm64"))
    assert (exe.parent / f"{z.name}.sha256").read_text() == f"{mac.sha256}  {z.name}\n"
    assert parse_release(raw, Settings.update_feed_url, sig).asset == exe.name
    # the published feed as installed 0.1.3 / 0.1.4 clients read it: still the exe (ADR-266/270)
    assert v013.parse_release(raw, Settings.update_feed_url).asset == exe.name
    assert v014.parse_release(raw, Settings.update_feed_url, sig).asset == exe.name
    monkeypatch.setattr(publish, "git_problems", lambda tag: [])
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran")))
    assert publish.main(["--dir", str(exe.parent)]) == 0
    out = capsys.readouterr().out
    assert str(z) in out and str(exe.parent / f"{z.name}.sha256") in out and str(exe) in out
    z.write_bytes(b"PK swapped after signing")
    assert publish.main(["--dir", str(exe.parent)]) == 1
    assert f"latest.json sha256 does not match {z.name}" in capsys.readouterr().err


def test_manifest_refuses_a_wrong_or_misplaced_mac_zip(exe: Path, key: Path, tmp_path: Path) -> None:
    wrong = _zip(exe.parent, "ResearchOS-0.0.1-mac-arm64.zip")
    assert manifest.main(["--exe", str(exe), "--mac-zip", str(wrong), "--key", str(key), "--notes", "n"]) == 1
    (tmp_path / "elsewhere").mkdir()
    away = _zip(tmp_path / "elsewhere")
    assert manifest.main(["--exe", str(exe), "--mac-zip", str(away), "--key", str(key), "--notes", "n"]) == 1
    z = _zip(exe.parent)
    assert manifest.main(["--exe", str(exe), "--mac-zip", str(z), "--mac-zip", str(z), "--key", str(key),
                          "--notes", "n"]) == 1
    assert not (exe.parent / "latest.json").exists()

"""Platform adapter: path rules (Windows rules tested on every OS), Mac install dirs (fake home), process-tree kill,
PID-reuse guard."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import pytest

from researchos.kernel import config
from researchos.platform import IS_WINDOWS, macos, paths
from researchos.platform.process import detached_kwargs, kill_tree, pid_alive, spawn


@pytest.mark.parametrize("name", ["CON", "con.txt", "COM1.pdf", "a<b", "a:b", "x?", "trail.", "trail ", "..", ""])
def test_rejects_windows_illegal_names(name: str) -> None:
    with pytest.raises(paths.PathRuleError):
        paths.check_component(name)


@pytest.mark.parametrize("name", ["Smith2020.pdf", "张三2023-论文.pdf", "a.b.c", "CONSOLE.txt"])
def test_accepts_normal_names(name: str) -> None:
    paths.check_component(name)


def test_compare_key_case_and_unicode() -> None:
    assert paths.compare_key("A/Smith.PDF", windows=True) == paths.compare_key("a/smith.pdf", windows=True)
    assert paths.compare_key("A", windows=False) != paths.compare_key("a", windows=False)
    assert paths.compare_key("e\u0301", windows=False) == paths.compare_key("\u00e9", windows=False)


@pytest.mark.parametrize("raw", ["C:foo", "\\\\server\\share\\x", "C:\\a\\b.txt:stream"])
def test_dangerous_windows_syntax(raw: str) -> None:
    with pytest.raises(paths.PathRuleError):
        paths.reject_dangerous_syntax(raw, windows=True)


def test_stored_paths_relative(tmp_path: Path) -> None:
    f = tmp_path / "raw" / "x.pdf"
    f.parent.mkdir()
    f.write_text("x")
    assert paths.to_stored(tmp_path, f) == "raw/x.pdf"
    with pytest.raises(paths.PathRuleError):
        paths.from_stored(tmp_path, "../etc/passwd")


def test_symlink_escape_detected(tmp_path: Path) -> None:
    root, outside = tmp_path / "root", tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (root / "link").symlink_to(outside, target_is_directory=True)
    assert paths.has_reparse_point(root / "link" / "f.txt", root)
    assert not paths.is_within(root, root / "link" / "f.txt")
    assert paths.is_within(root, root / "sub" / "f.txt")


@pytest.mark.skipif(IS_WINDOWS, reason="POSIX process-group path; Windows Job Object covered by selftest.ps1")
def test_kill_tree_kills_grandchildren(tmp_path: Path) -> None:
    script = ("import subprocess,sys,time; "
              "subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); time.sleep(60)")
    child = spawn([sys.executable, "-c", script], cwd=tmp_path, env={"PATH": "/usr/bin:/bin"},
                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.5)
    import psutil
    kids = psutil.Process(child.pid).children(recursive=True)
    assert kids
    assert kill_tree(child.pid, child.create_time, grace_s=0.5)
    child.popen.wait(timeout=5)
    time.sleep(0.2)
    assert not any(k.is_running() and k.status() != psutil.STATUS_ZOMBIE for k in kids)


def test_pid_reuse_guard() -> None:
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"])
    try:
        assert pid_alive(p.pid, None)
        assert not pid_alive(p.pid, 12345.0)  # wrong create_time => treated as a different process
    finally:
        p.kill()
        p.wait()


def test_mac_bundle_detected_only_for_the_app_layout(tmp_path: Path) -> None:
    app = tmp_path / "Applications" / "ResearchOS.app"
    assert macos.app_bundle(app / "Contents" / "Resources" / "app") == app
    for not_bundled in (tmp_path / "repo", app / "Contents" / "Resources" / "lib",
                        tmp_path / "ResearchOS" / "Contents" / "Resources" / "app",
                        tmp_path / "x" / "Resources" / "app"):
        assert macos.app_bundle(not_bundled) is None


def test_mac_data_and_logs_outside_the_bundle_with_a_fake_home(tmp_path: Path) -> None:
    home = tmp_path / "Users" / "owner"
    root = tmp_path / "Applications" / "ResearchOS.app" / "Contents" / "Resources" / "app"
    dirs = macos.bundled_dirs(root, home, platform="darwin")
    assert dirs == macos.UserDirs(data=home / "Library" / "Application Support" / "ResearchOS",
                                  logs=home / "Library" / "Logs" / "ResearchOS")
    assert macos.bundled_dirs(tmp_path / "checkout", home, platform="darwin") is None  # dev checkout: <repo>/data
    assert macos.bundled_dirs(root, home, platform="linux") is None
    assert macos.bundled_dirs(root, home, platform="win32") is None


def test_bundled_mac_settings_use_the_user_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    monkeypatch.setattr(config, "_bundled", lambda: macos.user_dirs(home))
    monkeypatch.delenv("RESEARCHOS_DATA_DIR", raising=False)
    monkeypatch.delenv("RESEARCHOS_LOG_DIR", raising=False)
    if sys.platform != "win32":
        s = config.load_settings()
        assert s.data_dir == home / "Library" / "Application Support" / "ResearchOS"
        assert s.logs_dir == home / "Library" / "Logs" / "ResearchOS"
    s = config.load_settings(tmp_path / "d")
    assert s.data_dir == tmp_path / "d" and s.logs_dir == home / "Library" / "Logs" / "ResearchOS"


def test_settings_logs_default_to_the_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RESEARCHOS_LOG_DIR", raising=False)
    assert config.load_settings(tmp_path).logs_dir == tmp_path / "logs"
    monkeypatch.setenv("RESEARCHOS_LOG_DIR", str(tmp_path / "elsewhere"))
    assert config.load_settings(tmp_path).logs_dir == tmp_path / "elsewhere"


@pytest.mark.skipif(IS_WINDOWS, reason="POSIX session flag; Windows flags covered by selftest.ps1")
def test_detached_children_get_their_own_session() -> None:
    assert detached_kwargs() == {"start_new_session": True} == detached_kwargs(breakaway=True)

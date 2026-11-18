"""Build the portable Windows folder (ADR-278): unzip, double-click Start-ResearchOS.bat, nothing to install.

    ResearchOS/
      Start-ResearchOS.bat        double-click: the app opens in the browser (this computer only)
      Start-with-phone.bat        same, but the phone on the same Wi-Fi can pair (shows the address to type)
      Stop-ResearchOS.bat         stops the server and the worker
      README.txt                  the same in Chinese (UTF-8 with BOM, so Notepad shows it)
      app/                        the staged app (build_package.stage_app) + app/python, the embedded CPython 3.12
                                  with every win_amd64 wheel already unpacked into Lib/site-packages
      data/config/researchos.toml data lives next to app/ (launch.ps1 picks it up), so the folder can move

Same runtime and wheel set as the setup .exe (win_runtime.prepare: python.org embeddable zip checked against its
published MD5, wheels exactly as uv.lock pins them for Windows), installed here with
`uv pip install --target --python-platform x86_64-pc-windows-msvc`. Built and started headless (health checked,
both launchers) on a GitHub Windows runner by .github/workflows/desktop-windows.yml before it is uploaded.

Usage: python scripts/build_portable.py OUT_DIR   (the web build must exist)"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_package  # noqa: E402
import win_runtime  # noqa: E402

NAME = "ResearchOS"
CONFIG = ('host = "127.0.0.1"\r\nport = 8443\r\n'
          "# Start-with-phone.bat listens on this computer's Wi-Fi address instead (see README.txt)\r\n")
# cmd reads .bat files in the console code page: keep them ASCII; everything a person reads is in README.txt
BAT = ('@echo off\r\nstart "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden '
       '-File "%~dp0app\\scripts\\{script}"{args}\r\n')
LAUNCHERS = {"Start-ResearchOS.bat": ("launch.ps1", ""), "Start-with-phone.bat": ("launch.ps1", " -Phone"),
             "Stop-ResearchOS.bat": ("stop.ps1", ' -DataDir "%~dp0data"')}
README = """思维账本 电脑端（Windows，免安装）

打开
  双击 Start-ResearchOS.bat。几秒后浏览器会打开思维账本。
  第一次打开会弹出一个「设置口令」（已复制好），在浏览器里粘贴它，建自己的账号。
  不用装 Python，也不用敲命令。
  如果 Windows 弹出「是否运行此文件」之类的安全提示，点「运行」。

让手机也能连（手机和电脑连同一个 Wi-Fi）
  1. 双击 Start-with-phone.bat。弹窗会显示一个地址，形如 http://192.168.1.23:8443
     Windows 防火墙如果问要不要允许，点「允许」（只勾「专用网络」就够）。
  2. 电脑浏览器里：设置 → 设备 → 配对设备，拿到 8 位配对码。
  3. 手机思维账本：设置 → 打开「连接电脑（增强功能）」→ 电脑地址填弹窗里的地址 → 输入配对码 → 配对。
  配对一次就行，关掉 App 再打开不用重配。电脑上撤销这台设备后，手机要重新配对。

关闭
  双击 Stop-ResearchOS.bat，或者直接关机。

数据
  都在旁边的 data 文件夹里。整个 ResearchOS 文件夹可以挪位置，data 跟着走就行。
  出问题时看 data\\logs\\launcher.log。

说明
  这个包在 GitHub 的 Windows 云电脑上自动解压、启动并检查过；作者没有在真实的 Windows 电脑上试过。
"""


def build(out_dir: Path) -> Path:
    if not (ROOT / "apps/web/dist/index.html").is_file():
        raise SystemExit("web build missing: cd apps/web && pnpm install && pnpm run build")
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                            text=True).stdout.strip()
    top = out_dir / NAME
    app = top / "app"
    manifest = build_package.stage_app(app, commit, {**build_package.ACCEPTANCE,
                                                     "portable": "started headless on a GitHub Windows runner only"})
    with tempfile.TemporaryDirectory() as td:
        runtime = win_runtime.prepare(Path(td))
        shutil.move(Path(td) / "python", app / "python")  # %TEMP% may be on another drive
        wheels = Path(td) / "wheels"
        subprocess.run(["uv", "pip", "install", "-q", "--target", str(app / "python" / "Lib" / "site-packages"),
                        "--python-platform", "x86_64-pc-windows-msvc", "--python-version", "3.12", "--no-index",
                        "--no-deps", "--find-links", str(wheels), "-r", str(wheels / "install.txt")],
                       check=True, cwd=ROOT)
    (top / "data" / "config").mkdir(parents=True)
    (top / "data" / "config" / "researchos.toml").write_bytes(CONFIG.encode("ascii"))
    for name, (script, args) in LAUNCHERS.items():
        (top / name).write_bytes(BAT.format(script=script, args=args).encode("ascii"))
    (top / "README.txt").write_bytes(README.replace("\n", "\r\n").encode("utf-8-sig"))
    report = {"version": manifest["version"], "git": commit, "app_files": len(manifest["files"]),  # type: ignore[arg-type]
              "runtime": runtime}
    (out_dir / f"{NAME}-portable.build.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return top


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    print(build(Path(sys.argv[1])))

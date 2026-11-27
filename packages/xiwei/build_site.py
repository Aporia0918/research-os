"""把引擎打包给手机：Pyodide 核心文件 + site.zip（钉死版本的纯 Python 包和 xiwei 本身，不含各包的测试）。

用法：python build_site.py <输出目录，如 apps/mobile/public/engine>
Pyodide 从 npm 官方源下载固定版本并核对 SHA-256；依赖按 requirements.txt 的哈希下载。
手机端在后台线程里加载 Pyodide，把 site.zip 解到虚拟文件系统里再 import xiwei（见 apps/mobile/src/xiwei/engine.worker.ts）。
"""

from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
PYODIDE = ("https://registry.npmjs.org/pyodide/-/pyodide-0.27.7.tgz",
           "89d5d952675eb08e11286e52c7238f1248ce71726e896db9703e73bef23dc343")
CORE = ("pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json")
SKIP = ("/tests/", "/testing/", "/benchmarks/", "__pycache__", ".dist-info/RECORD")


def pyodide(out: Path) -> None:
    url, digest = PYODIDE
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise SystemExit("Pyodide 包的哈希对不上，停止打包")
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for name in CORE:
            (out / name).write_bytes(tar.extractfile(f"package/{name}").read())  # type: ignore[union-attr]


def site(out: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(out / "site.zip", "w", zipfile.ZIP_DEFLATED) as z:
        subprocess.run([sys.executable, "-m", "pip", "download", "-q", "--no-deps", "--only-binary=:all:", "--require-hashes",
                        "-r", str(HERE / "requirements.txt"), "-d", tmp], check=True)
        for whl in sorted(Path(tmp).glob("*.whl")):
            with zipfile.ZipFile(whl) as w:
                for item in w.infolist():
                    if not any(s in f"/{item.filename}" for s in SKIP):
                        z.writestr(item, w.read(item))
        for f in sorted((HERE / "xiwei").glob("*.py")):
            z.write(f, f"xiwei/{f.name}")


if __name__ == "__main__":
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    pyodide(target)
    site(target)
    print(f"engine → {target} ({sum(f.stat().st_size for f in target.iterdir()) / 2**20:.1f} MB)")

"""Release manifest (ADR-225/228/266): for release/ResearchOS-Setup-<v>.exe (and the Mac zips built by the
mac-build workflow, `--mac-zip`, e.g. ResearchOS-<v>-mac-arm64.zip) write, next to it, <asset>.sha256
("<hex>  <name>") for each, latest.json = the updater feed {version, asset, sha256, url, notes, notes_zh} (ADR-223)
plus `platforms: {"darwin-arm64": {asset, sha256, url}}` when Mac zips are given, and latest.json.sig, its detached
Ed25519 signature over the whole file made with the release key (kept outside the repo, on the maintainer machine
only: $RESEARCHOS_UPDATE_KEY, default ~/.config/researchos/keys/update-release.pem). url =
https://github.com/<owner>/<repo>/releases/download/v<v>/<asset> (owner/repo from the default Settings.update_feed_url).
Signed feed + signature are checked with update_feed.parse_release (embedded trusted keys, every platform) before
anything is written.

Usage: python scripts/release/manifest.py (--notes TEXT | --notes-file FILE) [--notes-zh-file FILE] [--exe PATH]
           [--mac-zip PATH ...] [--key PEM]   (default exe: release/ResearchOS-Setup-<pyproject version>.exe)"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from researchos import __version__
from researchos.kernel.backup import file_sha256
from researchos.services.ops.update_feed import MAC_ARCHES, UpdateError, asset_name, parse_release, signature_url
from researchos.services.ops.update_signing import TRUSTED_KEYS, load_private, sign

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import FEED_URL, SIGNING_KEY, default_exe, download_url, json_bytes, sha256_line  # noqa: E402

FEED, SIG = "latest.json", Path(signature_url("latest.json")).name


def entry(path: Path, url: str) -> dict[str, str]:
    return {"asset": path.name, "sha256": file_sha256(path), "url": url}


def feed(exe: Path, version: str, url: str, notes: str, notes_zh: str = "",
         platforms: Mapping[str, dict[str, str]] | None = None) -> dict[str, object]:
    """The top level stays exactly the Windows feed of 0.1.3/0.1.4; `platforms` only when a Mac zip is released."""
    meta: dict[str, object] = {"version": version, **entry(exe, url), "notes": notes, "notes_zh": notes_zh}
    if platforms:
        meta["platforms"] = dict(platforms)
    return meta


def mac_platforms(zips: Sequence[Path], version: str, exe_dir: Path) -> dict[str, Path]:
    """{feed platform key: zip} from the zip names (ResearchOS-<v>-mac-<arch>.zip): one zip per platform, each in
    the exe's folder."""
    names = {asset_name(version, k): k for k in MAC_ARCHES}
    out = {}
    for z in zips:
        if z.name not in names or names[z.name] in out:
            raise ValueError(f"{z.name}: not one of {', '.join(names)} or given twice")
        if z.parent.resolve() != exe_dir.resolve():
            raise ValueError(f"{z.name}: put it next to the exe ({exe_dir}); publish uploads from that folder")
        out[names[z.name]] = z
    return out


def signed(meta: Mapping[str, object], key: Ed25519PrivateKey, feed_url: str,
           trusted: Mapping[str, str] = TRUSTED_KEYS) -> tuple[bytes, bytes]:
    """(feed bytes, signature) that the updater accepts with its embedded keys for every platform in the feed
    (raises UpdateError otherwise)."""
    raw = json_bytes(meta)
    sig = sign(raw, key).encode("ascii")
    platforms = meta.get("platforms")
    for platform in ("win32", *(platforms if isinstance(platforms, dict) else ())):
        parse_release(raw, feed_url, sig, trusted, platform)
    return raw, sig


def write_release(exe: Path, version: str, notes: str, *, url: str, feed_url: str, out_dir: Path,
                  key: Ed25519PrivateKey, notes_zh: str = "", trusted: Mapping[str, str] = TRUSTED_KEYS,
                  mac: Mapping[str, tuple[Path, str]] | None = None) -> dict[str, object]:
    """Write <asset>.sha256 per asset, latest.json and latest.json.sig into `out_dir`; returns the feed. `mac` maps
    a platform key to (zip, download URL)."""
    if exe.name != asset_name(version):
        raise ValueError(f"{exe.name} is not {asset_name(version)}")
    platforms = {k: entry(z, u) for k, (z, u) in (mac or {}).items()}
    meta = feed(exe, version, url, notes, notes_zh, platforms)
    raw, sig = signed(meta, key, feed_url, trusted)
    for asset, digest in ((exe.name, str(meta["sha256"])), *((e["asset"], e["sha256"]) for e in platforms.values())):
        (out_dir / f"{asset}.sha256").write_text(sha256_line(digest, asset), encoding="utf-8")
    (out_dir / FEED).write_bytes(raw)
    (out_dir / SIG).write_bytes(sig)
    return meta


def _text(inline: str | None, path: str | None) -> str:
    return Path(path).read_text(encoding="utf-8").strip() if path else str(inline or "").strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exe", type=Path, default=default_exe())
    ap.add_argument("--mac-zip", type=Path, action="append", default=[],
                    help="a Mac app zip from the mac-build workflow (repeatable, one per platform)")
    ap.add_argument("--key", type=Path, default=SIGNING_KEY)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--notes")
    group.add_argument("--notes-file")
    ap.add_argument("--notes-zh-file", help="Chinese release notes for the in-app 'What's new'")
    args = ap.parse_args(argv)
    exe: Path = args.exe
    for p, hint in ((exe, "build it with scripts/build_package.py"), (args.key, "create it with keygen.py"),
                    *((z, "download it from the mac-build workflow run") for z in args.mac_zip)):
        if not p.is_file():
            print(f"manifest: {p} not found ({hint})", file=sys.stderr)
            return 2
    try:
        mac = {k: (z, download_url(__version__, FEED_URL, k))
               for k, z in mac_platforms(args.mac_zip, __version__, exe.parent).items()}
        meta = write_release(exe, __version__, _text(args.notes, args.notes_file), url=download_url(__version__),
                             feed_url=FEED_URL, out_dir=exe.parent, key=load_private(args.key.read_bytes()),
                             notes_zh=_text(None, args.notes_zh_file), mac=mac)
    except (ValueError, UpdateError) as e:
        print(f"manifest: {e}", file=sys.stderr)
        return 1
    print(f"{exe.parent / FEED} (+ {SIG}): {meta['version']} {meta['sha256']}\n{meta['url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

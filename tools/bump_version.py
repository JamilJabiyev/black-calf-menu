#!/usr/bin/env python3
"""Set one release version everywhere it is used for cache busting (dev tool).

    python3 tools/bump_version.py 2026-12-01-r1

Updates VERSION in sw.js and every ?v= in index.html, qr.html and js/*.js.
tools/check.py fails if they ever disagree.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["sw.js", "index.html", "qr.html"] + [str(p.relative_to(ROOT)) for p in sorted((ROOT / "js").glob("*.js"))]


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"[0-9A-Za-z.-]+", sys.argv[1]):
        raise SystemExit("usage: bump_version.py <version, e.g. 2026-12-01-r1>")
    version = sys.argv[1]
    for name in FILES:
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        new = re.sub(r"\?v=[0-9A-Za-z.-]+", "?v=" + version, text)
        new = re.sub(r"const VERSION = '[^']+';", f"const VERSION = '{version}';", new)
        if new != text:
            path.write_text(new, encoding="utf-8")
            print("updated", name)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Rebuild the self-hosted font subsets in fonts/ (dev tool, never loaded by the site).

Uses the Google Fonts CSS2 API `text=` parameter, so no font tooling is needed.
Run once after changing the character sets:  python3 tools/fetch_fonts.py

Why per-language files: one file with AZ+RU+EN alphabets weighs 72 KB for both families,
the perf budget is 45 KB. Splitting by page language keeps every page under budget,
and Unbounded is only ever rendered uppercase, so it ships capitals only.
"""
import pathlib
import re
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts"
# A modern UA makes the API answer with woff2.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"

UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
LOWER = "abcdefghijklmnopqrstuvwxyz"
DIGITS = "0123456789"
PUNCT = " !\"%&'()*+,-./:;?~  «»—–·−№…‘’“”„×→↑₼"
AZ_UPPER = "ƏĞİŞÇÖÜ"
AZ_LOWER = "əğışçöüñ"  # ñ: "Jalapeños" on the EN page, which shares the AZ files
CYR_UPPER = "".join(chr(c) for c in range(0x410, 0x430)) + "Ё"
CYR_LOWER = "".join(chr(c) for c in range(0x430, 0x450)) + "ё"

FILES = {
    # file name: (Google family spec, characters)
    "unbounded-800-caps-az.woff2": ("Unbounded:wght@800", UPPER + DIGITS + PUNCT + AZ_UPPER),
    "unbounded-800-caps-ru.woff2": ("Unbounded:wght@800", UPPER + DIGITS + PUNCT + "Ü" + CYR_UPPER),
    "onest-400-700-az.woff2": ("Onest:wght@400..700", UPPER + LOWER + DIGITS + PUNCT + AZ_UPPER + AZ_LOWER),
    "onest-400-ru.woff2": ("Onest:wght@400", UPPER + LOWER + DIGITS + PUNCT + "Üü" + CYR_UPPER + CYR_LOWER),
    "onest-700-ru.woff2": ("Onest:wght@700", UPPER + LOWER + DIGITS + PUNCT + "Üü" + CYR_UPPER + CYR_LOWER),
}


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main():
    OUT.mkdir(exist_ok=True)
    for name, (family, chars) in FILES.items():
        query = urllib.parse.urlencode({"family": family, "text": chars, "display": "swap"})
        css = fetch("https://fonts.googleapis.com/css2?" + query).decode()
        match = re.search(r"url\((https://[^)]+)\) format\('woff2'\)", css)
        if not match:
            raise SystemExit("no woff2 in response for " + name)
        data = fetch(match.group(1))
        (OUT / name).write_bytes(data)
        print(f"{name}: {len(data)} B")


if __name__ == "__main__":
    main()

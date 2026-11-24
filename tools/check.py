#!/usr/bin/env python3
"""Pre-commit checks for the QR menu. Python 3.9+, standard library only.

    python3 tools/check.py

Checks: menu.json is valid; legal invariants (no halal_tbd / internal secret, allergens on every item,
AZ/RU/EN everywhere, set arithmetic); every ui string the views use exists; no third-party URLs in
the page; a single innerHTML sink; gzip sizes against the perf budget. Exit code 1 on any failure.
"""
import gzip
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANGS = ("az", "ru", "en")
VISIBLE_TAGS = {"hit", "new", "spicy", "veg"}
INTERNAL_TAGS = {"hero"}
SET_PART_PREFIXES = ("extra-sauce", "durum", "fries", "drink")
FORBIDDEN_UI_WORDS = re.compile(r"(самый|лучший|\bbest\b|\bonly\b|№\s*1\b|\bən\b)", re.IGNORECASE)

KB = 1024
# perf/2026-11-24-qr-redesign-budget.md, measured as gzip -9 bytes (woff2 as is)
BUDGET = {
    "html": 6 * KB, "css": 10 * KB, "js": 12 * KB, "json": 12 * KB,
    "first_screen": 40 * KB, "fonts": 45 * KB, "font_files": 3, "total": 100 * KB,
}
# Documented deviations awaiting a perf decision: key -> (hard ceiling, reason). Printed, never silent.
EXCEPTIONS = {
    "JS incl. sw.js": (16 * KB, "Jarvis round 2: unminified source, no build step (charter limit 25 KB)"),
}
PAGE_CSS = ["css/app.css"]
PAGE_JS = ["js/main.js", "js/model.js", "js/views.js", "sw.js"]
FONTS_BY_LANG = {
    "az": ["fonts/unbounded-800-caps-az.woff2", "fonts/onest-400-700-az.woff2"],
    "en": ["fonts/unbounded-800-caps-az.woff2", "fonts/onest-400-700-az.woff2"],
    "ru": ["fonts/unbounded-800-caps-ru.woff2", "fonts/onest-400-ru.woff2", "fonts/onest-700-ru.woff2"],
}

errors = []


def fail(message):
    errors.append(message)


def cents(value):
    return round(value * 100)


def gz(path):
    return len(gzip.compress((ROOT / path).read_bytes(), compresslevel=9))


# ---------- menu.json ----------

def load_menu():
    try:
        return json.loads((ROOT / "menu.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        fail(f"menu.json is not valid JSON: {error}")
        return None


def check_l10n(where, value, required=True):
    if value is None and not required:
        return
    if not isinstance(value, dict) or any(not str(value.get(lang, "")).strip() for lang in LANGS):
        fail(f"{where}: needs non-empty az/ru/en")


def check_leaks(menu):
    text = json.dumps(menu, ensure_ascii=False)
    if "halal" in text.lower():
        fail("menu.json mentions halal (decision 11: remove halal_tbd from public data)")
    if "secret_item_internal" in text:
        fail("menu.json contains secret_item_internal (decision 11)")


def check_items(menu):
    legend = menu.get("allergen_legend", {})
    index = {}
    for category in menu["categories"]:
        check_l10n(f"category {category.get('id')} name", category.get("name"))
        for item in category.get("items", []):
            item_id = item.get("id", "?")
            index[item_id] = item
            check_l10n(f"{item_id} name", item.get("name"))
            check_l10n(f"{item_id} description", item.get("description"))
            check_l10n(f"{item_id} short_description", item.get("short_description"), required=False)
            if not isinstance(item.get("allergens"), list):
                fail(f"{item_id}: allergens must be a list (legal: allergens on every item)")
            keys = list(item.get("allergens") or [])
            keys += [k for v in item.get("variants", []) for k in (v.get("allergens") or [])]
            for key in keys:
                if key not in legend:
                    fail(f"{item_id}: allergen '{key}' missing in allergen_legend")
            for tag in item.get("tags", []):
                if tag not in VISIBLE_TAGS | INTERNAL_TAGS:
                    fail(f"{item_id}: tag '{tag}' is not whitelisted")
            if not item.get("variants") and not (isinstance(item.get("price"), (int, float)) and item["price"] > 0):
                fail(f"{item_id}: needs a positive price or variants")
            for variant in item.get("variants", []):
                check_l10n(f"{item_id}:{variant.get('id')} name", variant.get("name"))
    return index


def price_of(ref, index):
    item_id, _, variant_id = ref.partition(":")
    item = index.get(item_id)
    if item is None:
        return None
    variants = item.get("variants", [])
    if variant_id:
        match = [v for v in variants if v.get("id") == variant_id]
        return cents(match[0]["price"]) if match else None
    if variants:
        default = next((v for v in variants if v.get("default")), variants[0])
        return cents(default["price"])
    return cents(item["price"])


def allergens_of(ref, index):
    item_id, _, variant_id = ref.partition(":")
    item = index.get(item_id, {})
    variant = next((v for v in item.get("variants", []) if v.get("id") == variant_id), {})
    return set(variant["allergens"]) if "allergens" in variant else set(item.get("allergens") or [])


def check_set_allergens(item, refs, choices, index):
    """BA AC-06.7: a set lists the allergens of every possible choice."""
    every = set(refs) | {ref for options in choices.values() for ref in options}
    missing = set().union(*(allergens_of(ref, index) for ref in every)) - set(item.get("allergens") or [])
    if missing:
        fail(f"{item['id']}: allergens miss {sorted(missing)} from possible choices")


def check_sets(index):
    for item in index.values():
        refs = item.get("set_items")
        if not refs:
            continue
        item_id = item["id"]
        prices = [price_of(ref, index) for ref in refs]
        if None in prices:
            fail(f"{item_id}: set_items reference a missing item/variant")
            continue
        separately = sum(prices)
        price = cents(item["price"])
        if cents(item.get("price_separately", 0)) != separately:
            fail(f"{item_id}: price_separately {item.get('price_separately')} != sum of items {separately / 100:.2f}")
        if cents(item.get("savings", 0)) != separately - price:
            fail(f"{item_id}: savings {item.get('savings')} != {(separately - price) / 100:.2f}")
        choices = item.get("set_choices", {})
        low = high = 0
        for ref in refs:
            slot = next((options for options in choices.values() if ref in options), [ref])
            slot_prices = [price_of(option, index) for option in slot]
            if None in slot_prices:
                fail(f"{item_id}: set_choices reference a missing item/variant")
                break
            low += min(slot_prices)
            high += max(slot_prices)
        expected = [round((low - price) / 100, 2), round((high - price) / 100, 2)]
        if "savings_range" in item and [round(x, 2) for x in item["savings_range"]] != expected:
            fail(f"{item_id}: savings_range {item['savings_range']} != {expected}")
        check_set_allergens(item, refs, choices, index)
        if low - price <= 0:
            fail(f"{item_id}: set is not cheaper for every choice")
        for ref in refs:
            if not ref.startswith(SET_PART_PREFIXES):
                fail(f"{item_id}: '{ref}' has no formula part (see SET_PARTS in js/model.js)")


def check_ui(menu):
    ui = menu.get("ui", {})
    views = (ROOT / "js/views.js").read_text(encoding="utf-8") + (ROOT / "js/main.js").read_text(encoding="utf-8")
    used = {key for args in re.findall(r"\bt\(([^()]*)\)", views) for key in re.findall(r"'([a-z_]+)'", args)}
    for key in sorted(used):
        if key not in ui:
            fail(f"ui.{key} is used by the views but missing in menu.json")
    for key, value in ui.items():
        nested = value.values() if all(isinstance(v, dict) for v in value.values()) else [value]
        for entry in nested:
            check_l10n(f"ui.{key}", entry)
            for lang in LANGS:
                if FORBIDDEN_UI_WORDS.search(str(entry.get(lang, ""))):
                    fail(f"ui.{key}.{lang}: superlative claim is not allowed (legal)")


# ---------- code ----------

def check_versions(sw):
    """sw.js VERSION and every ?v= must match, or a guest gets new HTML with old cached JS/CSS."""
    match = re.search(r"const VERSION = '([^']+)'", sw)
    version = match.group(1) if match else None
    files = ["index.html", "qr.html"] + [str(p.relative_to(ROOT)) for p in sorted((ROOT / "js").glob("*.js"))]
    for name in files:
        for found in re.findall(r"\?v=([0-9A-Za-z.-]+)", (ROOT / name).read_text(encoding="utf-8")):
            if found != version:
                fail(f"{name}: ?v={found} but sw.js VERSION is {version} (run tools/bump_version.py)")
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    for ref in ("css/app.css", "js/main.js", "js/model.js", "js/views.js"):
        if f"{ref}?v=" not in index_html:
            fail(f"index.html loads {ref} without ?v=")


def check_code():
    page_files = ["index.html", "sw.js"] + PAGE_CSS + PAGE_JS
    for path in page_files:
        text = (ROOT / path).read_text(encoding="utf-8")
        for url in re.findall(r"https?://[^\s'\")]+", text):
            if not url.startswith(("http://www.w3.org/", "https://wa.me/", "https://www.instagram.com/")):
                fail(f"{path}: third-party URL {url}")
        if re.search(r"\bhalal", text, re.IGNORECASE):
            fail(f"{path}: mentions halal")
    for path in sorted((ROOT / "js").glob("*.js")):
        text = path.read_text(encoding="utf-8")
        sinks = len(re.findall(r"\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML", text))
        allowed = 1 if path.name == "views.js" else 0
        if sinks != allowed:
            fail(f"js/{path.name}: {sinks} innerHTML sinks (only views.js#mount may have one)")
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    for ref in re.findall(r'(?:href|src)="((?:css|js|fonts|assets)/[^"?]+)', index_html):
        if not (ROOT / ref).exists():
            fail(f"index.html references missing file {ref}")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    for ref in re.findall(r"(?:css|js)/[\w.-]+\.(?:css|js)|menu\.json", sw.split("const FONTS")[0]):
        if not (ROOT / ref).exists():
            fail(f"sw.js precaches missing file {ref}")
    check_versions(sw)
    for files in FONTS_BY_LANG.values():
        for font in files:
            if not (ROOT / font).exists():
                fail(f"missing font {font}")
    if not (ROOT / "fonts/OFL.txt").exists():
        fail("fonts/OFL.txt (font licence) is missing")


# ---------- budget ----------

def check_budget():
    html_b = gz("index.html")
    css_b = sum(gz(p) for p in PAGE_CSS)
    js_b = sum(gz(p) for p in PAGE_JS)
    json_b = gz("menu.json")
    first = html_b + css_b + sum(gz(p) for p in PAGE_JS if p != "sw.js") + json_b
    sw_b = gz("sw.js")  # downloaded after load, still part of the first visit
    rows = [("HTML (incl. inline SVG sprite)", html_b, BUDGET["html"]), ("CSS", css_b, BUDGET["css"]),
            ("JS incl. sw.js", js_b, BUDGET["js"]), ("menu.json", json_b, BUDGET["json"]),
            ("First screen without fonts", first, BUDGET["first_screen"])]
    for lang, files in FONTS_BY_LANG.items():
        size = sum((ROOT / f).stat().st_size for f in files)
        rows.append((f"Fonts {lang} ({len(files)} files)", size, BUDGET["fonts"]))
        rows.append((f"Total first visit {lang} (incl. sw.js)", first + sw_b + size, BUDGET["total"]))
        if len(files) > BUDGET["font_files"]:
            fail(f"fonts {lang}: {len(files)} files > {BUDGET['font_files']}")
    print("Budget (gzip -9 bytes):")
    for name, size, limit in rows:
        ceiling, reason = EXCEPTIONS.get(name, (limit, ""))
        mark = "ok  " if size <= limit else "EXC " if size <= ceiling else "OVER"
        note = f"  <- exception: {reason}" if mark == "EXC " else ""
        print(f"  {mark} {name:34} {size / KB:6.1f} KB / {limit / KB:.0f} KB{note}")
        if size > ceiling:
            fail(f"budget: {name} {size} B > {ceiling} B")


def main():
    menu = load_menu()
    if menu is not None:
        check_leaks(menu)
        index = check_items(menu)
        check_sets(index)
        check_ui(menu)
    check_code()
    check_budget()
    if errors:
        print(f"\nFAILED ({len(errors)}):")
        for message in errors:
            print("  - " + message)
        sys.exit(1)
    print("\nAll checks passed.")


if __name__ == "__main__":
    main()

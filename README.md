# Black Calf — QR menu

QR menu for **Black Calf** (dürüm & kebab) on GitHub Pages. Static site, no build step, no frameworks,
no trackers, no third-party requests. Everything on the page comes from **`menu.json`**.

**Live:** https://jamiljabiyev.github.io/black-calf-menu/ · **QR cards:** https://jamiljabiyev.github.io/black-calf-menu/qr.html

> Current content is a **DEMO** (`"is_demo": true`): prices, weights and ingredients are placeholders.
> Set `"is_demo": false` when the real menu is ready and the DEMO strip disappears.

## Structure

```
index.html            shell: header, language switch, hero skeleton, SVG sprite, mount points
css/app.css           all styles in @layer reset, tokens, base, layout, components, motion, utilities
js/main.js            composition root: state, render, language, scroll-spy, motion hooks, SW registration
js/model.js           pure data: language, money/size formatting, menu model, set price checks
js/views.js           html`` template (escapes by default), safeUrl, mount, all components
sw.js                 service worker: versioned CSS/JS + fonts cache-first, page + menu.json network-first (2.5 s timeout)
fonts/                self-hosted woff2 subsets (Unbounded 800 caps, Onest) + OFL.txt
qr.html, js/qr.js, css/qr.css, js/vendor/   printable QR cards (vendored qrcode-generator 1.4.4, MIT)
tools/check.py        checks before every commit
tools/fetch_fonts.py  rebuilds the font subsets
tools/bump_version.py sets one release version in sw.js and every ?v= (check.py verifies they match)
```

## Update the menu

1. Edit `menu.json` (prices, names, descriptions, tags, allergens). Interface strings live in `ui`.
2. Run `python3 tools/check.py`. It fails on invalid JSON, a set whose "separately"/savings do not match
   the real item prices, a missing translation, a non-whitelisted tag, or a budget overrun.
3. When CSS/JS change, run `python3 tools/bump_version.py <new-version>`. Price-only edits to `menu.json` need
   no bump: the page and `menu.json` are always fetched fresh first. Never rename a font file; add a new one.
4. Commit and push to `main`. GitHub Pages updates in about a minute.

Legal rules: Azerbaijani first; no "best / №1 / only" claims; only the tags `hit`, `new`, `spicy`, `veg` are ever
shown; internal data (halal status, secret items) stays out of this public repo; allergens on every item.

- **Contacts:** fill `contact.whatsapp`, `contact.phone`, `contact.maps_url`, `contact.instagram`; the contact
  bar appears automatically. Empty values mean no button.
- **Sets:** the site recomputes "separately" and the savings from `set_items` / `set_choices` and shows
  "save from X" (the guaranteed minimum). If the numbers in the file disagree, the savings are hidden.
- **Night set:** while `availability.status` starts with `tbd`, the set is not shown.
- **Languages:** `?lang=` → saved choice → phone language → AZ.
- **Details & photos:** tapping any card opens a details sheet. Until real photos exist it shows a branded
  placeholder (no stock photos: guests must see the real portion). To add a photo, put it in `img/`
  (WebP, 4:3, ~1200×900, ≤ 120 KB, e.g. `img/durum-qara.webp`) and set `"image": "img/durum-qara.webp"` on the item.
  Photos load only when a sheet is opened, so they never slow down the first screen.
- **v1 → v2 bridge:** `app.js` and `styles.css` in the root only serve guests whose browser cached the old v1 page;
  they refresh it once into v2. Keep them (and the v1 fields in `menu.json`) until at least 2026-12-25.

## Run locally

```bash
python3 -m http.server 8080      # then open http://localhost:8080 (add ?debug to see data warnings)
python3 tools/check.py
```

Service worker emergency switch: set `KILL = true` in `sw.js` and deploy; it clears its caches and unregisters.

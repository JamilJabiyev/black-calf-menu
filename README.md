# Black Calf — QR menu

Free QR menu for **Black Calf** (dürüm & kebab), hosted on GitHub Pages.
One static page, no build step, no tracking, no paid services.

**Live:** https://jamiljabiyev.github.io/black-calf-menu/ · **QR cards:** https://jamiljabiyev.github.io/black-calf-menu/qr.html

- **Menu:** `index.html` + `app.js` + `styles.css` render everything from **`menu.json`**.
- **QR cards:** open `qr.html` on the live site → print or download PNG/SVG.
- **Languages:** AZ / RU / EN (remembers the visitor's choice; `?lang=ru` forces a language).

> ⚠️ Current content is a **DEMO** (`"is_demo": true`). Prices, weights and ingredients are placeholders.

## Update the menu

1. Edit `menu.json` (prices, names, descriptions, tags, allergens).
2. Contacts for the bottom buttons: fill `contact.whatsapp`, `contact.phone`, `contact.maps_url`, `contact.instagram` (empty = button hidden).
3. When the real menu is ready, set `"is_demo": false` — the yellow demo bar disappears.
4. Commit and push to `main` — GitHub Pages updates the site in ~1 minute.

Rules from the legal check: Azerbaijani first; no "best / №1 / only" claims; never show `halal_tbd` (internal tag) unless there is a certificate; keep allergens on every item; set prices "separately" must match real item prices.

## Run locally

```bash
python3 -m http.server 8080
```
Then open http://localhost:8080.

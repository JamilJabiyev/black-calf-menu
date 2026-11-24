// qr.html: printable QR cards. Uses the vendored qrcode-generator (global `qrcode`, loaded with defer before this module).
import { html, mount } from './views.js?v=2026-11-24-r2';

const MAX_CARDS = 12;
const form = document.querySelector('[data-js="form"]');
const sheet = document.querySelector('[data-js="sheet"]');
const baseUrl = location.href.replace(/qr\.html.*$/, '');

/** Menu URL with optional ?src= so scans can be told apart later. */
function menuUrl() {
  const url = new URL(form.url.value.trim() || baseUrl, baseUrl);
  if (form.src.value) url.searchParams.set('src', form.src.value);
  return url.href;
}

function makeCode(text) {
  const code = window.qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code;
}

/** The library returns SVG markup built only from numbers; the URL is not embedded in it. */
const svgFor = (code) => code.createSvgTag({ cellSize: 8, margin: 0, scalable: true });

function card(url, svg) {
  return html`<article class="qr-card">
    <div class="qr-card__brand"><img src="assets/logo.svg" alt="" width="42" height="42">BLACK CALF</div>
    <div class="qr-card__code">${svg}</div>
    <div><p class="qr-card__scan">Menyu · Меню · Menu</p>
      <p class="qr-card__langs">Kameranı QR-a tut · Наведи камеру · Scan with your camera</p></div>
    <p class="qr-card__url">${url}</p>
  </article>`;
}

function draw() {
  const url = menuUrl();
  const count = Math.max(1, Math.min(MAX_CARDS, Number(form.count.value) || 1));
  const markup = trusted(svgFor(makeCode(url)));
  mount(sheet, html`${Array.from({ length: count }, () => card(url, markup))}`);
}

/** Wraps library output as already-safe markup via the template (it contains no user text). */
function trusted(markup) {
  const strings = [markup];
  strings.raw = [markup];
  return html(strings);
}

function download(name, blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadPng() {
  const code = makeCode(menuUrl());
  const modules = code.getModuleCount();
  const cell = 24;
  const pad = cell * 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = modules * cell + pad * 2;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < modules; r += 1) {
    for (let c = 0; c < modules; c += 1) if (code.isDark(r, c)) g.fillRect(pad + c * cell, pad + r * cell, cell, cell);
  }
  canvas.toBlob((blob) => download('black-calf-menu-qr.png', blob));
}

form.url.value = baseUrl;
form.addEventListener('input', draw);
form.addEventListener('submit', (event) => event.preventDefault());
document.querySelector('[data-js="print"]').addEventListener('click', () => window.print());
document.querySelector('[data-js="svg"]').addEventListener('click', () => {
  download('black-calf-menu-qr.svg', new Blob([svgFor(makeCode(menuUrl()))], { type: 'image/svg+xml' }));
});
document.querySelector('[data-js="png"]').addEventListener('click', downloadPng);
draw();

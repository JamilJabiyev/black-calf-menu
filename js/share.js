// Story card (1080×1920) drawn on a canvas in the guest's phone, then shared as an image file
// (Web Share API: Instagram / WhatsApp stories) or downloaded where sharing files is not supported.
// Lazy-loaded when a details modal opens, so the first screen never pays for it. Nothing is uploaded.
import { formatAmount } from './model.js?v=2026-11-25-r12';

const W = 1080;
const H = 1920;
const PAD = 90;
const COAL = '#151311';
const CREAM = '#F3EADB';
const CREAM_2 = '#D8CEBE';
const CREAM_3 = '#B8AE9F';
const EMBER = '#E8572A';
const SAFFRON = '#F2B33D';

const displayNo = (number) => (/^\d+$/.test(number) ? number.padStart(2, '0') : number);
const fontVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Largest size (down to min) at which the text fits maxWidth on one line. */
function fit(g, text, weight, family, maxPx, minPx, maxWidth) {
  let px = maxPx;
  g.font = `${weight} ${px}px ${family}`;
  while (px > minPx && g.measureText(text).width > maxWidth) {
    px -= 4;
    g.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** object-fit: cover into the rounded photo frame. */
function drawCover(g, img, x, y, w, h, r) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  g.save();
  roundRect(g, x, y, w, h, r);
  g.clip();
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

async function draw({ item, ctx, pageUrl }) {
  const display = fontVar('--font-display');
  const text = fontVar('--font-text');
  const title = ctx.pick(item.title).toLocaleUpperCase(ctx.lang === 'en' ? 'en' : ctx.lang);
  const subtitle = item.subtitle ? ctx.pick(item.subtitle) : '';
  const prices = item.variants.length ? item.variants.map((v) => v.priceCents) : [item.priceCents];
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  const price = low === high ? `${formatAmount(low, ctx.lang)} ₼` : `${formatAmount(low, ctx.lang)}–${formatAmount(high, ctx.lang)} ₼`;
  const number = displayNo(item.number);

  // make sure the brand fonts are ready for the exact glyphs we draw
  await Promise.all([
    document.fonts.load(`800 120px ${display}`, title + number),
    document.fonts.load(`700 60px ${text}`, subtitle + price + ctx.t('say_at_counter')),
  ]).catch(() => {});
  const [stamp, photo] = await Promise.all([
    loadImage(document.querySelector('.stamp__burnt')?.src),
    loadImage(item.image),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  // coal background with an ember glow and grill lines
  g.fillStyle = COAL;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 640, 40, W / 2, 640, 760);
  glow.addColorStop(0, 'rgba(232, 87, 42, .42)');
  glow.addColorStop(1, 'rgba(232, 87, 42, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(243, 234, 219, .035)';
  g.lineWidth = 3;
  for (let x = -H; x < W; x += 54) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + H * 0.53, 0);
    g.stroke();
  }

  // brand line
  g.fillStyle = EMBER;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `800 44px ${display}`;
  g.fillText('BLACK CALF', W / 2, 190);

  // hero visual: the real photo when there is one, otherwise the brand stamp
  if (photo) {
    drawCover(g, photo, PAD, 260, W - PAD * 2, 760, 48);
    if (stamp) g.drawImage(stamp, W - PAD - 230, 260 + 760 - 200, 260, 260);
  } else if (stamp) {
    g.drawImage(stamp, W / 2 - 300, 300, 600, 600);
  }

  // title + subtitle
  let y = photo ? 1150 : 1080;
  g.fillStyle = CREAM;
  const titlePx = fit(g, title, 800, display, 170, 80, W - PAD * 2);
  g.font = `800 ${titlePx}px ${display}`;
  g.fillText(title, W / 2, y);
  if (subtitle) {
    y += 76;
    g.fillStyle = CREAM_2;
    fit(g, subtitle, 700, text, 50, 32, W - PAD * 2);
    g.fillText(subtitle, W / 2, y);
  }

  // price
  y += 150;
  g.fillStyle = CREAM;
  g.font = `700 120px ${text}`;
  g.fillText(price, W / 2, y);

  // "say at the counter" ticket
  y += 70;
  const boxH = 190;
  g.setLineDash([18, 14]);
  g.lineWidth = 5;
  g.strokeStyle = EMBER;
  roundRect(g, PAD, y, W - PAD * 2, boxH, 36);
  g.stroke();
  g.setLineDash([]);
  g.textAlign = 'left';
  g.fillStyle = CREAM_2;
  g.font = `700 48px ${text}`;
  g.fillText(ctx.t('say_at_counter'), PAD + 50, y + boxH / 2 + 17);
  g.textAlign = 'right';
  g.fillStyle = EMBER;
  g.font = `800 130px ${display}`;
  g.fillText(number, W - PAD - 50, y + boxH / 2 + 46);

  // footer: where the menu lives (+ a legal note while prices are a demo)
  g.textAlign = 'center';
  g.fillStyle = CREAM_3;
  g.font = `700 38px ${text}`;
  g.fillText(pageUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, H - 150);
  if (ctx.model.isDemo) {
    g.fillStyle = SAFFRON;
    g.font = `700 30px ${text}`;
    g.fillText(`DEMO · ${ctx.t('demo_short')}`, W / 2, H - 96);
  }

  // JPEG: 3–4× lighter than PNG and faster to encode; Instagram re-encodes to JPEG anyway
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

/** Builds the image ahead of the tap: iOS only allows navigator.share() right inside the click. */
export async function prepareStory({ item, ctx, pageUrl }) {
  const blob = await draw({ item, ctx, pageUrl });
  if (!blob) return null;
  return new File([blob], `black-calf-${item.id}.jpg`, { type: 'image/jpeg' });
}

/** 'shared' | 'saved' | 'cancelled'. Call synchronously from the click handler with a prepared file. */
export function shareStory(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title }).then(() => 'shared', (error) => (error?.name === 'AbortError' ? 'cancelled' : save(file)));
  }
  return Promise.resolve(save(file));
}

function save(file) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  return 'saved';
}

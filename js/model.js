// Pure data layer: language, money/size formatting, menu view model. Only loadMenu() touches the network.

export const LANGS = ['az', 'ru', 'en'];
export const DEFAULT_LANG = 'az';

/** Only these tags can ever reach the screen, in this display priority (decision 10). */
const VISIBLE_TAGS = ['new', 'hit', 'veg'];
const MAX_TAGS = 2;
const MAX_SPICE = 3;
const DECIMAL_MARK = { az: ',', ru: ',', en: '.' };
/** set_items id prefix → formula part (ui.set_parts key). */
const SET_PARTS = [['extra-sauce', 'sauce'], ['durum', 'durum'], ['fries', 'fries'], ['drink', 'drink']];
const partOf = (ref) => (SET_PARTS.find(([prefix]) => String(ref).startsWith(prefix)) || [])[1] || null;

export class MenuLoadError extends Error {}

/** Localized string with fallback: requested → az → en. */
export const pick = (l10n, lang) => (l10n && (l10n[lang] || l10n[DEFAULT_LANG] || l10n.en)) || '';

/** View context; a missing ui key yields '' rather than a raw key on screen. */
export function createContext(model, lang) {
  return { lang, model, pick: (l10n) => pick(l10n, lang), t: (key) => pick(model.ui[key], lang) };
}

// ---------- money and sizes: integer cents everywhere, floats only at the JSON boundary ----------

export function toCents(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

/** "4,00" (az/ru), "4.00" (en). Manual on purpose: Intl with "az" is unreliable on old Android. */
export function formatAmount(cents, lang) {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)}${DECIMAL_MARK[lang] || ','}${String(abs % 100).padStart(2, '0')}`;
}

/** "~305 q" / "0,25 l". Volume wins over weight; '' when unknown. */
export function formatSize({ weightG, volumeMl }, units, lang) {
  if (volumeMl) {
    const whole = Math.floor(volumeMl / 1000);
    const fraction = String(volumeMl % 1000).padStart(3, '0').replace(/0+$/, '');
    return `${whole}${fraction ? (DECIMAL_MARK[lang] || ',') + fraction : ''} ${pick(units.l, lang)}`;
  }
  return weightG ? `~${weightG} ${pick(units.g, lang)}` : '';
}

// ---------- loading ----------

const TIMEOUT_MS = 10000;

/** Default fetch cache mode, so the <link rel=preload> response is reused. */
export async function loadMenu(url = 'menu.json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new MenuLoadError(`HTTP ${response.status}`);
    let raw;
    try { raw = await response.json(); } catch { throw new MenuLoadError('invalid JSON'); }
    return buildMenuModel(raw);
  } catch (error) {
    throw error instanceof MenuLoadError ? error : new MenuLoadError(error.message);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- model ----------

/** raw menu.json → { model (language-agnostic), warnings }. Bad items are skipped; no categories throws. */
export function buildMenuModel(raw) {
  if (!raw || !Array.isArray(raw.categories) || raw.categories.length === 0) {
    throw new MenuLoadError('empty');
  }
  const warnings = [];
  const legend = raw.allergen_legend || {};
  const categories = raw.categories.map((category) => ({
    id: String(category.id),
    name: category.name || {},
    icon: category.icon || null,
    items: (category.items || []).map((item) => normalizeItem(item, legend, warnings)).filter(Boolean),
  }));

  const index = new Map();
  categories.forEach((category) => category.items.forEach((item) => index.set(item.id, item)));
  const all = Array.from(index.values());
  all.filter((item) => item.isSet).forEach((item) => { item.set = resolveSet(item, index, warnings); });

  const visible = categories
    .map((category) => ({ ...category, items: category.items.filter((item) => !item.isHidden) }))
    .filter((category) => category.items.length > 0);
  addUpsells(all.filter((item) => !item.isHidden), index);
  if (!visible.length) throw new MenuLoadError('empty');

  return {
    warnings,
    model: {
      brand: raw.brand || 'Black Calf',
      version: raw.version || '',
      isDemo: raw.is_demo === true,
      hero: visible.flatMap((category) => category.items).find((item) => item.isHero) || null,
      teaser: setTeaser(visible),
      categories: visible,
      extras: raw.extras || {},
      notes: raw.notes || null,
      contact: normalizeContact(raw.contact),
      allergenLegend: legend,
      tagLabels: raw.tag_labels || {},
      ui: raw.ui || {},
    },
  };
}

function normalizeItem(raw, legend, warnings) {
  const id = raw && typeof raw.id === 'string' ? raw.id : null;
  if (!id || !raw.name || !raw.name.az) {
    warnings.push(`item skipped: no id or name.az (${id})`);
    return null;
  }
  const variants = (raw.variants || []).map((variant) => normalizeVariant(variant, id, warnings)).filter(Boolean);
  const priceCents = toCents(raw.price);
  if (!variants.length && priceCents === null) {
    warnings.push(`item skipped: no valid price (${id})`);
    return null;
  }
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const allergens = Array.isArray(raw.allergens) ? raw.allergens : [];
  if (!Array.isArray(raw.allergens)) warnings.push(`allergens missing (${id})`);
  allergens.filter((key) => !legend[key]).forEach((key) => warnings.push(`unknown allergen "${key}" (${id})`));
  const isSet = Array.isArray(raw.set_items) && raw.set_items.length > 0;

  return {
    id,
    number: String(raw.number ?? ''),
    ...splitName(raw.name, raw.subtitle),
    description: raw.short_description || raw.description || {},
    priceCents,
    isAddon: raw.is_addon === true,
    isHero: tags.includes('hero'),
    variants,
    weightG: positiveOrNull(raw.weight_g),
    volumeMl: positiveOrNull(raw.volume_ml),
    spicyLevel: clampSpice(raw.spicy_level),
    spicyTag: tags.includes('spicy'),
    tags: VISIBLE_TAGS.filter((tag) => tags.includes(tag)).slice(0, MAX_TAGS),
    allergens,
    icon: raw.icon || null,
    isSet,
    setRaw: isSet ? { items: raw.set_items, choices: raw.set_choices || {}, json: raw } : null,
    set: null,
    upsell: null,
    availability: normalizeAvailability(raw.availability),
    // decision 7: a set whose availability is still "tbd…" is not shown at all
    isHidden: /^tbd/.test(raw.availability?.status || ''),
  };
}

function normalizeVariant(raw, itemId, warnings) {
  const priceCents = toCents(raw && raw.price);
  if (!raw || !raw.id || priceCents === null) {
    warnings.push(`variant skipped: no valid price (${itemId}:${raw && raw.id})`);
    return null;
  }
  return {
    id: String(raw.id),
    name: raw.name || {},
    priceCents,
    weightG: positiveOrNull(raw.weight_g),
    spicyLevel: raw.spicy_level === undefined ? null : clampSpice(raw.spicy_level),
    allergens: Array.isArray(raw.allergens) ? raw.allergens : null,
    isDefault: raw.default === true,
  };
}

/** "Boss — ikiqat mal əti ilə dürüm" → title "Boss", subtitle "ikiqat…" (split at the first " — "). */
function splitName(name, subtitle) {
  const title = {};
  const sub = {};
  Object.keys(name).forEach((lang) => {
    const [head, ...rest] = String(name[lang]).split(' — ');
    title[lang] = head;
    if (rest.length) sub[lang] = rest.join(' — ');
  });
  return { title, subtitle: subtitle || (Object.keys(sub).length ? sub : null) };
}

const positiveOrNull = (value) => (typeof value === 'number' && value > 0 ? value : null);
const clampSpice = (value) => Math.max(0, Math.min(MAX_SPICE, Math.round(Number(value) || 0)));

function normalizeAvailability(raw) {
  const time = /^\d{2}:\d{2}$/;
  if (!raw || !time.test(raw.from || '')) return null;
  return { from: raw.from, to: raw.to === 'close' || time.test(raw.to || '') ? raw.to : 'close' };
}

function normalizeContact(raw = {}) {
  const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return { whatsapp: clean(raw.whatsapp), phone: clean(raw.phone), mapsUrl: clean(raw.maps_url), instagram: clean(raw.instagram) };
}

// ---------- sets: "separately" and savings are recomputed from real prices (ADR-003, decision 6) ----------

function resolveRef(ref, index) {
  const [id, variantId] = String(ref).split(':');
  const item = index.get(id);
  if (!item) return null;
  const variant = variantId ? item.variants.find((v) => v.id === variantId)
    : item.variants.find((v) => v.isDefault) || item.variants[0];
  if (variantId && !variant) return null;
  return { item, variant: variantId ? variant : null, priceCents: variant ? variant.priceCents : item.priceCents };
}

/** Cheapest and dearest price a slot can take, given the set_choices that contain this ref. */
function slotRange(ref, choices, index) {
  const slot = Object.values(choices).find((options) => Array.isArray(options) && options.includes(ref)) || [ref];
  const prices = slot.map((option) => resolveRef(option, index)?.priceCents ?? null);
  return prices.includes(null) ? [null, null] : [Math.min(...prices), Math.max(...prices)];
}

/** "2× Dürüm + Fri L": fries name their size when all refs agree. */
function formulaParts(refs, index) {
  const parts = [];
  refs.forEach((ref) => {
    const key = partOf(ref);
    if (!key) return;
    const variant = resolveRef(ref, index)?.variant || null;
    const part = parts.find((p) => p.key === key);
    if (!part) parts.push({ key, count: 1, variant });
    else {
      part.count += 1;
      if (part.variant !== variant) part.variant = null;
    }
  });
  return parts.map((part) => ({ ...part, variant: part.key === 'fries' && part.variant ? part.variant.name : null }));
}

/** Choices per slot; options of one item (sauces) show variant names only. */
function choiceLines(choices, index) {
  return Object.entries(choices).map(([key, refs]) => {
    const options = refs.map((ref) => resolveRef(ref, index)).filter(Boolean);
    const sameItem = options.every((option) => option.item === options[0].item);
    return {
      key,
      options: options.map(({ item, variant }) => ({ title: sameItem ? null : item.title, variant: variant ? variant.name : null })),
    };
  }).filter((line) => line.options.length > 1);
}

/** null when the data disagrees with real prices: then no savings are shown at all. */
function resolveSet(item, index, warnings) {
  const { items: refs, choices, json } = item.setRaw;
  const fail = (reason) => { warnings.push(`set savings hidden (${item.id}): ${reason}`); return null; };
  if (item.priceCents === null) return fail('no set price');

  const prices = refs.map((ref) => resolveRef(ref, index)?.priceCents ?? null);
  if (prices.includes(null)) return fail('set_items reference a missing item or variant');
  const ranges = refs.map((ref) => slotRange(ref, choices, index));
  if (ranges.some(([min]) => min === null)) return fail('set_choices reference a missing item or variant');

  const sum = (list) => list.reduce((total, cents) => total + cents, 0);
  const separately = sum(prices);
  const savings = separately - item.priceCents;
  const minSavings = sum(ranges.map(([min]) => min)) - item.priceCents;
  const maxSavings = sum(ranges.map(([, max]) => max)) - item.priceCents;

  if (json.price_separately !== undefined && toCents(json.price_separately) !== separately) {
    return fail(`price_separately ${json.price_separately} ≠ ${separately / 100}`);
  }
  if (json.savings !== undefined && Math.round(json.savings * 100) !== savings) {
    return fail(`savings ${json.savings} ≠ ${savings / 100}`);
  }
  const range = json.savings_range;
  if (Array.isArray(range) && (Math.round(range[0] * 100) !== minSavings || Math.round(range[1] * 100) !== maxSavings)) {
    return fail(`savings_range ${range} ≠ ${minSavings / 100},${maxSavings / 100}`);
  }
  if (minSavings <= 0) return fail('no real saving for every choice');

  // Show the guaranteed minimum: "save from X" and "separately from price + X".
  return {
    separatelyCents: item.priceCents + minSavings,
    savingsCents: minSavings,
    isRange: minSavings !== maxSavings,
    parts: formulaParts(refs, index),
    choices: choiceLines(choices, index),
    durumChoices: choices.durum || [],
  };
}

/** Hero teaser: the smallest guaranteed saving across visible sets. */
function setTeaser(categories) {
  for (const category of categories) {
    const sets = category.items.filter((item) => item.set);
    if (!sets.length) continue;
    const best = sets.reduce((low, item) => (item.set.savingsCents < low.set.savingsCents ? item : low));
    return { categoryId: category.id, name: category.name, savingsCents: best.set.savingsCents, isRange: sets.some((s) => s.set.isRange) };
  }
  return null;
}

/** Cross-sell hints from prices: dürüm → "+Δ → S1" (one-dürüm set), fries → cheapest sauce. */
function addUpsells(items, index) {
  const combo = items.find((item) => item.set && item.set.parts.some((p) => p.key === 'durum' && p.count === 1));
  combo?.set.durumChoices.forEach((ref) => {
    const choice = resolveRef(ref, index);
    const delta = choice && combo.priceCents - choice.priceCents;
    if (delta > 0 && !choice.item.upsell) {
      choice.item.upsell = { kind: 'combo', targetId: combo.id, label: combo.number, deltaCents: delta, variant: choice.variant?.name || null };
    }
  });
  const sauce = items.find((item) => partOf(item.id) === 'sauce');
  if (!sauce) return;
  const sauceCents = Math.min(...(sauce.variants.length ? sauce.variants.map((v) => v.priceCents) : [sauce.priceCents]));
  items.filter((item) => partOf(item.id) === 'fries').forEach((item) => {
    item.upsell = { kind: 'sauce', targetId: sauce.id, deltaCents: sauceCents };
  });
}

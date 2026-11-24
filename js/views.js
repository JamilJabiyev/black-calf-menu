// Markup: html`` escapes by default (ADR-002), mount() is the only innerHTML sink. Views are pure.
import { formatAmount, formatSize } from './model.js';

// ---------- safe templating ----------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const toHtml = (value) => {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  if (value == null || value === false) return '';
  return escapeHtml(value);
};

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += toHtml(value) + strings[i + 1]; });
  return new SafeHtml(out);
}

/** Allowed schemes only: javascript:, data: and garbage → null. */
export function safeUrl(url, allowed = ['https:']) {
  try {
    const parsed = new URL(url);
    return allowed.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function mount(element, fragment) {
  element.innerHTML = fragment instanceof SafeHtml ? fragment.value : escapeHtml(fragment);
}

/** "Qənaət {x}-dan" + {x: SafeHtml} → SafeHtml; the template text itself is escaped. */
function fill(template, vars) {
  return new SafeHtml(template.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? toHtml(vars[part]) : escapeHtml(part))).join(''));
}

// ---------- link builders: contact data never goes into href unchecked ----------

const digitsOf = (value) => String(value).replace(/\D/g, '');
const whatsappUrl = (value) => (digitsOf(value).length >= 8 ? `https://wa.me/${digitsOf(value)}` : null);
const telUrl = (value) => (digitsOf(value).length >= 8 ? `tel:+${digitsOf(value)}` : null);
function instagramUrl(value) {
  const handle = String(value).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').replace(/\/$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

// ---------- partials ----------

const ALLERGEN_ICONS = { gluten: 'gluten', milk: 'milk', egg: 'egg', sesame: 'sesame' };
const PART_ICONS = { durum: 'durum', fries: 'fries', drink: 'cup', sauce: 'sauce' };

const icon = (name, cls = '') => html`<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const markIcon = () => html`<svg class="mark" aria-hidden="true" focusable="false"><use href="#mark"/></svg>`;
const displayNo = (number) => (/^\d+$/.test(number) ? number.padStart(2, '0') : number);

function amount(cents, ctx, sign = '') {
  return html`${sign}${formatAmount(cents, ctx.lang)}<span class="cur" aria-hidden="true">₼</span><span class="u-vh"> ${ctx.t('manat')}</span>`;
}

function price(cents, ctx, { cls = '', sign = '' } = {}) {
  if (cents == null) return html`<p class="price ${cls}">—<span class="u-vh"> ${ctx.t('price_at_counter')}</span></p>`;
  return html`<p class="price ${cls}">${amount(cents, ctx, sign)}</p>`;
}

/** "3,50–4,00 ₼": variants share one price line in the row head; the cells below give the detail. */
function priceSpan(cents, ctx, { cls = '', sign = '' } = {}) {
  const [min, max] = [Math.min(...cents), Math.max(...cents)];
  if (min === max) return price(min, ctx, { cls, sign });
  return html`<p class="price ${cls}">${sign}${formatAmount(min, ctx.lang)}–${amount(max, ctx)}</p>`;
}

function tagList(item, ctx, extra = '') {
  const tags = item.tags.map((tag) => {
    const label = ctx.pick(ctx.model.tagLabels[tag]);
    if (!label) return '';
    const glyph = tag === 'hit' ? icon('flame') : tag === 'veg' ? icon('leaf') : '';
    return html`<li class="tag tag--${tag}">${glyph}${label}</li>`;
  });
  if (!extra && !tags.some(Boolean)) return '';
  return html`<ul class="tags" role="list">${extra}${tags}</ul>`;
}

/** Chili scale 0–3; the "spicy" tag adds the word instead of a second badge. */
function spice(level, ctx, withWord) {
  if (!level && !withWord) return '';
  const label = `${ctx.t('spicy_level')} ${level}/3`;
  const chilies = [1, 2, 3].map((n) => icon('chili', n <= level ? '' : 'is-off'));
  const word = withWord ? html`<span class="spice__word" aria-hidden="true">${ctx.pick(ctx.model.tagLabels.spicy)}</span>` : '';
  return html`<span class="spice" role="img" aria-label="${label}">${level ? chilies : ''}${word}</span>`;
}

function allergenList(keys, ctx) {
  if (!keys || !keys.length) return ''; // decision 12: no line when empty, the footer disclaimer covers it
  const legend = ctx.model.allergenLegend;
  return html`<span class="allergens"><span class="u-vh">${ctx.t('allergens')}: </span>${keys.map((key) => html`
    <span class="allergen">${ALLERGEN_ICONS[key] ? icon(ALLERGEN_ICONS[key]) : ''}${ctx.pick(legend[key]) || key}</span>`)}</span>`;
}

const sizeOf = (thing, ctx) => formatSize(thing, ctx.model.ui.units || {}, ctx.lang);

function meta(item, ctx, { size = true, allergens = true } = {}) {
  const parts = [
    size && sizeOf(item, ctx) ? html`<span>${sizeOf(item, ctx)}</span>` : '',
    spice(item.spicyLevel, ctx, item.spicyTag),
    allergens ? allergenList(item.allergens, ctx) : '',
  ].filter(Boolean);
  return parts.length ? html`<p class="meta">${parts}</p>` : '';
}

/** Variants override item spice/allergens only where they define their own (BA AC-05.2). */
const variantsHaveOwnAllergens = (item) => item.variants.some((v) => v.allergens !== null);

function titleFor(item, ctx) {
  const number = /^\d+$/.test(item.number) ? fill(ctx.t('number_sr'), { n: item.number }) : item.number;
  return html`<span class="u-vh">${number} </span>${ctx.pick(item.title)}`;
}

// ---------- hero ----------

export function heroBody(item, ctx) {
  const title = ctx.pick(item.title);
  const phrase = ctx.pick(ctx.model.extras.hero_phrase);
  return html`
    <p class="kicker">${ctx.t('signature')}</p>
    <h2 class="hero__title" id="hero-t"><span class="u-vh">${title}</span><span class="hero__letters" aria-hidden="true">${
      Array.from(title).map((char, i) => html`<span style="--i:${i}">${char === ' ' ? ' ' : char}</span>`)}</span></h2>
    ${item.subtitle ? html`<p class="hero__sub">${ctx.pick(item.subtitle)}</p>` : ''}
    <p class="hero__desc">${ctx.pick(item.description)}</p>
    <div class="hero__buy">${price(item.priceCents, ctx, { cls: 'price--xl' })}${phrase ? html`<span class="sticker">${phrase}</span>` : ''}</div>
    <div class="hero__meta">${meta(item, ctx)}${tagList(item, ctx)}</div>`;
}

// ---------- rows by kind ----------

function signatureRow(item, ctx) {
  const badge = html`<li class="tag tag--sig">${ctx.t('signature_badge')}</li>`;
  return html`<article class="item item--sig" id="item-${item.id}" aria-labelledby="t-${item.id}">
    <span class="item__no" aria-hidden="true">${displayNo(item.number)}</span>
    <div class="item__head"><h3 class="item__title" id="t-${item.id}">${titleFor(item, ctx)}</h3>${price(item.priceCents, ctx)}</div>
    ${tagList(item, ctx, badge)}
    <a class="more" href="#qara">↑ ${ctx.t('more_above')}</a>
  </article>`;
}

function variantCells(item, ctx) {
  const ownAllergens = variantsHaveOwnAllergens(item);
  return html`<ul class="variants" role="list">${item.variants.map((v) => html`<li>
    <span class="variants__name">${ctx.pick(v.name)}</span>
    <span class="variants__w">${sizeOf({ weightG: v.weightG }, ctx)}${
      ownAllergens ? html` ${allergenList(v.allergens, ctx)}` : ''}</span>
    ${price(v.priceCents, ctx, { cls: 'price--s' })}</li>`)}</ul>`;
}

function dishRow(item, ctx) {
  if (item.isHero) return signatureRow(item, ctx);
  const hasVariants = item.variants.length > 0;
  return html`<article class="item" id="item-${item.id}" aria-labelledby="t-${item.id}">
    <span class="item__no" aria-hidden="true">${displayNo(item.number)}</span>
    <div class="item__head">
      <h3 class="item__title" id="t-${item.id}">${titleFor(item, ctx)}</h3>
      ${hasVariants ? priceSpan(item.variants.map((v) => v.priceCents), ctx) : price(item.priceCents, ctx)}
    </div>
    ${item.subtitle ? html`<p class="item__sub">${ctx.pick(item.subtitle)}</p>` : ''}
    ${tagList(item, ctx)}
    <p class="item__desc">${ctx.pick(item.description)}</p>
    ${hasVariants ? variantCells(item, ctx) : ''}
    ${meta(item, ctx, { size: !hasVariants, allergens: !(hasVariants && variantsHaveOwnAllergens(item)) })}
  </article>`;
}

function lineVariants(item, ctx, sign) {
  if (!item.variants.length) return '';
  const own = variantsHaveOwnAllergens(item);
  return html`<ul class="line__vars" role="list">${item.variants.map((v) => html`<li class="line__var">
    <span>${ctx.pick(v.name)}</span>${price(v.priceCents, ctx, { sign })}
    ${v.spicyLevel ? spice(v.spicyLevel, ctx, false) : ''}${own ? allergenList(v.allergens, ctx) : ''}</li>`)}</ul>`;
}

/** Extras and drinks: compact lines; extras get "+price". */
function line(item, ctx) {
  const sign = item.isAddon ? '+' : '';
  const prices = item.variants.length ? item.variants.map((v) => v.priceCents) : [item.priceCents];
  const own = item.variants.length > 0 && variantsHaveOwnAllergens(item);
  const lineIcon = item.icon || null;
  return html`<article class="line${lineIcon ? ' line--icon' : ''}" id="item-${item.id}" aria-labelledby="t-${item.id}">
    ${lineIcon ? icon(lineIcon, 'line__icon') : ''}
    <div>
      <h3 class="line__name" id="t-${item.id}"><span class="line__no">${item.number}</span>${ctx.pick(item.title)}</h3>
      <p class="line__desc">${ctx.pick(item.description)}</p>
      ${meta(item, ctx, { size: item.volumeMl !== null, allergens: !own })}
    </div>
    ${priceSpan(prices, ctx, { sign, cls: `line__price${sign ? ' line__price--add' : ''}` })}
    ${lineVariants(item, ctx, sign)}
  </article>`;
}

function formula(set, ctx) {
  if (!set || !set.parts.length) return '';
  const names = ctx.model.ui.set_parts || {};
  return html`<ol class="formula" aria-label="${ctx.t('set_contents')}">${set.parts.map((part, i) => html`${
    i ? html`<li class="formula__plus" aria-hidden="true">+</li>` : ''}<li class="formula__part">${icon(PART_ICONS[part.key])}${
    part.count > 1 ? `${part.count}× ` : ''}${ctx.pick(names[part.key])}</li>`)}</ol>`;
}

function setPricing(item, ctx) {
  const set = item.set;
  const savings = set
    ? html`<p class="set__was">${fill(ctx.t(set.isRange ? 'separately_from' : 'separately'), { x: html`<s>${amount(set.separatelyCents, ctx)}</s>` })}</p>
      <p class="save">${fill(ctx.t(set.isRange ? 'save_from' : 'save'), { x: amount(set.savingsCents, ctx) })}</p>`
    : '';
  return html`<div class="set__price">${price(item.priceCents, ctx, { cls: 'price--l' })}${savings}</div>`;
}

function availability(item, ctx) {
  const window = item.availability;
  if (!window) return '';
  const text = window.to === 'close' ? fill(ctx.t('available_until_close'), { from: window.from }) : `${window.from}–${window.to}`;
  return html`<p class="avail">${icon('moon')}${text}</p>`;
}

function setCard(item, ctx, isFeature) {
  return html`<article class="set${isFeature ? ' set--feature' : ''}" id="item-${item.id}" aria-labelledby="t-${item.id}">
    <div class="set__top"><span class="set__no" aria-hidden="true">${item.number}</span>${tagList(item, ctx)}</div>
    <h3 class="set__title" id="t-${item.id}"><span class="u-vh">${item.number} </span>${ctx.pick(item.title)}</h3>
    ${item.subtitle ? html`<p class="set__sub">${ctx.pick(item.subtitle)}</p>` : ''}
    ${formula(item.set, ctx)}
    ${availability(item, ctx)}
    ${setPricing(item, ctx)}
    <p class="set__desc">${ctx.pick(item.description)}</p>
    ${meta(item, ctx, { size: false })}
  </article>`;
}

// ---------- sections ----------

const kindOf = (item) => (item.isSet ? 'set' : item.isAddon || item.volumeMl ? 'line' : 'dish');

function categoryBody(category, ctx) {
  const kind = kindOf(category.items[0]);
  if (kind === 'set') {
    const featureId = (category.items.find((item) => item.tags.includes('hit')) || {}).id;
    return html`<div class="sets">${category.items.map((item) => setCard(item, ctx, item.id === featureId))}</div>`;
  }
  const row = kind === 'line' ? line : dishRow;
  return html`<div class="${kind === 'line' ? 'lines' : 'items'}">${category.items.map((item) => row(item, ctx))}</div>`;
}

function categorySection(category, ctx) {
  return html`<section class="cat" id="cat-${category.id}" aria-labelledby="h-${category.id}">
    <header class="cat__head">
      ${category.icon ? icon(category.icon, 'cat__icon') : html`<span></span>`}
      <h2 class="cat__title" id="h-${category.id}">${ctx.pick(category.name)}</h2>
      <span class="cat__count" aria-hidden="true">${String(category.items.length).padStart(2, '0')}</span>
    </header>
    ${categoryBody(category, ctx)}
  </section>`;
}

export function categoryNav(categories, ctx) {
  return html`<ul role="list">${categories.map((category, i) => html`<li style="--i:${i}"><a href="#cat-${category.id}">${
    ctx.pick(category.name)}<span class="catnav__n" aria-hidden="true">${category.items.length}</span></a></li>`)}</ul>`;
}

function loyaltyTile(text, ctx) {
  if (!text) return '';
  const rings = Array.from({ length: 10 }, (_, i) => (i === 9 ? html`<span>${markIcon()}</span>` : html`<span></span>`));
  return html`<section class="tile" aria-labelledby="loyalty-t"><h2 class="tile__t" id="loyalty-t">${ctx.t('loyalty_title')}</h2>
    <div class="rings" aria-hidden="true">${rings}</div><p>${text}</p></section>`;
}

function footer(model, ctx) {
  const legendKeys = Object.keys(model.allergenLegend);
  const secret = ctx.pick(model.extras.secret);
  const instagram = model.contact.instagram && instagramUrl(model.contact.instagram);
  return html`<div class="info">
      ${loyaltyTile(ctx.pick(model.extras.loyalty), ctx)}
      ${secret ? html`<section class="tile tile--secret" aria-labelledby="secret-t"><h2 class="tile__t" id="secret-t">${
        ctx.t('secret_title')}</h2><p>${secret}</p>${markIcon()}</section>` : ''}
      ${legendKeys.length ? html`<section class="tile tile--wide" aria-labelledby="legend-t"><h2 class="tile__t" id="legend-t">${ctx.t('allergens')}</h2>
        <ul class="legend" role="list">${legendKeys.map((key) => html`<li>${
          ALLERGEN_ICONS[key] ? icon(ALLERGEN_ICONS[key]) : ''}${ctx.pick(model.allergenLegend[key])}</li>`)}</ul></section>` : ''}
    </div>
    ${model.notes ? html`<section class="notes" id="notes" aria-labelledby="notes-t">${
      model.isDemo ? html`<b class="notes__demo">DEMO</b>` : ''}<h2 class="tile__t" id="notes-t">${ctx.t('notes_title')}</h2>
      <p>${ctx.pick(model.notes)}</p></section>` : ''}
    <p class="sign" aria-hidden="true">${model.brand.split(' ').map((word) => html`<span>${word}</span>`)}</p>
    <p class="foot__ver"><span>${model.brand} · ${ctx.t('version')} ${model.version}</span>${
      instagram ? html`<a href="${instagram}" rel="noopener">${icon('ig')}Instagram</a>` : ''}</p>`;
}

/** Floating capsule; empty string when menu.json has no contacts (decision 14). */
export function actionBar(contact, ctx) {
  const buttons = [
    contact.whatsapp && { href: whatsappUrl(contact.whatsapp), name: 'wa', label: 'WhatsApp', primary: true },
    contact.phone && { href: telUrl(contact.phone), name: 'phone', label: ctx.t('call') },
    contact.mapsUrl && { href: safeUrl(contact.mapsUrl), name: 'pin', label: ctx.t('map') },
  ].filter((button) => button && button.href);
  if (!buttons.length) return '';
  return html`<nav class="actions" aria-label="${ctx.t('contact')}">${buttons.map((b) => (b.primary
    ? html`<a class="btn btn--primary" href="${b.href}" rel="noopener">${icon(b.name)}${b.label}</a>`
    : html`<a class="btn btn--icon" href="${b.href}" rel="noopener" aria-label="${b.label}">${icon(b.name)}</a>`))}</nav>`;
}

/** Keyed by data-js mount point. */
export function renderApp(model, ctx) {
  return {
    'demo-text': model.isDemo ? ctx.t('demo_short') : '',
    welcome: ctx.pick(model.extras.welcome),
    'hero-body': model.hero ? heroBody(model.hero, ctx) : '',
    catnav: categoryNav(model.categories, ctx),
    menu: html`${model.categories.map((category) => categorySection(category, ctx))}`,
    foot: footer(model, ctx),
    actions: actionBar(model.contact, ctx),
  };
}

export function errorState(strings) {
  return html`<div class="state">${markIcon()}
    <h2 class="state__t" tabindex="-1" data-js="error-title">${strings.title}</h2>
    <p>${strings.text}</p>
    <button class="btn btn--primary" type="button" data-js="retry">${strings.retry}</button></div>`;
}

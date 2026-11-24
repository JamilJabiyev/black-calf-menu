// Composition root: owns state and the DOM (render, language, scroll-spy, motion hooks).
import { LANGS, loadMenu, createContext, MenuLoadError } from './model.js?v=2026-11-25-r13';
import { mount, renderApp, errorState, detailSheet } from './views.js?v=2026-11-25-r13';

let story = null; // { id, lang, file: Promise<File|null> } — the story card is drawn before the tap (iOS share rule)
const BUILD = '2026-11-25-r13'; // = <html data-build>, set by tools/bump_version.py
// Shown before or without menu.json, so they cannot live in its "ui" block.
const OFFLINE_STRINGS = {
  az: { page: 'Black Calf — Menyu', skip: 'Menyuya keç', loading: 'Yüklənir…', title: 'Menyu yüklənmədi', text: 'İnterneti yoxlayın və ya kassada soruşun.', empty: 'Menyu müvəqqəti əlçatan deyil. Kassada soruşun.', retry: 'Yenidən cəhd et' },
  ru: { page: 'Black Calf — Меню', skip: 'Перейти к меню', loading: 'Загружается…', title: 'Меню не загрузилось', text: 'Проверьте интернет или спросите на кассе.', empty: 'Меню временно недоступно. Спросите на кассе.', retry: 'Повторить' },
  en: { page: 'Black Calf — Menu', skip: 'Skip to menu', loading: 'Loading…', title: "The menu didn't load", text: 'Check your connection or ask at the counter.', empty: 'The menu is temporarily unavailable. Please ask at the counter.', retry: 'Try again' },
};
const MOUNTS = ['menu', 'catnav', 'hero', 'hero-body', 'teaser', 'foot', 'actions', 'lang', 'stamp', 'demo', 'demo-text', 'welcome', 'offline', 'h1', 'skip'];
const SLOW_MS = 4000;

const root = document.documentElement;
const $ = (name) => document.querySelector(`[data-js="${name}"]`);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canAnimate = () => !reducedMotion.matches;
const isDebug = ['localhost', '127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).has('debug');
/** Motion durations live in CSS (--intro-ms, --stamp-ms); JS only reads them. */
const cssMs = (name) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;

const state = { lang: LANGS.includes(root.lang) ? root.lang : 'az', model: null, error: null };
const timers = { intro: 0, stamp: 0, slow: 0 };
let spy = null;
let setObserver = null;
let navHeight = 0;
const seenSets = new Set();

// ---------- release safety: an HTML page from the HTTP cache may meet newer JS ----------

const shellIsStale = () => root.dataset.build !== BUILD || MOUNTS.some((name) => !$(name));

/** Refresh page + data past the HTTP cache once per build, then reload. false = already tried. */
function reloadFresh() {
  try {
    if (sessionStorage.getItem('bc-fresh') === BUILD) return false;
    sessionStorage.setItem('bc-fresh', BUILD);
  } catch { return false; }
  Promise.allSettled([fetch(location.href, { cache: 'reload' }), fetch(`menu.json?v=${BUILD}`, { cache: 'reload' })])
    .then(() => location.reload());
  return true;
}

// ---------- render ----------

function render() {
  const ctx = createContext(state.model, state.lang);
  Object.entries(renderApp(state.model, ctx)).forEach(([name, fragment]) => mount($(name), fragment));
  setChrome(ctx.t('page_title'), ctx.t('skip'));
  $('catnav').setAttribute('aria-label', ctx.t('categories_nav'));
  $('demo').hidden = !state.model.isDemo;
  $('hero').hidden = !state.model.hero;
  observeSections();
  markReveal();
  armSets();
}

function setChrome(title, skip) {
  document.title = title;
  [['h1', title], ['skip', skip]].forEach(([name, text]) => { if ($(name)) $(name).textContent = text; });
}

function syncLangSwitch() {
  $('lang').querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  });
}

function storeLang(lang) {
  try { localStorage.setItem('bc-lang', lang); } catch { /* private mode */ }
}

/** Keeps the same row under the sticky nav across a re-render (BA AC-01.7). */
function captureAnchor() {
  const navBottom = $('catnav').getBoundingClientRect().bottom;
  for (const row of document.querySelectorAll('[id^="item-"], .cat')) {
    const top = row.getBoundingClientRect().top;
    if (top >= navBottom - 1) return { id: row.id, top };
  }
  return null;
}

function restoreAnchor(anchor) {
  const row = anchor && document.getElementById(anchor.id);
  if (row && window.scrollY > 0) window.scrollBy(0, row.getBoundingClientRect().top - anchor.top);
}

function setLang(next) {
  if (next === state.lang || !LANGS.includes(next)) return;
  state.lang = next;
  storeLang(next);
  syncLangSwitch();
  const update = () => {
    root.lang = next; // font subset, AZ uppercasing (i → İ) and the language pill follow html[lang]
    if (state.error) return showError(state.error);
    if (!state.model) return;
    const anchor = captureAnchor();
    render();
    restoreAnchor(anchor);
    if (sheet?.open) fillSheet();
  };
  endIntro();
  if (document.startViewTransition && canAnimate()) document.startViewTransition(update);
  else update();
}

// ---------- scroll-spy: one IntersectionObserver, no scroll listeners ----------

function observeSections() {
  if (spy) spy.disconnect();
  const nav = $('catnav');
  navHeight = nav.offsetHeight;
  root.style.setProperty('--nav-h', `${navHeight}px`);
  if (!('IntersectionObserver' in window)) return;
  const links = new Map(Array.from(nav.querySelectorAll('a'), (link) => [link.hash.slice(1), link]));
  const visible = new Set();
  spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id)));
    let id = null;
    for (const key of links.keys()) if (visible.has(key)) id = key; // lowest section in the band = being read
    if (id) setActiveLink(nav, links.get(id));
  }, { rootMargin: `-${navHeight + 2}px 0px -55% 0px` }); // +2: touching the nav edge is not "current"
  document.querySelectorAll('.cat').forEach((section) => spy.observe(section));
}

/** The nav wraps on wide screens: re-measure when its height changes (resize, font swap). */
function watchNavHeight() {
  if (!('ResizeObserver' in window)) return;
  new ResizeObserver(([entry]) => {
    if (state.model && entry.target.offsetHeight !== navHeight) observeSections();
  }).observe($('catnav'));
}

function setActiveLink(nav, link) {
  if (link.getAttribute('aria-current') === 'true') return;
  const strip = link.closest('ul');
  const left = link.offsetLeft;
  const outOfView = left < strip.scrollLeft || left + link.offsetWidth > strip.scrollLeft + strip.clientWidth;
  nav.querySelectorAll('[aria-current]').forEach((other) => other.removeAttribute('aria-current'));
  link.setAttribute('aria-current', 'true');
  // scroll the strip only: scrollIntoView would move the page too
  if (outOfView) strip.scrollTo({ left: Math.max(0, left - 16), behavior: canAnimate() ? 'smooth' : 'auto' });
}

// ---------- motion hooks (visuals live in CSS) ----------

/** The scene starts at first paint (inline script sets html.is-intro); here it only ends. */
function endIntro() {
  clearTimeout(timers.intro);
  root.classList.remove('is-intro');
}

function restamp() {
  if (!canAnimate() || root.classList.contains('is-intro')) return;
  const stamp = $('stamp');
  stamp.classList.remove('is-stamping');
  void stamp.offsetWidth; // restart CSS animations from frame 0
  stamp.classList.add('is-stamping');
  clearTimeout(timers.stamp);
  timers.stamp = setTimeout(() => stamp.classList.remove('is-stamping'), cssMs('--stamp-ms'));
}

/** Only content below the first screen may fade in. */
function markReveal() {
  if (!canAnimate()) return;
  const fold = window.innerHeight;
  const below = Array.from(document.querySelectorAll('.set, .cat__head, .item')).filter((el) => el.getBoundingClientRect().top > fold);
  below.forEach((el) => el.classList.add('reveal'));
}

/** Savings strike + stamp, once per set. 0.6 rather than 1: WebKit may report 0.99 for a fully visible block. */
function armSets() {
  if (setObserver) setObserver.disconnect();
  if (!canAnimate() || !('IntersectionObserver' in window)) return;
  setObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const card = entry.target.closest('.set');
    card.classList.add('is-seen');
    seenSets.add(card.id);
    setObserver.unobserve(entry.target);
  }), { threshold: 0.6, rootMargin: '0px 0px -15% 0px' });
  const fold = window.innerHeight;
  const blocks = Array.from(document.querySelectorAll('.set__price'))
    .filter((block) => block.querySelector('.save') && !seenSets.has(block.closest('.set').id))
    .filter((block) => block.getBoundingClientRect().top > fold); // reads first, writes below
  blocks.forEach((block) => {
    block.closest('.set').classList.add('is-armed');
    setObserver.observe(block);
  });
}

// ---------- details sheet: native <dialog> (focus trap, Esc, top layer) ----------

let sheet = null;
let sheetItemId = null;

function findItem(id) {
  for (const category of state.model?.categories || []) {
    const item = category.items.find((it) => it.id === id);
    if (item) return item;
  }
  return state.model?.hero?.id === id ? state.model.hero : null;
}

function ensureSheet() {
  if (sheet) return sheet;
  sheet = document.createElement('dialog');
  sheet.className = 'sheet';
  sheet.setAttribute('aria-labelledby', 'sheet-t');
  sheet.addEventListener('cancel', (event) => { event.preventDefault(); requestCloseSheet(); }); // Esc
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet || event.target.closest('[data-js="close"]')) requestCloseSheet(); // backdrop or ×
  });
  document.body.append(sheet);
  return sheet;
}

function fillSheet() {
  const item = findItem(sheetItemId);
  if (item) mount(sheet, detailSheet(item, createContext(state.model, state.lang)));
}

function openSheet(id) {
  if (!findItem(id)) return;
  ensureSheet();
  const replacing = sheet.open;
  sheetItemId = id;
  fillSheet();
  sheet.classList.remove('is-closing');
  if (!replacing) {
    sheet.showModal();
    root.classList.add('has-sheet'); // iOS: <dialog> alone does not stop the page from scrolling
    history.pushState({ bcSheet: id }, ''); // the phone's Back closes the sheet, not the menu
  } else {
    sheet.querySelector('[data-js="sheet-panel"]').scrollTop = 0;
  }
  prepareStoryFor(id);
  // focus the panel itself (no ring); iOS would otherwise auto-focus × and draw a focus ring after a tap
  sheet.querySelector('[data-js="sheet-panel"]').focus({ preventScroll: true });
}

// ---------- share to stories (js/share.js is loaded only when a modal opens) ----------

const shareModule = () => import('./share.js?v=' + BUILD);

function prepareStoryFor(id) {
  if (story && story.id === id && story.lang === state.lang) return;
  const item = findItem(id);
  const ctx = createContext(state.model, state.lang);
  const pageUrl = location.origin + location.pathname;
  story = { id, lang: state.lang, file: shareModule().then((m) => m.prepareStory({ item, ctx, pageUrl })).catch(() => null) };
}

async function onShare(button) {
  prepareStoryFor(button.dataset.id);
  const label = button.querySelector('span');
  const ctx = createContext(state.model, state.lang);
  const [module, file] = await Promise.all([shareModule(), story.file]);
  if (!file) return;
  const result = await module.shareStory(file, `Black Calf — ${ctx.pick(findItem(button.dataset.id).title)}`);
  if (result === 'saved' && label) label.textContent = ctx.t('story_saved');
}

/** Every close goes through history so Back, ×, Esc and the backdrop behave the same. */
function requestCloseSheet() {
  if (history.state?.bcSheet) history.back();
  else closeSheet();
}

function closeSheet() {
  if (!sheet?.open) return;
  const opener = document.querySelector(`[data-js="open"][data-id="${sheetItemId}"]`);
  const finish = () => {
    sheet.close();
    sheet.classList.remove('is-closing');
    root.classList.remove('has-sheet');
    opener?.focus({ preventScroll: true, focusVisible: false });
  };
  if (!canAnimate()) return finish();
  sheet.classList.add('is-closing');
  setTimeout(finish, cssMs('--sheet-out-ms'));
}

function toggleExpand(button) {
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  button.closest('.item, .hero').toggleAttribute('data-open', open);
}

// ---------- boot ----------

function showError(error) {
  const strings = OFFLINE_STRINGS[state.lang];
  state.error = error;
  ['hero', 'catnav', 'teaser'].forEach((name) => { if ($(name)) $(name).hidden = true; });
  setChrome(strings.page, strings.skip);
  // only a failed download is "check your connection"; data or code problems get the neutral text
  const network = error instanceof MenuLoadError && error.message !== 'empty';
  mount($('menu'), errorState(network ? strings : { ...strings, text: strings.empty }));
  $('error-title')?.focus();
}

async function boot() {
  const status = $('status');
  clearTimeout(timers.slow);
  if (status) timers.slow = setTimeout(() => { status.textContent = OFFLINE_STRINGS[state.lang].loading; }, SLOW_MS);
  try {
    const { model, warnings } = await loadMenu(`menu.json?v=${BUILD}`);
    if (isDebug) warnings.forEach((warning) => console.warn(`[menu] ${warning}`));
    state.model = model;
    state.error = null;
    render();
    // only deep links into the menu scroll; anything else (an old #notes from v1) is dropped so the page opens at the top
    const target = /^#(cat|item)-[\w-]+$/.test(location.hash) && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'instant' });
    else if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  } catch (error) {
    if (isDebug) console.warn('[menu] load failed:', error.message);
    if (!(error instanceof MenuLoadError) && reloadFresh()) return; // a render bug may be a version mix
    showError(error);
  } finally {
    clearTimeout(timers.slow);
  }
}

function wireEvents() {
  $('lang').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lang]');
    if (button) setLang(button.dataset.lang);
  });
  $('stamp').addEventListener('click', restamp);
  $('catnav').addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (link) setActiveLink($('catnav'), link); // immediate feedback; the spy confirms on arrival
  });
  document.addEventListener('click', (event) => {
    const share = event.target.closest('[data-js="share"]');
    if (share && state.model) return void onShare(share);
    const opener = event.target.closest('[data-js="open"]');
    if (opener && state.model) {
      event.preventDefault();
      return openSheet(opener.dataset.id);
    }
    const expand = event.target.closest('[data-js="expand"]');
    if (expand) toggleExpand(expand);
    if (!event.target.closest('[data-js="retry"]')) return;
    ['hero', 'catnav', 'teaser'].forEach((name) => { $(name).hidden = false; });
    boot();
  });
  document.addEventListener('touchstart', () => {}, { passive: true }); // lets :active fire on iOS
  addEventListener('popstate', () => { if (!history.state?.bcSheet) closeSheet(); });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true }); // never competes with the first render
}

function start() {
  // a QR menu always starts at the top: no restored scroll position from an earlier visit (Jamil, r9)
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (root.classList.contains('is-intro')) timers.intro = setTimeout(endIntro, cssMs('--intro-ms'));
  syncLangSwitch();
  wireEvents();
  watchNavHeight();
  boot();
  registerServiceWorker();
}

if (!(shellIsStale() && reloadFresh())) {
  if (shellIsStale()) showError(new MenuLoadError('empty')); // reload did not help: say so, never crash
  else start();
}

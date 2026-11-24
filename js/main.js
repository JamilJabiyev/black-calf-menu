// Composition root: owns state and the DOM (render, language, scroll-spy, motion hooks).
import { LANGS, loadMenu, createContext } from './model.js?v=2026-11-24-r2';
import { mount, renderApp, errorState } from './views.js?v=2026-11-24-r2';

// Shown before or without menu.json, so they cannot live in its "ui" block.
const OFFLINE_STRINGS = {
  az: { page: 'Black Calf — Menyu', skip: 'Menyuya keç', loading: 'Yüklənir…', title: 'Menyu yüklənmədi', text: 'İnterneti yoxlayın və ya kassada soruşun.', empty: 'Menyu müvəqqəti əlçatan deyil. Kassada soruşun.', retry: 'Yenidən cəhd et' },
  ru: { page: 'Black Calf — Меню', skip: 'Перейти к меню', loading: 'Загружается…', title: 'Меню не загрузилось', text: 'Проверьте интернет или спросите на кассе.', empty: 'Меню временно недоступно. Спросите на кассе.', retry: 'Повторить' },
  en: { page: 'Black Calf — Menu', skip: 'Skip to menu', loading: 'Loading…', title: "The menu didn't load", text: 'Check your connection or ask at the counter.', empty: 'The menu is temporarily unavailable. Please ask at the counter.', retry: 'Try again' },
};
const STORAGE_KEY = 'bc-lang';
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
const seenSets = new Set();

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
  $('h1').textContent = title;
  $('skip').textContent = skip;
}

function syncLangSwitch() {
  const group = $('lang');
  group.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  });
}

function storeLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode: keep it for this visit only */ }
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
    root.lang = next; // switches the font subset, AZ-correct uppercasing (i → İ) and the language pill
    if (state.error) return showError(state.error);
    if (!state.model) return;
    const anchor = captureAnchor();
    render();
    restoreAnchor(anchor);
  };
  endIntro();
  if (document.startViewTransition && canAnimate()) document.startViewTransition(update);
  else update();
}

// ---------- scroll-spy: one IntersectionObserver, no scroll listeners ----------

function observeSections() {
  if (spy) spy.disconnect();
  const nav = $('catnav');
  const navHeight = nav.offsetHeight;
  root.style.setProperty('--nav-h', `${navHeight}px`); // the nav may wrap on desktop
  if (!('IntersectionObserver' in window)) return; // links still work as plain anchors
  const links = new Map(Array.from(nav.querySelectorAll('a'), (link) => [link.hash.slice(1), link]));
  const visible = new Set();
  spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id)));
    let id = null;
    for (const key of links.keys()) if (visible.has(key)) id = key; // the lowest section in the band is the one being read
    if (id) setActiveLink(nav, links.get(id));
  }, { rootMargin: `-${navHeight + 2}px 0px -55% 0px` }); // +2: a section merely touching the nav edge is not "current"
  document.querySelectorAll('.cat').forEach((section) => spy.observe(section));
}

function setActiveLink(nav, link) {
  if (link.getAttribute('aria-current') === 'true') return;
  const strip = link.closest('ul');
  const left = link.offsetLeft;
  const outOfView = left < strip.scrollLeft || left + link.offsetWidth > strip.scrollLeft + strip.clientWidth;
  nav.querySelectorAll('[aria-current]').forEach((other) => other.removeAttribute('aria-current'));
  link.setAttribute('aria-current', 'true');
  // scrollTo on the strip only: scrollIntoView would also move the page
  if (outOfView) strip.scrollTo({ left: Math.max(0, left - 16), behavior: canAnimate() ? 'smooth' : 'auto' });
}

// ---------- motion hooks (visuals live in CSS) ----------

/** The stamp scene starts at first paint (inline script sets html.is-intro); here we only end it. */
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

/** Only content that starts below the first screen may fade in; what the guest already sees stays put. */
function markReveal() {
  if (!canAnimate()) return;
  const fold = window.innerHeight;
  const below = Array.from(document.querySelectorAll('.set, .cat__head')).filter((el) => el.getBoundingClientRect().top > fold);
  below.forEach((el) => el.classList.add('reveal'));
}

/** Savings strike + stamp, once per set, when the price block itself is fully in view. */
function armSets() {
  if (setObserver) setObserver.disconnect();
  if (!canAnimate() || !('IntersectionObserver' in window)) return;
  setObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const card = entry.target.closest('.set');
    card.classList.add('is-seen');
    seenSets.add(card.id);
    setObserver.unobserve(entry.target);
  }), { threshold: 1, rootMargin: '0px 0px -15% 0px' });
  const fold = window.innerHeight;
  const blocks = Array.from(document.querySelectorAll('.set__price'))
    .filter((block) => block.querySelector('.save') && !seenSets.has(block.closest('.set').id))
    .filter((block) => block.getBoundingClientRect().top > fold); // reads first, writes below
  blocks.forEach((block) => {
    block.closest('.set').classList.add('is-armed');
    setObserver.observe(block);
  });
}

function toggleExpand(button) {
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  button.closest('.item, .hero').toggleAttribute('data-open', open);
}

// ---------- boot ----------

function reportWarnings(warnings) {
  if (isDebug) warnings.forEach((warning) => console.warn(`[menu] ${warning}`));
}

function showError(error) {
  const strings = OFFLINE_STRINGS[state.lang];
  state.error = error;
  $('hero').hidden = true;
  $('catnav').hidden = true;
  setChrome(strings.page, strings.skip);
  const message = error.message === 'empty' ? { ...strings, text: strings.empty } : strings;
  mount($('menu'), errorState(message));
  $('error-title').focus();
}

async function boot() {
  const status = $('status');
  clearTimeout(timers.slow);
  if (status) timers.slow = setTimeout(() => { status.textContent = OFFLINE_STRINGS[state.lang].loading; }, SLOW_MS);
  try {
    const { model, warnings } = await loadMenu('menu.json');
    reportWarnings(warnings);
    state.model = model;
    state.error = null;
    render();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
  } catch (error) {
    if (isDebug) console.warn('[menu] load failed:', error.message);
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
    const expand = event.target.closest('[data-js="expand"]');
    if (expand) toggleExpand(expand);
    if (!event.target.closest('[data-js="retry"]')) return;
    $('hero').hidden = false;
    $('catnav').hidden = false;
    boot();
  });
  // lets :active fire on iOS Safari
  document.addEventListener('touchstart', () => {}, { passive: true });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // after load, so it never competes with the first render
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => { /* site works without it */ });
  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true });
}

if (root.classList.contains('is-intro')) timers.intro = setTimeout(endIntro, cssMs('--intro-ms'));
syncLangSwitch();
wireEvents();
boot();
registerServiceWorker();

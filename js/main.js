// Composition root: owns state and the DOM (render, language, scroll-spy, motion hooks).
import { LANGS, loadMenu, createContext } from './model.js';
import { mount, renderApp, errorState } from './views.js';

// Shown before or without menu.json, so they cannot live in its "ui" block.
const OFFLINE_STRINGS = {
  az: { loading: 'Yüklənir…', title: 'Menyu yüklənmədi', text: 'İnterneti yoxlayın və ya kassada soruşun.', retry: 'Yenidən cəhd et' },
  ru: { loading: 'Загружается…', title: 'Меню не загрузилось', text: 'Проверьте интернет или спросите на кассе.', retry: 'Повторить' },
  en: { loading: 'Loading…', title: "The menu didn't load", text: 'Check your connection or ask at the counter.', retry: 'Try again' },
};
const STORAGE_KEY = 'bc-lang';
const INTRO_MS = 2000;   // longest intro chain (smoke) ends at ~1.9 s
const STAMP_MS = 1400;
const SLOW_MS = 4000;

const root = document.documentElement;
const $ = (name) => document.querySelector(`[data-js="${name}"]`);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canAnimate = () => !reducedMotion.matches;
const isDebug = ['localhost', '127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).has('debug');

const state = { lang: LANGS.includes(root.lang) ? root.lang : 'az', model: null };
const timers = { intro: 0, stamp: 0, slow: 0 };
let spy = null;
let setObserver = null;
const seenSets = new Set();

// ---------- render ----------

function render() {
  const ctx = createContext(state.model, state.lang);
  const parts = renderApp(state.model, ctx);
  Object.entries(parts).forEach(([name, fragment]) => mount($(name), fragment));
  document.title = ctx.t('page_title') || document.title;
  $('h1').textContent = ctx.t('page_title');
  $('skip').textContent = ctx.t('skip');
  $('catnav').setAttribute('aria-label', ctx.t('categories_nav'));
  $('demo').hidden = !state.model.isDemo;
  $('hero').hidden = !state.model.hero;
  observeSections();
  armSets();
}

function syncLangSwitch() {
  const group = $('lang');
  group.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  });
  group.style.setProperty('--lang-i', String(LANGS.indexOf(state.lang)));
}

function storeLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode: keep it for this visit only */ }
}

/** Keeps the same row under the sticky nav across a re-render (BA AC-01.7). */
function captureAnchor() {
  const navBottom = $('catnav').getBoundingClientRect().bottom;
  const rows = document.querySelectorAll('[id^="item-"], .cat');
  for (const row of rows) {
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
    root.lang = next; // also switches the font subset and AZ-correct uppercasing (i → İ)
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
  if (!('IntersectionObserver' in window)) return; // links still work as plain anchors
  const nav = $('catnav');
  const links = new Map(Array.from(nav.querySelectorAll('a'), (link) => [link.hash.slice(1), link]));
  const visible = new Set();
  spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id)));
    const id = Array.from(links.keys()).find((key) => visible.has(key));
    if (id) setActiveLink(nav, links.get(id));
  }, { rootMargin: `-${nav.offsetHeight}px 0px -55% 0px` });
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

function startIntro() {
  if (!canAnimate() || !state.model.hero) return;
  try {
    if (sessionStorage.getItem('bc-intro')) return; // the brand scene plays once per visit
    sessionStorage.setItem('bc-intro', '1');
  } catch { /* storage blocked: play it */ }
  root.classList.add('is-intro');
  $('stamp').classList.add('is-stamping');
  timers.intro = setTimeout(endIntro, INTRO_MS);
}

function endIntro() {
  clearTimeout(timers.intro);
  root.classList.remove('is-intro');
  $('stamp').classList.remove('is-stamping');
}

/** Tap on the stamp replays the scene. */
function restamp() {
  if (!canAnimate() || root.classList.contains('is-intro')) return;
  const stamp = $('stamp');
  stamp.classList.remove('is-stamping');
  void stamp.offsetWidth; // restart CSS animations from frame 0
  stamp.classList.add('is-stamping');
  clearTimeout(timers.stamp);
  timers.stamp = setTimeout(() => stamp.classList.remove('is-stamping'), STAMP_MS);
}

/** Savings strike + stamp: once per set, when 60 % in view. */
function armSets() {
  if (setObserver) setObserver.disconnect();
  if (!canAnimate() || !('IntersectionObserver' in window)) return;
  setObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-seen');
    seenSets.add(entry.target.id);
    setObserver.unobserve(entry.target);
  }), { threshold: 0.6 });
  const foldY = window.innerHeight;
  document.querySelectorAll('.set').forEach((card) => {
    // cards already on screen stay static: never hide a price fact the guest is reading
    if (seenSets.has(card.id) || !card.querySelector('.save') || card.getBoundingClientRect().top < foldY) return;
    card.classList.add('is-armed');
    setObserver.observe(card);
  });
}

// ---------- boot ----------

function reportWarnings(warnings) {
  if (isDebug) warnings.forEach((warning) => console.warn(`[menu] ${warning}`));
}

function showError() {
  const strings = OFFLINE_STRINGS[state.lang];
  $('hero').hidden = true;
  $('catnav').hidden = true;
  $('status').textContent = '';
  mount($('menu'), errorState(strings));
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
    root.lang = state.lang;
    render();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    startIntro();
  } catch (error) {
    if (isDebug) console.warn('[menu] load failed:', error.message);
    showError();
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
  $('menu').addEventListener('click', (event) => {
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

syncLangSwitch();
wireEvents();
boot();
registerServiceWorker();

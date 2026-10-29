/** Medición de las páginas públicas. Bloqueo básico: ninguna conexión antes de aceptar. */
import { measurement } from './medicion-config.js';
import { el } from './ui.js';

const KEY = 'miniapolis-consentimiento-v1';
const TTL = 180 * 24 * 60 * 60 * 1000;
const campaigns = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const denied = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
const production = new URL(measurement.url);
const pagePath = (path) => path === `${production.pathname}index.html` ? production.pathname : path;
const currentPage = () => measurement.pages.find((page) => page.path === pagePath(location.pathname));
const validId = /^G-[A-Z0-9]+$/.test(measurement.id);
const eligible = () => location.protocol === 'https:' && location.origin === production.origin && Boolean(currentPage()) && validId;

/** Campañas con vocabulario acotado; nunca texto libre, correos, teléfonos ni fragmentos. */
export function safeCampaign(value) {
  return typeof value === 'string' && value.length <= 80 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value) && !/\d{7,}/.test(value) ? value : '';
}

export function cleanLocation(value) {
  try {
    const source = new URL(value, measurement.url);
    const page = measurement.pages.find((item) => item.path === pagePath(source.pathname));
    if (source.origin !== production.origin || !page) return measurement.url;
    const clean = new URL(page.path, production.origin);
    for (const key of campaigns) {
      const safe = safeCampaign(source.searchParams.get(key));
      if (safe) clean.searchParams.set(key, safe);
    }
    return clean.href;
  } catch { return measurement.url; }
}

export function cleanReferrer(value) {
  try {
    const ref = new URL(value);
    if (!['https:', 'http:'].includes(ref.protocol)) return '';
    return ref.origin === production.origin ? new URL(cleanLocation(value)).origin + new URL(cleanLocation(value)).pathname : `${ref.origin}/`;
  } catch { return ''; }
}

let choice = 'unset';
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && Date.now() - saved.at < TTL && ['accepted', 'rejected'].includes(saved.choice)) choice = saved.choice;
} catch { /* Si falla el almacenamiento, la decisión vive en memoria. */ }
let configured = false;
let scriptStarted = false;
let lastPage = '';
let banner;
let returnFocus;

function command() { window.dataLayer.push(arguments); }

/** Priva de validez todas las cookies GA accesibles, también en rutas y dominios padre. */
export function clearAnalyticsCookies() {
  const names = document.cookie.split(';').map((part) => part.split('=')[0].trim()).filter((name) => /^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/.test(name));
  const labels = location.hostname.split('.');
  const domains = ['', ...labels.map((_, index) => labels.slice(index).join('.')).filter((domain) => domain.includes('.'))];
  const parts = location.pathname.split('/').filter(Boolean);
  const paths = new Set(['/']);
  for (let index = 1; index <= parts.length; index += 1) {
    paths.add(`/${parts.slice(0, index).join('/')}`);
    paths.add(`/${parts.slice(0, index).join('/')}/`);
  }
  for (const name of names) for (const domain of domains) for (const path of paths) {
    document.cookie = `${name}=; Max-Age=0; Path=${path};${domain ? ` Domain=${domain};` : ''} SameSite=Lax; Secure`;
  }
}

function pageView() {
  if (choice !== 'accepted' || !eligible()) return;
  const page = currentPage();
  if (lastPage === page.path) return;
  lastPage = page.path;
  command('event', 'page_view', { page_title: page.title, page_location: cleanLocation(location.href), page_referrer: cleanReferrer(document.referrer) });
}

function enable() {
  if (!eligible()) return;
  window[`ga-disable-${measurement.id}`] = false;
  if (!configured) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = command;
    command('consent', 'default', denied);
    command('set', 'ads_data_redaction', true);
    command('js', new Date());
    command('consent', 'update', { ...denied, analytics_storage: 'granted' });
    command('config', measurement.id, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_domain: 'none', cookie_path: production.pathname, cookie_expires: 33696000, cookie_update: false,
      page_location: cleanLocation(location.href), page_referrer: cleanReferrer(document.referrer), page_title: currentPage().title,
    });
    if (!scriptStarted) {
      const script = document.createElement('script');
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurement.id}`;
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.id = 'miniapolis-google-analytics';
      document.head.append(script);
      scriptStarted = true;
    }
    configured = true;
  } else command('consent', 'update', { ...denied, analytics_storage: 'granted' });
  pageView();
}

function choose(nextChoice) {
  choice = nextChoice;
  try { localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() })); } catch { /* Conservar en memoria. */ }
  if (choice === 'accepted') enable();
  else {
    window[`ga-disable-${measurement.id}`] = true;
    // No actualizar consentimiento en Google al retirar: evitar pings sin cookies.
    if (window.dataLayer) window.dataLayer.length = 0;
    configured = false;
    lastPage = '';
    clearAnalyticsCookies();
  }
  banner.hidden = true;
  returnFocus?.focus();
}

function preferences() {
  returnFocus = document.activeElement;
  banner.hidden = false;
  banner.querySelector('button')?.focus();
}

function setup() {
  // La protección por host es adicional al consentimiento; nunca medir localhost o páginas privadas.
  window[`ga-disable-${measurement.id}`] = choice !== 'accepted' || !eligible();
  const status = document.querySelector('[data-measurement-status]');
  if (status) status.textContent = validId ? 'La medición de visitas es opcional y requiere tu aceptación.' : 'La medición de visitas está actualmente desactivada en esta web.';
  banner = el('section', { class: 'consentimiento', 'aria-label': 'Preferencias de cookies' },
    el('h2', {}, 'Tú eliges la medición'),
    el('p', {}, 'Usamos cookies opcionales para saber qué páginas se visitan. Solo cargamos Google Analytics si aceptas. Puedes cambiar tu elección al pie. ', el('a', { href: './privacidad.html' }, 'Privacidad y cookies')),
    el('div', { class: 'consentimiento__acciones' },
      el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => choose('rejected') }, 'Rechazar medición'),
      el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => choose('accepted') }, 'Aceptar medición')));
  if (!validId) {
    banner.replaceChildren(el('h2', {}, 'Medición de visitas desactivada'),
      el('p', {}, 'Este sitio no envía datos a Google Analytics. Puedes seguir consultando todas sus páginas.'),
      el('button', { type: 'button', class: 'boton boton--fantasma', onClick: () => { banner.hidden = true; returnFocus?.focus(); } }, 'Cerrar'));
  }
  banner.hidden = !validId || choice !== 'unset';
  document.body.append(banner);
  const existing = document.querySelector('[data-cookie-preferences]');
  if (!existing) {
    const footer = document.querySelector('footer .sitio-pie__base') || document.querySelector('footer');
    footer?.append(el('a', { href: './privacidad.html' }, 'Privacidad y cookies'), el('button', { type: 'button', class: 'boton boton--fantasma boton--chico', 'data-cookie-preferences': '', onClick: preferences }, 'Preferencias de cookies'));
  }
  existing?.addEventListener('click', preferences);
  if (choice === 'accepted') enable();
  else clearAnalyticsCookies();

  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    let next = 'rejected';
    try { if (JSON.parse(event.newValue)?.choice === 'accepted') next = 'accepted'; } catch { /* Revocar si se borra. */ }
    choice = next;
    if (next === 'accepted') { enable(); banner.hidden = true; }
    else { choose('rejected'); }
  });
  document.addEventListener('click', (event) => {
    if (choice !== 'accepted' || !eligible()) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.href, location.href); } catch { return; }
    const cta = link.closest('footer') ? 'footer' : link.closest('header') ? 'header' : 'content';
    const params = { cta_location: cta, page_title: currentPage().title, page_location: cleanLocation(location.href), page_referrer: cleanReferrer(document.referrer) };
    if (['racinghobbies.net', 'simracingec.com'].includes(url.hostname)) command('event', 'partner_store_click', { ...params, partner: url.hostname === 'racinghobbies.net' ? 'racing_hobbies' : 'sim_racing_ecuador' });
    else if (url.hostname === 'wa.me' && url.pathname === '/593989019836') command('event', 'partner_whatsapp_click', { ...params, partner: 'racing_hobbies' });
    else if (url.origin === location.origin && url.hash === '#acceso') command('event', 'login_intent', params);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
else setup();

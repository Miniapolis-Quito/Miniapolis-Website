import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { site, publicPages } from '../site.config.js';

const source = fs.readFileSync('public/js/medicion.js', 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');

function browser({ url = site.url, saved = null, storageFails = false } = {}) {
  const handlers = {};
  const scripts = [];
  const buttons = [];
  const nodes = [];
  const cookies = [];
  const window = { addEventListener: (type, callback) => { handlers[type] = callback; } };
  const el = (tag, attrs = {}, ...children) => {
    const node = { tag, ...attrs, children, hidden: false, focus() {}, addEventListener(type, cb) { this[`on${type}`] = cb; }, append(...items) { children.push(...items); }, querySelector() { return buttons[0]; } };
    nodes.push(node);
    if (tag === 'button') buttons.push(node);
    return node;
  };
  const preferencesButton = el('button');
  const document = {
    readyState: 'complete', activeElement: preferencesButton,
    referrer: 'https://example.org/path?email=private@example.org',
    head: { append: (script) => scripts.push(script) }, body: { append: (node) => nodes.push(node) },
    createElement: (tag) => ({ tag }), querySelector: () => preferencesButton,
    addEventListener: (type, callback) => { handlers[type] = callback; },
    get cookie() { return '_ga=secret; _ga_TEST=secret; session=essential'; },
    set cookie(value) { cookies.push(value); },
  };
  let stored = saved;
  let writes = 0;
  const localStorage = { getItem() { if (storageFails) throw new Error('denied'); return stored; }, setItem(_, value) { if (storageFails) throw new Error('denied'); stored = value; writes += 1; } };
  const measurement = { id: 'G-TEST1234', url: site.url, campaignValues: site.campaignValues, pages: publicPages.map((p) => ({ path: new URL(p.path, site.url).pathname, title: p.title })) };
  const context = vm.createContext({ window, document, location: new URL(url), localStorage, URL, Date, measurement, el });
  vm.runInContext(source, context);
  const clickChoice = (choice) => buttons.find((b) => b.children.includes(choice))?.onClick();
  const events = () => (window.dataLayer || []).filter(([type]) => type === 'event');
  return { window, document, nodes, scripts, cookies, context, handlers, events, writes: () => writes, stored: () => stored, accept: () => clickChoice('Aceptar medición'), reject: () => clickChoice('Rechazar medición') };
}

test('sin permiso no se carga Google ni se envían eventos, tampoco al rechazar', () => {
  const b = browser();
  assert.equal(b.scripts.length, 0);
  assert.equal(b.events().length, 0);
  b.reject();
  assert.equal(b.scripts.length, 0);
  assert.equal(JSON.parse(b.stored()).choice, 'rejected');
  assert.ok(b.cookies.some((c) => c.includes('Path=/;')));
  const nested = browser({ url: `${site.url}nivel/pagina.html` });
  nested.reject();
  assert.ok(nested.cookies.some((c) => c.includes('Path=/nivel/;')));
  assert.ok(!b.cookies.some((c) => c.startsWith('session=')));
});

test('aceptar tarde mide solo la página actual una vez y carga una sola integración', () => {
  const b = browser();
  b.accept();
  b.accept();
  assert.equal(b.scripts.length, 1);
  assert.equal(b.events().filter((e) => e[1] === 'page_view').length, 1);
  const commands = b.window.dataLayer;
  assert.equal(commands[0][0], 'consent');
  assert.equal(commands[0][2].analytics_storage, 'denied');
  assert.equal(commands.find((c) => c[0] === 'config')[2].send_page_view, false);
  assert.equal(commands.find((c) => c[0] === 'config')[2].allow_google_signals, false);
});

test('retirar corta eventos, elimina cookies y volver a aceptar no duplica el cliente', () => {
  const b = browser();
  b.accept();
  b.reject();
  assert.equal(b.window['ga-disable-G-TEST1234'], true);
  assert.equal(b.events().length, 0);
  b.accept();
  assert.equal(b.scripts.length, 1);
  assert.equal(b.events().length, 1);
});

test('almacenamiento bloqueado conserva la decisión en la visita', () => {
  const b = browser({ storageFails: true });
  b.accept();
  assert.equal(b.events().length, 1);
  b.reject();
  assert.equal(b.window['ga-disable-G-TEST1234'], true);
});

test('localhost, otros hosts y páginas de cuenta nunca cargan Analytics', () => {
  for (const url of ['http://localhost:3000/', 'https://preview.example.org/', `${site.url}admin.html`, `${site.url}restablecer.html#token=secret`]) {
    const b = browser({ url, saved: JSON.stringify({ choice: 'accepted', at: Date.now() }) });
    b.accept();
    assert.equal(b.scripts.length, 0, url);
    assert.equal(b.events().length, 0, url);
  }
});

test('URLs y referentes excluyen datos privados, fragmentos y campañas de texto libre', () => {
  const url = `${site.url}index.html?email=private@example.org&utm_source=newsletter&utm_medium=email&utm_campaign=otoño%20ana@example.org&utm_content=593999999999#token=private`;
  const b = browser({ url });
  b.accept();
  const params = b.events()[0][2];
  assert.equal(params.page_location, `${site.url}?utm_source=newsletter&utm_medium=email`);
  assert.equal(params.page_referrer, 'https://example.org/');
  assert.ok(!JSON.stringify(b.window.dataLayer).includes('private'));
  const personal = browser({ url: `${site.url}?utm_source=Danilo_Monge&utm_campaign=Ana_Piloto&utm_term=Cliente_Real` });
  personal.accept();
  assert.equal(personal.events()[0][2].page_location, site.url, 'una forma válida no convierte un nombre personal en una campaña autorizada');
});

test('la revocación en otra pestaña bloquea esta pestaña', () => {
  const b = browser();
  b.accept();
  b.handlers.storage({ key: 'miniapolis-consentimiento-v1', newValue: JSON.stringify({ choice: 'rejected', at: Date.now() }) });
  assert.equal(b.window['ga-disable-G-TEST1234'], true);
  assert.equal(b.events().length, 0);
  assert.equal(b.writes(), 1, 'recibir una revocación no debe escribir otra vez ni provocar bucles entre pestañas');
});

test('las páginas públicas tienen identidad, canónica única, marcado y sitemap coherentes', () => {
  const sitemap = fs.readFileSync('public/sitemap.xml', 'utf8');
  const titles = new Set();
  for (const page of publicPages) {
    const html = fs.readFileSync(`public/${page.file}`, 'utf8');
    assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1);
    assert.ok(html.includes(`href="${new URL(page.path, site.url).href}"`));
    assert.ok(html.includes('lang="es-EC"'));
    assert.ok(html.includes(`property="og:site_name" content="${site.name}"`));
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    assert.equal(data['@context'], 'https://schema.org');
    assert.ok(!JSON.stringify(data).includes('sameAs'));
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(!titles.has(title));
    titles.add(title);
    assert.ok(sitemap.includes(new URL(page.path, site.url).href));
  }
  assert.ok(!sitemap.includes('lastmod'));
  assert.ok(!sitemap.includes('admin'));
  for (const file of ['admin', 'app', 'scan', 'cartera', 'restablecer', 'recordatorios', '404']) {
    assert.match(fs.readFileSync(`public/${file}.html`, 'utf8'), /name="robots" content="noindex/);
  }
});

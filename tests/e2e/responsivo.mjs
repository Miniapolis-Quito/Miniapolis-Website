/**
 * Auditoría responsive: recorre todas las páginas, con cada rol, en los anchos
 * de pantalla habituales —del teléfono más estrecho al monitor grande— y falla
 * si algo se sale por el costado.
 *
 * Mira tres cosas que un vistazo en el escritorio no enseña:
 *
 * - **Desborde horizontal.** La página no puede tener barra de desplazamiento
 *   lateral, y ningún elemento visible puede asomar fuera de la pantalla salvo
 *   dentro de un contenedor que lo recorte o lo desplace a propósito (una tabla
 *   con su propio scroll, la fila de pestañas).
 * - **Texto que no cabe.** Una palabra larga o un botón que empuja su texto
 *   fuera de la caja.
 * - **Campos pequeños en el teléfono.** Por debajo de 16 px, Safari en iOS
 *   acerca la vista al tocar un campo y deja la página descolocada.
 *
 * No entra en `npm test` porque necesita Playwright. Con `CAPTURAS_DIR` guarda
 * además una captura de cada combinación, para revisarlas a ojo.
 */
import '../env-espera.js';
import { mkdirSync } from 'node:fs';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import * as packsService from '../../src/services/packs.js';
import { cargarNavegador } from './navegador.mjs';

const chromium = await cargarNavegador();
const B = await levantarServidor();
const { cliente: usuarioCliente, master } = await sembrarUsuarios();
packsService.issuePack({ userId: usuarioCliente.id, size: 10, priceCents: 2500, paymentMethod: 'cash', actor: master });

const CAPTURAS = process.env.CAPTURAS_DIR || null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

const ANCHOS = [
  [320, 640], [360, 740], [375, 667], [390, 844], [414, 896], [430, 932],
  [600, 960], [768, 1024], [834, 1194], [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
  // Teléfono girado: poca altura, que es donde se amontonan las cabeceras fijas.
  [844, 390],
];

const opciones = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
const navegador = await chromium.launch(opciones);

const problemas = [];
const errores = [];
let revisadas = 0;

/** Lo que se mide dentro de la página. Devuelve una lista de problemas legibles. */
function medir() {
  const vw = document.documentElement.clientWidth;
  const hallazgos = [];
  const nombre = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const clases = [...el.classList].slice(0, 2).join('.');
    if (clases) s += `.${clases}`;
    return s;
  };
  const visible = (el) => {
    const e = getComputedStyle(el);
    return e.visibility !== 'hidden' && e.display !== 'none' && Number(e.opacity) > 0.01;
  };
  // Un contenedor con su propio desplazamiento (una tabla, la fila de
  // pestañas) justifica que algo asome. Uno que recorta solo lo justifica si
  // es una pieza acotada —un marco de foto—: si ocupa todo el ancho, lo que
  // asoma no se ve y es contenido cortado.
  const recortado = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const e = getComputedStyle(a);
      if (['auto', 'scroll'].includes(e.overflowX)) return true;
      if (['hidden', 'clip'].includes(e.overflowX)) {
        const caja = a.getBoundingClientRect();
        if (caja.width < vw - 2) return true;
      }
    }
    return false;
  };
  const oculto = (el) => {
    for (let a = el; a; a = a.parentElement) {
      if (a.hidden || a.getAttribute?.('aria-hidden') === 'true' || a.inert) return true;
      const e = getComputedStyle(a);
      if (e.display === 'none' || e.visibility === 'hidden') return true;
    }
    return false;
  };

  // Una pieza que el motor de la portada mueve con el scroll (el riel que se
  // recorre de lado, el panel que entra frenando) está fuera a propósito hasta
  // que le llega su turno. En la pasada con movimiento reducido no se mueve
  // nada, y ahí es donde se exige que todo quepa.
  const enMovimiento = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const e = getComputedStyle(a);
      if (e.transform && e.transform !== 'none' && e.transform !== 'matrix(1, 0, 0, 1, 0, 0)') return true;
      // El riel arranca sin desplazar: lo delata que se prepara para moverse.
      if (e.willChange.includes('transform')) return true;
    }
    return false;
  };

  const anchoDoc = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (anchoDoc > vw + 1) hallazgos.push(`la página mide ${anchoDoc}px en una pantalla de ${vw}px`);

  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'svg'].includes(el.tagName) || el.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (!visible(el) || oculto(el)) continue;
    const posicion = getComputedStyle(el).position;
    if ((r.right > vw + 1 || r.left < -1) && !recortado(el) && posicion !== 'fixed' && !enMovimiento(el)) {
      hallazgos.push(`${nombre(el)} asoma fuera (${Math.round(r.left)}→${Math.round(r.right)} de ${vw})`);
    }
    // Texto que se sale de su caja: solo en hojas con texto propio.
    const e = getComputedStyle(el);
    const textoPropio = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (textoPropio && e.overflowX === 'visible' && e.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2
      && el.clientWidth > 0 && !['inline'].includes(e.display)) {
      hallazgos.push(`${nombre(el)} no le cabe el texto (${el.scrollWidth} en ${el.clientWidth}px): «${el.textContent.trim().slice(0, 40)}»`);
    }
  }

  // Una imagen que ya terminó de cargar sin píxeles es una ruta rota.
  for (const img of document.images) {
    if (!oculto(img) && img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      hallazgos.push(`imagen rota: ${img.getAttribute('src')}`);
    }
  }

  if (vw < 768) {
    for (const campo of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea')) {
      if (oculto(campo)) continue;
      const tam = parseFloat(getComputedStyle(campo).fontSize);
      if (tam < 16) hallazgos.push(`${nombre(campo)} tiene letra de ${tam}px: iOS acercará la vista al tocarlo`);
    }
  }
  return [...new Set(hallazgos)];
}

/**
 * Revisa una página en todos los anchos. Las públicas se recargan en cada uno;
 * las que tienen sesión se cargan una vez y se redimensiona la ventana, que es
 * también lo que pasa al girar el teléfono (y recargar tanto agotaría el límite
 * de renovaciones de la sesión).
 */
async function revisar(pagina, etiqueta, preparar, { recargarCadaAncho = false } = {}) {
  let preparada = false;
  for (const [ancho, alto] of ANCHOS) {
    await pagina.setViewportSize({ width: ancho, height: alto });
    if (preparar && (recargarCadaAncho || !preparada)) await preparar(pagina);
    preparada = true;
    await pagina.waitForTimeout(250);
    // Se baja hasta el fondo y se vuelve, para que las animaciones de entrada
    // de la portada dejen cada pieza en su sitio antes de medir.
    await pagina.evaluate(async () => {
      const paso = Math.max(200, innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight; y += paso) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      scrollTo(0, 0);
    });
    await pagina.waitForTimeout(300);
    revisadas += 1;
    const hallazgos = await pagina.evaluate(medir);
    for (const h of hallazgos) problemas.push(`${etiqueta} @${ancho}x${alto}: ${h}`);
    if (CAPTURAS) {
      await pagina.screenshot({ path: `${CAPTURAS}/${etiqueta.replace(/[^\w-]+/g, '_')}-${ancho}x${alto}.png`, fullPage: true });
    }
  }
}

async function entrar(pagina, email, clave, destino) {
  await pagina.goto(B, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#entrar-email', email);
  await pagina.fill('#entrar-password', clave);
  await pagina.click('#form-entrar button[type=submit]');
  await pagina.waitForURL(`**${destino}`, { timeout: 15000 });
}

const recargar = (ruta) => async (p) => {
  // `load` y no `networkidle`: las páginas con sesión mantienen abierto el
  // canal en vivo, y la red nunca llega a quedarse quieta.
  await p.goto(`${B}${ruta}`, { waitUntil: 'load' });
  await p.waitForTimeout(400);
};

/**
 * Cada recorrido se hace dos veces: con el movimiento que ve casi todo el
 * mundo y con movimiento reducido, que es la maquetación en reposo.
 */
for (const movimiento of ['no-preference', 'reduce']) {
  const sufijo = movimiento === 'reduce' ? ' (sin movimiento)' : '';
  const pestana = async (etiqueta) => {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: movimiento });
    const pagina = await contexto.newPage();
    pagina.on('pageerror', (e) => errores.push(`${etiqueta}${sufijo}: ${e.message}`));
    return pagina;
  };
  const revisarEn = (pagina, etiqueta, preparar, opciones) => revisar(pagina, `${etiqueta}${sufijo}`, preparar, opciones);

  // Páginas públicas.
  const anon = await pestana('anonimo');
  for (const ruta of ['/', '/posiciones', '/restablecer', '/recordatorios', '/cartera', '/no-existe']) {
    await revisarEn(anon, `publica${ruta}`, recargar(ruta), { recargarCadaAncho: true });
  }
  await revisarEn(anon, 'portada-crear-cuenta', async (p) => {
    await recargar('/')(p);
    const pestanaCrear = p.locator('.entrada__acceso-panel .pestana').nth(1);
    if (await pestanaCrear.count()) await pestanaCrear.click();
  }, { recargarCadaAncho: true });

  // Cliente.
  const cliente = await pestana('cliente');
  await entrar(cliente, 'cliente@pista.ec', CLAVES.cliente, '/app');
  await revisarEn(cliente, 'cliente/app', async (p) => {
    await recargar('/app')(p);
    await p.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
  });

  // Operador.
  const staff = await pestana('staff');
  await entrar(staff, 'staff@pista.ec', CLAVES.staff, '/escanear');
  await revisarEn(staff, 'staff/escanear', recargar('/escanear'));

  // Administración: cada pestaña por separado.
  const admin = await pestana('admin');
  await entrar(admin, 'master@pista.ec', CLAVES.master, '/admin');
  const secciones = await admin.locator('#pestanas-admin .pestana').evaluateAll((b) => b.filter((x) => x.checkVisibility()).map((x) => x.dataset.panel));
  for (const seccion of secciones) {
    await revisarEn(admin, `admin/${seccion}`, async (p) => {
      await recargar('/admin')(p);
      await p.click(`#pestanas-admin [data-panel="${seccion}"]`);
      await p.waitForSelector(`#panel-${seccion}:not([hidden])`, { timeout: 15000 });
      await p.waitForTimeout(600);
    });
  }

  // El riel de la portada se recorre de lado con el scroll: al final de su
  // tramo, el último panel tiene que haber entrado entero en la pantalla.
  // Con otras pestañas abiertas, Chromium frena las animaciones de la que no
  // está al frente: el motor no avanzaría y se mediría el riel sin mover.
  await anon.bringToFront();
  for (const [ancho, alto] of ANCHOS) {
    await anon.setViewportSize({ width: ancho, height: alto });
    await anon.goto(`${B}/`, { waitUntil: 'load' });
    const hayRiel = await anon.evaluate(() => document.documentElement.classList.contains('portada-fija'));
    if (!hayRiel) continue;
    await anon.evaluate(async () => {
      const recta = document.querySelector('.portada__recta');
      const fin = recta.getBoundingClientRect().bottom + scrollY - innerHeight - 2;
      for (let y = scrollY; y < fin; y += 150) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 30));
      }
      scrollTo(0, fin);
    });
    // El motor suaviza el recorrido: se espera a que el panel deje de moverse
    // (con la máquina cargada tarda más), no un tiempo fijo.
    await anon.waitForFunction(() => new Promise((resolver) => {
      const ultimo = [...document.querySelectorAll('.portada__riel .portada__panel')].at(-1);
      const antes = ultimo.getBoundingClientRect().left;
      setTimeout(() => resolver(Math.abs(ultimo.getBoundingClientRect().left - antes) < 0.5), 400);
    }), null, { timeout: 15000, polling: 100 }).catch(() => {});
    const caja = await anon.evaluate(() => {
      const r = [...document.querySelectorAll('.portada__riel .portada__panel')].at(-1).getBoundingClientRect();
      return { izq: r.left, der: r.right, vw: document.documentElement.clientWidth };
    });
    revisadas += 1;
    if (caja.izq < -1 || caja.der > caja.vw + 1) {
      problemas.push(`riel de la portada${sufijo} @${ancho}x${alto}: el último panel acaba en ${Math.round(caja.izq)}→${Math.round(caja.der)} de ${caja.vw}`);
    }
  }

  // El panel de acceso entra frenando desde un costado: al llegar a él tiene
  // que quedar entero dentro de la pantalla, en cualquier ancho.
  for (const [ancho, alto] of ANCHOS) {
    await anon.setViewportSize({ width: ancho, height: alto });
    await anon.goto(`${B}/#acceso`, { waitUntil: 'load' });
    await anon.locator('.entrada__acceso-panel').scrollIntoViewIfNeeded();
    await anon.waitForTimeout(1500);
    const caja = await anon.locator('.entrada__acceso-panel').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { izq: r.left, der: r.right, vw: document.documentElement.clientWidth };
    });
    revisadas += 1;
    if (caja.izq < -1 || caja.der > caja.vw + 1) {
      problemas.push(`panel de acceso${sufijo} @${ancho}x${alto}: al llegar a él queda en ${Math.round(caja.izq)}→${Math.round(caja.der)} de ${caja.vw}`);
    }
  }
}

await navegador.close();
await bajarServidor();

console.log(`${revisadas} combinaciones de página y pantalla revisadas.`);
for (const e of errores) console.log('ERROR ', e);
for (const p of problemas) console.log('FALLO ', p);
if (problemas.length || errores.length) {
  console.log(`\n${problemas.length} problemas de maquetación y ${errores.length} errores de página.`);
  process.exit(1);
}
console.log('Todo cabe en todas las pantallas.');
process.exit(0);

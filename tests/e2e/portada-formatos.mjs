/**
 * La portada en cada formato de pantalla, con la aplicación real levantada.
 *
 * Una portada con tanto movimiento se rompe de formas que solo se ven en un
 * tamaño concreto: un titular que la máscara recorta en una pantalla enorme, la
 * bandera que se queda a medias porque en una pantalla alta no hay scroll para
 * terminarla, un botón que en un móvil mide 32 px. Aquí se recorre una lista de
 * formatos reales (escritorio, portátil, tableta, móvil, apaisado, movimiento
 * reducido) y se comprueban las mismas cosas en todos.
 *
 * No entra en `npm test` porque necesita Playwright, que no es dependencia del
 * proyecto. Ver el README de esta carpeta.
 */
import '../env-espera.js';
import { levantarServidor, bajarServidor } from '../helpers.js';
import { cargarNavegador } from './navegador.mjs';

const chromium = await cargarNavegador();
const B = await levantarServidor();

/** [nombre, ancho, alto, { tactil, reducido }] */
const FORMATOS = [
  ['pantalla 4K', 3840, 2160],
  ['ultraancho', 3440, 1440],
  ['QHD / televisor', 2560, 1440],
  ['Full HD', 1920, 1080],
  ['portátil 1440×900', 1440, 900],
  ['portátil 1366×768', 1366, 768],
  ['portátil 1280×720', 1280, 720],
  ['netbook 1024×600', 1024, 600],
  ['iPad apaisado', 1024, 768, { tactil: true }],
  ['iPad Pro vertical', 1024, 1366, { tactil: true }],
  ['justo en el límite (900×600)', 900, 600],
  ['justo bajo el límite (899×800)', 899, 800],
  ['tableta vertical 820×1180', 820, 1180, { tactil: true }],
  ['tableta vertical 768×1024', 768, 1024, { tactil: true }],
  ['móvil grande 430×932', 430, 932, { tactil: true }],
  ['móvil 390×844', 390, 844, { tactil: true }],
  ['móvil 375×667', 375, 667, { tactil: true }],
  ['móvil pequeño 320×568', 320, 568, { tactil: true }],
  ['móvil apaisado 844×390', 844, 390, { tactil: true }],
  ['móvil apaisado 667×375', 667, 375, { tactil: true }],
  ['movimiento reducido, escritorio', 1440, 900, { reducido: true }],
  ['movimiento reducido, móvil', 390, 844, { tactil: true, reducido: true }],
];

const errores = [];
const fallidos = [];
let totales = 0;

async function paso(nombre, fn) {
  totales += 1;
  try {
    await fn();
    console.log('OK    ', nombre);
  } catch (error) {
    console.log('FALLO ', nombre, '->', error.message.split('\n')[0]);
    fallidos.push(nombre);
  }
}

const opciones = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
const navegador = await chromium.launch(opciones);

async function irA(pagina, y) {
  await pagina.evaluate((valor) => window.scrollTo({ top: Math.max(0, Math.round(valor)), behavior: 'instant' }), y);
  // El motor suaviza el scroll: hay que darle tiempo a asentarse.
  await pagina.waitForTimeout(1500);
}

async function comprobar(nombre, ancho, alto, { tactil = false, reducido = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    hasTouch: tactil,
    isMobile: tactil && ancho < 900,
    reducedMotion: reducido ? 'reduce' : 'no-preference',
  });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => errores.push(`${nombre} pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(`${nombre} console: ${m.text()}`);
  });
  await pagina.goto(B, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2600);

  const fallos = [];
  const hero = await pagina.evaluate(() => {
    const vw = window.innerWidth;
    const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    // Un párrafo o el kicker ocupan todo el ancho de su caja: se mide el texto, no la caja.
    const texto = (sel) => [...document.querySelectorAll(sel)].map((e) => { const rango = document.createRange(); rango.selectNodeContents(e); return rango.getBoundingClientRect(); }).filter((r) => r.width > 0);
    const textos = [
      ...rects('.portada__linea > span'), ...texto('.portada__lema'), ...texto('.portada__kicker'),
      ...rects('.portada__acciones .boton'), ...rects('.portada__enlace'),
    ];
    const auto = document.querySelector('.portada__auto').getBoundingClientRect();
    const tapa = (r) => Math.min(r.right, auto.right) - Math.max(r.left, auto.left) > 6 && Math.min(r.bottom, auto.bottom) - Math.max(r.top, auto.top) > 6;
    const pequenos = [...document.querySelectorAll('.entrada__accion, .portada__enlace')]
      .map((e) => [e.className, e.getBoundingClientRect().height])
      .filter(([, h]) => h < 44);
    return {
      desborde: document.documentElement.scrollWidth - vw,
      lineaRecortada: [...document.querySelectorAll('.portada__linea')].some((l) => l.scrollWidth > l.clientWidth + 1),
      textoFuera: textos.some((r) => r.right > vw + 1 || r.left < -1),
      textoTapado: textos.some(tapa),
      pequenos,
      motor: document.documentElement.classList.contains('portada-motor'),
      visible: ['#titulo-entrada', '.portada__lema', '.portada__auto img', '.entrada__acceso-panel'].every((s) => {
        const e = document.querySelector(s);
        const c = getComputedStyle(e);
        return e.getBoundingClientRect().width > 0 && c.opacity === '1' && c.visibility === 'visible';
      }),
    };
  });
  if (hero.desborde !== 0) fallos.push(`desborde horizontal de ${hero.desborde}px`);
  if (hero.lineaRecortada) fallos.push('la máscara recorta el titular');
  if (hero.textoFuera) fallos.push('hay texto fuera de la pantalla');
  if (hero.textoTapado) fallos.push('el auto tapa texto del hero');
  if (tactil && hero.pequenos.length) fallos.push(`áreas táctiles menores de 44 px: ${JSON.stringify(hero.pequenos)}`);
  if (reducido && hero.motor) fallos.push('con movimiento reducido no debe montarse el motor');
  if (reducido && !hero.visible) fallos.push('con movimiento reducido todo debe verse');

  const escenas = await pagina.evaluate(() => {
    const s = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return { top: b.top + scrollY, h: b.height }; };
    return { recta: s('[data-escena=recta]'), boxes: s('[data-escena=boxes]'), fija: document.documentElement.classList.contains('portada-fija') };
  });
  const esperadaFija = !reducido && ancho >= 900 && alto >= 560 && ancho >= alto;
  if (escenas.fija !== esperadaFija) fallos.push(`recorrido horizontal ${escenas.fija ? 'activo' : 'apagado'} y debería estar ${esperadaFija ? 'activo' : 'apagado'}`);

  // Recta: al empezar y al terminar el recorrido no se recorta ninguna foto.
  for (const [fraccion, etiqueta] of [[0.02, 'inicio'], [0.98, 'final']]) {
    await irA(pagina, escenas.recta.top + Math.max(0, escenas.recta.h - alto) * fraccion);
    const m = await pagina.evaluate(() => ({
      vw: innerWidth, vh: innerHeight,
      paneles: [...document.querySelectorAll('.portada__panel')].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }; }),
      tituloB: document.querySelector('.portada__recta-cabeza h2').getBoundingClientRect().bottom,
    }));
    if (esperadaFija) {
      const foto = m.paneles.filter((p) => p.h > 0);
      if (etiqueta === 'inicio' && foto[0].l < -2) fallos.push('la primera foto arranca recortada');
      if (etiqueta === 'final' && foto.at(-1).r > m.vw + 2) fallos.push('la última foto termina recortada');
      const techo = Math.min(...foto.map((p) => p.t));
      if (m.tituloB > techo + 4) fallos.push('el título de la recta tapa las fotos');
    } else if (etiqueta === 'inicio') {
      if (m.paneles.some((p) => p.r > m.vw + 2 || p.l < -2)) fallos.push('hay fotos apiladas fuera de la pantalla');
      if (m.paneles.some((p) => p.h > m.vh * 0.85 + 2)) fallos.push('hay fotos apiladas más altas que la pantalla');
    }
  }

  // Final de la página: lo último que se ve es el formulario, asentado.
  await irA(pagina, await pagina.evaluate(() => document.documentElement.scrollHeight));
  const fin = await pagina.evaluate(() => {
    const seccion = document.querySelector('[data-escena=boxes]');
    const panel = document.querySelector('.entrada__acceso-panel');
    const r = panel.getBoundingClientRect();
    const zoom = Number(getComputedStyle(panel).zoom) || 1;
    return {
      cruce: seccion.style.getPropertyValue('--cruce'),
      entra: seccion.style.getPropertyValue('--entra'),
      dentro: r.left >= -1 && r.right <= innerWidth + 1,
      pie: document.querySelector('.entrada__pie').getBoundingClientRect().bottom <= innerHeight + 1,
      pestanas: [...document.querySelectorAll('.entrada__acceso-panel .pestana')].map((e) => e.getBoundingClientRect().height / zoom),
    };
  });
  if (!reducido && (fin.cruce !== '1.000' || fin.entra !== '1.000')) fallos.push(`la escena de boxes queda a medias al final (cruce ${fin.cruce}, entra ${fin.entra})`);
  if (!fin.dentro) fallos.push('el panel de acceso se sale de la pantalla');
  if (!fin.pie) fallos.push('el pie no se ve al llegar al final');
  if (fin.pestanas.some((h) => h > 52)) fallos.push(`las pestañas de acceso se parten en dos líneas (${fin.pestanas.join(', ')} px)`);

  await contexto.close();
  if (fallos.length) throw new Error(fallos.join('; '));
}

for (const [nombre, ancho, alto, extra] of FORMATOS) {
  await paso(`${nombre} (${ancho}×${alto})`, () => comprobar(nombre, ancho, alto, extra));
}

await navegador.close();
await bajarServidor();

// El 401 de comprobar si hay sesión al cargar es normal en una visita anónima.
const ESPERADOS = /favicon|manifest|status of (401|409)|ViewTransition/i;
const relevantes = errores.filter((e) => !ESPERADOS.test(e));

console.log('\n=== errores de consola/página ===');
console.log(relevantes.length ? relevantes.join('\n') : 'ninguno');
console.log(`\n${totales - fallidos.length}/${totales} formatos correctos.`);
process.exit(relevantes.length || fallidos.length ? 1 : 0);

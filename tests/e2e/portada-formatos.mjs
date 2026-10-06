/**
 * La portada en cada formato de pantalla, con la aplicación real levantada.
 *
 * Una portada se rompe de formas que solo se ven en un tamaño concreto: un
 * titular que se parte a mitad de palabra en un móvil pequeño, una tira de
 * fotos que empuja la página de lado, un botón que en un teléfono mide 32 px,
 * un bloque que se queda transparente porque nadie lo vio llegar. Aquí se
 * recorre una lista de formatos reales (escritorio, portátil, tableta, móvil,
 * apaisado, movimiento reducido) y se comprueban las mismas cosas en todos.
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
  ['tableta 900×600', 900, 600],
  ['tableta 899×800', 899, 800],
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

/** Lo que se mide en cualquier punto de la página. */
function medirPagina() {
  const vw = document.documentElement.clientWidth;
  // Una palabra partida entre dos líneas deja dos rectángulos en su rango.
  const partidas = [];
  for (const titular of document.querySelectorAll('h1, h2, h3, .cifra__valor, .horario__horas, .tiempo__marca')) {
    const recorrer = (nodo) => {
      for (const hijo of nodo.childNodes) {
        if (hijo.nodeType === Node.ELEMENT_NODE) { recorrer(hijo); continue; }
        if (hijo.nodeType !== Node.TEXT_NODE) continue;
        for (const m of hijo.textContent.matchAll(/\S+/g)) {
          const rango = document.createRange();
          rango.setStart(hijo, m.index);
          rango.setEnd(hijo, m.index + m[0].length);
          const lineas = new Set([...rango.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (lineas.size > 1) partidas.push(m[0]);
        }
      }
    };
    recorrer(titular);
  }
  // Lo que está a mitad de una animación (con un transform propio o de un
  // antepasado) puede estar fuera a propósito: se mide solo lo que está quieto.
  const quieto = (e) => {
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t !== 'none' && !new DOMMatrix(t).isIdentity) return false;
    }
    return true;
  };
  const fuera = [...document.querySelectorAll('main h1, main h2, main p, main strong, main .boton')]
    .filter((e) => !e.closest('.galeria, .productos, .marquesina') && quieto(e))
    .map((e) => { const r = e.getBoundingClientRect(); return { e: e.textContent.trim().slice(0, 30), l: r.left, r: r.right, w: r.width }; })
    .filter(({ l, r, w }) => w > 0 && (r > vw + 1 || l < -1));
  // Un texto que no cabe en su caja y se recorta, o dos rótulos que se pisan.
  const recortados = [...document.querySelectorAll('.pestanas, .pestana, .sitio-nav a, .boton, .horario__dia, .horario__horas, .horario__estado, .tiempo__marca, .cifra__valor, .evento h3, .disciplina h3')]
    .filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1)
    .map((e) => e.textContent.trim().slice(0, 30));
  const choca = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const pisados = [...document.querySelectorAll('.horario')].filter((fila) => {
    const dia = fila.querySelector('.horario__dia').getBoundingClientRect();
    const horas = fila.querySelector('.horario__horas').getBoundingClientRect();
    return choca(dia, horas);
  }).map((fila) => fila.querySelector('.horario__dia').textContent.trim());
  return { desborde: document.documentElement.scrollWidth - vw, partidas, fuera, recortados, pisados };
}

async function comprobar(nombre, ancho, alto, { tactil = false, reducido = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    hasTouch: tactil,
    isMobile: tactil && ancho < 900,
    reducedMotion: reducido ? 'reduce' : 'no-preference',
  });
  const pagina = await contexto.newPage();
  await pagina.addInitScript(() => {
    // Lo que tiene que verse al llegar: titulares, textos, fotos, fichas y el acceso.
    window.CONTENIDO = [
      'main .seccion__cabeza h2', 'main .seccion__lead', '.mosaico__foto', '.disciplina', '.plano', '.ficha__fila',
      '.horario', '.tiempo', '.evento', '.pronto__texto h2', '.pronto__foto', '.galeria__foto', '.productos > li',
      '.ventaja', '.entrada__acceso-panel', '.sitio-pie__columna',
    ].join(', ');
    window.opacidadReal = (e) => {
      let o = 1;
      for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.visibility === 'hidden' || c.display === 'none') return 0;
        o *= Number(c.opacity);
      }
      return o;
    };
  });
  pagina.on('pageerror', (e) => errores.push(`${nombre} pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(`${nombre} console: ${m.text()}`);
  });
  await pagina.goto(B, { waitUntil: 'networkidle' });
  // El semáforo (1,25 s tras cargar la foto) y la salida del titular (unos 2,6 s).
  await pagina.waitForTimeout(5500);

  const fallos = [];
  const hero = await pagina.evaluate(() => {
    const raiz = document.documentElement;
    const cabecera = document.querySelector('.sitio-barra').getBoundingClientRect();
    const titulo = document.querySelector('#titulo-entrada').getBoundingClientRect();
    const acciones = document.querySelector('.hero__acciones').getBoundingClientRect();
    const cifras = document.querySelector('.hero__cifras').getBoundingClientRect();
    const tactiles = [...document.querySelectorAll('.sitio-accion, .hero__acciones a')]
      .map((e) => [e.textContent.trim(), e.getBoundingClientRect().height])
      .filter(([, h]) => h < 44);
    const visible = (s) => {
      const e = document.querySelector(s);
      const c = getComputedStyle(e);
      return e.getBoundingClientRect().width > 0 && c.opacity === '1' && c.visibility === 'visible';
    };
    return {
      animada: raiz.classList.contains('portada-animada'),
      intro: raiz.classList.contains('portada-intro'),
      lineaRecortada: [...document.querySelectorAll('.hero__linea')].some((l) => l.scrollWidth > l.clientWidth + 1),
      bajoCabecera: titulo.top >= cabecera.bottom - 1,
      solapa: acciones.bottom > cifras.top + 1,
      tactiles,
      titularVisible: visible('#titulo-entrada') && visible('.hero__lead') && visible('.hero__cifras'),
      ...(() => {
        // Sin movimiento, nada espera a ser revelado: todo se ve sin bajar.
        const ocultos = [...document.querySelectorAll(window.CONTENIDO)].filter((e) => window.opacidadReal(e) < 0.99);
        return { ocultosAlAbrir: ocultos.length };
      })(),
    };
  });
  if (hero.lineaRecortada) fallos.push('la ventana del titular lo recorta');
  if (!hero.bajoCabecera) fallos.push('la cabecera tapa el titular');
  if (hero.solapa) fallos.push('las cifras se montan sobre los botones de la apertura');
  if (tactil && hero.tactiles.length) fallos.push(`áreas táctiles menores de 44 px: ${JSON.stringify(hero.tactiles)}`);
  if (!hero.titularVisible) fallos.push('la apertura no terminó de verse');
  if (hero.intro) fallos.push('la apertura se quedó a medias');
  if (reducido && hero.animada) fallos.push('con movimiento reducido no debe animarse nada');
  if (reducido && hero.ocultosAlAbrir) fallos.push(`con movimiento reducido hay ${hero.ocultosAlAbrir} bloques ocultos`);
  if (!reducido && !hero.animada) fallos.push('con movimiento la portada debe animarse');
  const escenas = await pagina.evaluate(() => window.ScrollTrigger?.getAll().length ?? 0);
  if (!reducido && escenas < 20) fallos.push(`solo hay ${escenas} escenas montadas`);
  if (reducido && escenas) fallos.push('con movimiento reducido no debe montarse ninguna escena');

  // Recorre la página de arriba abajo: en cada parada, nada se sale ni se parte.
  const alto_total = await pagina.evaluate(() => document.documentElement.scrollHeight);
  const vistos = new Set();
  for (let y = 0; y < alto_total; y += Math.round(alto * 0.8)) {
    await pagina.evaluate((valor) => window.scrollTo({ top: valor, behavior: 'instant' }), y);
    await pagina.waitForTimeout(450);
    const m = await pagina.evaluate(medirPagina);
    if (m.desborde > 0) vistos.add(`desborde horizontal de ${m.desborde}px`);
    for (const palabra of m.partidas) vistos.add(`palabra partida: «${palabra}»`);
    for (const f of m.fuera) vistos.add(`texto fuera de la pantalla: «${f.e}»`);
    for (const t of m.recortados) vistos.add(`texto recortado: «${t}»`);
    for (const t of m.pisados) vistos.add(`el día y la hora se pisan: «${t}»`);
  }
  fallos.push(...vistos);

  // Al llegar al final: todo se reveló, el panel de acceso entra y el pie se ve.
  await pagina.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await pagina.waitForTimeout(2200);
  const fin = await pagina.evaluate(() => {
    const panel = document.querySelector('.entrada__acceso-panel').getBoundingClientRect();
    return {
      sinRevelar: [...document.querySelectorAll(window.CONTENIDO)].filter((e) => window.opacidadReal(e) < 0.99).map((e) => e.className || e.tagName),
      dentro: panel.left >= -1 && panel.right <= innerWidth + 1,
      pie: document.querySelector('.sitio-pie__base').getBoundingClientRect().bottom <= innerHeight + 1,
      pestanas: [...document.querySelectorAll('.entrada__acceso-panel .pestana')].map((e) => e.getBoundingClientRect().height),
      progreso: Number(getComputedStyle(document.querySelector('.sitio-progreso span')).getPropertyValue('--progreso')),
    };
  });
  if (fin.sinRevelar.length) fallos.push(`bloques que nunca aparecieron: ${[...new Set(fin.sinRevelar)].join(', ')}`);
  if (!fin.dentro) fallos.push('el panel de acceso se sale de la pantalla');
  if (!fin.pie) fallos.push('el pie no se ve al llegar al final');
  if (fin.pestanas.some((h) => h > 52)) fallos.push(`las pestañas de acceso se parten en dos líneas (${fin.pestanas.join(', ')} px)`);
  if (fin.progreso < 0.99) fallos.push(`el avance de lectura no llega al final (${fin.progreso})`);

  // Galería: con botones (pantallas anchas) retrocede apagado y avanzar desplaza la tira.
  const galeria = await pagina.evaluate(async () => {
    const pista = document.querySelector('#galeria-pista');
    const atras = document.querySelector('[data-galeria="atras"]');
    const adelante = document.querySelector('[data-galeria="adelante"]');
    pista.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (document.querySelector('#galeria').classList.contains('galeria-fija')) {
      // Fija: la tira corre de lado con el desplazamiento vertical.
      const seccion = document.querySelector('#galeria');
      const fija = window.ScrollTrigger.getAll().find((t) => t.pin === seccion);
      const inicio = fija.start;
      window.scrollTo({ top: inicio + 10, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 900));
      const antes = new DOMMatrix(getComputedStyle(pista).transform).m41;
      window.scrollTo({ top: inicio + innerHeight * 1.2, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 1400));
      const despues = new DOMMatrix(getComputedStyle(pista).transform).m41;
      return { fija: true, corre: despues < antes - 50 };
    }
    const conBotones = adelante.getBoundingClientRect().width > 0;
    if (!conBotones) return { conBotones, desliza: pista.scrollWidth > pista.clientWidth };
    const antes = { atras: atras.disabled, adelante: adelante.disabled };
    adelante.click();
    await new Promise((r) => setTimeout(r, 900));
    return { conBotones, antes, movida: pista.scrollLeft > 0, atrasLuego: atras.disabled };
  });
  if (galeria.fija) {
    if (!galeria.corre) fallos.push('la galería fija no corre de lado al bajar');
  } else if (galeria.conBotones) {
    if (!galeria.antes.atras || galeria.antes.adelante) fallos.push('al empezar, la galería solo debe dejar avanzar');
    if (!galeria.movida || galeria.atrasLuego) fallos.push('avanzar no desplaza la galería');
  } else if (!galeria.desliza) {
    fallos.push('sin botones, la galería debe poder deslizarse');
  }

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

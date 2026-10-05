import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (f) => fs.readFileSync(f, 'utf8');
const HTML = leer('public/index.html');
const CSS = leer('public/css/portada.css');
const PUBLICO = leer('public/css/publico.css');
const JS = leer('public/js/portada.js');
const ARRANQUE = leer('public/js/portada-arranque.js');
const CALCULOS = leer('public/js/portada-calculos.js');

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const reglas = (css) => [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), cuerpo: m[2] }));

test('la portada carga los estilos compartidos, los públicos, los propios y sus módulos', () => {
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/styles\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/publico\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/portada\.css">/);
  assert.match(HTML, /<script type="module" src="\/js\/login\.js">/);
  assert.match(HTML, /<script type="module" src="\/js\/portada\.js">/);
  assert.match(HTML, /<body class="pagina-entrada">/);
  assert.match(JS, /from '\.\/portada-calculos\.js'/);
});

test('el sitio público anula lo que la app le pondría por defecto', () => {
  assert.match(PUBLICO, /\.pagina-entrada main,\s*\.pagina-posiciones main\s*\{\s*padding:\s*0/, 'el `main` compartido trae relleno propio');
  assert.match(PUBLICO, /\.pagina-entrada::before,\s*\.pagina-posiciones::before\s*\{\s*display:\s*none/, 'la rejilla de body::before no es del sitio público');
  assert.match(PUBLICO, /\.pagina-entrada main > \.revelar,[\s\S]*?\{[^}]*opacity:\s*1;[^}]*animation:\s*none/, 'el revelado genérico de shell.js no debe tocar las secciones');
});

test('la cabecera queda fija, con la marca, la navegación y la acción de entrar', () => {
  assert.match(HTML, /<header class="sitio-barra">/);
  assert.match(HTML, /class="sitio-marca"[^>]*>\s*<img src="\.\/images\/miniapolis-logo-oficial-400\.webp" srcset="[^"]*miniapolis-logo-oficial\.webp 1000w"/);
  assert.match(HTML, /class="sitio-accion boton boton--principal[^"]*" href="#acceso"/);
  assert.match(PUBLICO, /\.sitio-barra\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0\s+0\s+auto;/s);
  assert.match(PUBLICO, /\.sitio-barra\s*\{[^}]*border-bottom:\s*1px\s+solid/s);
  assert.match(HTML, /<a class="sitio-saltar" href="#contenido">/, 'quien navega con teclado puede saltarse la cabecera');
  assert.match(HTML, /<main id="contenido">/);
});

test('cada ancla interna lleva a una sección que existe', () => {
  const ids = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anclas = [...HTML.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anclas.length > 10);
  assert.deepEqual(anclas.filter((ancla) => !ids.has(ancla)), []);
  assert.doesNotMatch(HTML, /href="#"/);
});

test('cada sección se nombra con su propio titular', () => {
  const secciones = [...HTML.matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(secciones.length >= 10);
  for (const seccion of secciones) {
    const id = seccion.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(id, `sección sin nombre accesible: ${seccion}`);
    assert.match(HTML, new RegExp(`<h[12] id="${id}"`), `${id} debe ser el titular de su sección`);
  }
  assert.equal((HTML.match(/<h1\b/g) ?? []).length, 1, 'un solo titular principal');
});

test('los índices de sección van en orden, sin saltos ni repeticiones', () => {
  const indices = [...HTML.matchAll(/class="seccion__indice"><span>(\d{2})<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(indices, indices.map((_, i) => i + 1));
  assert.ok(indices.length >= 8);
});

test('la portada mantiene un copy breve, natural y sin ruido', () => {
  for (const frase of ['Ven a', 'rodar.', 'Pista indoor', 'La pista', 'Especificaciones del circuito', 'Horarios', 'Mejores tiempos', 'Tu pase.', 'Entra y guarda tu pase.']) {
    assert.ok(HTML.includes(frase), `falta «${frase}»`);
  }
  for (const frase of ['Asfalto, curvas y control.', 'Rectas, curvas y asfalto.', 'A tu ritmo.', 'Una pista para sentir cada vuelta.', 'READY TO RACE', 'FRAME / 01']) {
    assert.ok(!HTML.includes(frase) && !CSS.includes(frase), `sigue presente el texto decorativo «${frase}»`);
  }
  assert.doesNotMatch(HTML, /·/, 'sin puntos medios como separadores');
  assert.doesNotMatch(HTML, /Track\s+\d+/i, 'sin identificadores artificiales de pista');
  assert.doesNotMatch(HTML, /0°\d+|\d+°\d+['’]/, 'sin coordenadas decorativas');
  assert.doesNotMatch(HTML, /césped|cesped|grass/i, 'la pista es de asfalto');
  assert.doesNotMatch(HTML, /para disfrutar de verdad|dar tus primeras vueltas|buscar tu mejor tiempo|desde cualquier celular/);
});

test('las cifras de la pista no se contradicen entre secciones', () => {
  assert.doesNotMatch(HTML, /400\s*m²/, 'el asfalto mide 1.000 m² en toda la portada');
  assert.ok((HTML.match(/1\.000\s*(?:<small>)?m²/g) ?? []).length >= 2);
});

test('cada imagen declara su tamaño y su alt, y todas las rutas existen', () => {
  for (const [etiqueta] of HTML.matchAll(/<img\b[^>]*>/g)) {
    assert.match(etiqueta, /\swidth="\d+"/, `sin width: ${etiqueta.slice(0, 80)}`);
    assert.match(etiqueta, /\sheight="\d+"/, `sin height: ${etiqueta.slice(0, 80)}`);
    assert.match(etiqueta, /\salt="/, `sin alt: ${etiqueta.slice(0, 80)}`);
  }
  assert.match(HTML, /<img[^>]*miniapolis-track-wide\.webp[^>]*fetchpriority="high"/, 'la foto de la apertura es lo primero que se pide');
  assert.match(HTML, /<link rel="preload" as="image"[^>]*imagesrcset="[^"]*miniapolis-track-wide-960\.webp/, 'la precarga pide el mismo tamaño que usará la foto');
  const rutas = new Set();
  for (const m of HTML.matchAll(/\b(?:src|href)="(\.[^"]*\/images\/[^"]+)"/g)) rutas.add(m[1]);
  for (const m of HTML.matchAll(/\b(?:srcset|imagesrcset)="([^"]+)"/g)) {
    for (const candidato of m[1].split(',')) rutas.add(candidato.trim().split(/\s+/)[0]);
  }
  const faltan = [...rutas].filter((r) => !fs.existsSync(path.join('public', r.replace(/^\.\//, ''))));
  assert.deepEqual(faltan, []);
  // Solo la foto de la apertura y el logotipo de la cabecera se piden al abrir.
  const sinDiferir = [...HTML.matchAll(/<img\b[^>]*>/g)].map((m) => m[0])
    .filter((img) => !/fetchpriority="high"/.test(img) && !/loading="lazy"/.test(img));
  assert.equal(sinDiferir.length, 1);
  assert.match(sinDiferir[0], /miniapolis-logo-oficial\.webp/);
});

test('las hojas y el JS no dependen de rutas absolutas ni de terceros', () => {
  for (const hoja of [CSS, PUBLICO]) assert.doesNotMatch(hoja, /url\(\s*["']?\/(?!\/)/, 'las url() del CSS deben ser relativas o data:');
  assert.doesNotMatch(JS + ARRANQUE + CALCULOS, /https?:\/\//, 'sin CDN ni recursos externos');
  assert.doesNotMatch(HTML, /\sstyle="/, 'la política de seguridad prohíbe estilos en línea');
  assert.doesNotMatch(HTML, /<script>(?!<\/script>)/, 'sin scripts en línea');
});

test('solo lo clicable tiene :hover', () => {
  const CLICABLE = /^(?:a|button|input|select|textarea|label|summary)(?![\w-])|\.(?:boton(?:--[\w-]+)?|sitio-[\w-]+|enlace-flecha|producto|galeria__boton|pestana)(?![\w-])|\[role="tab"\]/;
  const fallos = [];
  for (const hoja of [CSS, PUBLICO]) {
    for (const { selector } of reglas(hoja)) {
      if (selector.startsWith('@') || !selector.includes(':hover')) continue;
      for (const uno of selector.split(',')) {
        if (!uno.includes(':hover')) continue;
        const compuestos = uno.trim().split(/\s*[>+~]\s*|\s+/).filter((c) => c.includes(':hover'));
        for (const compuesto of compuestos) {
          if (!CLICABLE.test(compuesto)) fallos.push(uno.trim());
        }
      }
    }
  }
  assert.deepEqual(fallos, [], 'estos selectores dan hover a algo que no se puede pulsar');
  assert.doesNotMatch(JS, /mouse(?:enter|over)/, 'el movimiento no depende de eventos de hover');
});

test('lo que se oculta para animarse solo se oculta bajo .portada-intro o .portada-animada', () => {
  const ocultan = /(?:^|[;\s])opacity:\s*0\s*(?:;|$)|clip-path:\s*inset\(|visibility:\s*hidden|translate3d\(0,\s*1\d\d%/;
  const fallos = reglas(CSS)
    .filter(({ selector }) => !selector.startsWith('@') && !/^(?:\d|from|to)/.test(selector))
    .filter(({ cuerpo }) => ocultan.test(cuerpo))
    .filter(({ selector }) => !/\.portada-(?:intro|animada)/.test(selector))
    .map(({ selector }) => selector);
  assert.deepEqual(fallos, [], 'sin movimiento, todo el contenido debe verse');
});

test('sin movimiento no se anima nada y la página queda completa y quieta', () => {
  assert.match(JS, /import \{ sinMovimiento \} from '\.\/movimiento\.js'/);
  assert.match(JS, /const conMovimiento = !sinMovimiento\(\) && typeof IntersectionObserver === 'function'/);
  assert.match(
    JS,
    /if \(conMovimiento\) \{\s*raiz\.classList\.add\('portada-animada'\);[\s\S]*arrancarApertura\(\);\s*\} else \{\s*raiz\.classList\.remove\('portada-intro', 'portada-luces'\);/,
    'la clase que anima solo se pone con movimiento, y sin él se retira la apertura',
  );
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});

test('la apertura se prepara antes del primer fotograma y se retira sola si el módulo no llega', () => {
  const cabeza = HTML.slice(0, HTML.indexOf('</head>'));
  assert.match(cabeza, /<script src="\/js\/portada-arranque\.js"><\/script>/, 'script clásico en el <head>, no módulo diferido');
  assert.match(ARRANQUE, /prefers-reduced-motion: reduce/, 'sin movimiento no hay apertura');
  assert.match(ARRANQUE, /classList\.add\('portada-intro'\)/);
  assert.doesNotMatch(ARRANQUE, /classList\.add\('portada-animada'\)/, 'la animación solo la monta portada.js');
  assert.match(ARRANQUE, /setTimeout\([\s\S]*classList\.remove\('portada-intro'\)/, 'si el módulo falla, la página queda estática y completa');
  assert.match(JS, /Promise\.race\(\[Promise\.allSettled\(esperas\), new Promise\(\(r\) => setTimeout\(r, \d+\)\)\]\)/, 'el titular nunca espera indefinidamente a la foto');
});

test('el semáforo enciende cinco luces de una en una', () => {
  assert.equal((HTML.match(/<div class="hero__semaforo" aria-hidden="true">(?:<span><\/span>){5}<\/div>/g) ?? []).length, 1);
  for (let n = 2; n <= 5; n += 1) {
    assert.match(CSS, new RegExp(`\\.portada-luces \\.hero__semaforo span:nth-child\\(${n}\\) \\{ animation-delay: ${(n - 1) * 200}ms; \\}`));
  }
});

test('las cajas de contenido permanecen nítidas', () => {
  for (const hoja of [CSS, PUBLICO]) {
    assert.doesNotMatch(hoja, /(^|[;\s])filter:\s*blur\(/, 'el movimiento puede desplazar u ocultar suavemente, pero nunca desenfocar el contenido');
  }
  assert.doesNotMatch(sinComentarios(CSS), /backdrop-filter/, 'un desenfoque sobre un fondo que se mueve se recalcula en cada fotograma');
  const estiran = reglas(CSS + PUBLICO).filter(({ selector, cuerpo }) => selector.includes(':hover') && /letter-spacing/.test(cuerpo));
  assert.deepEqual(estiran.map((r) => r.selector), [], 'un hover no cambia el ancho del texto');
});

test('fluidez: por cada desplazamiento se escribe en un único fotograma y solo en quien lo lee', () => {
  assert.match(JS, /window\.addEventListener\('scroll', programar, \{ passive: true \}\)/);
  assert.match(JS, /if \(pendiente\) return;\s*pendiente = true;\s*requestAnimationFrame\(pintar\)/);
  assert.match(JS, /barra\?\.style\.setProperty\('--progreso'/);
  assert.match(PUBLICO, /transform:\s*scaleX\(var\(--progreso, 0\)\)/, 'el avance de lectura se compone, no reescribe el layout');
  assert.match(JS, /if \(foto && y <= altoHero\)/, 'la foto de la apertura solo se mueve mientras se ve');
  assert.doesNotMatch(JS, /querySelector\('main'\)\.style|document\.body\.style\.setProperty/, 'ninguna variable por fotograma en un contenedor grande');
});

test('en táctil lo que se pulsa mide al menos 44 px', () => {
  const tactil = (hoja) => hoja.slice(hoja.indexOf('@media (pointer: coarse)'));
  assert.match(tactil(PUBLICO), /\.sitio-accion[^{]*\{\s*min-height:\s*44px/);
  assert.match(tactil(CSS), /\.hero__acciones \.enlace-flecha\s*\{\s*min-height:\s*48px/);
  assert.match(CSS, /\.galeria__boton\s*\{[^}]*width:\s*52px;[^}]*height:\s*52px/s);
  assert.match(PUBLICO, /\.sitio-nav a\s*\{[^}]*min-height:\s*44px/s);
});

test('la galería se recorre con botones nombrados y con el teclado', () => {
  for (const sentido of ['atras', 'adelante']) {
    assert.match(HTML, new RegExp(`<button class="galeria__boton" type="button" data-galeria="${sentido}" aria-label="[^"]+" aria-controls="galeria-pista">`));
  }
  assert.match(HTML, /<div class="galeria revela" id="galeria-pista" tabindex="0" role="region" aria-label="[^"]+">/);
  assert.match(JS, /atras\.disabled = /);
  assert.match(JS, /behavior: sinMovimiento\(\) \? 'auto' : 'smooth'/);
});

test('el plano del circuito es decorativo, dice que es un esquema y su punto solo corre a la vista', () => {
  assert.match(HTML, /<svg class="plano__dibujo"[^>]*aria-hidden="true"/);
  assert.match(HTML, /<figcaption>Esquema ilustrativo del recinto/);
  assert.match(HTML, /<animateMotion[^>]*begin="indefinite"/, 'el punto no arranca solo: lo arranca portada.js con movimiento');
  assert.match(JS, /svg\.pauseAnimations\?\.\(\)/, 'fuera de pantalla el punto se detiene');
  assert.match(CSS, /\.plano__auto\s*\{\s*display:\s*none/);
});

test('el horario dice la verdad del momento y el cronómetro no engaña a los lectores de pantalla', () => {
  assert.match(JS, /montarHorarioVivo\(\);\s*setInterval\(\(\) => montarHorarioVivo\(\), 60_000\)/);
  assert.match(JS, /etiqueta\.textContent = textoJornada\(estado, rango\)/, 'el estado se escribe como texto, no solo como color');
  assert.match(JS, /el\.setAttribute\('aria-label', final\)/, 'mientras corre, se anuncia el tiempo real');
  assert.match(JS, /tiempoEnTexto\(valorContado\(valor, Math\.max\(0, t\)\), 2, final\.length\)/, 'la cifra que corre no cambia de ancho');
});

test('los rótulos de las hojas están en español', () => {
  const rotulos = [...sinComentarios(CSS + PUBLICO).matchAll(/content:\s*'([^']*[A-Za-z][^']*)'/g)].map((m) => m[1]);
  for (const ingles of ['READY', 'ACCESS', 'FACILITIES', 'TELEMETRY', 'TIMING', 'CALENDAR', 'OPEN', 'NIGHT', 'RACE', 'FRAME', 'LIVE', 'NEW']) {
    assert.ok(!rotulos.some((r) => new RegExp(`\\b${ingles}\\b`).test(r)), `rótulo en inglés: ${ingles}`);
  }
});

test('las hojas del sitio público cierran cada bloque y cada comentario', () => {
  for (const archivo of ['public/css/portada.css', 'public/css/publico.css', 'public/css/posiciones.css']) {
    const hoja = leer(archivo);
    assert.equal((hoja.match(/\/\*/g) || []).length, (hoja.match(/\*\//g) || []).length, `${archivo}: comentario sin cerrar`);
    let profundidad = 0;
    for (const caracter of sinComentarios(hoja)) {
      if (caracter === '{') profundidad += 1;
      if (caracter === '}') profundidad -= 1;
      assert.ok(profundidad >= 0, `${archivo}: llave de cierre de más`);
    }
    assert.equal(profundidad, 0, `${archivo}: bloque sin cerrar`);
  }
});

test('el motor de escenas anterior ya no se carga', () => {
  for (const archivo of ['public/js/portada-motor.js', 'public/js/portada-efectos.js', 'public/css/portada-efectos.css']) {
    assert.ok(!fs.existsSync(archivo), `${archivo} debería haberse retirado`);
  }
  assert.doesNotMatch(HTML, /portada-(?:motor|efectos)/);
  assert.doesNotMatch(HTML, /entrada__mira|portada__chispas|portada__cinta/);
});

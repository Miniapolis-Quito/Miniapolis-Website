import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (f) => fs.readFileSync(f, 'utf8');
const HTML = leer('public/index.html');
const CSS = leer('public/css/portada.css');
const JS = leer('public/js/portada.js');
const MOTOR = leer('public/js/portada-motor.js');

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const reglas = (css) => [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), cuerpo: m[2] }));

test('la portada anula lo que el resto de la app le pondría por defecto', () => {
  assert.match(CSS, /\.pagina-entrada main\s*\{[^}]*padding:\s*0/, 'el `main` compartido trae relleno propio');
  assert.match(CSS, /\.pagina-entrada::before\s*\{[^}]*display:\s*none/, 'la rejilla de body::before no es de la portada');
  assert.match(CSS, /\.pagina-entrada \.boton\.boton--principal\s*\{[^}]*--chasis:\s*var\(--acento\)/, 'el botón primario de la portada debe ser verde');
  assert.match(CSS, /\.pagina-entrada main > \.revelar\s*,\s*\.pagina-entrada main > \.revelar--visible\s*\{[^}]*animation:\s*none/, 'el revelado genérico de shell.js no debe tocar las escenas');
});

test('el enlace «Ver la pista» comparte el chasis inclinado de los botones', () => {
  assert.match(CSS, /\.portada__enlace::before\s*\{[^}]*transform:\s*skewX\(var\(--inclinacion\)\)/s);
  assert.match(CSS, /\.portada__enlace:hover::before\s*\{[^}]*box-shadow:[^}]*var\(--acento\)/s);
});

test('la portada carga los estilos compartidos, los propios y sus dos módulos', () => {
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/styles\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/portada\.css">/);
  assert.match(HTML, /<script type="module" src="\/js\/login\.js">/);
  assert.match(HTML, /<script type="module" src="\/js\/portada\.js">/);
  assert.match(HTML, /<body class="pagina-entrada">/);
});

test('el HTML declara las cuatro escenas y portada.js las monta', () => {
  for (const escena of ['salida', 'tablero', 'recta', 'boxes']) {
    assert.match(HTML, new RegExp(`data-escena="${escena}"`), `falta la escena ${escena} en el HTML`);
    assert.ok(JS.includes(`[data-escena="${escena}"]`), `portada.js no monta la escena ${escena}`);
  }
});

test('portada.js importa todas las funciones que usa el motor de escenas', () => {
  assert.match(JS, /import \{[^}]*\beaseOutCubic\b[^}]*\} from '\.\/portada-motor\.js'/s);
  assert.match(JS, /easeOutCubic\(fase\(p, 0\.2, 0\.62\)\)/);
});

test('solo lo clicable tiene :hover', () => {
  const CLICABLE = /^(?:a|button|input|select|textarea|label|summary)(?![\w-])|\.(?:boton(?:--[\w-]+)?|entrada__accion|entrada__marca|portada__enlace|pestana)(?![\w-])|\[role="tab"\]/;
  const fallos = [];
  for (const { selector } of reglas(CSS)) {
    if (selector.startsWith('@') || !selector.includes(':hover')) continue;
    for (const uno of selector.split(',')) {
      if (!uno.includes(':hover')) continue;
      const compuestos = uno.trim().split(/\s*[>+~]\s*|\s+/).filter((c) => c.includes(':hover'));
      for (const compuesto of compuestos) {
        if (!CLICABLE.test(compuesto)) fallos.push(uno.trim());
      }
    }
  }
  assert.deepEqual(fallos, [], 'estos selectores dan hover a algo que no se puede pulsar');
  assert.doesNotMatch(JS + MOTOR, /mouse(?:enter|over)/, 'el movimiento no debe depender de eventos de hover');
});

test('lo que se oculta para animarse solo se oculta bajo .portada-motor', () => {
  const ocultan = /(?:^|[;\s])opacity:\s*0\s*(?:;|$)|clip-path:\s*inset\(0 0 100% 0\)|clip-path:\s*inset\(0 0 0 100%\)|visibility:\s*hidden/;
  const fallos = reglas(CSS)
    .filter(({ selector }) => !selector.startsWith('@') && !/^(?:\d|from|to)/.test(selector))
    .filter(({ cuerpo }) => ocultan.test(cuerpo))
    .filter(({ selector }) => !selector.includes('.portada-motor'))
    .map(({ selector }) => selector);
  assert.deepEqual(fallos, [], 'sin movimiento, todo el contenido debe verse');
});

test('sin movimiento reducido el motor no se monta y la página queda estática', () => {
  assert.match(JS, /import \{ sinMovimiento \} from '\.\/movimiento\.js'/);
  assert.match(
    JS,
    /if \(reducir[^)]*\) \{\s*montarProgresoSimple\(\);\s*\} else \{[\s\S]*classList\.add\('portada-motor'\)[\s\S]*crearMotor\(\)/,
    'crearMotor y .portada-motor solo pueden ir en la rama con movimiento',
  );
  assert.doesNotMatch(CSS, /(?<!\.portada-motor )\.portada__estela\s*\{[^}]*display:\s*block/, 'la estela solo existe con motor');
});

test('la mira conserva su apariencia y reacciona solo a lo clicable', () => {
  for (const pieza of ['.entrada__mira--segmento', '.entrada__mira-centro', 'miraOrbita', 'mix-blend-mode: screen', '.mira-sobre-objetivo .entrada__mira']) {
    assert.ok(CSS.includes(pieza), `falta ${pieza} en portada.css`);
  }
  const clicables = JS.match(/const CLICABLES = '([^']+)'/)?.[1] ?? '';
  assert.ok(clicables.includes('a,') && clicables.includes('button'), 'la lista de objetivos debe incluir enlaces y botones');
  assert.doesNotMatch(clicables, /figure|img|foto|picture/, 'la mira no debe reaccionar a fotos');
  const alMover = JS.match(/'pointermove',\s*\(evento\) => \{[\s\S]*?\n  \}, \{ passive: true \}\)/)?.[0] ?? '';
  assert.match(alMover, /setProperty\('--puntero-x'/, 'la mira sigue al puntero directamente');
  assert.doesNotMatch(alMover, /requestAnimationFrame/, 'la posición no debe esperar a otro fotograma');
  assert.doesNotMatch(CSS, /\.entrada__mira\s*\{[^}]*transition:\s*[^;}]*\btransform\b/s, 'la mira no debe interpolar su posición');
});

test('la cabecera de la portada permanece fija durante el scroll', () => {
  assert.match(HTML, /<header class="entrada__barra"[^>]*>/);
  assert.match(HTML, /miniapolis-logo-oficial\.webp/);
  assert.match(HTML, /class="entrada__accion"[^>]*href="#acceso"/);
  assert.match(CSS, /\.pagina-entrada\s*>\s*\.entrada__barra\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0\s+0\s+auto;/s);
});

test('la cabecera permanece negra desde el primer render y no anima su entrada', () => {
  assert.match(CSS, /\.pagina-entrada\s*>\s*\.entrada__barra\s*\{[^}]*background:\s*rgba\([^;]+\);/s);
  assert.match(CSS, /\.pagina-entrada\s*>\s*\.entrada__barra\s*\{[^}]*border-bottom:\s*1px\s+solid\s+var\(--borde\);/s);
  assert.doesNotMatch(CSS, /\.pagina-entrada\s*>\s*\.entrada__barra::before\s*\{/);
  assert.doesNotMatch(CSS, /\.pagina-entrada\s*>\s*\.entrada__barra\.esta-desplazada\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(CSS, /\.pagina-entrada\s*>\s*\.entrada__barra[^}]*transition:\s*transform/);
});

test('la portada mantiene un copy breve, natural y sin ruido', () => {
  for (const frase of ['Ven a', 'rodar.', 'Asfalto, curvas y control.', 'Pista indoor', 'La pista.', 'Rectas, curvas y asfalto.', 'A tu ritmo.', 'Una pista para sentir cada vuelta.', 'Tu pase.', 'Entra y guarda tu pase.']) {
    assert.ok(HTML.includes(frase), `falta «${frase}»`);
  }
  assert.doesNotMatch(HTML, /·/, 'sin puntos medios como separadores');
  assert.doesNotMatch(HTML, /Track\s+\d+/i, 'sin identificadores artificiales de pista');
  assert.doesNotMatch(HTML, /0°\d+|\d+°\d+['’]/, 'sin coordenadas decorativas');
  assert.doesNotMatch(HTML, /césped|cesped|grass/i, 'la pista es de asfalto');
  assert.doesNotMatch(HTML, /para disfrutar de verdad|dar tus primeras vueltas|buscar tu mejor tiempo|desde cualquier celular/);
});

test('cada imagen declara su tamaño y su alt, y todas las rutas existen', () => {
  for (const [etiqueta] of HTML.matchAll(/<img\b[^>]*>/g)) {
    assert.match(etiqueta, /\swidth="\d+"/, `sin width: ${etiqueta.slice(0, 80)}`);
    assert.match(etiqueta, /\sheight="\d+"/, `sin height: ${etiqueta.slice(0, 80)}`);
    assert.match(etiqueta, /\salt="/, `sin alt: ${etiqueta.slice(0, 80)}`);
  }
  assert.match(HTML, /<img[^>]*pista-circuito-panorama\.webp[^>]*fetchpriority="high"/, 'el panorama es lo primero que se pide');
  const rutas = new Set();
  for (const m of HTML.matchAll(/\b(?:src|href)="(\.[^"]*\/images\/[^"]+)"/g)) rutas.add(m[1]);
  for (const m of HTML.matchAll(/\bsrcset="([^"]+)"/g)) {
    for (const candidato of m[1].split(',')) rutas.add(candidato.trim().split(/\s+/)[0]);
  }
  const faltan = [...rutas].filter((r) => !fs.existsSync(path.join('public', r.replace(/^\.\//, ''))));
  assert.deepEqual(faltan, []);
});

test('portada.css y el JS no dependen de rutas absolutas ni de terceros', () => {
  assert.doesNotMatch(CSS, /url\(\s*["']?\/(?!\/)/, 'las url() del CSS deben ser relativas o data:');
  assert.doesNotMatch(JS + MOTOR, /https?:\/\//, 'sin CDN ni recursos externos');
  assert.doesNotMatch(HTML, /\sstyle="/, 'la política de seguridad prohíbe estilos en línea');
});

test('el motor solo escribe las variables que el CSS consume', () => {
  for (const variable of ['--p', '--vel', '--vel-abs', '--scroll', '--scroll-px']) {
    assert.ok(MOTOR.includes(`'${variable}'`), `el motor no publica ${variable}`);
    assert.ok(CSS.includes(`var(${variable}`), `portada.css no usa ${variable}`);
  }
});

test('portada.css cierra cada bloque y cada comentario: una llave huérfana anida el resto de la hoja', () => {
  const aperturas = (CSS.match(/\/\*/g) || []).length;
  const cierres = (CSS.match(/\*\//g) || []).length;
  assert.equal(aperturas, cierres, 'hay un comentario sin abrir o sin cerrar');
  let profundidad = 0;
  for (const caracter of sinComentarios(CSS)) {
    if (caracter === '{') profundidad += 1;
    if (caracter === '}') profundidad -= 1;
    assert.ok(profundidad >= 0, 'hay una llave de cierre de más');
  }
  assert.equal(profundidad, 0, 'hay un bloque sin cerrar');
});

test('cada pieza de contenido tiene su propio reloj: se lee quieta entre la entrada y la salida', () => {
  assert.match(JS, /entradaPieza\(/, 'la entrada de cada pieza depende de su posición');
  assert.match(JS, /salidaPieza\(/, 'la salida de cada pieza depende de la cabecera');
  assert.match(JS, /setProperty\('--item-in'/);
  assert.match(JS, /setProperty\('--item-out'/);
  assert.doesNotMatch(CSS, /\.portada__info\s*\{[^}]*width:\s*min\(1400px/, 'las escenas van a sangre como la salida y la recta');
});

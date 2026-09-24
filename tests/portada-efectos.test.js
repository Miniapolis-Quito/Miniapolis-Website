import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  partirTexto, rellenoPalabra, valorContado, tiempoEnTexto, magnetismo, ritmoCinta,
  diaDeTexto, rangoDeTexto, horaEcuador, estadoJornada,
} from '../public/js/portada-efectos.js';

const leer = (f) => fs.readFileSync(f, 'utf8');
const HTML = leer('public/index.html');
const CSS = leer('public/css/portada-efectos.css');
const JS = leer('public/js/portada-efectos.js');
const PORTADA = leer('public/js/portada.js');
const MOTOR = leer('public/js/portada-motor.js');

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const reglas = (css) => [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), cuerpo: m[2] }));

test('partirTexto conserva palabras y espacios sin perder nada', () => {
  const texto = 'Más que una  pista, una comunidad.';
  assert.deepEqual(partirTexto(texto).join(''), texto);
  assert.deepEqual(partirTexto('Hola mundo'), ['Hola', ' ', 'mundo']);
  assert.deepEqual(partirTexto(''), []);
});

test('rellenoPalabra ilumina las palabras de corrido y termina con todas llenas', () => {
  assert.equal(rellenoPalabra(0, 0, 5), 0);
  assert.equal(rellenoPalabra(1, 4, 5), 1);
  assert.ok(rellenoPalabra(0.3, 0, 5) > rellenoPalabra(0.3, 3, 5), 'las primeras palabras se llenan antes');
  for (let i = 0; i < 5; i++) assert.equal(rellenoPalabra(1, i, 5), 1);
});

test('valorContado arranca en cero, frena y llega exacto al tiempo real', () => {
  assert.equal(valorContado(12.46, 0), 0);
  assert.equal(valorContado(12.46, 1), 12.46);
  assert.equal(valorContado(12.46, 2), 12.46);
  assert.ok(valorContado(12.46, 0.5) > 12.46 / 2, 'frena al final: a mitad de tiempo va más allá de la mitad');
  assert.equal(tiempoEnTexto(12.4), '12.40');
  assert.equal(tiempoEnTexto(valorContado(12.46, 1)), '12.46');
});

test('magnetismo acerca el botón al puntero con un tope', () => {
  assert.equal(magnetismo(100, 100), 0);
  assert.ok(magnetismo(140, 100) > 0);
  assert.ok(magnetismo(60, 100) < 0);
  assert.equal(magnetismo(10000, 0), 12);
  assert.equal(magnetismo(-10000, 0, 0.28, 9), -9);
});

test('ritmoCinta: 1 en reposo, más rápido al bajar y en sentido contrario al subir', () => {
  assert.equal(ritmoCinta(0), 1);
  assert.equal(ritmoCinta(0, -1), -1);
  assert.ok(ritmoCinta(0.5) > 1);
  assert.ok(ritmoCinta(-0.5) < 0, 'subir con fuerza invierte la cinta');
  assert.ok(ritmoCinta(0.5, -1) < 0, 'la cinta inversa arranca al revés');
});

test('los días de la tabla de horarios se reconocen con o sin tilde y en plural', () => {
  assert.equal(diaDeTexto('Miércoles'), 3);
  assert.equal(diaDeTexto('Sábados'), 6);
  assert.equal(diaDeTexto('Domingos'), 0);
  assert.equal(diaDeTexto('  sabado '), 6);
  assert.equal(diaDeTexto('Feriado'), -1);
  assert.deepEqual(rangoDeTexto('19:00 — 23:30'), [1140, 1410]);
  assert.equal(rangoDeTexto('cerrado'), null);
});

test('la hora de Ecuador es UTC−5 sin cambios de horario', () => {
  // 2026-09-23 es miércoles. 00:30 UTC del jueves = 19:30 del miércoles en Quito.
  const h = horaEcuador(new Date('2026-09-24T00:30:00Z'));
  assert.equal(h.dia, 3);
  assert.equal(h.minutos, 19 * 60 + 30);
  assert.equal(horaEcuador(new Date('2026-01-15T12:00:00Z')).minutos, 7 * 60);
});

test('estadoJornada distingue abierto, hoy fuera de horario y otro día', () => {
  const miercoles = [3, [19 * 60, 23 * 60 + 30]];
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-24T00:30:00Z')), 'abierto');
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-23T15:00:00Z')), 'hoy', 'a las 10:00 del miércoles todavía no abre');
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-24T04:30:00Z')), 'hoy', 'a las 23:30 en punto ya cerró');
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-25T02:00:00Z')), '', 'un jueves no es miércoles');
  assert.equal(estadoJornada(-1, null), '');
});

test('el HTML de los efectos no usa estilos en línea ni puntos medios y cada cinta es decorativa', () => {
  assert.doesNotMatch(HTML, /\sstyle="/);
  assert.doesNotMatch(HTML, /·/);
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/portada-efectos\.css">/);
  for (const [cinta] of HTML.matchAll(/<div class="portada__cinta(?: [^"]*)?"[^>]*>/g)) assert.match(cinta, /aria-hidden="true"/);
  for (const [fantasma] of HTML.matchAll(/<span class="portada__fantasma"[^>]*>/g)) assert.match(fantasma, /aria-hidden="true"/);
  assert.match(HTML, /<canvas class="portada__chispas" aria-hidden="true">/);
  assert.ok((HTML.match(/data-capitulo="/g) ?? []).length >= 10, 'cada escena declara su capítulo');
});

test('los efectos solo se montan con movimiento; el horario y «volver arriba» funcionan siempre', () => {
  assert.match(PORTADA, /import \{[^}]*montarEfectos[^}]*\} from '\.\/portada-efectos\.js'/);
  assert.match(PORTADA, /montarBoxes\(motor\);\s*montarEfectos\(motor\);\s*motor\.iniciar\(\)/, 'los efectos se registran antes de iniciar el motor');
  const antesDelMotor = PORTADA.slice(0, PORTADA.lastIndexOf('if (reducir ||'));
  assert.match(antesDelMotor, /montarHorarioVivo\(\)/);
  assert.match(antesDelMotor, /montarVolverArriba\(\)/);
  assert.doesNotMatch(antesDelMotor, /montarEfectos\(/);
});

test('portada-efectos.js no depende de terceros ni de eventos de hover', () => {
  assert.doesNotMatch(JS, /https?:\/\//);
  assert.doesNotMatch(JS, /mouse(?:enter|over)/);
  assert.doesNotMatch(JS, /import\(|fetch\(/);
});

test('portada-efectos.css: lo que se oculta o se anima cuelga de .portada-motor', () => {
  const ocultan = /(?:^|[;\s])opacity:\s*0\s*(?:;|$)|visibility:\s*hidden/;
  const fallos = reglas(CSS)
    .filter(({ selector }) => !selector.startsWith('@') && !/^(?:\d|from|to)/.test(selector))
    .filter(({ cuerpo }) => ocultan.test(cuerpo))
    .filter(({ selector }) => !selector.includes('.portada-motor'))
    .map(({ selector }) => selector);
  assert.deepEqual(fallos, []);
  assert.doesNotMatch(CSS, /(^|[;\s])filter:\s*blur\(/, 'el contenido nunca se desenfoca');
  assert.doesNotMatch(CSS, /url\(\s*["']?\/(?!\/)/, 'sin rutas absolutas');
});

test('portada-efectos.css: solo lo clicable tiene :hover', () => {
  const CLICABLE = /^(?:a|button)(?![\w-])|\.(?:boton(?:--[\w-]+)?|entrada__accion|entrada__arriba|portada__enlace)(?![\w-])/;
  const fallos = [];
  for (const { selector } of reglas(CSS)) {
    if (selector.startsWith('@') || !selector.includes(':hover')) continue;
    for (const uno of selector.split(',')) {
      const compuestos = uno.trim().split(/\s*[>+~]\s*|\s+/).filter((c) => c.includes(':hover'));
      for (const c of compuestos) if (!CLICABLE.test(c)) fallos.push(uno.trim());
    }
  }
  assert.deepEqual(fallos, []);
});

test('portada-efectos.css cierra cada bloque y cada comentario', () => {
  assert.equal((CSS.match(/\/\*/g) || []).length, (CSS.match(/\*\//g) || []).length);
  let profundidad = 0;
  for (const c of sinComentarios(CSS)) {
    if (c === '{') profundidad += 1;
    if (c === '}') profundidad -= 1;
    assert.ok(profundidad >= 0, 'llave de cierre de más');
  }
  assert.equal(profundidad, 0, 'bloque sin cerrar');
});

test('el motor expone alCuadro y lo llama también en el último fotograma en reposo', () => {
  assert.match(MOTOR, /alCuadro\(fn\)/);
  assert.match(MOTOR, /for \(const fn of alCuadro\) fn\(/);
  const i = MOTOR.indexOf('for (const fn of alCuadro)');
  const j = MOTOR.indexOf('if (quieto) { corriendo = false; return; }');
  assert.ok(i > 0 && i < j, 'los ganchos corren antes de cortar el bucle en reposo');
});

test('con movimiento reducido las animaciones infinitas se apagan', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]*portada__cinta-pista[\s\S]*animation: none/);
});

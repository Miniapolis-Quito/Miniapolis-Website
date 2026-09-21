# Portada inmersiva: implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usar superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas `- [ ]`.

**Objetivo:** Reconstruir `public/index.html` como una vuelta al circuito guiada por el scroll (salida, tablero, recta horizontal, boxes), con motor propio, hovers solo en lo clicable y la mira intacta.

**Arquitectura:** Un motor JS propio (`portada-motor.js`) suaviza el scroll nativo, calcula progreso por escena y velocidad, y los publica como variables CSS (`--p`, `--vel`, `--scroll`). `portada.css` (nuevo, solo portada) convierte esas variables en movimiento. Por defecto la página es estática y completa; todo lo animado cuelga de `.portada-motor`, que `portada.js` añade solo si hay movimiento permitido.

**Tecnologías:** JS de módulos ES sin dependencias, CSS moderno (`clip-path`, `mod()`, `conic-gradient`), `node --test`, Playwright (ya en `node_modules`) para verificación visual.

**Spec:** `docs/superpowers/specs/2026-09-21-portada-carrera-inmersiva-design.md`

## Restricciones globales

- Paleta: negro de marca, verde `#3dfe40`, rojo/blanco de los bordillos. No se atenúan las fotos con capas oscuras globales; solo un degradado lateral/inferior detrás del texto.
- La mira (`.entrada__mira`) conserva su apariencia exacta; solo reacciona a elementos clicables.
- Solo `a`, `button`, `label`, campos, `[role="tab"]` y clases de enlace/botón tienen `:hover`. Fotos, cifras y bloques, nunca.
- Alcance: solo `public/index.html`. `app.html`, `admin.html`, `scan.html`, `restablecer.html`, `404.html` no cambian (verificado por captura idéntica).
- Copy: se conserva el actual; no se añaden frases. Se arregla el espaciado («Ven a» se leía «Vena»).
- Los `id` de formularios que usa `public/js/login.js` no cambian: el bloque `.entrada__acceso-panel` del HTML actual (líneas 139–225) se conserva tal cual.
- CSP: `script-src 'self'`, sin `style=""` en el HTML, sin CDN. `url()` de CSS y `import` de JS con rutas relativas (excepto `data:`).
- `index.html` sigue cargando `<link rel="stylesheet" href="/css/styles.css">` (lo exige un test global) y `<meta name="theme-color" content="#000000">`.
- `e2e/interfaz.mjs` exige: `.entrada__acceso-panel .pestanas` en `display: grid`, pestañas de igual ancho y márgenes simétricos, `::after` de la pestaña activa en `none`, contraste ≥ 4.5:1.
- Quien pide menos movimiento recibe la página estática con todo visible.
- Cada commit termina con `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (segundo `-m`).
- Ruta de trabajo: `/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets` (sin segmentos ocultos: `npm test` es fiable aquí). Carpeta temporal de la sesión en `$SP`:
  `SP=/private/tmp/claude-501/-Users-danilomonge-Desktop-Own-Projects-miniapolis-tickets/e7b872bb-f098-47e5-8da5-a8797e85c1c6/scratchpad`

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `public/js/portada-motor.js` | Funciones puras de progreso/velocidad (probadas) + `crearMotor()` (bucle, escenas, variables CSS). |
| `public/js/portada.js` | Orquestación: mira, progreso sin motor, arranque de la salida, cifras, escenas. |
| `public/css/portada.css` | Todo el CSS de la portada. |
| `public/index.html` | Marcado nuevo; formularios intactos. |
| `public/css/styles.css` | Se le quita el CSS heredado de la portada. |
| `public/js/movimiento.js` | Se le quita `revelarFiguras` (la portada ya no usa figuras reveladas ahí). |
| `tests/portada-motor.test.js` | Pruebas unitarias del motor. |
| `tests/portada.test.js` | Pruebas de contrato de la portada. |
| `tests/frontend.test.js` | Se retiran los tests atados al diseño anterior. |
| `$SP/qa/harness.mjs` | Servidor estático + capturas + rendimiento (fuera del repo). |

---

### Tarea 1: Línea base y herramientas de verificación

**Archivos:**
- Restaurar: `public/images/oficial/pista-circuito-panorama.webp`, `public/index.html` (deshacer cambios sin commit)
- Crear (fuera del repo): `$SP/qa/harness.mjs`

- [ ] **Paso 1: Restaurar el panorama de máxima calidad y el HTML**

La versión de 432 KB queda respaldada en `$SP/panorama-WT.webp`.

```bash
cd "/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets"
git checkout -- public/images/oficial/pista-circuito-panorama.webp public/index.html
git status --short
ls -l public/images/oficial/pista-circuito-panorama.webp
```
Esperado: `git status` vacío; el archivo pesa 974702 bytes.

- [ ] **Paso 2: Crear el arnés de verificación**

Escribe `$SP/qa/harness.mjs`:

```js
// Uso: SP=... node harness.mjs <etiqueta> [ancho alto]
// Sirve public/ en :8766, captura el scroll en fracciones y mide fotogramas.
import { chromium } from '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/public';
const SP = process.env.SP;
const etiqueta = process.argv[2] || 'despues';
const ancho = Number(process.argv[3] || 1440);
const alto = Number(process.argv[4] || 900);
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const f = path.join(RAIZ, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8766);

const carpeta = path.join(SP, 'qa', `${etiqueta}-${ancho}`);
fs.mkdirSync(carpeta, { recursive: true });
for (const f of fs.readdirSync(carpeta)) fs.unlinkSync(path.join(carpeta, f));

const nav = await chromium.launch();
const pagina = await nav.newPage({ viewport: { width: ancho, height: alto } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
await pagina.goto('http://localhost:8766/index.html', { waitUntil: 'networkidle' });

// Secuencia de salida (solo tiene sentido en la portada nueva).
for (const ms of [350, 900, 1500, 2600]) {
  await pagina.waitForTimeout(ms === 350 ? 350 : ms - [350, 900, 1500, 2600][[350, 900, 1500, 2600].indexOf(ms) - 1]);
  await pagina.screenshot({ path: path.join(carpeta, `salida-${String(ms).padStart(4, '0')}.png`) });
}

const max = await pagina.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const pasos = 24;
for (let i = 0; i <= pasos; i++) {
  const y = Math.round((max * i) / pasos);
  await pagina.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
  await pagina.waitForTimeout(750);
  await pagina.screenshot({ path: path.join(carpeta, `scroll-${String(i).padStart(2, '0')}.png`) });
}

const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await pagina.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await pagina.waitForTimeout(500);
const rendimiento = await pagina.evaluate(async () => {
  const deltas = [];
  let ultimo = performance.now();
  let activo = true;
  const bucle = (t) => { deltas.push(t - ultimo); ultimo = t; if (activo) requestAnimationFrame(bucle); };
  requestAnimationFrame(bucle);
  const tope = document.documentElement.scrollHeight - innerHeight;
  await new Promise((res) => {
    let y = 0;
    const paso = () => { y += 28; window.scrollTo({ top: y, behavior: 'instant' }); if (y >= tope) res(); else requestAnimationFrame(paso); };
    paso();
  });
  activo = false;
  deltas.sort((a, b) => a - b);
  return { fotogramas: deltas.length, mediana: +deltas[Math.floor(deltas.length / 2)].toFixed(1), p95: +deltas[Math.floor(deltas.length * 0.95)].toFixed(1), maximo: +deltas.at(-1).toFixed(1), largos: deltas.filter((d) => d > 33).length };
});
const resumen = { etiqueta, ancho, alto, max, desborde, rendimiento, errores };
fs.writeFileSync(path.join(carpeta, 'resumen.json'), JSON.stringify(resumen, null, 2));
console.log(JSON.stringify(resumen));
await nav.close();
servidor.close();
```

- [ ] **Paso 3: Capturar la línea base de la portada anterior (escritorio y móvil)**

```bash
cd "/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets"
export SP=/private/tmp/claude-501/-Users-danilomonge-Desktop-Own-Projects-miniapolis-tickets/e7b872bb-f098-47e5-8da5-a8797e85c1c6/scratchpad
mkdir -p "$SP/qa"
node "$SP/qa/harness.mjs" antes 1440 900
node "$SP/qa/harness.mjs" antes 390 844
```
Esperado: cada ejecución imprime un JSON con `rendimiento` y `errores: []`. Anota `p95` y `largos` de la base.

- [ ] **Paso 4: Línea base de las pruebas**

```bash
npm test 2>&1 | tail -15
```
Esperado: todas pasan (`# fail 0`). Si algo falla ya aquí, detente y averigua la causa antes de seguir.

- [ ] **Paso 5: Commit**

No hay cambios que commitear (solo se restauraron archivos). Comprueba `git status --short` vacío y sigue.

---

### Tarea 2: Funciones puras del motor (TDD)

**Archivos:**
- Crear: `public/js/portada-motor.js`
- Crear: `tests/portada-motor.test.js`

**Interfaces — produce (Tareas 5 y siguientes las importan):**
```js
limitar(valor, minimo = 0, maximo = 1) -> number
suavizar(actual, objetivo, rigidez, dt) -> number          // dt en segundos
progresoFijo(scroll, inicio, largo) -> 0..1                 // escenas fijas (sticky)
progresoVista(scroll, altoVentana, top, alto) -> 0..1       // escenas que cruzan la pantalla
normalizarVelocidad(pxPorSegundo, maximo = 2400) -> -1..1
fase(p, desde, hasta) -> 0..1
easeOutCubic(t) -> 0..1
lucesEncendidas(p, total) -> entero 0..total
digitosDe(texto) -> number[]
entradaPanel(izquierdaEnPantalla, anchoVentana) -> 0..1
```

- [ ] **Paso 1: Escribir las pruebas que fallan**

`tests/portada-motor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitar, suavizar, progresoFijo, progresoVista, normalizarVelocidad,
  fase, easeOutCubic, lucesEncendidas, digitosDe, entradaPanel,
} from '../public/js/portada-motor.js';

const cerca = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} no está a ${eps} de ${b}`);

test('limitar recorta al rango', () => {
  assert.equal(limitar(5), 1);
  assert.equal(limitar(-1), 0);
  assert.equal(limitar(7, 0, 10), 7);
});

test('suavizar no se mueve con dt cero y converge con dt grande', () => {
  assert.equal(suavizar(0, 100, 10, 0), 0);
  cerca(suavizar(0, 100, 10, 1), 100 * (1 - Math.exp(-10)));
});

test('suavizar da lo mismo en dos pasos de 0,5 s que en uno de 1 s', () => {
  const dos = suavizar(suavizar(0, 100, 10, 0.5), 100, 10, 0.5);
  cerca(dos, suavizar(0, 100, 10, 1), 1e-9);
});

test('progresoFijo recorre 0..1 sobre el largo de la escena', () => {
  assert.equal(progresoFijo(0, 100, 400), 0);
  assert.equal(progresoFijo(300, 100, 400), 0.5);
  assert.equal(progresoFijo(900, 100, 400), 1);
  assert.equal(progresoFijo(50, 100, 0), 0);
  assert.equal(progresoFijo(150, 100, 0), 1);
});

test('progresoVista va de 0 al asomar por abajo a 1 al salir por arriba', () => {
  // Elemento en y=1000 de alto 500; ventana de 800.
  assert.equal(progresoVista(200, 800, 1000, 500), 0);
  cerca(progresoVista(850, 800, 1000, 500), 0.5);
  assert.equal(progresoVista(1500, 800, 1000, 500), 1);
});

test('normalizarVelocidad se satura en ±1', () => {
  assert.equal(normalizarVelocidad(0), 0);
  assert.equal(normalizarVelocidad(1200), 0.5);
  assert.equal(normalizarVelocidad(-4800), -1);
});

test('fase reparte un tramo de p', () => {
  assert.equal(fase(0, 0.25, 0.75), 0);
  assert.equal(fase(0.5, 0.25, 0.75), 0.5);
  assert.equal(fase(1, 0.25, 0.75), 1);
  assert.equal(fase(0.3, 0.5, 0.5), 0);
  assert.equal(fase(0.7, 0.5, 0.5), 1);
});

test('easeOutCubic frena al final', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(0.5), 0.875);
});

test('lucesEncendidas cuenta luces enteras', () => {
  assert.equal(lucesEncendidas(0, 10), 0);
  assert.equal(lucesEncendidas(0.05, 10), 0);
  assert.equal(lucesEncendidas(0.5, 10), 5);
  assert.equal(lucesEncendidas(0.99, 10), 9);
  assert.equal(lucesEncendidas(1, 10), 10);
});

test('digitosDe ignora todo lo que no es un dígito', () => {
  assert.deepEqual(digitosDe('400'), [4, 0, 0]);
  assert.deepEqual(digitosDe('1/10'), [1, 1, 0]);
  assert.deepEqual(digitosDe('7 días'), [7]);
});

test('entradaPanel es 0 fuera de pantalla y 1 cuando el panel pasó la mitad', () => {
  assert.equal(entradaPanel(1000, 1000), 0);
  assert.equal(entradaPanel(500, 1000), 1);
  assert.equal(entradaPanel(-200, 1000), 1);
  assert.equal(entradaPanel(750, 1000), 0.5);
  assert.equal(entradaPanel(10, 0), 1);
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
node --test tests/portada-motor.test.js 2>&1 | head -15
```
Esperado: FAIL (`Cannot find module` / archivo no existe).

- [ ] **Paso 3: Implementar las funciones puras**

`public/js/portada-motor.js` (la parte del DOM se añade en la Tarea 5; el archivo no toca `window` al importarse):

```js
/**
 * Motor de scroll de la portada.
 *
 * No secuestra el scroll: la página se desplaza de forma nativa y aquí solo se
 * suaviza lo que se pinta, para dar inercia. Publica variables CSS y el CSS
 * hace el resto:
 *
 *   :root   --scroll (0..1 de la página), --vel (-1..1), --vel-abs, --scroll-px
 *   escena  --p (0..1 de su recorrido)
 *
 * Las funciones de arriba son puras y están probadas. Nada de esto toca el
 * documento al importarse.
 */

export const limitar = (valor, minimo = 0, maximo = 1) => Math.min(maximo, Math.max(minimo, valor));

/** Acerca `actual` a `objetivo`; el resultado no depende de los fotogramas por segundo. */
export function suavizar(actual, objetivo, rigidez, dt) {
  return actual + (objetivo - actual) * (1 - Math.exp(-rigidez * dt));
}

/** Progreso de una escena fija (sticky): 0 al fijarse, 1 al soltarse. */
export function progresoFijo(scroll, inicio, largo) {
  if (largo <= 0) return scroll >= inicio ? 1 : 0;
  return limitar((scroll - inicio) / largo);
}

/** Progreso de una escena que cruza la pantalla: 0 al asomar por abajo, 1 al salir por arriba. */
export function progresoVista(scroll, altoVentana, top, alto) {
  return limitar((scroll + altoVentana - top) / (altoVentana + Math.max(alto, 1)));
}

export function normalizarVelocidad(pxPorSegundo, maximo = 2400) {
  return limitar(pxPorSegundo / maximo, -1, 1);
}

/** Un tramo [desde, hasta] de p convertido a 0..1. */
export function fase(p, desde, hasta) {
  if (hasta <= desde) return p >= desde ? 1 : 0;
  return limitar((p - desde) / (hasta - desde));
}

export const easeOutCubic = (t) => 1 - (1 - limitar(t)) ** 3;

/** Cuántas luces de cambio hay encendidas: enteras, y todas al llegar a 1. */
export function lucesEncendidas(p, total) {
  const q = limitar(p);
  if (q >= 1) return total;
  return Math.floor(q * total + 1e-9);
}

export function digitosDe(texto) {
  return [...String(texto)].filter((c) => c >= '0' && c <= '9').map(Number);
}

/** Cuánto ha entrado un panel del riel: 0 fuera por la derecha, 1 al pasar la mitad de la pantalla. */
export function entradaPanel(izquierdaEnPantalla, anchoVentana) {
  if (anchoVentana <= 0) return 1;
  return limitar((anchoVentana - izquierdaEnPantalla) / (anchoVentana * 0.5));
}
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
node --test tests/portada-motor.test.js 2>&1 | tail -12
```
Esperado: `# pass 11`, `# fail 0`.

- [ ] **Paso 5: Commit**

```bash
git add public/js/portada-motor.js tests/portada-motor.test.js
git commit -m "feat: add pure scroll math for the racing landing motor" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Tarea 3: Sacar de `styles.css` el CSS heredado de la portada

El CSS de la portada está repartido en cinco capas de rediseños anteriores dentro de `styles.css` (líneas 1334–1954, 2034–2040, 2552–3415, 3481–3522, 3584–4307). Se extrae con un script que analiza el CSS por reglas (no con edición manual) y se verifica con capturas idénticas de las páginas que no son la portada.

**Archivos:**
- Modificar: `public/css/styles.css`, `public/js/movimiento.js`
- Crear (fuera del repo): `$SP/extraer-css.mjs`, `$SP/removidas.css`

- [ ] **Paso 1: Capturas «antes» de páginas que no cambian**

Usan el CSS actual. Deben quedar idénticas después.

```bash
cd "/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets"
export SP=/private/tmp/claude-501/-Users-danilomonge-Desktop-Own-Projects-miniapolis-tickets/e7b872bb-f098-47e5-8da5-a8797e85c1c6/scratchpad
mkdir -p "$SP/compartidas"
cat > "$SP/capturar-compartidas.mjs" <<'EOF'
import { chromium } from '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/public';
const etiqueta = process.argv[2];
const SP = process.env.SP;
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const s = http.createServer((req, res) => {
  const f = path.join(RAIZ, new URL(req.url, 'http://x').pathname);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(8767);
const nav = await chromium.launch();
for (const [ancho, alto] of [[1280, 900], [390, 844]]) {
  const p = await nav.newPage({ viewport: { width: ancho, height: alto }, reducedMotion: 'reduce' });
  for (const pagina of ['restablecer', '404', 'app', 'admin', 'scan', 'recordatorios']) {
    await p.goto(`http://localhost:8767/${pagina}.html`, { waitUntil: 'load' }).catch(() => {});
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${SP}/compartidas/${etiqueta}-${pagina}-${ancho}.png`, fullPage: true });
  }
  await p.close();
}
await nav.close(); s.close();
EOF
node "$SP/capturar-compartidas.mjs" antes && ls "$SP/compartidas" | wc -l
```
Esperado: 12 capturas.

- [ ] **Paso 2: Comprobar que no hay selectores con la clase de la portada dentro de `:not(...)`**

```bash
grep -n ":not(\.pagina-entrada\|:not(\.entrada__" public/css/styles.css || echo "ninguno"
```
Esperado: `ninguno`. Si aparece alguno, decide a mano qué hacer con esa regla antes de seguir.

- [ ] **Paso 3: Escribir el extractor**

`$SP/extraer-css.mjs`:

```js
// Uso (desde la raíz del repo): SP=... node "$SP/extraer-css.mjs"
import fs from 'node:fs';

const RUTA = 'public/css/styles.css';
const SP = process.env.SP;
const LANDING = /\.pagina-entrada|\.entrada__|\.portada-revela|\.figura-revela|\.mira-(?:activa|sobre)|\.contenedor--portada|\.cifra(?![\w])|\.cifra__/;

function saltarCadena(css, i, comilla) {
  let j = i + 1;
  while (j < css.length && css[j] !== comilla) { if (css[j] === '\\') j++; j++; }
  return j + 1;
}

/** Trocea en comentarios y sentencias (regla o at-regla), conservando el espacio previo. */
function analizar(css) {
  const partes = [];
  let i = 0;
  let pre = '';
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (/\s/.test(c)) { pre += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') {
      const f = css.indexOf('*/', i + 2);
      const fin = f === -1 ? n : f + 2;
      partes.push({ t: 'com', pre, s: css.slice(i, fin) });
      pre = ''; i = fin; continue;
    }
    const ini = i;
    let llaves = 0; let paren = 0;
    while (i < n) {
      const ch = css[i];
      if (ch === '/' && css[i + 1] === '*') { const f = css.indexOf('*/', i + 2); i = f === -1 ? n : f + 2; continue; }
      if (ch === '"' || ch === "'") { i = saltarCadena(css, i, ch); continue; }
      if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '{') llaves++;
      else if (ch === '}') { llaves--; if (llaves === 0) { i++; break; } }
      else if (ch === ';' && llaves === 0 && paren === 0) { i++; break; }
      i++;
    }
    partes.push({ t: 'sent', pre, s: css.slice(ini, i) });
    pre = '';
  }
  return { partes, cola: pre };
}
const serializar = ({ partes, cola }) => partes.map((p) => p.pre + p.s).join('') + cola;

function dividirComas(prelude) {
  const out = []; let prof = 0; let ini = 0;
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (c === '(' || c === '[') prof++;
    else if (c === ')' || c === ']') prof--;
    else if (c === ',' && prof === 0) { out.push(prelude.slice(ini, i)); ini = i + 1; }
  }
  out.push(prelude.slice(ini));
  return out;
}

const quitadas = [];
const esBanner = (s) => /^\/\*\s*={5,}/.test(s);

function filtrar(analisis) {
  const salida = [];
  let pendientes = [];
  const volcar = () => { salida.push(...pendientes); pendientes = []; };
  for (const p of analisis.partes) {
    if (p.t === 'com') {
      if (esBanner(p.s)) { volcar(); if (/portada/i.test(p.s)) { quitadas.push(p.s); } else salida.push(p); }
      else pendientes.push(p);
      continue;
    }
    const nueva = filtrarSentencia(p.s);
    if (nueva === null) { pendientes.forEach((c) => quitadas.push(c.s)); pendientes = []; continue; }
    volcar();
    salida.push({ ...p, s: nueva });
  }
  volcar();
  return { partes: salida, cola: analisis.cola };
}

function filtrarSentencia(s) {
  const i = s.indexOf('{');
  if (i === -1) return s;
  const prelude = s.slice(0, i);
  const cuerpo = s.slice(i);
  const p = prelude.trim();
  if (/^@(media|supports|layer)\b/.test(p)) {
    const interior = filtrar(analizar(cuerpo.slice(1, -1)));
    const texto = serializar(interior);
    if (texto.trim() === '') { quitadas.push(s); return null; }
    return `${prelude}{${texto}}`;
  }
  if (p.startsWith('@')) return s;
  const selectores = dividirComas(p);
  const quedan = selectores.filter((x) => !LANDING.test(x));
  if (quedan.length === selectores.length) return s;
  if (quedan.length === 0) { quitadas.push(s); return null; }
  quitadas.push(`/* selectores quitados: ${selectores.filter((x) => LANDING.test(x)).join(',').replace(/\s+/g, ' ')} */`);
  return `${quedan.map((x) => x.trim()).join(',\n')} ${cuerpo}`;
}

const original = fs.readFileSync(RUTA, 'utf8');
if (serializar(analizar(original)) !== original) throw new Error('el analizador no es idempotente: no se toca nada');

let resultado = serializar(filtrar(analizar(original)));

// Fotogramas que ya nadie usa.
const otros = fs.readdirSync('public/js').map((f) => fs.readFileSync(`public/js/${f}`, 'utf8')).join('\n')
  + fs.readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(`public/${f}`, 'utf8')).join('\n');
for (const m of [...resultado.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)]) {
  const nombre = m[1];
  const usos = [...(resultado + otros).matchAll(new RegExp(`(?<![\\w-])${nombre}(?![\\w-])`, 'g'))].length;
  if (usos <= 1) {
    const analisis = analizar(resultado);
    analisis.partes = analisis.partes.filter((p) => { const va = p.s.startsWith(`@keyframes ${nombre}`); if (va) quitadas.push(p.s); return !va; });
    resultado = serializar(analisis);
  }
}

resultado = resultado.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(RUTA, resultado);
fs.writeFileSync(`${SP}/removidas.css`, quitadas.join('\n\n'));
console.log(`styles.css: ${original.split('\n').length} -> ${resultado.split('\n').length} líneas; ${quitadas.length} elementos quitados`);
```

- [ ] **Paso 4: Ejecutar el extractor**

```bash
node "$SP/extraer-css.mjs"
grep -c "pagina-entrada\|entrada__\|portada-revela\|figura-revela\|contenedor--portada" public/css/styles.css
```
Esperado: mensaje con menos líneas que 4317 y `0` en el `grep -c`. Si el extractor lanza «no es idempotente», corrige el analizador (no toques el CSS a mano).

- [ ] **Paso 5: Comprobar que se conserva la mira y la pestaña de referencia en `removidas.css`**

```bash
grep -c "entrada__mira" "$SP/removidas.css"
grep -n "miraOrbita\|entrada__acceso-panel .pestana" "$SP/removidas.css" | head -5
```
Esperado: varias coincidencias (esas reglas se reescriben en `portada.css` en la Tarea 4).

- [ ] **Paso 6: Quitar `revelarFiguras` de `movimiento.js`**

En `public/js/movimiento.js`: borra el bloque completo desde `// Fotografías: revelado al entrar en pantalla` (cabecera de sección incluida) hasta el cierre de `revelarFiguras`, borra las constantes `ESCALON_MS` y `RED_DE_SEGURIDAD_MS` y su comentario, y en `montarMovimiento` borra:

```js
  if (document.body.classList.contains('pagina-entrada')) {
    revelarFiguras();
  }
```
En el comentario de cabecera, cambia «las fotos que se descubren al entrar en pantalla, el subrayado…» por «el subrayado…». Mantén `sinMovimiento`, `yaHecho`, `montarCabeceraAlDesplazar`, `montarPestanasDesplazables`, `montarIndicadorPestanas`, `montarTemporizadorQr`.

```bash
grep -n "revelarFiguras\|ESCALON_MS\|RED_DE_SEGURIDAD" public/js/*.js || echo "limpio"
```
Esperado: `limpio`.

- [ ] **Paso 7: Capturas «después» y comparación píxel a píxel**

```bash
node "$SP/capturar-compartidas.mjs" despues
for f in "$SP"/compartidas/antes-*.png; do
  d="${f/antes-/despues-}"
  r=$(magick compare -metric AE "$f" "$d" null: 2>&1); echo "$(basename "$f"): $r"
done
```
Esperado: todos `0`. Cualquier valor distinto de 0 significa que el extractor quitó algo compartido: encuentra la regla en `$SP/removidas.css`, devuélvela a `styles.css` y ajusta `LANDING` o el filtro (revierte con `git checkout public/css/styles.css` y repite).

- [ ] **Paso 8: Retirar los tests atados al diseño anterior**

Script de una vez (no se commitea):

```bash
node --input-type=module -e "
import fs from 'node:fs';
const f = 'tests/frontend.test.js';
let s = fs.readFileSync(f, 'utf8');
const titulos = [
 'la portada usa la pista real y los recursos fotográficos inmersivos',
 'la portada mantiene un copy editorial breve, natural y sin ruido visual',
 'la portada gana presencia con capas visuales, no con más copy',
 'la portada prepara una dirección de arte cinematográfica y no una retícula decorativa',
 'la portada usa una sola imagen protagonista limpia y descarta encuadres con personas',
 'la portada conecta sus bloques con escenas de scroll y movimiento progresivo',
 'la portada articula una salida de carrera con capas visuales reales',
 'la portada traduce el scroll y el puntero en una coreografía de carrera',
 'la portada carga su capa de movimiento y respeta el movimiento reducido',
 'la mira del puntero se posiciona sin interpolación ni transición espacial',
 'la capa de movimiento tiene una salida global para movimiento reducido',
 'la cabecera de la portada permanece fija durante el scroll',
 'la cabecera fija reserva su espacio y no dibuja adornos laterales',
 'la cabecera de la portada usa un lenguaje de pit lane sobrio y estático',
];
for (const t of titulos) {
  const re = new RegExp(\"test\\\\('\" + t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\$&') + \"'[\\\\s\\\\S]*?\\\\n\\\\}\\\\);\\\\n\\\\n?\");
  if (!re.test(s)) throw new Error('no encontrado: ' + t);
  s = s.replace(re, '');
}
fs.writeFileSync(f, s);
console.log('retirados', titulos.length);
"
grep -c "^test(" tests/frontend.test.js
```
Esperado: `retirados 14`. Ese script es un atajo: si el escape de comillas falla en tu shell, borra a mano esos 14 bloques `test('…', () => { … });` por su título.

- [ ] **Paso 9: Ajustar el test de clases definidas para que lea todas las hojas enlazadas**

En `tests/frontend.test.js`, reemplaza el test `'toda clase usada en el HTML está definida en la hoja de estilos'` por:

```js
test('toda clase usada en el HTML está definida en la hoja de estilos', () => {
  const fallos = [];
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    const src = leer(html);
    const hojas = [...src.matchAll(/<link rel="stylesheet" href="\/css\/([\w.-]+\.css)">/g)].map((m) => leer(`public/css/${m[1]}`));
    const definidas = new Set(hojas.flatMap((css) => [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])));
    for (const m of src.matchAll(/class="([^"]+)"/g)) {
      for (const clase of m[1].split(/\s+/)) {
        if (clase && !definidas.has(clase)) fallos.push(`${html}: la clase .${clase} no está definida`);
      }
    }
  }
  assert.deepEqual(fallos, []);
});
```

- [ ] **Paso 10: Commit (la portada queda temporalmente sin estilo propio; se rehace en la Tarea 4)**

```bash
git add public/css/styles.css public/js/movimiento.js tests/frontend.test.js
git commit -m "refactor: remove legacy landing CSS layers from the shared stylesheet" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
No corras `npm test` completo todavía: fallarán tests de la portada que la Tarea 4 vuelve a satisfacer.

### Tarea 4: Marcado nuevo y CSS base estático

Al terminar esta tarea la portada ya es completa, bonita y funcional **sin movimiento** (estado por defecto y estado de `prefers-reduced-motion`). Las Tareas 5–9 le añaden el movimiento.

**Archivos:**
- Modificar: `public/index.html`
- Crear: `public/css/portada.css`

**Interfaces — produce (las Tareas 5–9 dependen de estos nombres):**
- Escenas (atributo `data-escena`): `salida`, `tablero`, `recta`, `boxes`.
- Clases: `.portada__cielo` (img del fondo), `.portada__semaforo > .portada__luz ×5`, `.portada__salida-copy`, `.portada__linea > span`, `.portada__auto`, `.portada__luces > span ×10`, `.cifra__num[data-cifra][data-prefijo][data-sufijo]`, `.portada__recta-marco`, `.portada__riel`, `.portada__panel`, `.portada__bordillo`, `.portada__bandera`, `.entrada__acceso-panel` (intacto), `.portada__estela`.
- Variables CSS que lee: `--p`, `--vel`, `--vel-abs`, `--scroll`, `--scroll-px`, `--cruce`, `--entra`, `--q`, `--recorrido`, `--alto-recta`.
- Clases de estado en `<html>`: `.portada-motor`, `.portada-listos`, `.portada-rapido`, `.portada-fija`.

- [ ] **Paso 1: Generar el nuevo `index.html` conservando los formularios**

Este script toma el bloque `.entrada__acceso-panel` del archivo actual tal cual (los `id` que usa `login.js` no se retocan) y lo inserta en el marcado nuevo.

```bash
export SP=/private/tmp/claude-501/-Users-danilomonge-Desktop-Own-Projects-miniapolis-tickets/e7b872bb-f098-47e5-8da5-a8797e85c1c6/scratchpad
cat > "$SP/generar-index.mjs" <<'EOF'
import fs from 'node:fs';
const actual = fs.readFileSync('public/index.html', 'utf8');
const ini = actual.indexOf('<div class="entrada__acceso-panel">');
const fin = actual.indexOf('</section>', ini);
if (ini === -1 || fin === -1) throw new Error('no se encontró el panel de acceso');
const panel = actual.slice(ini, fin).trimEnd().split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#000000">
  <meta name="description" content="Miniápolis #3: pista indoor de asfalto para autos a control remoto. Guarda tu pase y entra a rodar.">
  <title>Miniápolis #3 — Entra a rodar</title>
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="stylesheet" href="/css/portada.css">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
  <link rel="preload" href="./images/oficial/pista-circuito-panorama.webp" as="image" fetchpriority="high">
</head>
<body class="pagina-entrada">
  <header class="entrada__barra">
    <div class="entrada__barra-interior contenedor contenedor--portada">
      <a class="entrada__marca subrayado-no" href="./index.html" aria-label="Miniápolis #3 — inicio">
        <span class="entrada__marca-sello" aria-hidden="true"><img src="./images/miniapolis-logo-oficial.webp" width="1000" height="425" alt="Miniápolis #3"></span>
      </a>
      <a class="entrada__accion" href="#acceso">Entrar</a>
    </div>
    <div class="entrada__progreso" aria-hidden="true"><span></span></div>
  </header>

  <main>
    <section class="portada__salida" data-escena="salida" aria-labelledby="titulo-entrada">
      <div class="portada__salida-marco">
        <div class="portada__cielo" aria-hidden="true">
          <img src="./images/oficial/pista-circuito-panorama.webp" width="3840" height="2160" alt="" fetchpriority="high" decoding="async">
        </div>
        <div class="portada__semaforo" aria-hidden="true">
          <span class="portada__luz"></span><span class="portada__luz"></span><span class="portada__luz"></span><span class="portada__luz"></span><span class="portada__luz"></span>
        </div>
        <div class="portada__salida-copy">
          <p class="portada__kicker">Pista indoor</p>
          <h1 id="titulo-entrada"><span class="portada__linea"><span>Ven a</span></span><span class="portada__linea portada__linea--acento"><span>rodar.</span></span></h1>
          <p class="portada__lema">Asfalto, curvas y control.</p>
          <div class="portada__acciones">
            <a class="boton boton--principal boton--grande" href="#acceso">Entrar</a>
            <a class="portada__enlace" href="#pista">Ver la pista</a>
          </div>
        </div>
        <figure class="portada__auto">
          <picture>
            <source srcset="./images/landing/miniapolis-car-detail-640.webp 640w, ./images/landing/miniapolis-car-detail-900.webp 900w, ./images/landing/miniapolis-car-detail.webp 1221w" type="image/webp" sizes="(max-width: 700px) 46vw, 28vw">
            <img src="./images/landing/miniapolis-car-detail.jpeg" width="1221" height="1289"
                 alt="Coche de radiocontrol listo para entrar en pista"
                 sizes="(max-width: 700px) 46vw, 28vw" decoding="async">
          </picture>
        </figure>
      </div>
    </section>

    <section class="portada__tablero" data-escena="tablero" aria-label="La pista en cifras">
      <div class="portada__luces" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
      <ul class="portada__cifras">
        <li class="cifra">
          <span class="cifra__num" data-cifra="400" data-sufijo="m²">400 m²</span>
          <span class="cifra__texto">Asfalto indoor</span>
        </li>
        <li class="cifra">
          <span class="cifra__num" data-cifra="10" data-prefijo="1/">1/10</span>
          <span class="cifra__texto">GT y touring</span>
        </li>
        <li class="cifra">
          <span class="cifra__num" data-cifra="7" data-sufijo="días">7 días</span>
          <span class="cifra__texto">Packs activos</span>
        </li>
      </ul>
    </section>

    <section id="pista" class="portada__recta" data-escena="recta" aria-labelledby="titulo-pista">
      <div class="portada__recta-marco">
        <header class="portada__recta-cabeza">
          <h2 id="titulo-pista">La pista.</h2>
          <p>Rectas, curvas y asfalto.</p>
        </header>
        <div class="portada__riel">
          <figure class="portada__panel portada__panel--ancho">
            <img src="./images/pista/miniapolis-track-corner-wide.webp" width="1675" height="939"
                 alt="Vista baja de una curva del circuito de asfalto de Miniápolis #3"
                 srcset="./images/pista/miniapolis-track-corner-wide-960.webp 960w, ./images/pista/miniapolis-track-corner-wide-1440.webp 1440w, ./images/pista/miniapolis-track-corner-wide.webp 1675w"
                 sizes="(max-width: 899px) 100vw, 60vw" loading="lazy" decoding="async">
          </figure>
          <article class="portada__panel portada__panel--texto">
            <h3>A tu ritmo.</h3>
            <p>Una pista para sentir cada vuelta.</p>
            <ul class="portada__datos">
              <li><span>Superficie</span><span>Asfalto real</span></li>
              <li><span>Recorrido</span><span>Rectas y curvas</span></li>
            </ul>
          </article>
          <figure class="portada__panel portada__panel--alto">
            <picture>
              <source srcset="./images/pista/miniapolis-hangar-vertical-640.webp 640w, ./images/pista/miniapolis-hangar-vertical.webp 941w" type="image/webp" sizes="(max-width: 899px) 100vw, 30vw">
              <img src="./images/pista/miniapolis-hangar-vertical.webp" width="941" height="1671"
                   alt="Vista vertical del circuito y el hangar de Miniápolis" loading="lazy" decoding="async">
            </picture>
          </figure>
          <figure class="portada__panel portada__panel--alto">
            <picture>
              <source srcset="./images/pista/miniapolis-curb-detail-vertical-640.webp 640w, ./images/pista/miniapolis-curb-detail-vertical.webp 941w" type="image/webp" sizes="(max-width: 899px) 100vw, 30vw">
              <img src="./images/pista/miniapolis-curb-detail-vertical.webp" width="941" height="1672"
                   alt="Detalle de un bordillo rojo y blanco sobre el asfalto" loading="lazy" decoding="async">
            </picture>
          </figure>
          <figure class="portada__panel portada__panel--ancho">
            <picture>
              <source srcset="./images/landing/miniapolis-track-atmosphere-960.webp 960w, ./images/landing/miniapolis-track-atmosphere-1440.webp 1440w, ./images/landing/miniapolis-track-atmosphere.webp 1675w" type="image/webp" sizes="(max-width: 899px) 100vw, 60vw">
              <img src="./images/landing/miniapolis-track-atmosphere.jpeg" width="1675" height="939"
                   alt="Vista amplia del circuito dentro del hangar" loading="lazy" decoding="async">
            </picture>
          </figure>
        </div>
        <div class="portada__bordillo" aria-hidden="true"></div>
      </div>
    </section>

    <section id="acceso" class="portada__boxes" data-escena="boxes" aria-labelledby="titulo-acceso">
      <div class="portada__bandera" aria-hidden="true"></div>
      <div class="portada__intro">
        <h2 id="titulo-acceso">Tu pase.</h2>
        <p class="entrada__acceso-nota">Entra y guarda tu pase.</p>
      </div>
${panel}
    </section>
  </main>

  <footer class="entrada__pie">
    <div class="entrada__pie-interior contenedor contenedor--portada">
      <p class="entrada__pie-marca">Miniápolis&nbsp;#3</p>
    </div>
  </footer>

  <div class="portada__estela" aria-hidden="true"></div>

  <script type="module" src="/js/login.js"></script>
  <script type="module" src="/js/portada.js"></script>
</body>
</html>
`;
fs.writeFileSync('public/index.html', html);
EOF
node "$SP/generar-index.mjs"
grep -c 'id="form-entrar"\|id="form-registro"\|id="form-recuperar"\|id="form-segundo-paso"\|id="aviso"' public/index.html
```
Esperado: `5`.

- [ ] **Paso 2: Elegir el encuadre del hero en móvil**

Mira estas imágenes verticales ya existentes y decide si alguna funciona mejor que el panorama recortado en 390×844:

```bash
ls -l public/images/oficial/*vertical* public/images/landing/miniapolis-track-portrait.webp
```
Ábrelas con el lector de imágenes. Criterio: solo pista/hangar, sin personas ni objetos ajenos, nítida a pantalla completa. Si una cumple, añade dentro de `.portada__cielo` antes del `<img>`: `<picture><source media="(max-width: 699px)" srcset="./images/oficial/<archivo>.webp"> <img …></picture>` (mueve ahí el `<img>` existente). Si ninguna convence, no cambies nada y afina `object-position` en el CSS (Paso 4). Anota la decisión en el mensaje del commit.

- [ ] **Paso 3: Crear el extractor de bloques de código del plan**

Los bloques ` ```css ` y ` ```js ` de esta tarea cuya primera línea es `@archivo: ruta` (sobrescribe la primera vez que aparece la ruta y luego añade) o `@añadir: ruta` (siempre añade) se escriben en disco con este script, para no teclear el código dos veces.

```bash
cat > "$SP/extraer-del-plan.mjs" <<'EOF'
// Uso (raíz del repo): node "$SP/extraer-del-plan.mjs" <número de tarea>
import fs from 'node:fs';
const tarea = process.argv[2];
const plan = fs.readFileSync('docs/superpowers/plans/2026-09-21-portada-carrera-inmersiva-implementation.md', 'utf8');
const seccion = plan.split(/^### Tarea /m).slice(1).find((s) => s.startsWith(`${tarea}:`));
if (!seccion) throw new Error(`no existe la tarea ${tarea}`);
const vistos = new Set();
const re = /```(?:css|js)\n(?:\/\*|\/\/) @(archivo|añadir): (\S+?)(?: \*\/)?\n([\s\S]*?)\n```/g;
let n = 0;
for (const [, modo, ruta, cuerpo] of seccion.matchAll(re)) {
  const anexar = modo === 'añadir' || vistos.has(ruta);
  fs[anexar ? 'appendFileSync' : 'writeFileSync'](ruta, (anexar ? '\n' : '') + cuerpo + '\n');
  vistos.add(ruta); n++;
}
console.log(`tarea ${tarea}: ${n} bloques -> ${[...vistos].join(', ')}`);
EOF
```

- [ ] **Paso 4: CSS base — tokens, cabecera, botones, enlaces y mira**

```css
/* @archivo: public/css/portada.css */
/* ==========================================================================
   Portada pública: el scroll es una vuelta al circuito.

   Estado por defecto: página estática y completa. Todo lo que se mueve cuelga
   de `.portada-motor`, que `portada.js` añade solo si el sistema permite
   movimiento. Solo lo clicable tiene :hover.
   ========================================================================== */

.pagina-entrada {
  --fondo: #050706;
  --fondo-2: #0b0f0d;
  --superficie: #0e1311;
  --superficie-2: #151b18;
  --borde: rgba(217, 230, 222, .14);
  --borde-fuerte: rgba(217, 230, 222, .34);
  --borde-campo: rgba(217, 230, 222, .44);
  --texto: #f4f7f4;
  --texto-2: #b4c0b9;
  --texto-3: #78877f;
  --acento: #3dfe40;
  --acento-2: #a4ffa6;
  --acento-suave: rgba(61, 254, 64, .12);
  --acento-borde: rgba(61, 254, 64, .45);
  --rojo: #e23a32;
  --altura-cabecera: 76px;
  --gutter: clamp(18px, 4.2vw, 64px);
  --salida: cubic-bezier(.16, 1, .3, 1);
  min-height: 100svh;
  background: var(--fondo);
  color: var(--texto);
  color-scheme: dark;
}
.pagina-entrada main { overflow-x: clip; }
.pagina-entrada h1,
.pagina-entrada h2,
.pagina-entrada h3 { margin: 0; color: var(--texto); font-weight: 900; }
.pagina-entrada p { margin: 0; }
.pagina-entrada .contenedor--portada { width: min(1400px, 100%); margin-inline: auto; padding-inline: var(--gutter); }
.portada__lectura { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* --- Cabecera ------------------------------------------------------------ */
.pagina-entrada > .entrada__barra {
  position: fixed;
  inset: 0 0 auto;
  z-index: 60;
  border-bottom: 1px solid transparent;
  background: linear-gradient(180deg, rgba(5, 7, 6, .82), rgba(5, 7, 6, 0));
  transition: background-color 260ms, border-color 260ms;
}
.pagina-entrada > .entrada__barra.esta-desplazada { border-bottom-color: var(--borde); background: rgba(5, 7, 6, .92); }
.entrada__barra-interior { display: flex; align-items: center; justify-content: space-between; min-height: var(--altura-cabecera); }
.entrada__marca { display: inline-flex; }
.entrada__marca-sello { display: block; }
.entrada__marca-sello img { display: block; width: auto; height: 34px; }
.entrada__progreso { position: absolute; inset: auto 0 -1px; height: 2px; }
.entrada__progreso span {
  display: block;
  height: 100%;
  background: var(--acento);
  box-shadow: 0 0 12px rgba(61, 254, 64, .6);
  transform: scaleX(var(--scroll, 0));
  transform-origin: left center;
}

/* --- Solo lo clicable reacciona ----------------------------------------- */
.entrada__accion {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 11px 18px;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid var(--borde-fuerte);
  color: var(--texto);
  font: 650 .72rem/1 var(--mono);
  letter-spacing: .16em;
  text-transform: uppercase;
  white-space: nowrap;
}
.entrada__accion::before {
  content: '';
  position: absolute;
  inset: 0 -20%;
  z-index: -1;
  background: var(--acento);
  transform: translate3d(-110%, 0, 0) skewX(-18deg);
  transition: transform 340ms var(--salida);
}
.entrada__accion::after { content: '→'; transition: transform 340ms var(--salida); }

.pagina-entrada .boton--principal {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background: var(--acento);
  border-color: var(--acento);
  color: #04120a;
  font-weight: 800;
}
.pagina-entrada .boton--principal::before {
  content: '';
  position: absolute;
  inset: 0 -30%;
  z-index: -1;
  background: var(--texto);
  transform: translate3d(-110%, 0, 0) skewX(-20deg);
  transition: transform 380ms var(--salida);
}
/* Anula el barrido compartido y lo sustituye por la flecha, solo en la acción del hero. */
.pagina-entrada .boton--principal::after { content: none; }
.portada__acciones .boton--principal::after {
  content: '→';
  position: static;
  inset: auto;
  width: auto;
  height: auto;
  margin-left: 10px;
  background: none;
  transform: translate3d(0, 0, 0);
  transition: transform 340ms var(--salida);
}

.portada__enlace {
  padding-bottom: 6px;
  color: var(--texto);
  font-weight: 600;
  background:
    linear-gradient(var(--borde-fuerte), var(--borde-fuerte)) 0 100% / 100% 1px no-repeat,
    linear-gradient(var(--acento), var(--acento)) 0 100% / 0 2px no-repeat;
  transition: background-size 380ms var(--salida), color 200ms;
}

@media (hover: hover) {
  .entrada__accion:hover { border-color: var(--acento); color: #04120a; }
  .entrada__accion:hover::before { transform: translate3d(0, 0, 0) skewX(-18deg); }
  .entrada__accion:hover::after { transform: translate3d(5px, 0, 0); }
  .pagina-entrada .boton--principal:hover:not(:disabled) { background: var(--acento); border-color: var(--texto); box-shadow: none; transform: none; }
  .pagina-entrada .boton--principal:hover:not(:disabled)::before { transform: translate3d(0, 0, 0) skewX(-20deg); }
  .portada__acciones .boton--principal:hover:not(:disabled)::after { transform: translate3d(7px, 0, 0); animation: none; }
  .portada__enlace:hover { color: var(--acento); background-size: 100% 1px, 100% 2px; }
}
.pagina-entrada a:focus-visible,
.pagina-entrada button:focus-visible { outline: 2px solid var(--acento); outline-offset: 3px; }

/* --- La mira: apariencia intacta; solo reacciona a lo clicable ----------- */
@keyframes miraOrbita { to { transform: rotate(360deg); } }
@keyframes miraPulso { 0%, 100% { opacity: .72; } 50% { opacity: 1; } }
.pagina-entrada.mira-activa,
.pagina-entrada.mira-activa a,
.pagina-entrada.mira-activa button,
.pagina-entrada.mira-activa input,
.pagina-entrada.mira-activa select,
.pagina-entrada.mira-activa textarea { cursor: none; }
.entrada__mira { position: fixed; top: 0; left: 0; z-index: 80; width: 26px; height: 26px; pointer-events: none; opacity: .9; transform: translate3d(calc(var(--puntero-x, -100px) - 13px), calc(var(--puntero-y, -100px) - 13px), 0) scale(var(--mira-escala, 1)); transition: opacity 220ms var(--curva); will-change: transform; mix-blend-mode: screen; }
.entrada__mira::before,
.entrada__mira::after { position: absolute; content: ''; background: var(--mira-color, rgba(244,247,244,.92)); box-shadow: 0 0 8px var(--mira-color, rgba(61,254,64,.45)); }
.entrada__mira::before { top: 0; bottom: 0; left: 50%; width: 1px; transform: translateX(-50%); }
.entrada__mira::after { top: 50%; right: 0; left: 0; height: 1px; transform: translateY(-50%); }
.entrada__mira--segmento { position: absolute; inset: -14px; border: 1px dashed var(--mira-color, rgba(61,254,64,.76)); border-radius: 50%; animation: miraOrbita 8s linear infinite, miraPulso 2.4s ease-in-out infinite; }
.entrada__mira-centro { position: absolute; inset: 9px; border: 1px solid var(--mira-color, rgba(61,254,64,.92)); border-radius: 50%; box-shadow: 0 0 12px var(--mira-color, rgba(61,254,64,.45)); }
.mira-sobre-objetivo .entrada__mira { --mira-escala: 1.3; --mira-color: var(--acento); opacity: 1; }
.mira-sobre-objetivo .entrada__mira--segmento { animation-duration: 3.6s, 1.2s; }
@media (max-width: 620px) { .entrada__mira { display: none; } }
```

- [ ] **Paso 5: CSS base — salida y tablero (estáticos)**

```css
/* @archivo: public/css/portada.css */

/* --- Salida --------------------------------------------------------------- */
.portada__salida { position: relative; }
.portada__salida-marco {
  position: relative;
  display: grid;
  align-items: end;
  min-height: 100svh;
  padding: calc(var(--altura-cabecera) + 24px) var(--gutter) clamp(40px, 9vh, 110px);
  overflow: hidden;
  isolation: isolate;
}
.portada__cielo { position: absolute; inset: 0; z-index: -2; }
.portada__cielo img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 58% 50%; }
/* Solo detrás del texto: la foto no se oscurece en el resto. */
.portada__salida-marco::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(5, 7, 6, .82) 0, rgba(5, 7, 6, .4) 40%, rgba(5, 7, 6, 0) 72%),
    linear-gradient(0deg, rgba(5, 7, 6, .9) 0, rgba(5, 7, 6, 0) 34%);
}
.portada__semaforo { display: none; }
.portada__salida-copy { position: relative; z-index: 2; max-width: min(880px, 100%); }
.portada__kicker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  color: var(--acento);
  font: 650 .74rem/1 var(--mono);
  letter-spacing: .2em;
  text-transform: uppercase;
}
.portada__kicker::before { content: ''; width: 34px; height: 2px; background: currentColor; }
.portada__salida h1 { font-size: clamp(3.6rem, 12.2vw, 12.5rem); line-height: .86; letter-spacing: -.045em; word-spacing: .16em; }
.portada__linea { display: block; overflow: hidden; padding: .05em .25em .08em 0; }
.portada__linea > span { display: inline-block; transform: skewX(-8deg); transform-origin: 0 100%; }
.portada__linea--acento { color: var(--acento); }
.portada__lema { max-width: 32ch; margin-top: 26px; color: var(--texto-2); font-size: clamp(1.05rem, 1.7vw, 1.4rem); }
.portada__acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 22px; margin-top: 34px; }
.portada__auto { position: absolute; right: var(--gutter); bottom: clamp(40px, 9vh, 110px); z-index: 2; width: clamp(210px, 28vw, 430px); margin: 0; }
.portada__auto img { display: block; width: 100%; height: auto; }

/* --- Tablero -------------------------------------------------------------- */
.portada__tablero { padding: clamp(64px, 11vw, 150px) var(--gutter); border-block: 1px solid var(--borde); background: var(--fondo-2); }
.portada__luces { display: flex; gap: 6px; max-width: 760px; }
.portada__luces span { flex: 1; height: 8px; background: var(--acento); box-shadow: 0 0 18px rgba(61, 254, 64, .55); transform: skewX(-20deg); }
.portada__luces span:nth-child(n + 7) { background: var(--rojo); box-shadow: 0 0 18px rgba(226, 58, 50, .6); }
.portada__cifras { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: clamp(40px, 7vw, 96px) 0 0; padding: 0; list-style: none; }
.cifra { padding: 0 clamp(16px, 3vw, 44px); border-left: 1px solid var(--borde); }
.cifra:first-child { padding-left: 0; border-left: 0; }
.cifra__num { display: flex; align-items: baseline; font: 900 clamp(3rem, 9vw, 9rem)/.9 var(--fuente); letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.cifra__afijo { font-size: .3em; letter-spacing: 0; color: var(--acento); }
.cifra__afijo--pre { margin-right: .2em; }
.cifra__afijo--suf { margin-left: .3em; }
.cifra__texto { display: block; margin-top: 16px; color: var(--texto-3); font: 600 .78rem/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; }
.rueda { display: inline-block; height: 1em; overflow: hidden; line-height: 1; }
.rueda__tira { display: flex; flex-direction: column; }
.rueda__tira i { height: 1em; font-style: normal; line-height: 1; }
```

- [ ] **Paso 6: CSS base — recta apilada, boxes, formulario, pie y adaptaciones**

```css
/* @archivo: public/css/portada.css */

/* --- Recta (apilada por defecto; horizontal fija con .portada-fija) ------- */
.portada__recta { padding: clamp(72px, 11vw, 150px) 0; }
.portada__recta-cabeza { padding-inline: var(--gutter); margin-bottom: clamp(28px, 4vw, 56px); }
.portada__recta-cabeza h2 { font-size: clamp(3rem, 9.5vw, 9.5rem); line-height: .9; letter-spacing: -.045em; }
.portada__recta-cabeza p { margin-top: 14px; color: var(--texto-2); font-size: clamp(1rem, 1.5vw, 1.25rem); }
.portada__riel { display: grid; gap: clamp(20px, 3vw, 40px); padding-inline: var(--gutter); }
.portada__panel { position: relative; margin: 0; overflow: hidden; }
.portada__panel img { display: block; width: 100%; height: auto; }
.portada__panel--texto { align-self: center; max-width: 46ch; overflow: visible; }
.portada__panel--texto h3 { font-size: clamp(1.8rem, 3vw, 2.6rem); letter-spacing: -.03em; }
.portada__panel--texto > p { margin: 12px 0 22px; color: var(--texto-2); }
.portada__datos { display: grid; margin: 0; padding: 0; list-style: none; }
.portada__datos li { display: flex; justify-content: space-between; gap: 18px; padding: 13px 0; border-top: 1px solid var(--borde); color: var(--texto-2); }
.portada__datos li span:first-child { color: var(--acento); font: 650 .72rem/1.6 var(--mono); letter-spacing: .14em; text-transform: uppercase; }
.portada__bordillo { display: none; }

/* --- Boxes ---------------------------------------------------------------- */
.portada__boxes {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 520px);
  gap: clamp(32px, 6vw, 96px);
  align-items: end;
  padding: clamp(120px, 16vw, 220px) var(--gutter) clamp(72px, 10vw, 140px);
  overflow-x: clip;
}
.portada__bandera { display: none; }
.portada__intro h2 { font-size: clamp(3.2rem, 9vw, 9rem); line-height: .9; letter-spacing: -.045em; word-spacing: .12em; }
.entrada__acceso-nota { margin-top: 18px; color: var(--texto-2); }
.entrada__acceso-subtitulo { margin: 0 0 6px; font-size: 1.35rem; letter-spacing: -.02em; }
.entrada__acceso-pie { margin: 18px 0 0; text-align: center; }
.entrada__acceso-panel {
  padding: clamp(20px, 3vw, 34px);
  border: 1px solid var(--borde-fuerte);
  border-radius: 6px;
  background: rgba(14, 19, 17, .78);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.entrada__acceso-panel form { margin: 0; }
.entrada__acceso-panel .campo label { color: var(--texto-2); }
.entrada__acceso-panel .campo input { border-color: var(--borde-campo); background: rgba(5, 7, 6, .6); color: var(--texto); }
.entrada__acceso-panel .campo input:focus { border-color: var(--acento); box-shadow: 0 0 0 3px rgba(61, 254, 64, .12); }

/* Selector segmentado: dos opciones del mismo peso (lo verifica e2e/interfaz.mjs). */
.entrada__acceso-panel .pestanas {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin: 0 0 clamp(22px, 3vw, 34px);
  padding: 4px;
  overflow: visible;
  border: 1px solid rgba(226, 240, 231, .2);
  border-radius: 14px;
  background: rgba(226, 240, 231, .045);
}
.entrada__acceso-panel .pestana {
  min-width: 0;
  width: 100%;
  min-height: 48px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--texto-2);
  font-size: .95rem;
  font-weight: 650;
  line-height: 1.15;
  transition: background-color 160ms, color 160ms;
}
.entrada__acceso-panel .pestana:hover { background: rgba(226, 240, 231, .08); color: var(--texto); }
.entrada__acceso-panel .pestana[aria-selected="true"] { background: var(--acento); color: #04120a; box-shadow: none; }
.entrada__acceso-panel .pestana[aria-selected="true"]::after { display: none; content: none; }
.entrada__acceso-panel .pestanas__indicador { display: none; }

/* --- Pie ------------------------------------------------------------------ */
.entrada__pie { border-top: 1px solid var(--borde); background: var(--fondo); }
.entrada__pie-interior { display: flex; align-items: center; min-height: 84px; }
.entrada__pie-marca { font-weight: 700; letter-spacing: -.01em; }

/* --- Adaptaciones --------------------------------------------------------- */
@media (max-width: 899px) {
  .portada__boxes { grid-template-columns: 1fr; align-items: start; }
  .entrada__acceso-panel { max-width: 560px; }
}
@media (max-width: 700px) {
  .portada__auto { top: calc(var(--altura-cabecera) + 12px); bottom: auto; width: 46vw; }
  .portada__cifras { grid-template-columns: 1fr; gap: 28px; }
  .cifra, .cifra:first-child { padding: 0 0 0 16px; border-left: 2px solid var(--acento); }
  .portada__luces { max-width: 100%; }
}
@media (max-width: 620px) {
  .entrada__acceso-panel .pestanas { gap: 3px; padding: 3px; }
  .entrada__acceso-panel .pestana { min-height: 44px; padding-inline: 8px; font-size: .88rem; }
}
@media print { .entrada__barra, .entrada__pie, .portada__estela { display: none !important; } }
```

- [ ] **Paso 7: Escribir `portada.css` desde el plan y comprobar la mira**

```bash
node "$SP/extraer-del-plan.mjs" 4
wc -l public/css/portada.css
for s in "mix-blend-mode: screen" "miraOrbita 8s linear infinite" "inset: 9px"; do grep -cF "$s" "$SP/removidas.css" | xargs echo "$s en removidas:"; grep -cF "$s" public/css/portada.css | xargs echo "$s en portada.css:"; done
```
Esperado: `portada.css` con unas 300 líneas y cada fragmento de la mira presente en ambos archivos (la apariencia no cambió).

- [ ] **Paso 8: JS mínimo temporal para que la portada funcione ya**

`login.js` sigue cargándose solo. Crea un `public/js/portada.js` provisional para que el `<script>` no dé 404 (se reescribe entero en la Tarea 5):

```bash
printf "// provisional: se sustituye en la Tarea 5\n" > public/js/portada.js
```

- [ ] **Paso 9: Verificar la portada estática (escritorio y móvil)**

```bash
node "$SP/qa/harness.mjs" estatica 1440 900
node "$SP/qa/harness.mjs" estatica 390 844
```
Esperado: `errores: []` y `desborde: 0` en ambos. Abre con el lector de imágenes al menos `estatica-1440/salida-2600.png`, `scroll-06.png`, `scroll-12.png`, `scroll-18.png`, `scroll-24.png` y `estatica-390/salida-2600.png`, `scroll-12.png`, `scroll-24.png`. Comprueba: foto del hero a brillo pleno, «Ven a rodar.» con espacio entre palabras y legible, cifras, fotos apiladas, formulario completo. Corrige el CSS en lo que falle (no sigas con defectos visibles).

- [ ] **Paso 10: Pruebas que sí deben pasar ya**

```bash
node --test tests/frontend.test.js 2>&1 | tail -8
```
Esperado: `# fail 0` (en especial: identificadores de `login.js`, `aria-*`, ids únicos, clases definidas en `styles.css` + `portada.css`, sin `style=""`, `theme-color`).

- [ ] **Paso 11: Commit**

```bash
git add public/index.html public/css/portada.css public/js/portada.js
git commit -m "feat: rebuild landing markup and static base styles" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 5: Motor DOM y orquestación (`portada.js`)

**Archivos:**
- Modificar: `public/js/portada-motor.js` (añade `crearMotor`)
- Reescribir: `public/js/portada.js`

**Interfaces:**
- Consume (Tarea 2): `suavizar`, `limitar`, `progresoFijo`, `progresoVista`, `normalizarVelocidad`, `fase`, `easeOutCubic`, `lucesEncendidas`, `digitosDe`, `entradaPanel`.
- Produce: `crearMotor() -> { registrar(el, { modo: 'fija' | 'vista', alActualizar?(p, { velocidad, ancho, alto }) }), iniciar(), medir() }`. Escribe `--p` en cada escena y `--scroll`, `--scroll-px`, `--vel`, `--vel-abs` en `<html>`.
- Produce (para el CSS de las Tareas 6–9): clases en `<html>` `portada-motor`, `portada-listos`, `portada-rapido`, `portada-fija`; variables `--rueda` (en `.cifra__num`), clase `.on` (en `.portada__luces span`), `--recorrido` y `--alto-recta` (en la escena `recta`), `--q` (en cada `.portada__panel`), `--cruce` y `--entra` (en la escena `boxes`), clase `.visto` (en paneles apilados).

- [ ] **Paso 1: Añadir el motor al final de `portada-motor.js`**

```js
// @añadir: public/js/portada-motor.js
// ---------------------------------------------------------------------------
// Motor (DOM)
// ---------------------------------------------------------------------------

/**
 * Una escena se registra con su elemento y un modo:
 *  - 'fija': contenedor alto con un marco `position: sticky` dentro.
 *  - 'vista': cruza la pantalla de abajo arriba.
 * `alActualizar` solo se llama cuando `p` cambia y la escena está cerca de la
 * pantalla. El bucle se duerme en cuanto el scroll se asienta.
 */
export function crearMotor() {
  const raiz = document.documentElement;
  const escenas = [];
  let alto = window.innerHeight;
  let ancho = window.innerWidth;
  let suave = window.scrollY;
  let velocidad = 0;
  let ultimo = 0;
  let corriendo = false;
  let midiendo = false;

  const maximo = () => Math.max(raiz.scrollHeight - alto, 1);

  function calcular(e) {
    return e.modo === 'fija'
      ? progresoFijo(suave, e.top, e.alto - alto)
      : progresoVista(suave, alto, e.top, e.alto);
  }

  function pintar() {
    for (const e of escenas) {
      if (!e.visible) continue;
      const p = calcular(e);
      if (Math.abs(p - e.p) < 0.0004) continue;
      e.p = p;
      e.el.style.setProperty('--p', p.toFixed(4));
      e.alActualizar?.(p, { velocidad, ancho, alto });
    }
  }

  function cuadro(ahora) {
    const dt = Math.min(0.05, Math.max(0.001, (ahora - ultimo) / 1000));
    ultimo = ahora;
    const objetivo = window.scrollY;
    const previo = suave;
    suave = suavizar(suave, objetivo, 9, dt);
    velocidad = suavizar(velocidad, normalizarVelocidad((suave - previo) / dt), 10, dt);
    const quieto = Math.abs(objetivo - suave) < 0.1 && Math.abs(velocidad) < 0.003;
    if (quieto) { suave = objetivo; velocidad = 0; }

    raiz.style.setProperty('--vel', velocidad.toFixed(3));
    raiz.style.setProperty('--vel-abs', Math.abs(velocidad).toFixed(3));
    raiz.style.setProperty('--scroll', limitar(suave / maximo()).toFixed(4));
    raiz.style.setProperty('--scroll-px', suave.toFixed(1));
    pintar();

    if (quieto) { corriendo = false; return; }
    requestAnimationFrame(cuadro);
  }

  function despertar() {
    if (corriendo) return;
    corriendo = true;
    ultimo = performance.now();
    requestAnimationFrame(cuadro);
  }

  /** Mide posiciones absolutas una vez (y al cambiar el tamaño), no en cada fotograma. */
  function medir() {
    alto = window.innerHeight;
    ancho = window.innerWidth;
    const y = window.scrollY;
    for (const e of escenas) {
      const r = e.el.getBoundingClientRect();
      e.top = r.top + y;
      e.alto = r.height;
      e.p = -1;
    }
    despertar();
  }

  const medirEnFotograma = () => {
    if (midiendo) return;
    midiendo = true;
    requestAnimationFrame(() => { midiendo = false; medir(); });
  };

  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      const escena = escenas.find((e) => e.el === entrada.target);
      if (!escena) continue;
      escena.visible = entrada.isIntersecting;
      escena.p = -1;
    }
    despertar();
  }, { rootMargin: '25% 0px 25% 0px' });

  return {
    registrar(el, { modo = 'vista', alActualizar } = {}) {
      const escena = { el, modo, alActualizar, top: 0, alto: 0, p: -1, visible: false };
      escenas.push(escena);
      observador.observe(el);
      medir();
      return escena;
    },
    iniciar() {
      window.addEventListener('scroll', despertar, { passive: true });
      window.addEventListener('resize', medirEnFotograma, { passive: true });
      window.addEventListener('load', medirEnFotograma, { once: true });
      document.fonts?.ready.then(medirEnFotograma);
      new ResizeObserver(medirEnFotograma).observe(document.body);
      medir();
    },
    medir,
  };
}
```

- [ ] **Paso 2: Reescribir `portada.js`**

```js
// @archivo: public/js/portada.js
/**
 * Portada: orquesta las escenas y la mira.
 *
 * Sin movimiento (preferencia del sistema o navegador sin soporte) no se añade
 * `.portada-motor` y la página queda estática y completa. La mira se monta
 * siempre que haya puntero fino.
 */
import { sinMovimiento } from './movimiento.js';
import {
  crearMotor, easeOutCubic, digitosDe, entradaPanel, fase, lucesEncendidas,
} from './portada-motor.js';

const raiz = document.documentElement;
const reducir = sinMovimiento();
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/** Lo único que la mira reconoce como objetivo: lo que se puede pulsar. */
const CLICABLES = 'a, button, input, select, textarea, label, summary, [role="tab"]';

// ---------------------------------------------------------------------------
// Mira del puntero
// ---------------------------------------------------------------------------

function montarMira() {
  if (reducir || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

  document.body.classList.add('mira-activa');
  const mira = document.createElement('span');
  mira.className = 'entrada__mira';
  mira.setAttribute('aria-hidden', 'true');
  const segmento = document.createElement('span');
  segmento.className = 'entrada__mira--segmento';
  const centro = document.createElement('span');
  centro.className = 'entrada__mira-centro';
  mira.append(segmento, centro);
  document.body.append(mira);

  const esObjetivo = (nodo) => nodo?.closest?.(CLICABLES);
  window.addEventListener('pointermove', (evento) => {
    raiz.style.setProperty('--puntero-x', `${evento.clientX}px`);
    raiz.style.setProperty('--puntero-y', `${evento.clientY}px`);
  }, { passive: true });
  window.addEventListener('pointerover', (evento) => {
    raiz.classList.toggle('mira-sobre-objetivo', Boolean(esObjetivo(evento.target)));
  }, { passive: true });
  window.addEventListener('pointerout', (evento) => {
    if (!esObjetivo(evento.relatedTarget)) raiz.classList.remove('mira-sobre-objetivo');
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Progreso de la cabecera cuando no hay motor
// ---------------------------------------------------------------------------

function montarProgresoSimple() {
  let pendiente = false;
  const pintar = () => {
    pendiente = false;
    const maximo = Math.max(raiz.scrollHeight - window.innerHeight, 1);
    raiz.style.setProperty('--scroll', Math.min(1, window.scrollY / maximo).toFixed(4));
  };
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };
  pintar();
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', programar, { passive: true });
}

// ---------------------------------------------------------------------------
// Salida: semáforo y titular
// ---------------------------------------------------------------------------

function arrancarSalida() {
  let repetida = false;
  try {
    repetida = sessionStorage.getItem('portada-salida') === '1';
    sessionStorage.setItem('portada-salida', '1');
  } catch { /* sin almacenamiento: la salida se ve completa */ }
  if (repetida) raiz.classList.add('portada-rapido');

  const listo = () => raiz.classList.add('portada-listos');
  const imagen = $('.portada__cielo img');
  const esperas = [document.fonts?.ready, imagen?.decode?.()].filter(Boolean);
  // Red de seguridad: el titular nunca se queda esperando a un recurso.
  Promise.race([Promise.allSettled(esperas), new Promise((r) => setTimeout(r, 1800))]).then(listo);
}

// ---------------------------------------------------------------------------
// Tablero: luces de cambio y cuentakilómetros
// ---------------------------------------------------------------------------

function pieza(clase, texto) {
  const nodo = document.createElement('span');
  nodo.className = clase;
  nodo.textContent = texto;
  nodo.setAttribute('aria-hidden', 'true');
  return nodo;
}

function armarCifras() {
  return $$('.cifra__num[data-cifra]').map((el) => {
    const lectura = document.createElement('span');
    lectura.className = 'portada__lectura';
    lectura.textContent = el.textContent.trim();
    const ruedas = digitosDe(el.dataset.cifra).map((digito) => {
      const rueda = document.createElement('span');
      rueda.className = 'rueda';
      rueda.setAttribute('aria-hidden', 'true');
      const tira = document.createElement('span');
      tira.className = 'rueda__tira';
      tira.style.setProperty('--d', String(digito));
      for (let n = 0; n < 10; n++) {
        const numero = document.createElement('i');
        numero.textContent = String(n);
        tira.append(numero);
      }
      rueda.append(tira);
      return rueda;
    });
    const partes = [];
    if (el.dataset.prefijo) partes.push(pieza('cifra__afijo cifra__afijo--pre', el.dataset.prefijo));
    partes.push(...ruedas);
    if (el.dataset.sufijo) partes.push(pieza('cifra__afijo cifra__afijo--suf', el.dataset.sufijo));
    el.replaceChildren(lectura, ...partes);
    return el;
  });
}

function montarTablero(motor) {
  const seccion = $('[data-escena="tablero"]');
  if (!seccion) return;
  const cifras = armarCifras();
  const luces = $$('.portada__luces span', seccion);
  let encendidas = -1;
  motor.registrar(seccion, {
    modo: 'vista',
    alActualizar: (p) => {
      const n = lucesEncendidas(fase(p, 0.22, 0.7), luces.length);
      if (n !== encendidas) {
        luces.forEach((luz, i) => luz.classList.toggle('on', i < n));
        encendidas = n;
      }
      cifras.forEach((cifra, i) => {
        cifra.style.setProperty('--rueda', easeOutCubic(fase(p, 0.18 + i * 0.1, 0.62 + i * 0.1)).toFixed(3));
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Recta: recorrido horizontal fijo (≥ 900 px) o apilado con revelado
// ---------------------------------------------------------------------------

function montarRecta(motor) {
  const seccion = $('[data-escena="recta"]');
  const riel = seccion && $('.portada__riel', seccion);
  if (!riel) return;
  const paneles = $$('.portada__panel', riel);
  const fija = window.matchMedia('(min-width: 900px) and (min-height: 560px)');
  let recorrido = 0;
  let izquierdas = [];

  // Las fotos del riel están lejos de la pantalla: se cargan ya para que no
  // lleguen en blanco.
  const cargarTodo = () => $$('img', riel).forEach((img) => { img.loading = 'eager'; });
  if (document.readyState === 'complete') cargarTodo();
  else window.addEventListener('load', cargarTodo, { once: true });

  const ajustar = () => {
    raiz.classList.toggle('portada-fija', fija.matches);
    if (fija.matches) {
      recorrido = Math.max(0, riel.scrollWidth - window.innerWidth);
      izquierdas = paneles.map((panel) => panel.offsetLeft);
      seccion.style.setProperty('--recorrido', String(recorrido));
      seccion.style.setProperty('--alto-recta', `${Math.round(recorrido + window.innerHeight)}px`);
    } else {
      seccion.style.removeProperty('--recorrido');
      seccion.style.removeProperty('--alto-recta');
    }
    motor.medir();
  };

  motor.registrar(seccion, {
    modo: 'fija',
    alActualizar: (p, { ancho }) => {
      if (!fija.matches) return;
      const x = p * recorrido;
      paneles.forEach((panel, i) => {
        panel.style.setProperty('--q', entradaPanel(izquierdas[i] - x, ancho).toFixed(3));
      });
    },
  });
  fija.addEventListener('change', ajustar);
  new ResizeObserver(ajustar).observe(riel);
  ajustar();

  // Apilado: cada foto se descubre al llegar.
  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      entrada.target.classList.add('visto');
      observador.unobserve(entrada.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
  paneles.forEach((panel) => observador.observe(panel));
  setTimeout(() => paneles.forEach((panel) => panel.classList.add('visto')), 8000);
}

// ---------------------------------------------------------------------------
// Boxes: la bandera cruza y el panel entra frenando
// ---------------------------------------------------------------------------

function montarBoxes(motor) {
  const seccion = $('[data-escena="boxes"]');
  if (!seccion) return;
  motor.registrar(seccion, {
    modo: 'vista',
    alActualizar: (p) => {
      seccion.style.setProperty('--cruce', fase(p, 0.04, 0.5).toFixed(3));
      seccion.style.setProperty('--entra', easeOutCubic(fase(p, 0.2, 0.62)).toFixed(3));
    },
  });
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

montarMira();

if (reducir || typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') {
  montarProgresoSimple();
} else {
  raiz.classList.add('portada-motor');
  const motor = crearMotor();
  const salida = $('[data-escena="salida"]');
  if (salida) motor.registrar(salida, { modo: 'fija' });
  montarTablero(motor);
  montarRecta(motor);
  montarBoxes(motor);
  motor.iniciar();
  arrancarSalida();
}
```

- [ ] **Paso 3: Escribir ambos archivos desde el plan**

```bash
cd "/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets"
node "$SP/extraer-del-plan.mjs" 5
node --test tests/portada-motor.test.js 2>&1 | tail -6
node --check public/js/portada.js && node --check public/js/portada-motor.js && echo "sintaxis ok"
```
Esperado: 11 pruebas del motor siguen pasando y `sintaxis ok`.

- [ ] **Paso 4: Comprobar en el navegador que el motor publica las variables**

```bash
cat > "$SP/qa/motor.mjs" <<'EOF'
import { chromium } from '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/public';
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const s = http.createServer((req, res) => { const f = path.join(RAIZ, new URL(req.url, 'http://x').pathname === '/' ? 'index.html' : new URL(req.url, 'http://x').pathname); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); }).listen(8768);
const nav = await chromium.launch();
const p = await nav.newPage({ viewport: { width: 1440, height: 900 } });
const errores = []; p.on('pageerror', (e) => errores.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
await p.goto('http://localhost:8768/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
const antes = await p.evaluate(() => ({ motor: document.documentElement.classList.contains('portada-motor'), fija: document.documentElement.classList.contains('portada-fija'), listos: document.documentElement.classList.contains('portada-listos'), altoRecta: document.querySelector('[data-escena=recta]').style.getPropertyValue('--alto-recta'), ruedas: document.querySelectorAll('.rueda').length }));
await p.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
await p.waitForTimeout(900);
const despues = await p.evaluate(() => ({ p: document.querySelector('[data-escena=salida]').style.getPropertyValue('--p'), scroll: getComputedStyle(document.documentElement).getPropertyValue('--scroll'), vel: getComputedStyle(document.documentElement).getPropertyValue('--vel') }));
console.log(JSON.stringify({ antes, despues, errores }));
await nav.close(); s.close();
EOF
node "$SP/qa/motor.mjs"
```
Esperado: `motor: true`, `fija: true`, `listos: true`, `altoRecta` con un valor en píxeles, `ruedas: 6` (3+2+1), `despues.p` distinto de `0`, `scroll` > 0, `errores: []`.

- [ ] **Paso 5: Commit**

```bash
git add public/js/portada-motor.js public/js/portada.js
git commit -m "feat: add scroll engine and landing orchestration" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 6: Movimiento de la salida (semáforo, titular, cámara, estela)

**Archivos:** Modificar `public/css/portada.css` (añadir al final).

**Interfaces — consume:** `--p` de la escena `salida` (la fija `portada.js`), `--vel`, `--vel-abs`, `--scroll-px` de `<html>`, clases `portada-motor` / `portada-listos` / `portada-rapido`.

- [ ] **Paso 1: CSS de la salida**

```css
/* @añadir: public/css/portada.css */

/* ==========================================================================
   Movimiento: salida
   ========================================================================== */
.portada-motor .portada__salida { height: 200svh; }
.portada-motor .portada__salida-marco { position: sticky; top: 0; height: 100svh; min-height: 0; }

/* La cámara avanza hacia el punto de fuga. */
.portada-motor .portada__cielo img {
  transform-origin: 60% 45%;
  transform: scale(calc(1.04 + var(--p, 0) * .42)) translate3d(calc(var(--p, 0) * -2.5%), calc(var(--p, 0) * 3%), 0);
  will-change: transform;
}

/* Titular: sale hacia arriba y se inclina con la velocidad del scroll. */
.portada-motor .portada__salida-copy {
  transform-origin: 0 100%;
  transform: translate3d(0, calc(var(--p, 0) * -16svh), 0) skewY(calc(var(--vel, 0) * -4deg));
  opacity: calc(1 - var(--p, 0) * 1.8);
  will-change: transform, opacity;
}

/* Luces fuera: el titular entra de golpe, línea por línea, con máscara. */
.portada-motor .portada__linea > span { transform: translate3d(0, 112%, 0) skewX(-8deg); }
.portada__linea:nth-child(2) { --i: 1; }
.portada-listos .portada__linea > span {
  transform: translate3d(0, 0, 0) skewX(-8deg);
  transition: transform 900ms var(--salida);
  transition-delay: calc(var(--espera, 1250ms) + var(--i, 0) * 110ms);
}
.portada-rapido { --espera: 0ms; }

.portada-motor .portada__kicker,
.portada-motor .portada__lema,
.portada-motor .portada__acciones { opacity: 0; transform: translate3d(0, 18px, 0); }
.portada-listos .portada__kicker,
.portada-listos .portada__lema,
.portada-listos .portada__acciones {
  opacity: 1;
  transform: none;
  transition: opacity 700ms var(--salida), transform 700ms var(--salida);
  transition-delay: calc(var(--espera, 1250ms) + 350ms);
}

/* El auto sale disparado hacia un lado al hacer scroll. */
.portada-motor .portada__auto {
  transform: translate3d(calc(var(--p, 0) * 22vw), calc(var(--p, 0) * -14vh), 0) rotate(calc(var(--p, 0) * 5deg));
  opacity: calc(1 - var(--p, 0) * 1.6);
  will-change: transform, opacity;
}
.portada-motor .portada__auto img { clip-path: inset(0 0 0 100%); }
.portada-listos .portada__auto img {
  clip-path: inset(0);
  transition: clip-path 1000ms var(--salida) calc(var(--espera, 1250ms) + 150ms);
}

/* Semáforo de salida: cinco luces rojas, todas fuera a la vez. */
.portada-motor .portada__semaforo {
  position: absolute;
  top: calc(var(--altura-cabecera) + 5svh);
  left: 50%;
  z-index: 3;
  display: flex;
  gap: clamp(10px, 1.6vw, 22px);
  padding: 12px 20px;
  translate: -50% 0;
  border: 1px solid var(--borde);
  border-radius: 999px;
  background: rgba(5, 7, 6, .72);
  opacity: 0;
  pointer-events: none;
}
.portada-motor .portada__luz {
  width: clamp(16px, 2.3vw, 30px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: #1a0d0c;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .06);
}
.portada__luz:nth-child(2) { --i: 1; }
.portada__luz:nth-child(3) { --i: 2; }
.portada__luz:nth-child(4) { --i: 3; }
.portada__luz:nth-child(5) { --i: 4; }
.portada-listos .portada__semaforo { animation: semaforo 1.45s linear forwards; }
.portada-listos .portada__luz { animation: luz-roja .01s linear forwards; animation-delay: calc(var(--i, 0) * 160ms + 120ms); }
.portada-rapido .portada__semaforo { display: none; }
@keyframes semaforo { 0% { opacity: 0; } 8%, 84% { opacity: 1; } 100% { opacity: 0; } }
@keyframes luz-roja { to { background: var(--rojo); box-shadow: 0 0 22px 4px rgba(226, 58, 50, .7); } }

/* Estela: rayas en los bordes, visibles solo cuando el scroll va rápido. */
.portada__estela { display: none; }
.portada-motor .portada__estela {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: block;
  overflow: hidden;
  pointer-events: none;
  opacity: calc(var(--vel-abs, 0) * .9);
  -webkit-mask-image: linear-gradient(90deg, #000 0, transparent 16%, transparent 84%, #000 100%);
  mask-image: linear-gradient(90deg, #000 0, transparent 16%, transparent 84%, #000 100%);
}
.portada-motor .portada__estela::before {
  content: '';
  position: absolute;
  inset: -640px 0 0;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='640'%3E%3Cg fill='white'%3E%3Crect x='10' y='30' width='1' height='170' opacity='.5'/%3E%3Crect x='34' y='300' width='1' height='90' opacity='.3'/%3E%3Crect x='58' y='120' width='2' height='240' opacity='.4'/%3E%3Crect x='96' y='480' width='1' height='130' opacity='.3'/%3E%3Crect x='128' y='60' width='1' height='110' opacity='.35'/%3E%3Crect x='160' y='380' width='2' height='200' opacity='.45'/%3E%3Crect x='190' y='210' width='1' height='150' opacity='.3'/%3E%3Crect x='208' y='540' width='1' height='80' opacity='.4'/%3E%3C/g%3E%3C/svg%3E") 0 0 / 220px 640px;
  transform: translate3d(0, mod(var(--scroll-px, 0) * -2.2px, 640px), 0);
}

/* Los titulares de sección se inclinan con la velocidad. */
.portada-motor .portada__recta-cabeza h2 { transform-origin: 0 100%; transform: skewY(calc(var(--vel, 0) * -3deg)); }
```

- [ ] **Paso 2: Escribir, capturar y revisar**

```bash
node "$SP/extraer-del-plan.mjs" 6
node "$SP/qa/harness.mjs" mov-salida 1440 900
```
Abre `mov-salida-1440/salida-0350.png`, `salida-0900.png`, `salida-1500.png`, `salida-2600.png` y `scroll-01.png`, `scroll-02.png`, `scroll-03.png`. Comprueba: (a) a los 350 ms hay luces rojas encendiéndose y el titular aún no está; (b) a los 900 ms hay 4–5 luces; (c) a los 1500 ms el semáforo ya no está y el titular entra; (d) a los 2600 ms el hero está completo, con el auto dentro y el panorama a brillo pleno; (e) en `scroll-01..03` el panorama se acerca y titular y auto salen. Ajusta números (escala, tiempos, `transform-origin` del panorama para que apunte al fondo de la pista) hasta que se vea bien.

- [ ] **Paso 3: Commit**

```bash
git add public/css/portada.css
git commit -m "feat: add start-lights sequence, camera push and speed streaks" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 7: Movimiento del tablero (luces de cambio y cuentakilómetros)

**Archivos:** Modificar `public/css/portada.css`.

**Interfaces — consume:** clase `.on` en `.portada__luces span` y `--rueda` en `.cifra__num` (los escribe `montarTablero`), `--d` en `.rueda__tira`.

- [ ] **Paso 1: CSS del tablero**

```css
/* @añadir: public/css/portada.css */

/* ==========================================================================
   Movimiento: tablero
   ========================================================================== */
.portada-motor .portada__luces span { transition: background-color 120ms, box-shadow 120ms; }
.portada-motor .portada__luces span:not(.on) { background: rgba(217, 230, 222, .1); box-shadow: none; }
/* Sin dato todavía, la rueda enseña el valor final: nunca una cifra falsa. */
.portada-motor .rueda__tira { transform: translate3d(0, calc(var(--rueda, 1) * var(--d, 0) * -10%), 0); will-change: transform; }
.portada-motor .cifra__num { transform-origin: 0 100%; transform: skewY(calc(var(--vel, 0) * -3deg)); }
```

- [ ] **Paso 2: Escribir, capturar y revisar**

```bash
node "$SP/extraer-del-plan.mjs" 7
node "$SP/qa/harness.mjs" mov-tablero 1440 900
```
Abre las capturas donde aparece el tablero (`scroll-04..08`, según la altura). Comprueba: las luces se van encendiendo de izquierda a derecha (verde y las últimas rojas), las tres cifras terminan en «400 m²», «1/10», «7 días» y a mitad de recorrido se ven ruedas a medio girar (no cifras falsas fijas). Repite en 390 px.

- [ ] **Paso 3: Commit**

```bash
git add public/css/portada.css
git commit -m "feat: add shift lights and odometer digits to the stats board" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 8: Movimiento de la recta (recorrido horizontal fijo y apilado)

**Archivos:** Modificar `public/css/portada.css`.

**Interfaces — consume:** `<html>.portada-fija` (lo alterna `montarRecta` a partir de `(min-width: 900px) and (min-height: 560px)`), `--p`, `--recorrido`, `--alto-recta` en la escena, `--q` en cada panel, `.visto` en paneles apilados.

- [ ] **Paso 1: CSS de la recta**

```css
/* @añadir: public/css/portada.css */

/* ==========================================================================
   Movimiento: recta
   ========================================================================== */
.portada__panel picture { display: contents; }

/* Horizontal fija: el scroll vertical recorre el riel de lado a lado. */
.portada-fija .portada__recta { height: var(--alto-recta, 400svh); padding: 0; }
.portada-fija .portada__recta-marco {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100svh;
  padding-bottom: clamp(36px, 7svh, 84px);
  overflow: hidden;
}
.portada-fija .portada__recta-cabeza { position: absolute; top: calc(var(--altura-cabecera) + 3svh); left: 0; right: 0; margin: 0; }
.portada-fija .portada__recta-cabeza h2 { font-size: clamp(3rem, min(9.5vw, 15svh), 9.5rem); }
.portada-fija .portada__riel {
  --alto-panel: min(54svh, 600px);
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: clamp(28px, 3vw, 56px);
  width: max-content;
  transform: translate3d(calc(var(--p, 0) * var(--recorrido, 0) * -1px), 0, 0);
  will-change: transform;
}
.portada-fija .portada__panel {
  flex: none;
  height: var(--alto-panel);
  /* Corte diagonal de chicane: el panel se descubre según cuánto ha entrado. */
  clip-path: polygon(calc((1 - var(--q, 1)) * 100%) 0, 100% 0, 100% 100%, calc((1 - var(--q, 1)) * 100% - 14%) 100%);
}
.portada-fija .portada__panel img {
  width: auto;
  height: 100%;
  max-width: none;
  transform: translate3d(calc((.5 - var(--p, 0)) * 7%), 0, 0) scale(1.08);
}
.portada-fija .portada__panel--texto {
  align-self: center;
  width: clamp(280px, 26vw, 420px);
  height: auto;
  clip-path: none;
  opacity: calc(.2 + var(--q, 1) * .8);
}

/* Bordillo rojo y blanco pegado al suelo: corre al ritmo del riel. */
.portada-fija .portada__bordillo { position: absolute; inset: auto 0 0; display: block; height: 10px; overflow: hidden; }
.portada-fija .portada__bordillo::before {
  content: '';
  position: absolute;
  inset: 0 0 0 -96px;
  background: repeating-linear-gradient(90deg, var(--rojo) 0 48px, #f2f2f2 48px 96px);
  transform: translate3d(mod(var(--p, 0) * var(--recorrido, 0) * -1px, 96px), 0, 0);
}

/* Apilado (pantallas pequeñas): cada foto se descubre al llegar. */
.portada-motor:not(.portada-fija) .portada__panel:not(.visto) { clip-path: inset(0 0 100% 0); }
.portada-motor:not(.portada-fija) .portada__panel.visto { clip-path: inset(0); transition: clip-path 900ms var(--salida); }
```

- [ ] **Paso 2: Escribir, capturar y revisar (escritorio y móvil)**

```bash
node "$SP/extraer-del-plan.mjs" 8
node "$SP/qa/harness.mjs" mov-recta 1440 900
node "$SP/qa/harness.mjs" mov-recta 390 844
```
En escritorio, abre las capturas del tramo de la recta (`scroll-08..17`): el riel debe desplazarse de lado a lado con el scroll, los paneles entrar con corte diagonal, el título «La pista.» fijo arriba sin tapar las fotos, el bordillo rojo y blanco abajo, y el texto «A tu ritmo.» legible. Comprueba que el primer panel no arranca recortado y que el último termina completo antes de soltarse la sección. En 390 px las fotos van apiladas y todas terminan visibles (`desborde: 0`).

- [ ] **Paso 3: Commit**

```bash
git add public/css/portada.css
git commit -m "feat: add pinned horizontal track run with chicane wipes" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 9: Movimiento de boxes (bandera a cuadros y entrada del panel)

**Archivos:** Modificar `public/css/portada.css`.

**Interfaces — consume:** `--cruce` y `--entra` en la escena `boxes` (los escribe `montarBoxes`).

- [ ] **Paso 1: CSS de boxes**

```css
/* @añadir: public/css/portada.css */

/* ==========================================================================
   Movimiento: boxes
   ========================================================================== */
.portada-motor .portada__bandera {
  position: absolute;
  top: clamp(24px, 4vw, 56px);
  left: 0;
  right: 0;
  z-index: 3;
  display: block;
  height: 96px;
  overflow: hidden;
  pointer-events: none;
}
.portada-motor .portada__bandera::before {
  content: '';
  position: absolute;
  inset: 0;
  background: conic-gradient(#f5f5f5 25%, #050706 0 50%, #f5f5f5 0 75%, #050706 0) 0 0 / 96px 96px;
  transform: translate3d(calc(-110% + var(--cruce, 0) * 220%), 0, 0) skewX(-16deg);
}
/* El panel entra frenando, como un auto que llega a boxes. */
.portada-motor .entrada__acceso-panel {
  transform: translate3d(calc((1 - var(--entra, 1)) * 14vw), 0, 0) skewX(calc((1 - var(--entra, 1)) * -10deg));
  opacity: calc(.15 + var(--entra, 1) * .85);
  will-change: transform, opacity;
}
.portada-motor .portada__intro h2 {
  transform-origin: 0 100%;
  transform: translate3d(calc((1 - var(--entra, 1)) * -8vw), 0, 0) skewY(calc(var(--vel, 0) * -3deg));
}
```

- [ ] **Paso 2: Escribir, capturar y revisar**

```bash
node "$SP/extraer-del-plan.mjs" 9
node "$SP/qa/harness.mjs" mov-boxes 1440 900
node "$SP/qa/harness.mjs" mov-boxes 390 844
```
Abre las últimas capturas (`scroll-18..24`). Comprueba: la bandera a cuadros cruza la pantalla, el panel entra desde la derecha y termina alineado sin desplazamiento residual, el formulario es usable y no queda semitransparente al final. Mueve `fase(p, .04, .5)` y `fase(p, .2, .62)` en `montarBoxes` si la bandera o el panel llegan demasiado pronto o tarde.

- [ ] **Paso 3: Commit**

```bash
git add public/css/portada.css public/js/portada.js
git commit -m "feat: add checkered flag crossing and pit-entry panel" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 10: Pruebas de contrato de la portada

Fijan los invariantes del diseño (no nombres de clase heredados): hover solo en lo clicable, mira intacta, movimiento reducido, cabecera fija, copy, imágenes y rutas.

**Archivos:** Crear `tests/portada.test.js`.

- [ ] **Paso 1: Escribir las pruebas**

```js
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
  assert.doesNotMatch(CSS, /\.portada__estela\s*\{[^}]*display:\s*block/, 'la estela solo existe con motor');
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
```

- [ ] **Paso 2: Ejecutar**

```bash
node --test tests/portada.test.js 2>&1 | tail -25
```
Esperado: `# fail 0`. Si una prueba falla por un fallo real del CSS/JS/HTML, corrige el código (no la prueba); si falla por una redacción demasiado estricta de la propia prueba, ajústala solo con una razón concreta.

- [ ] **Paso 3: Comprobar que la prueba de hover detecta el error que debe detectar**

Añade temporalmente `.portada__panel:hover { opacity: .5; }` al final de `portada.css`, ejecuta `node --test tests/portada.test.js 2>&1 | grep -A3 "solo lo clicable"` y comprueba que falla nombrando ese selector. Quita la línea temporal y confirma que vuelve a pasar.

- [ ] **Paso 4: Suite completa**

```bash
npm test 2>&1 | tail -12
```
Esperado: `# fail 0`.

- [ ] **Paso 5: Commit**

```bash
git add tests/portada.test.js
git commit -m "test: lock landing contract (clickable-only hover, mira, reduced motion)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Tarea 11: Verificación final y pulido hasta que quede sobresaliente

No se pasa a la Tarea 12 hasta que **todos** los criterios de aceptación se cumplan. Cada ronda de arreglos se commitea (`fix:`/`style:`) y se repite el arnés.

**Archivos:** los que hagan falta en `public/css/portada.css`, `public/js/portada.js`, `public/index.html`.

- [ ] **Paso 1: Auditoría automática de hover y mira en el navegador**

```bash
cat > "$SP/qa/hover.mjs" <<'EOF'
import { chromium } from '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/public';
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const s = http.createServer((req, res) => { const n = new URL(req.url, 'http://x').pathname; const f = path.join(RAIZ, n === '/' ? 'index.html' : n); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); }).listen(8769);
const nav = await chromium.launch();
const p = await nav.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8769/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(2600);
const estilo = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return [c.transform, c.filter, c.opacity, c.boxShadow, c.backgroundColor, c.color, c.borderColor].join('|'); }, sel);
const resultados = { inertes: [], clicables: [] };
async function mover(sel) {
  await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
  await p.waitForTimeout(900);
  const antes = await estilo(sel);
  await p.hover(sel, { force: true });
  await p.waitForTimeout(500);
  const despues = await estilo(sel);
  const mira = await p.evaluate(() => document.documentElement.classList.contains('mira-sobre-objetivo'));
  await p.mouse.move(2, 2);
  return { sel, cambia: antes !== despues, mira };
}
for (const sel of ['.portada__auto img', '.portada__cifras .cifra', '.portada__panel--ancho img', '.portada__datos li', '.entrada__acceso-panel', '.portada__salida h1']) resultados.inertes.push(await mover(sel));
for (const sel of ['.entrada__accion', '.portada__acciones .boton--principal', '.portada__enlace', '#pestana-registro']) resultados.clicables.push(await mover(sel));
console.log(JSON.stringify(resultados, null, 1));
const malos = resultados.inertes.filter((r) => r.cambia || r.mira);
const flojos = resultados.clicables.filter((r) => !r.cambia && !r.mira);
console.log(malos.length || flojos.length ? `FALLO inertes=${JSON.stringify(malos)} clicablesSinRespuesta=${JSON.stringify(flojos)}` : 'OK: solo lo clicable reacciona');
await nav.close(); s.close();
EOF
node "$SP/qa/hover.mjs" | tail -4
```
Esperado: `OK: solo lo clicable reacciona`. Si un elemento inerte cambia, busca qué regla de `styles.css` compartido lo afecta (por ejemplo un `:hover` genérico) y anúlala solo dentro de `.pagina-entrada` en `portada.css`.

- [ ] **Paso 2: Movimiento reducido**

```bash
cat > "$SP/qa/reducido.mjs" <<'EOF'
import { chromium } from '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = '/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets/public';
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const s = http.createServer((req, res) => { const n = new URL(req.url, 'http://x').pathname; const f = path.join(RAIZ, n === '/' ? 'index.html' : n); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); }).listen(8770);
const nav = await chromium.launch();
const p = await nav.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await p.goto('http://localhost:8770/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const visible = (sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && c.opacity === '1' && c.visibility === 'visible'; };
  return {
    motor: document.documentElement.classList.contains('portada-motor'),
    h1: visible('#titulo-entrada'), lema: visible('.portada__lema'), auto: visible('.portada__auto img'),
    cifras: [...document.querySelectorAll('.cifra__num')].map((e) => e.textContent.trim()),
    paneles: [...document.querySelectorAll('.portada__panel')].every((e) => { const c = getComputedStyle(e); return c.clipPath === 'none' && c.opacity === '1'; }),
    panelAcceso: visible('.entrada__acceso-panel'),
    desborde: document.documentElement.scrollWidth - innerWidth,
  };
});
console.log(JSON.stringify(r));
await p.screenshot({ path: process.env.SP + '/qa/reducido-1440.png', fullPage: true });
await nav.close(); s.close();
EOF
node "$SP/qa/reducido.mjs"
```
Esperado: `motor: false`, `h1/lema/auto/paneles/panelAcceso: true`, cifras `["400 m²","1/10","7 días"]`, `desborde: 0`. Abre `reducido-1440.png` y comprueba que la página completa se ve ordenada.

- [ ] **Paso 3: Movimiento en cada tramo (cada gesto de scroll mueve algo)**

Compara capturas consecutivas de `qa/mov-boxes-1440` (la última ejecución, ya con todas las escenas):

```bash
cd "$SP/qa/mov-boxes-1440"
for i in $(seq 0 23); do a=$(printf "scroll-%02d.png" $i); b=$(printf "scroll-%02d.png" $((i+1))); r=$(magick compare -metric RMSE "$a" "$b" null: 2>&1 | sed -E 's/.*\(([0-9.e-]+)\).*/\1/'); echo "$i->$((i+1)) $r"; done
cd - >/dev/null
```
Criterio: ningún par por debajo de `0.01` (RMSE normalizado); un par casi idéntico significa un tramo de scroll sin movimiento visible. Para los tramos flojos, refuerza el movimiento de esa escena (más recorrido de parallax, más fase de la animación) y repite. Como referencia, ejecuta lo mismo en `qa/antes-1440` para ver cuánto ha mejorado.

- [ ] **Paso 4: Rendimiento y errores**

```bash
for f in mov-boxes-1440 mov-boxes-390 antes-1440 antes-390; do echo "$f: $(python3 -c "import json;d=json.load(open('$SP/qa/$f/resumen.json'));print(d['rendimiento'],'desborde',d['desborde'],'errores',d['errores'])")"; done
```
Criterios: `errores: []` y `desborde: 0` en ambos anchos; `p95` y `largos` no peores que un 25 % frente a `antes` (el arnés corre sin GPU, así que valen como comparación, no en absoluto). Si empeoran mucho, busca la causa (por ejemplo `backdrop-filter` del panel de acceso en movimiento: quítalo en `.portada-motor .entrada__acceso-panel` si es lo que cuesta).

- [ ] **Paso 5: Pruebas e2e de interfaz y flujos de acceso**

```bash
ls node_modules/playwright >/dev/null 2>&1 && echo "playwright enlazado" || echo "ENLAZAR playwright desde LDU_auto (ver memoria e2e-playwright-local)"
npm run test:ui 2>&1 | tail -20
npm run test:e2e 2>&1 | tail -20
```
Esperado: pasan (en especial «el selector de acceso es simétrico y legible» y el flujo de entrada). Si falla por falta de Chromium, usa `CHROMIUM_PATH` como indica la memoria del proyecto. No atribuyas a esta rama un fallo que ya exista en `main` sin compararlo.

- [ ] **Paso 6: Construcción de GitHub Pages**

```bash
node scripts/preparar-pages.js && grep -o 'href="[^"]*portada.css"\|src="[^"]*portada.js"' _site/index.html
```
Esperado: rutas relativas (`css/portada.css`, `js/portada.js`), no `/css/...`. Si salen absolutas, ajusta `scripts/preparar-pages.js` para que las reescriba igual que `styles.css`. Comprueba además que `_site/css/portada.css` no contiene `url(/`.

- [ ] **Paso 7: Revisión visual completa contra los criterios de aceptación**

Con las capturas de la última ejecución (`qa/mov-boxes-1440` y `qa/mov-boxes-390`, más `salida-*`), revisa una a una y marca cada criterio con evidencia:

1. Las fotos se ven a brillo y nitidez plenos (sin capas oscuras globales; solo el degradado detrás del texto).
2. El titular, las cifras y el formulario son legibles en todas las capturas.
3. «Ven a» y «rodar.» se leen como dos palabras (no «Vena»).
4. La secuencia de salida se ve completa: luces → luces fuera → titular entra.
5. Cada tramo del scroll mueve algo (Paso 3).
6. La recta horizontal no recorta el primer ni el último panel y el título no tapa las fotos.
7. La bandera cruza y el panel de acceso termina alineado y opaco.
8. Solo lo clicable reacciona al hover (Paso 1); la mira igual que antes y solo se agranda sobre clicables.
9. Móvil 390 px: sin desborde horizontal, sin solapes (auto del hero vs. titular), fotos apiladas con revelado.
10. Movimiento reducido: página completa y ordenada (Paso 2).
11. Nada de detalle innecesario ni texto de relleno; la página se siente minimalista.

Si algún criterio falla, corrige, repite el arnés y revisa de nuevo. Cuando todos pasen:

- [ ] **Paso 8: Commit de lo que haya cambiado en el pulido**

```bash
git add -A public tests
git status --short
git commit -m "style: polish landing motion after full visual review" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(Si no hubo cambios, no hay commit.)

---

### Tarea 12: Pull request, CI y merge

Solo se ejecuta si la Tarea 11 cerró con todos los criterios cumplidos.

- [ ] **Paso 1: Suite completa una última vez y limpieza**

```bash
cd "/Users/danilomonge/Desktop/Own Projects/miniapolis-tickets"
npm test 2>&1 | tail -8
git status --short
git log --oneline main..HEAD
```
Esperado: `# fail 0`, árbol limpio, la lista de commits de esta rama. Si quedan procesos del arnés, `pkill -f "harness.mjs"` (los servidores se cierran solos al terminar cada script).

- [ ] **Paso 2: Publicar la rama y abrir el PR**

```bash
git push -u origin codex/immersive-racing-rebuild
gh pr create --base main --head codex/immersive-racing-rebuild \
  --title "Portada inmersiva: el scroll es una vuelta al circuito" \
  --body "$(cat <<'EOF'
## Qué cambia
- Portada rehecha como una vuelta al circuito: semáforo de salida, cámara que avanza, tablero con luces de cambio y cuentakilómetros, recorrido horizontal de la pista, bandera a cuadros y entrada a boxes.
- Motor de scroll propio (`portada-motor.js`, sin dependencias, sin secuestrar el scroll nativo).
- Solo lo clicable tiene hover; la mira conserva su apariencia y ahora solo reacciona a lo clicable.
- Fotos a máxima calidad (panorama de 974 KB restaurado) y sin capas oscuras globales.
- CSS de la portada extraído de `styles.css` a `portada.css`; comprobado con capturas idénticas de las páginas que no cambian.
- Movimiento reducido: página estática y completa.

## Verificación
- `npm test`, `test:ui`, `test:e2e` en verde; capturas en 1440×900 y 390×844 revisadas contra los criterios del spec.

Spec: `docs/superpowers/specs/2026-09-21-portada-carrera-inmersiva-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Paso 3: Esperar al CI**

```bash
gh pr checks --watch
```
Esperado: todos los checks en verde. Si falla alguno, lee el log (`gh run view --log-failed`), corrige en la rama, empuja y vuelve a esperar. No se hace merge con el CI en rojo.

- [ ] **Paso 4: Merge**

```bash
gh pr merge --merge --delete-branch=false
git checkout main && git pull --ff-only
git log --oneline -3
```
Esperado: el merge aparece en `main`. Comprueba que el flujo «Actualizar GitHub Pages» arrancó (`gh run list --workflow "Actualizar GitHub Pages" --limit 1`).

- [ ] **Paso 5: Cierre**

Informa al usuario de: el enlace del PR, el resultado del CI, los criterios verificados y cualquier limitación real (por ejemplo, que las mediciones de rendimiento se hicieron sin GPU). Si el usuario lo pide, borra la rama remota.


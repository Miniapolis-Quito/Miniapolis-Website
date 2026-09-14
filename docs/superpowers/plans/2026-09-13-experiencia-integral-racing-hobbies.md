# Experiencia integral de Racing Hobbies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar todas las pantallas del sistema de entradas bajo la identidad oficial futurista, limpia y operativa de Racing Hobbies.

**Architecture:** La identidad se centraliza en `public/css/styles.css` mediante tokens y componentes compartidos. Las páginas HTML solo añaden una semántica mínima para sus bloques de interfaz; los módulos JavaScript, rutas y contratos de API no cambian. Las pruebas estáticas protegen paleta, recursos y estructura, mientras los flujos existentes validan el comportamiento.

**Tech Stack:** HTML semántico, CSS nativo, JavaScript ES modules, Node test runner y Playwright CLI.

---

### Task 1: Proteger la identidad oficial con una prueba estática

**Files:**
- Modify: `tests/frontend.test.js:164-177`
- Test: `tests/frontend.test.js`

- [ ] **Step 1: Escribir la prueba que falla**

Añadir después de la prueba de lienzo negro:

```js
test('la interfaz centraliza el verde oficial y los recursos de Racing Hobbies', () => {
  const css = leer('public/css/styles.css');
  assert.match(css, /--acento:\s*#3cfe3f;/);
  assert.match(css, /--acento-suave:\s*rgba\(60,\s*254,\s*63,/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const html of Object.keys(PAGINAS)) {
    assert.match(leer(html), /racing-hobbies-logo-oficial\.png/, `${html} debe exhibir el logo oficial`);
  }
});
```

- [ ] **Step 2: Ejecutar para comprobar el rojo**

Run: `node --test tests/frontend.test.js`

Expected: FAIL porque los tokens todavía usan `#3dfe40` y no existe la regla de movimiento reducido.

- [ ] **Step 3: Confirmar después de la implementación**

Run: `node --test tests/frontend.test.js`

Expected: PASS con todas las comprobaciones de estructura y marca.

- [ ] **Step 4: Commit**

```bash
git add tests/frontend.test.js public/css/styles.css
git commit -m "Unifica la paleta oficial de Racing Hobbies"
```

### Task 2: Convertir los componentes compartidos en señalética de pista

**Files:**
- Modify: `public/css/styles.css:21-535`
- Test: `tests/frontend.test.js`

- [ ] **Step 1: Usar los tokens oficiales en la capa raíz**

Reemplazar el grupo de marca con:

```css
--acento: #3cfe3f;
--acento-2: #3cfe3f;
--acento-suave: rgba(60, 254, 63, .14);
--acento-linea: rgba(60, 254, 63, .42);
--panel-profundo: #0a0a0a;
```

Cambiar las apariciones de `rgba(61, 254, 64, ...)` al equivalente `rgba(60, 254, 63, ...)` y conservar verde, amarillo y rojo solamente para estados operativos.

- [ ] **Step 2: Implementar superficie, pit bar y controles técnicos**

Aplicar estas reglas base y sustituir los estilos actuales equivalentes:

```css
body {
  background: #000;
  background-image: linear-gradient(90deg, rgba(60,254,63,.035) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 48px 48px;
}
.barra { border-bottom: 2px solid var(--acento); box-shadow: 0 10px 30px rgba(0,0,0,.52); }
.tarjeta, .pack, dialog { border-radius: 2px; box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 14px 34px rgba(0,0,0,.38); }
.tarjeta::before, .pack::before { content: ''; display: block; width: 34px; height: 2px; margin-bottom: 14px; background: var(--acento); }
.boton { border-radius: 2px; text-transform: uppercase; letter-spacing: .055em; font-size: .82rem; }
.boton--principal { box-shadow: 4px 4px 0 rgba(60,254,63,.2); }
.pestanas { border-radius: 2px; background: #080808; }
.pestana[aria-selected="true"] { color: #000; background: var(--acento); box-shadow: none; }
```

Ensure pseudo-elements do not appear in `.tarjeta` blocks that consist only of a QR or control where the title must remain first: override with `.qr-caja::before, .saldo::before, .resultado::before { content: none; }`.

- [ ] **Step 3: Implementar accesibilidad de movimiento**

Añadir al final de las reglas no impresas:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 4: Ejecutar la prueba de identidad**

Run: `node --test tests/frontend.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/css/styles.css tests/frontend.test.js
git commit -m "Convierte los componentes en señalética de pista"
```

### Task 3: Dar jerarquía Racing a cliente, escáner y administración

**Files:**
- Modify: `public/app.html:20-87`
- Modify: `public/scan.html:21-91`
- Modify: `public/admin.html:20-146`
- Modify: `public/css/styles.css:181-465`
- Test: `tests/frontend.test.js`

- [ ] **Step 1: Escribir las aserciones de estructura que fallan**

Añadir una prueba:

```js
test('las superficies operativas usan etiquetas de pista y no emojis decorativos', () => {
  const app = leer('public/app.html');
  const scan = leer('public/scan.html');
  const admin = leer('public/admin.html');
  assert.match(app, /class="eyebrow">Pase de pista<\//);
  assert.match(scan, /class="eyebrow">Puesto de control<\//);
  assert.match(admin, /class="eyebrow">Race control<\//);
  assert.ok(!/📷|🏁/.test(scan));
});
```

- [ ] **Step 2: Ejecutar para comprobar el rojo**

Run: `node --test tests/frontend.test.js`

Expected: FAIL porque las etiquetas y los marcadores CSS no existen y el escáner conserva emojis.

- [ ] **Step 3: Ajustar el HTML sin modificar identificadores funcionales**

Insertar antes de los `h1` de `app.html`, `scan.html` y `admin.html` respectivamente:

```html
<p class="eyebrow">Pase de pista</p>
<p class="eyebrow">Puesto de control</p>
<p class="eyebrow">Race control</p>
```

En `scan.html`, sustituir los contenidos decorativos por marcadores semánticos:

```html
<div class="vacio__icono vacio__icono--camara" aria-hidden="true"></div>
<div class="resultado__icono resultado__icono--bandera" aria-hidden="true"></div>
```

- [ ] **Step 4: Añadir los estilos específicos**

```css
.eyebrow { margin: 0 0 7px; color: var(--acento); font-size: .72rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.saldo { border-radius: 2px; background: linear-gradient(135deg, #101010 0 72%, rgba(60,254,63,.14) 72%); border-inline-start: 5px solid var(--acento); }
.saldo__numero, .resultado__restantes { font-family: var(--fuente-display); letter-spacing: .015em; }
.qr-caja { border: 7px solid #fff; outline: 2px solid var(--acento); outline-offset: 5px; border-radius: 0; }
.escaner__mira { border-color: var(--acento); border-radius: 0; clip-path: polygon(0 0, 28px 0, 28px 3px, calc(100% - 28px) 3px, calc(100% - 28px) 0, 100% 0, 100% 28px, calc(100% - 3px) 28px, calc(100% - 3px) calc(100% - 28px), 100% calc(100% - 28px), 100% 100%, calc(100% - 28px) 100%, calc(100% - 28px) calc(100% - 3px), 28px calc(100% - 3px), 28px 100%, 0 100%, 0 calc(100% - 28px), 3px calc(100% - 28px), 3px 28px, 0 28px); }
.vacio__icono--camara, .resultado__icono--bandera { width: 48px; height: 34px; margin-inline: auto; border: 2px solid var(--acento); position: relative; }
.vacio__icono--camara::before { content: ''; position: absolute; width: 14px; height: 8px; top: -8px; left: 14px; border: 2px solid var(--acento); border-bottom: 0; }
.resultado__icono--bandera { border-width: 0 0 2px 2px; transform: skewX(-18deg); }
.resultado__icono--bandera::before { content: ''; position: absolute; inset: 0 0 9px 0; background: repeating-linear-gradient(90deg, var(--acento) 0 8px, #000 8px 16px); }
```

- [ ] **Step 5: Ejecutar pruebas estáticas**

Run: `node --test tests/frontend.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.html public/scan.html public/admin.html public/css/styles.css tests/frontend.test.js
git commit -m "Da jerarquía de pista a las superficies operativas"
```

### Task 4: Refinar acceso, 404, tablas, modales y móvil

**Files:**
- Modify: `public/index.html:16-85`
- Modify: `public/404.html:14-24`
- Modify: `public/css/styles.css:435-820`
- Test: `tests/frontend.test.js`

- [ ] **Step 1: Escribir la prueba estructural que falla**

```js
test('acceso y error presentan el mensaje como una salida de pista', () => {
  assert.match(leer('public/index.html'), /class="eyebrow">Acceso de piloto<\//);
  assert.match(leer('public/404.html'), /class="eyebrow">Fuera de trazado<\//);
});
```

- [ ] **Step 2: Ejecutar para comprobar el rojo**

Run: `node --test tests/frontend.test.js`

Expected: FAIL porque ambas pantallas todavía no incluyen sus etiquetas.

- [ ] **Step 3: Añadir las etiquetas sin cambiar el contenido de formularios o enlaces**

Insertar `<p class="eyebrow">Acceso de piloto</p>` inmediatamente antes de `h1` en `index.html`, y `<p class="eyebrow">Fuera de trazado</p>` antes de `h1` en `404.html`.

- [ ] **Step 4: Refinar componentes densos y respuesta móvil**

Añadir reglas que mantengan la lectura y los objetivos táctiles:

```css
.tabla-envoltura { border-radius: 2px; border-top: 2px solid var(--acento); }
thead th { background: #050505; }
tbody tr:hover { background: rgba(60,254,63,.07); }
dialog { border-top: 3px solid var(--acento); border-radius: 2px; }
.brindis { border-inline-start: 3px solid var(--acento); border-radius: 2px; }
.presentacion-pista, .encabezado-pista { border-radius: 2px; }
@media (max-width: 640px) {
  body { background-size: 32px 32px; }
  .barra__interior { min-height: 58px; }
  .marca__sello { width: 88px; }
  .encabezado-pista { min-height: 0; padding: 18px; }
  .tarjeta, .pack { padding: 16px; }
  .tarjeta__titulo { align-items: flex-start; }
  .pestana { padding-inline: 12px; }
}
```

- [ ] **Step 5: Ejecutar la prueba de interfaz**

Run: `node --test tests/frontend.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/404.html public/css/styles.css tests/frontend.test.js
git commit -m "Refina acceso y componentes secundarios Racing"
```

### Task 5: Revisar visualmente y publicar

**Files:**
- Verify: `public/index.html`, `public/app.html`, `public/scan.html`, `public/admin.html`, `public/404.html`
- Verify: `tests/**/*.test.js`, `tests/e2e/interfaz.mjs`

- [ ] **Step 1: Ejecutar la suite funcional completa**

Run: `npm test`

Expected: 165 pruebas correctas y cero fallos.

- [ ] **Step 2: Ejecutar los recorridos de interfaz**

Run: `npm run test:ui`

Expected: 17/17 pasos correctos, sin errores de página o consola.

- [ ] **Step 3: Hacer revisión visual en navegador**

Abrir cada ruta con Playwright, tomar una captura de escritorio y otra en viewport móvil, y comprobar: logotipo oficial legible, verde `#3cfe3f` coherente, foco visible, filas sin desbordes y ningún emoji decorativo en escáner.

- [ ] **Step 4: Publicar y fusionar**

Crear la rama `codex/racing-hobbies-integral`, subirla, abrir una PR contra `main`, comprobar las validaciones y fusionarla usando `gh pr merge --merge --delete-branch`.

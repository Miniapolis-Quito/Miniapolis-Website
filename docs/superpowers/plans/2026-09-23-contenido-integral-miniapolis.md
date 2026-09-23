# Contenido integral de Miniápolis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasladar a `Miniapolis-Website` el contenido completo de la página fuente, manteniendo la portada inmersiva, las imágenes oficiales y la navegación de acceso.

**Architecture:** La portada seguirá siendo una página estática con escenas registradas en el motor existente. Los datos informativos se añadirán como bloques semánticos animables en `index.html`, con reglas locales en `portada.css` y pequeños registros en `portada.js`. La clasificación será una página estática adicional servida por Express y estilizada sobre los tokens compartidos.

**Tech Stack:** HTML semántico, CSS existente con Saira/Sora, módulos ES del navegador, Node `node:test`, Express estático.

**Spec:** `docs/superpowers/specs/2026-09-23-contenido-integral-miniapolis-design.md`

## Global Constraints

- Conservar las escenas actuales `salida`, `tablero`, `recta` y `boxes`.
- Usar solamente imágenes presentes en `public/images` y rutas locales.
- No introducir estilos inline, CDNs ni dependencias frontend nuevas.
- El contenido debe seguir visible si el motor de movimiento se desactiva.
- Toda imagen nueva debe declarar tamaño y texto alternativo.

## Review Focus

- Modo `prefers-reduced-motion`: la información nueva no puede quedar oculta.
- Pantallas pequeñas: las tarjetas deben apilarse sin desbordamiento horizontal.
- Rutas de imágenes: una referencia incorrecta debe fallar la prueba estática.
- Navegación pública: `/posiciones` y los anclajes deben ser alcanzables desde la portada.
- Datos de campeonato: nombres, puntos, fecha y categoría deben conservarse exactamente.

### Task 1: Contrato de contenido y navegación

**Files:**
- Create: `tests/contenido-integral.test.js`
- Modify: `public/index.html`
- Modify: `public/posiciones.html`
- Modify: `src/app.js`

**Interfaces:**
- Produce los anclajes `#complejo`, `#horarios`, `#records`, `#eventos`, `#galeria` y la ruta `/posiciones`.

- [ ] **Step 1: Write the failing test**

  Crear pruebas que lean ambos HTML y comprueben los bloques de copy, datos de posiciones, enlaces y que todas las imágenes locales referenciadas existan.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/contenido-integral.test.js`

  Expected: FAIL porque todavía no existen los nuevos anclajes ni `public/posiciones.html`.

- [ ] **Step 3: Write minimal structural implementation**

  Añadir el esqueleto semántico de los bloques en `index.html`, crear `posiciones.html` con la tabla pública y registrar `app.get('/posiciones', page('posiciones.html'))`.

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/contenido-integral.test.js`

  Expected: PASS con todos los textos y rutas presentes.

- [ ] **Step 5: Commit**

  `git add tests/contenido-integral.test.js public/index.html public/posiciones.html src/app.js && git commit -m "feat: add complete Miniapolis content structure"`

### Task 2: Sistema visual de bloques informativos

**Files:**
- Modify: `public/css/portada.css`
- Create: `public/css/posiciones.css`

**Interfaces:**
- Consume las clases semánticas creadas en Task 1.
- Produce tarjetas, tablas, chips y layouts responsive que usan los tokens existentes.

- [ ] **Step 1: Write the failing test**

  Ampliar `tests/contenido-integral.test.js` para exigir las reglas de los nuevos componentes, la rama de reducción de movimiento y los límites responsive.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/contenido-integral.test.js`

  Expected: FAIL por selectores y media queries inexistentes.

- [ ] **Step 3: Write minimal implementation**

  Añadir al final de `portada.css` el sistema de bloques con tarjetas de datos, grids de disciplinas, horarios, records, eventos, promos y galería; mantener las ocultaciones bajo `.portada-motor` y declarar una salida estática bajo `prefers-reduced-motion`. Añadir estilos de la página de posiciones con tabla responsive.

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/contenido-integral.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add public/css/portada.css public/css/posiciones.css tests/contenido-integral.test.js && git commit -m "feat: style the complete Miniapolis content experience"`

### Task 3: Integración de movimiento y accesibilidad

**Files:**
- Modify: `public/js/portada.js`
- Modify: `public/index.html`

**Interfaces:**
- Consume `data-escena` en `detalle`, `horario`, `records` y `eventos`.
- Reutiliza `crearMotor`, `fase`, `easeOutCubic` e `IntersectionObserver` existentes.

- [ ] **Step 1: Write the failing test**

  Añadir comprobaciones de que cada escena nueva está registrada, que los selectores existen y que el script conserva el fallback sin movimiento.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/contenido-integral.test.js tests/portada.test.js`

  Expected: FAIL porque `portada.js` todavía no registra las escenas nuevas.

- [ ] **Step 3: Write minimal implementation**

  Crear una función común de revelado para bloques informativos y registrarla en el motor; añadir la navegación de retorno suave solo para enlaces internos, sin interceptar formularios ni romper el fallback estático.

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/contenido-integral.test.js tests/portada.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add public/js/portada.js public/index.html tests/contenido-integral.test.js && git commit -m "feat: animate integrated content scenes"`

### Task 4: Verificación completa y revisión visual

**Files:**
- Modify: any files required by verification findings only.

- [ ] **Step 1: Run static and full tests**

  Run: `node --test tests/contenido-integral.test.js tests/portada.test.js tests/frontend.test.js`

  Then run: `npm test`

- [ ] **Step 2: Start the local server**

  Run: `npm start`

  Verify `/`, `/posiciones`, `/css/portada.css`, and the image paths with the integrated browser.

- [ ] **Step 3: Capture desktop and mobile screenshots**

  Check the hero, new content blocks, access panel, positions table and reduced-motion/static fallback; repair only defects found.

- [ ] **Step 4: Run final quality detectors**

  Run: `impeccable.cmd detect --json public/index.html public/posiciones.html public/css/portada.css public/css/posiciones.css`

  Run: `git diff --check` and review `git diff --stat`.

- [ ] **Step 5: Commit and push**

  `git add . && git commit -m "feat: complete Miniapolis public website experience"`

  `git push origin main`

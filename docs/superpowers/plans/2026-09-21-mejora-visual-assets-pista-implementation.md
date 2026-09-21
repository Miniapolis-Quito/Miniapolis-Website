# Mejora visual de assets de la pista Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reemplazar las imágenes de la landing por una familia fotográfica de alta resolución, limpia y coherente que conserve únicamente elementos reales de la pista y del hangar.

**Architecture:** Los archivos visuales seguirán siendo assets estáticos en `public/images/`. ImageGen se usará para editar las fotografías locales visibles en el contexto, eliminando personas, camiones y objetos accidentales sin alterar la arquitectura real; después se exportarán variantes WebP responsive y se actualizarán únicamente las referencias que las consumen. La cámara `<video>` del escáner queda fuera del tratamiento porque es un stream en vivo, no un video promocional.

**Tech Stack:** ImageGen integrado, WebP/JPEG, HTML estático, CSS existente, Node.js `node:test`, navegador local para revisión visual.

**Spec:** `docs/superpowers/specs/2026-09-21-mejora-visual-assets-pista-design.md`

## Global Constraints

- No deben aparecer personas, camiones, autos de fondo, cajas, conos innecesarios, señalética accidental ni objetos distractores.
- No se inventarán edificios, sectores del circuito, decoraciones, vehículos, marcas ni geometrías que no existan en el lugar.
- Se conservarán la identidad visual, el logotipo, los iconos, los colores de marca y la geometría reconocible del trazado.
- El único elemento `<video>` existente es la vista de cámara del escáner; no es un asset de marketing y no se reemplazará.
- El trabajo debe ser no destructivo sobre los cambios ya presentes en `public/css/styles.css` y `tests/frontend.test.js`.
- Los atributos `width`/`height` deben coincidir con las dimensiones finales de los assets.
- Las variantes responsive deben compartir el encuadre maestro y no ser ampliaciones de una imagen pequeña.

## Review Focus

- La edición puede introducir una persona o camión residual en una zona lejana: cada asset de landing se inspeccionará a tamaño completo antes de integrarse.
- La generación puede alterar columnas, bordillos o ventanas: se comparará cada salida con su fotografía real de referencia.
- Un asset puede quedar nítido pero demasiado pesado: se medirán dimensiones, formato y peso antes de actualizar los `srcset`.
- El recorte móvil puede revelar un objeto que no se veía en desktop: se revisarán crops de 390 px y 1440 px.
- Un cambio visual puede romper el layout o el orden de carga: se abrirá la landing en navegador y se correrán las pruebas de frontend.

---

### Task 1: Freeze the media inventory and regression coverage

**Files:**
- Modify: `tests/frontend.test.js` near the existing landing media tests
- Modify: `public/images/README.md` in the landing asset tables

**Interfaces:**
- Consumes: existing landing references in `public/index.html` and `public/css/styles.css`
- Produces: a documented asset inventory and tests that prevent reintroducing discarded visual sources

- [ ] **Step 1: Add a failing regression assertion for forbidden landing sources**

Extend the existing test `la portada usa la pista real y los recursos fotográficos inmersivos` with explicit assertions that the landing does not reference `miniapolis-action`, `miniapolis-track-portrait`, or any filename ending in `-draft`/`-upscale`.

- [ ] **Step 2: Run the focused frontend test**

Run: `node --test tests/frontend.test.js`

Expected: PASS if the existing landing already satisfies the new assertions; if a stale reference is found, the test output identifies the exact source before asset work begins.

- [ ] **Step 3: Update the image inventory documentation**

Document the final role of each retained landing/pista asset, the master dimensions, and the responsive derivatives. Keep the logo, PWA, Wallet, and scanner assets explicitly outside ImageGen editing.

- [ ] **Step 4: Run the focused frontend test again**

Run: `node --test tests/frontend.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the inventory guardrails**

```bash
git add tests/frontend.test.js public/images/README.md
git commit -m "test: lock clean landing media inventory"
```

### Task 2: Create the clean high-resolution hero and track masters

**Files:**
- Create or replace: `public/images/pista/miniapolis-track-wide.webp`
- Create or replace: `public/images/pista/miniapolis-track-corner-wide.webp`
- Create or replace: `public/images/pista/miniapolis-track-wide-960.webp`
- Create or replace: `public/images/pista/miniapolis-track-wide-1440.webp`
- Create or replace: `public/images/pista/miniapolis-track-corner-wide-960.webp`
- Create or replace: `public/images/pista/miniapolis-track-corner-wide-1440.webp`

**Interfaces:**
- Consumes: local real-track photographs as edit targets, especially the current wide and low-corner views
- Produces: two clean landscape masters plus responsive variants with consistent geometry and lighting

- [ ] **Step 1: Inspect every edit target with `view_image`**

Load the current wide and corner files before editing. Record the elements that must remain unchanged: white track borders, red/white curbs, black columns, arched roof, tall windows, and the real floor plan.

- [ ] **Step 2: Edit the wide master with ImageGen**

Use the built-in editor with the edit target role and this constraint set: preserve the exact real hangar architecture, columns, windows, track lines, curb positions, and perspective; remove only people, trucks, distant vehicles, loose equipment, and accidental clutter; improve dynamic range, natural sharpness, asphalt texture, and cinematic light; no new objects, structures, branding, text, or altered track geometry.

- [ ] **Step 3: Edit the low-corner master with ImageGen**

Use the same invariants while preserving the foreground red/white curb and low camera perspective. Remove only non-track distractions and keep the actual surface wear visible and natural.

- [ ] **Step 4: Inspect both outputs at full size**

Reject any output with invented seams, duplicated columns, melted curbs, people, vehicles, or plastic-looking asphalt. If needed, make one targeted regeneration per asset focused only on the defect.

- [ ] **Step 5: Export the responsive derivatives**

Create 1440 px and 960 px WebP derivatives from the approved masters using the same crop and color treatment. Keep the master dimensions in the HTML accurate.

- [ ] **Step 6: Verify image metadata and file sizes**

Run: `file public/images/pista/miniapolis-track-wide*.webp public/images/pista/miniapolis-track-corner-wide*.webp`

Expected: valid WebP files with landscape dimensions matching their suffixes and no accidental JPEG fallback in the `srcset` paths.

- [ ] **Step 7: Commit the track masters**

```bash
git add public/images/pista/miniapolis-track-wide*.webp public/images/pista/miniapolis-track-corner-wide*.webp
git commit -m "assets: upgrade clean track hero photography"
```

### Task 3: Create the clean portrait, atmosphere, and detail masters

**Files:**
- Create or replace: `public/images/pista/miniapolis-hangar-vertical.webp`
- Create or replace: `public/images/pista/miniapolis-track-vertical.webp`
- Create or replace: `public/images/pista/miniapolis-curb-detail-vertical.webp`
- Create or replace: `public/images/pista/miniapolis-asphalt-detail.webp`
- Create or replace: `public/images/landing/miniapolis-track-atmosphere.webp`
- Create or replace: `public/images/landing/miniapolis-track-atmosphere.jpeg`
- Create or replace: `public/images/landing/miniapolis-car-detail.webp`
- Create or replace: `public/images/landing/miniapolis-car-detail.jpeg`

**Interfaces:**
- Consumes: current vertical/detail/atmosphere/car photographs as edit targets
- Produces: clean portrait and detail assets that remain grounded in the real venue and are safe for the hero and gallery crops

- [ ] **Step 1: Inspect all portrait and detail edit targets with `view_image`**

Load the hangar, track, curb, asphalt, atmosphere, and car images. Mark the current defects: the person in the car background, the person and truck in the action source if present, low-resolution atmosphere softness, and any unwanted loose objects.

- [ ] **Step 2: Edit the hangar, track, curb, and asphalt masters with ImageGen**

Preserve exact architecture, track markings, curb paint, surface wear, and camera orientation. Improve light, texture, and separation only. Remove accidental non-track objects and never add scenery or decorative elements.

- [ ] **Step 3: Edit the atmosphere image with ImageGen**

Use the real wide hangar as the reference and keep the same layout, columns, windows, green/black/white track surfaces, and visible perspective. Remove people, trucks, distant cars, loose gear, and any visual noise; do not invent a new room.

- [ ] **Step 4: Edit the hero car image with ImageGen**

Keep the real RC car as the only subject and preserve its body shape, paint, wheels, antennae, and actual track setting. Remove the distant person, background vehicles, signs, and unrelated equipment; do not add a second car or change the venue.

- [ ] **Step 5: Inspect every output at full size and at landing crops**

Check 4:5, 16:10, and mobile portrait crops for residual people, trucks, vehicle silhouettes, duplicated track elements, incorrect car details, or artificial blur. Regenerate only the failed asset with a targeted correction.

- [ ] **Step 6: Export matching WebP and JPEG fallbacks**

Keep WebP as the primary source. Create JPEG fallbacks only for the existing `<picture>` markup, with matching dimensions and no extra crop.

- [ ] **Step 7: Commit the portrait and detail masters**

```bash
git add public/images/pista/miniapolis-hangar-vertical.webp public/images/pista/miniapolis-track-vertical.webp public/images/pista/miniapolis-curb-detail-vertical.webp public/images/pista/miniapolis-asphalt-detail.webp public/images/landing/miniapolis-track-atmosphere.* public/images/landing/miniapolis-car-detail.*
git commit -m "assets: clean and sharpen portrait track media"
```

### Task 4: Wire final dimensions and responsive sources into the landing

**Files:**
- Modify: `public/index.html` in the landing hero and track gallery media blocks
- Modify: `public/css/styles.css` only if a final asset needs a crop-position correction

**Interfaces:**
- Consumes: approved assets from Tasks 2 and 3
- Produces: stable landing markup with correct `srcset`, fallback sources, dimensions, and no stale asset references

- [ ] **Step 1: Add a failing asset-reference check**

Extend the frontend media test to read every `src` and `srcset` path under `public/index.html`, resolve it under `public/`, and assert that the file exists. Also assert that the landing contains no `miniapolis-action`, `miniapolis-track-portrait`, or old low-resolution atmosphere references.

- [ ] **Step 2: Update `public/index.html` references and dimensions**

Point the hero, wide track, hangar, curb, atmosphere, asphalt, and car blocks at the approved masters and derivatives. Ensure each declared `width`/`height` matches the final file and each `srcset` uses the same visual master at 960/1440/full sizes.

- [ ] **Step 3: Make only evidence-based CSS crop adjustments**

Use `object-position` only when the final clean composition requires it to preserve the track subject at the existing desktop and mobile aspect ratios. Do not add decorative objects or new background imagery.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/frontend.test.js`

Expected: PASS with all landing asset paths resolvable.

- [ ] **Step 5: Commit the landing wiring**

```bash
git add public/index.html public/css/styles.css tests/frontend.test.js
git commit -m "feat: serve premium responsive track media"
```

### Task 5: Perform browser visual QA and full regression verification

**Files:**
- Modify: none unless QA exposes a concrete issue in `public/index.html`, `public/css/styles.css`, or an asset
- Test: existing `tests/frontend.test.js` and full test suite

**Interfaces:**
- Consumes: final landing and asset set from Tasks 1–4
- Produces: verified desktop/mobile presentation and regression evidence

- [ ] **Step 1: Start the local site**

Run: `npm run start`

Expected: the server starts without errors and serves the landing at `http://localhost:3000/` or the configured local port.

- [ ] **Step 2: Inspect the landing at desktop width**

Open the landing in a browser at approximately 1440 × 1000. Check hero, track wide image, vertical hangar, curb detail, atmosphere, and car card. Confirm no person, truck, background vehicle, invented architecture, or generation artifact appears.

- [ ] **Step 3: Inspect the landing at mobile width**

Resize to approximately 390 × 844. Check every image crop, loading state, text contrast, and hero composition. Confirm that mobile crops do not expose hidden clutter.

- [ ] **Step 4: Check reduced-motion behavior**

Enable `prefers-reduced-motion: reduce` and confirm the visual assets remain visible and the existing motion layer does not hide or replace them.

- [ ] **Step 5: Run the complete test suite**

Run: `npm test`

Expected: all existing tests pass, including frontend asset checks and scanner/authentication/Wallet coverage.

- [ ] **Step 6: Record final asset paths and verification results**

Update `public/images/README.md` only with the final names, roles, dimensions, and optimization notes that match the verified files.

- [ ] **Step 7: Commit the verified result**

```bash
git add public/images/README.md
git commit -m "docs: record verified track media refresh"
```


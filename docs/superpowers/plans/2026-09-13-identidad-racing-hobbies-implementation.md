# Racing Hobbies Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tickets app, physical pass and wallet passes faithfully use Racing Hobbies Ecuador's official visual identity.

**Architecture:** Keep business flows unchanged. Add a transparent official logo for web/print, update the existing wallet asset bundle, consume brand tokens from the shared stylesheet, and carry the palette/logo into Apple and Google Wallet payloads.

**Tech Stack:** Static HTML/CSS/ES modules, Node.js test runner, Express, Apple PassKit JSON, Google Wallet Generic Pass.

---

### Task 1: Prepare official brand assets

**Files:**

- Create: `public/images/racing-hobbies-logo-oficial.png`
- Modify: `assets/wallet/icon.png`, `assets/wallet/icon@2x.png`, `assets/wallet/icon@3x.png`, `assets/wallet/logo.png`, `assets/wallet/logo@2x.png`

- [ ] **Step 1: Produce an official transparent logo.** Use supplied `IMG_5951.PNG`, retain the black artwork exactly, remove only its flat green background, and export it to `public/images/racing-hobbies-logo-oficial.png`.
- [ ] **Step 2: Export PassKit variants.** Produce the 29/58/87 px square icon variants and 160/320 px horizontal logo variants. At 29 px the RC car mark must remain legible; the horizontal assets must preserve the wordmark.
- [ ] **Step 3: Inspect dimensions and alpha.** Run `sips -g pixelWidth -g pixelHeight public/images/racing-hobbies-logo-oficial.png assets/wallet/*`; expect 29/58/87 px icons and 160/320 px Wallet logos.
- [ ] **Step 4: Commit.** Run `git add public/images/racing-hobbies-logo-oficial.png assets/wallet && git commit -m "Añade logo oficial de Racing Hobbies"`.

### Task 2: Apply the visual system and official logo to the web app

**Files:**

- Modify: `public/css/styles.css`, `public/index.html`, `public/404.html`, `public/app.html`, `public/admin.html`, `public/scan.html`, `public/manifest.webmanifest`, `public/favicon.svg`
- Test: `tests/frontend.test.js`

- [ ] **Step 1: Write the failing identity contract.** Add a `tests/frontend.test.js` assertion that each app page links the shared stylesheet and sets its theme color to `#000000`. Run `node --test tests/frontend.test.js`; expect failure because pages still use `#0a0d12`.
- [ ] **Step 2: Replace the shared visual tokens.** Define black and neutral surfaces, `#3dfe40` as the only brand accent, Anton/Archivo font faces, compact race-inspired radii, and thin neutral borders. Replace old orange, magenta and blue brand accents/glows while retaining semantic status colors.
- [ ] **Step 3: Replace placeholder marks.** Change login and 404 monograms to accessible images referencing `/images/racing-hobbies-logo-oficial.png`; add a compact official lockup to the shared header and page headers without causing action controls to wrap or overlap.
- [ ] **Step 4: Match metadata.** Set the app-page and manifest theme colors to `#000000`; replace the placeholder favicon with a minimal black-and-green RC mark that follows the supplied official artwork.
- [ ] **Step 5: Verify green.** Run `node --test tests/frontend.test.js`; expect pass.
- [ ] **Step 6: Commit.** Run `git add public tests/frontend.test.js && git commit -m "Alinea la interfaz con la identidad Racing Hobbies"`.

### Task 3: Redesign the printable physical pass

**Files:**

- Modify: `public/js/admin.js`, `public/css/styles.css`
- Test: `tests/e2e/interfaz.mjs`

- [ ] **Step 1: Write the failing print-pass assertion.** Add an assertion to the existing scenario that `#pase-impreso` contains an image classed `pase__logo` whose source is `/images/racing-hobbies-logo-oficial.png`. Run `npm run test:ui`; expect failure because the pass only contains text branding.
- [ ] **Step 2: Build the branded pass structure.** Render a top logo, pack size/status in a black/green header, retain QR on white, then code, holder and validity. Do not change static-QR eligibility or print cleanup behavior.
- [ ] **Step 3: Style for screen and paper.** Use an 86 mm card, black header, green detail strip, neutral typography and unchanged white QR zone; keep the rule that hides every surrounding app component during printing.
- [ ] **Step 4: Verify green.** Run `npm run test:ui`; expect pass including the existing only-the-pass printing check.
- [ ] **Step 5: Commit.** Run `git add public/js/admin.js public/css/styles.css tests/e2e/interfaz.mjs && git commit -m "Rediseña el pase físico con la marca oficial"`.

### Task 4: Carry the identity into Apple and Google Wallet

**Files:**

- Modify: `src/services/wallet.js`
- Test: `tests/cartera.test.js`

- [ ] **Step 1: Write failing Wallet assertions.** Assert Apple `backgroundColor` is `rgb(0, 0, 0)` and `labelColor` is `rgb(61, 254, 64)`; assert Google `hexBackgroundColor` is `#000000` and its `logo.sourceUri.uri` ends in `/images/racing-hobbies-logo-oficial.png`. Run `node --test tests/cartera.test.js`; expect failure because old colors and missing logo remain.
- [ ] **Step 2: Update Apple.** Set black background, light-neutral foreground, official-green labels, preserving all field names, barcodes and update behavior.
- [ ] **Step 3: Update Google.** Set class and object background to black and include the public official-logo URL only when `config.publicUrl` exists. Preserve fields and active/inactive state.
- [ ] **Step 4: Verify green.** Run `node --test tests/cartera.test.js`; expect pass.
- [ ] **Step 5: Commit.** Run `git add src/services/wallet.js tests/cartera.test.js && git commit -m "Lleva la identidad oficial a Apple y Google Wallet"`.

### Task 5: Verify end-to-end appearance and regression safety

**Files:** no source changes expected.

- [ ] **Step 1: Run all automated tests.** Run `npm test`; expect exit code 0.
- [ ] **Step 2: Run UI coverage.** Run `npm run test:ui`; expect exit code 0 and the branded printed-pass assertion.
- [ ] **Step 3: Inspect the running application.** Capture login, customer, administration, scanner and printed-pass views at desktop and mobile sizes. Confirm the official logo is visible, no brand orange/magenta remains, green is `#3dfe40`, QR contrast is unchanged and headers do not overlap.
- [ ] **Step 4: Audit final changes.** Run `git status --short && git log --oneline -4`; expect only the documented commits for this work plus the pre-existing untracked `RHE-DEMO-2026.pkpass`.

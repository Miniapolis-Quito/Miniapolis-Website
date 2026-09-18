# Higiene y cierre del repositorio Miniápolis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditar, ordenar y verificar el repositorio de Miniápolis #3, corregir los fallos encontrados y dejarlo listo para integrarse en GitHub.

**Architecture:** Se conserva la arquitectura actual de servidor Express, frontend estático compartido y publicación mediante `_site`. La limpieza será basada en referencias: primero se clasifica cada candidato, después se modifica solo lo que tenga una justificación verificable. Los cambios de lógica se prueban con regresiones pequeñas antes de ejecutar la suite completa.

**Tech Stack:** Node.js 22, Express 5, SQLite/better-sqlite3, frontend HTML/CSS/JavaScript nativo, Node test runner y GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-higiene-y-cierre-del-repositorio-design.md`

## Global Constraints

- No borrar ni sobrescribir cambios concurrentes del usuario.
- No versionar `.env`, bases de datos, pases, claves, caches ni artefactos generados.
- Mantener las rutas públicas y los nombres de assets que consume la aplicación.
- Ejecutar la suite completa y el empaquetado de GitHub Pages antes de integrar.

### Task 1: Cerrar la regresión temporal de fidelidad

**Files:**
- Modify: `tests/fidelidad.test.js`
- Modify: `src/services/fidelidad.js`

**Interfaces:**
- Consumes: `fidelidad.guardarAjustes`, `fidelidad.progreso` y los timestamps de `redemptions`.
- Produces: un reinicio de `countingSince` que no reabsorbe consumos de una etapa anterior.

- [ ] **Step 1: Add a deterministic same-millisecond regression test.** Create a case that stores a redemption at the exact timestamp used to re-enable the program, disables fidelity, re-enables at that timestamp, and asserts the progress is zero while previously awarded rewards remain.
- [ ] **Step 2: Run the focused test and observe the failure.** Run `node --test --test-concurrency=1 --test-name-pattern='mismo milisegundo|apagar y volver' tests/fidelidad.test.js`. Expected: the new boundary assertion fails before the fix.
- [ ] **Step 3: Fix the restart boundary only.** Preserve inclusive counting for the first activation, but when an existing `countingSince` proves this is a restart, advance the new counting boundary by one millisecond so prior same-timestamp redemptions cannot be carried into the new cycle.
- [ ] **Step 4: Run the focused tests.** Repeat the focused command and expect every selected test to pass.
- [ ] **Step 5: Commit the isolated fix.** Run `git add tests/fidelidad.test.js src/services/fidelidad.js && git commit -m "Corrige el reinicio temporal de fidelidad"`.

### Task 2: Audit and classify repository contents

**Files:**
- Inspect: `.gitignore`, `.github/workflows/*`, `package.json`, `scripts/preparar-pages.js`, `public/images/README.md`, `README.md`, `GUIA-DE-USO.md`.
- Inspect: all tracked assets under `assets/` and `public/images/`.
- Inspect: `docs/superpowers/specs/` and `docs/superpowers/plans/`.

**Interfaces:**
- Consumes: Git references, application imports, HTML/CSS/JS asset URLs, build scripts and CI rules.
- Produces: a written classification of live assets, source documentation, generated local artifacts and proven obsolete material.

- [ ] **Step 1: Enumerate tracked and ignored candidates.** Use `git ls-files`, `git check-ignore`, and `rg --files` while excluding dependencies, databases and generated directories.
- [ ] **Step 2: Trace every candidate.** Search its basename and public URL through source, tests, scripts, workflows, README files and docs; inspect history for deleted/replaced versions.
- [ ] **Step 3: Keep live/source material and isolate true leftovers.** Do not remove official source images or design records merely because the runtime does not import them directly; remove only files that are both obsolete and unreferenced.
- [ ] **Step 4: Update organization documentation if classification exposed stale instructions.** Keep commands, paths and package identity aligned with the current repository without changing runtime behavior unnecessarily.

### Task 3: Verify the cleaned repository and static deployment

**Files:**
- Modify only files justified by Tasks 1–2.
- Verify: `tests/`, `public/`, `src/`, `scripts/`, `.github/`.

**Interfaces:**
- Consumes: the corrected application and classified repository tree.
- Produces: passing tests, a generated `_site`, and evidence ready for integration.

- [ ] **Step 1: Run static consistency checks.** Check staged and committed diffs for whitespace errors, scan for forbidden tracked artifacts/secrets, and validate all referenced local files exist.
- [ ] **Step 2: Build GitHub Pages.** Run `npm run build:pages`; verify `_site/index.html`, `_site/css/styles.css`, `_site/js/portada.js`, the manifest and referenced images exist.
- [ ] **Step 3: Run the full test suite.** Run `npm test`; require zero failures.
- [ ] **Step 4: Run the relevant browser smoke checks.** Use the existing Playwright workflow against the generated or served public pages, capture desktop/mobile landing screenshots, and inspect console errors.
- [ ] **Step 5: Review final Git state.** Confirm only intended changes are staged, concurrent work is preserved, and the branch is based on `main` before integration.

### Task 4: Integrate in GitHub

**Files:**
- Git metadata only: current branch and remote `origin`.

**Interfaces:**
- Consumes: verified branch and cleanly separated commits.
- Produces: pushed branch and the requested GitHub integration, or a precise blocker if remote policy prevents direct merge.

- [ ] **Step 1: Commit the verified repository cleanup.** Include only intended cleanup, regression, and existing user changes that are explicitly part of the requested delivery.
- [ ] **Step 2: Push the feature branch.** Run `git push -u origin codex/modernizacion-pit-lane` without force-pushing.
- [ ] **Step 3: Integrate against `main`.** Use the repository's available GitHub workflow or provide the generated pull-request URL if direct forge tooling is unavailable.
- [ ] **Step 4: Re-run post-integration verification.** Confirm the resulting remote state and report exact commit/PR information.

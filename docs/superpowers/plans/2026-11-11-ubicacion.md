# Ubicación Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded change.

**Goal:** Mostrar la dirección y ubicación exacta de Miniápolis #3 dentro de la estética y movimiento existentes.

**Architecture:** HTML semántico y CSS con tokens existentes; reutilizar fijarCaja y el revelado de encabezados. Google Maps en iframe diferido con CID exacto y enlace independiente.

**Tech Stack:** HTML, CSS, módulos ES nativos, GSAP, Express y node:test.

**Spec:** docs/superpowers/specs/2026-11-11-ubicacion-design.md

## Global Constraints
- Sin nuevas dependencias, colores ajenos ni atributos style en HTML.
- Preservar navegación por teclado y contenido con movimiento reducido o sin JS.
- No modificar migraciones, horarios ni funcionalidades ajenas.
- Ejecutar la suite completa antes de integrar; commit semántico en español.

## Review Focus
- El mapa identifica Miniápolis #3 mediante CID, sin confundir el centro de la vista con el pin.
- La cabecera conserva espacio suficiente al añadir Ubicación.
- La dirección larga no desborda a 320 px.
- El enlace externo permanece disponible si Google no carga.
- El nuevo panel se revela y se limpia junto con las escenas existentes.

## Task 1: Sección y mapa
- [x] Ampliar la prueba real de cabeceras para verificar el origen de marcos permitido y verla fallar.
- [x] Añadir la sección después de Horarios y enlaces en navegación, renumerando las secciones posteriores.
- [x] Aplicar CSS responsive y animar el panel con fijarCaja dentro de montarEscenas.
- [x] Permitir el marco Google en CSP y documentarlo en privacidad.
- [x] Ejecutar npm test y npm run build:pages; verificar el resultado y auditar SEO.
- [x] Verificar en navegador el pin, enlaces, 320/375 px, escritorio, movimiento reducido y fallback.
- [x] Solicitar revisión independiente y resolver hallazgos: revisión sin hallazgos.
- [x] Crear/fusionar PR en main cuando CI pase: PR #117 fusionado, CI y publicación correctos.

## Evidencia
- `npm test`: 584/584 pruebas, sin fallos.
- `npm run build:pages`, `npm run seo:audit` y `git diff --check`: correctos.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- Chromium: 320, 375, 768, 1024, 1101, 1280 y 1440 px sin desbordamiento ni solapamiento de cabecera.
- Mapa real muestra Miniapolis #3 en el CID solicitado; enlaces originales y foco de teclado comprobados.
- Sin JavaScript, GSAP o acceso al mapa: titular, dirección y enlace visibles. Movimiento reducido sin recortes ni opacidad residual.
- Revisión independiente: sin hallazgos críticos, importantes ni menores.

## Corrección encontrada al comprobar producción
El alojamiento devuelve `Cache-Control: public, max-age=14400, must-revalidate` para el CSS, aunque `_headers` solicita revalidación inmediata. Una visita repetida recibió el HTML nuevo con el CSS y módulo de escenas anteriores: `.ubicacion` se mostraba como bloque y el mapa no tenía el tratamiento visual previsto.

Se añaden versiones basadas en contenido a las URLs publicadas de `portada.css`, `portada.js` y su importación de `portada-escenas.js`. Solo cambia la salida de Pages; el código fuente, las demás páginas y la caché del escáner conservan su comportamiento. La prueba de regresión ejecuta el preparador real y comprueba que cambios en CSS o escenas renuevan las tres URLs y que una reconstrucción idéntica las conserva.

- [x] Verificar regresión, suite completa (585/585) y navegador con recursos antiguos en caché.
- [x] Revisión independiente de la corrección: sin hallazgos.

La fusión y la verificación publicada se registran en el PR de esta corrección.

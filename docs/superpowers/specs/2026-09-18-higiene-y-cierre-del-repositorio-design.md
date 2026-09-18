# Higiene y cierre del repositorio Miniápolis

## Objetivo

Dejar el repositorio de Miniápolis #3 limpio, coherente, sin restos obsoletos que puedan confundir el mantenimiento, con la suite y el sitio estático funcionando, y listo para integrarse en GitHub.

## Alcance

- Corregir cualquier fallo reproducible encontrado durante la verificación, empezando por el reinicio del contador del programa de fidelidad.
- Auditar archivos versionados, assets, scripts, documentación, rutas y referencias antes de eliminar o mover nada.
- Mantener los assets activos y las fuentes documentales que explican decisiones del producto.
- Mantener fuera del repositorio los artefactos locales ya cubiertos por `.gitignore`.
- No tocar ni perder cambios concurrentes del usuario; cualquier commit debe separar claramente la limpieza de la funcionalidad existente.
- Verificar la aplicación, el build de GitHub Pages, las referencias estáticas y la ausencia de secretos o artefactos prohibidos.

## Criterios de aceptación

- El caso de apagar y volver a encender fidelidad no arrastra entradas de la etapa anterior, incluso si comparten el mismo milisegundo.
- Los archivos eliminados o reorganizados tienen evidencia de estar obsoletos y no quedan referencias activas rotas.
- `npm test` termina con cero fallos.
- `npm run build:pages` termina correctamente y genera un sitio navegable.
- El árbol queda ordenado y con cambios propios identificables antes de preparar la integración en GitHub.

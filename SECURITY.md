# Seguridad

## Avisar de un problema

Si encuentras una vulnerabilidad, no abras un issue: escribe directamente a la
administración de Miniápolis #3 o al responsable del repositorio.
Cuenta qué viste, cómo reproducirlo y qué podría hacer alguien con ello.

## Secretos

- Nunca se versiona un `.env`, una base de datos, un certificado, una clave
  privada ni un `.pkpass` generado: el `.gitignore` los excluye.
- Los archivos `*.example` solo llevan valores de ejemplo. En producción la
  aplicación **se niega a arrancar** con cualquiera de ellos, con un secreto que
  contenga «cambiame» o con el mismo secreto repetido para dos usos.
- Si un secreto se filtra, cámbialo: `ACCESS_TOKEN_SECRET` y
  `REFRESH_TOKEN_SECRET` cierran todas las sesiones, `QR_SECRET` invalida los
  códigos emitidos (los pases impresos habrá que reimprimirlos).
- `TWOFA_SECRET` cifra los segundos factores y firma los códigos de respaldo.
  Si se deja vacío se deriva de `ACCESS_TOKEN_SECRET`, así que **rotar el
  secreto de acceso deja ilegibles los segundos factores**: nadie queda dentro
  por error —el sistema lo detecta y niega el acceso—, pero cada persona tiene
  que volver a configurarlo y el máster tiene que retirárselo antes desde
  «Administración → Seguridad». Fíjalo aparte si usas dos pasos.

## En el repositorio

- La rama `main` no admite empujones forzados ni borrado.
- Las alertas de vulnerabilidades de Dependabot y sus correcciones automáticas
  están activas, y `.github/dependabot.yml` propone actualizaciones semanales.
- Las acciones de GitHub deben ir fijadas a un commit, y el flujo de pruebas
  solo tiene permiso de lectura.

Cómo se protege la aplicación en sí está descrito en la sección «Cómo se
protege el sistema» del README.

# Librerías de terceros

- `jsQR.js` — decodificador de códigos QR de Cognex (licencia Apache-2.0).
  Copiado desde `node_modules/jsqr/dist/jsQR.js`. Se sirve localmente para que
  la política de seguridad de contenido pueda prohibir todo script externo y
  para que el escáner funcione sin conexión a Internet.

  Solo se usa como respaldo: si el navegador ofrece la API nativa
  `BarcodeDetector` (Chrome/Edge en Android y escritorio), se usa esa.

- `gsap-3.15.0.min.js`, `ScrollTrigger-3.15.0.min.js`, `SplitText-3.15.0.min.js`
  y `MotionPathPlugin-3.15.0.min.js` — GSAP de GreenSock (licencia «Standard No Charge», <https://gsap.com/standard-license>:
  gratuita para sitios web, también comerciales). Copiados desde
  `node_modules/gsap/dist/`. Mueven las escenas de la portada ligadas al
  desplazamiento.
- `lenis-1.3.26.min.js` — Lenis de darkroom.engineering (licencia MIT), el
  desplazamiento suave de la portada en escritorio. Copiado desde
  `node_modules/lenis/dist/lenis.min.js` sin la línea del mapa de fuentes.

  La versión va en el nombre del archivo porque `/vendor/` se sirve con caché
  de un año: un archivo que cambia de contenido tiene que cambiar de nombre.
  Para actualizarlas: subir la versión en `package.json` (dependencias de
  desarrollo), `npm install`, copiar los archivos con el nombre nuevo y
  cambiar las etiquetas `<script>` de la portada. Las pruebas comprueban que
  lo servido coincide byte a byte con lo instalado.

  Nada de esto es imprescindible: si un archivo no llega, la portada se ve
  completa y quieta, igual que con movimiento reducido.

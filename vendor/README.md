# Librerías de terceros

- `jsQR.js` — decodificador de códigos QR de Cognex (licencia Apache-2.0).
  Copiado desde `node_modules/jsqr/dist/jsQR.js`. Se sirve localmente para que
  la política de seguridad de contenido pueda prohibir todo script externo y
  para que el escáner funcione sin conexión a Internet.

  Solo se usa como respaldo: si el navegador ofrece la API nativa
  `BarcodeDetector` (Chrome/Edge en Android y escritorio), se usa esa.

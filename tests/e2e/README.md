# Pruebas en navegador

Dos pruebas, con propósitos distintos. Ninguna forma parte de `npm test`: las
dos necesitan un navegador, que no es dependencia del proyecto.

```bash
npm install --no-save playwright
npx playwright install chromium
```

## `interfaz.mjs` — la interfaz, sin montar nada

```bash
npm run test:ui
```

Levanta la aplicación en el propio proceso, sobre una base en memoria, y la
recorre con un navegador real. No hace falta servidor ni base de datos, y no
deja rastro.

Cubre lo que ninguna prueba de API puede ver: que un botón haga lo que dice.
La descarga de los tres reportes (incluida la marca de codificación que hace
que Excel abra bien los acentos), el formateo del código mientras se teclea
—carácter a carácter, que es como falla de verdad—, lo que aparece en la lista
de actividad cuando llega un evento en vivo, el aviso de espera entre dos
escaneos y el saldo del cliente bajando sin recargar la página.

## `flujo-completo.mjs` — el sistema instalado

```bash
# En otra terminal, con la base recién creada:
rm -f data/tickets.db* && npm start

npm run test:e2e
```

Recorre el sistema tal y como queda instalado: contra un servidor de verdad,
por su puerto, con la cuenta máster que se creó al arrancar. Un cliente se
registra, el máster le vende un pack, el personal escanea, y se comprueba que
el saldo del cliente cambia en vivo. Es la prueba de que el despliegue funciona,
no solo el código.

Variables opcionales:

- `BASE_URL` — dirección del servidor (por defecto `http://localhost:3000`).
- `MASTER_EMAIL` / `MASTER_PASSWORD` — credenciales del máster inicial.
- `CHROMIUM_PATH` — ruta a un Chromium concreto, si Playwright no lo encuentra
  (sirve para las dos pruebas).
- `CAPTURAS` — carpeta donde guardar capturas de pantalla de cada paso.

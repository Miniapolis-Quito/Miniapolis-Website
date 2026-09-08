# Pruebas en navegador

Cuatro pruebas, con propósitos distintos. Ninguna forma parte de `npm test`:
todas necesitan un navegador, que no es dependencia del proyecto.

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

Dos pasos merecen mención aparte:

- **El corte de red.** Se deja que la petición llegue al servidor y se tira la
  respuesta de vuelta: el cobro ocurrió, pero el operador ve "sin conexión".
  Es el caso en el que un reintento descontaría dos veces si la clave de
  idempotencia no estuviera haciendo su trabajo.
- **El pase impreso.** Se sustituye `window.print` por una bandera y se mira lo
  que habría salido por la impresora: el pase con su QR, y nada más —ni la
  cabecera, ni el panel, ni el diálogo desde el que se pidió—.

## `camara.mjs` — el escáner leyendo un QR de verdad

```bash
npm run test:camara
```

El trabajo diario del personal, y lo único que no se puede comprobar sin una
cámara. Se genera un vídeo sin comprimir con el QR del pack dentro y se le da a
Chromium como dispositivo de captura: el escáner lo lee y descuenta la entrada
sin que nadie toque el teclado.

Se recorren los dos lectores, porque en la pista conviven los dos: el nativo
del navegador cuando existe, y el respaldo jsQR en todo lo demás (se fuerza
quitando `BarcodeDetector` antes de que cargue la página).

## `ficha-cliente.mjs` — la ficha del panel máster

```bash
# Con datos de demostración cargados:
rm -f data/tickets.db* && npm run seed && npm start

npm run test:e2e:ficha
```

Recorre lo que hace de verdad quien atiende: abrir la ficha desde el listado,
corregir un dato, acreditar entradas de cortesía, anular un consumo cobrado por
error, y comprobar que todo eso queda reflejado en la actividad, que la
contabilidad sigue cuadrando y que la pantalla se lee en un teléfono sin
desbordarse.

Modifica los datos, así que conviene volver a cargarlos (`npm run seed`) antes
de repetirla.

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
- `CLIENTE_DEMO` — correo del cliente sobre el que trabaja `ficha-cliente.mjs`.

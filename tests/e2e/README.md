# Pruebas en navegador

Varias pruebas, con propósitos distintos. Ninguna forma parte de `npm test`:
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

## `recuperacion.mjs` — recuperar y cambiar la contraseña

```bash
npm run test:e2e:recuperacion
```

Levanta la aplicación en el propio proceso con el correo en memoria y recorre
lo que la persona ve: pedir el enlace desde la página de acceso, abrirlo, que
el token desaparezca de la barra de direcciones, que recargar o reutilizar el
enlace ya no sirva y que se entre con la contraseña nueva. Comprueba también
que quien cambia su contraseña con la sesión abierta —en «Mi cuenta» o desde la
cabecera— se queda dentro: el servidor cierra las demás sesiones y avisa por el
canal en vivo, y ese aviso no debe echar a la pestaña que hizo el cambio.

## `avisos.mjs` — avisos y clientes por recuperar

```bash
npm run test:e2e:avisos
```

Levanta la aplicación en el propio proceso con el correo en memoria y un cliente
en cada grupo. Del lado de administración comprueba que cada uno aparece en su
grupo, que **WhatsApp** abre la conversación con el número y el mensaje bien
armados y deja el contacto registrado, que encender los avisos pide
confirmación, que la prueba llega al máster, que **Revisar ahora** envía solo lo
que toca (lo anterior a encenderlos no), que el contacto aparece en la ficha y
que en un teléfono la sección no se desborda. Del lado del cliente, el
interruptor de **Mi cuenta** y la página del enlace de baja abierta desde un
correo real: que borra el token de la barra, que abrirla no da de baja, y que se
puede dar de baja y deshacerlo.

Con `CAPTURAS=carpeta` guarda capturas de la sección, los ajustes, «Mi cuenta» y
la página de baja.

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

## `sin-conexion.mjs` — el escáner durante un corte de red

```bash
npm run test:e2e:sin-conexion
```

Levanta la aplicación en el propio proceso y recorre una tarde sin Internet:
con la red cortada, el operador teclea un código y la cámara lee un QR (las dos
lecturas se guardan en el teléfono), un doble disparo no se guarda dos veces, se
recarga la página sin señal y el escáner abre igual gracias al service worker.
Al volver la red se comprueba en la base que todo se cobró una sola vez y con la
hora de lectura, que la entrada que no se pudo cobrar aparece por revisar en el
puesto y en el resumen del máster, que se resuelve con una nota que queda en la
ficha, y que tras **Salir** el escáner ya no abre sin red con esa identidad.

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
# En otra terminal:
npm start

npm run test:e2e
```

Se puede repetir sobre el mismo servidor tantas veces como haga falta: cada
ejecución se inventa los correos del cliente y del personal que da de alta, así
que no choca con lo que dejó la anterior y no hay nada que borrar entre una y
otra.

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

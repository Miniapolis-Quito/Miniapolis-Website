# Sistema de entradas — Racing Hobbies Ecuador

Control de acceso por packs de entradas para la pista de autos a control remoto.
Los clientes compran packs de 5 o 10 entradas, muestran un código QR desde su
teléfono y el personal lo escanea en la puerta: cada escaneo descuenta una
entrada y el saldo se actualiza en el teléfono del cliente al instante.

---

## Qué hace

**Para el cliente**
- Ve cuántas entradas le quedan, en tiempo real y sin recargar la página.
- Muestra un QR que se renueva solo cada 30 segundos y caduca a los dos
  minutos, así que una captura de pantalla ajena sirve de poco — y de nada en
  cuanto ese código se usa una vez.
- Consulta su historial: cuándo usó cada entrada, en qué pack y con qué saldo
  quedó.
- Si se queda sin señal, su código de pack (`RHE-XXXX-XXXX`) sigue sirviendo:
  el personal puede ingresarlo a mano.
- Puede guardar el pack en la cartera del teléfono (Apple Wallet o Google
  Wallet) y ver ahí el saldo, que baja solo cada vez que usa una entrada.

**Para el personal de pista**
- Escáner con la cámara del teléfono, con lector nativo del navegador cuando
  está disponible y respaldo que funciona sin conexión a Internet.
- Confirmación grande y con sonido: cuántas entradas quedan, de quién es el
  pack, y aviso cuando el cliente se está quedando sin entradas.
- Consulta un pack sin descontar nada, e ingreso manual por código.
- **Sigue cobrando aunque se caiga Internet**: cada lectura se guarda en el
  teléfono y se cobra sola al volver la señal, con la hora en que se leyó. La
  página abre incluso sin red. Ver más abajo.
- No puede emitir packs, ajustar saldos ni ver la administración.

**Para el usuario máster**
- Vende packs, da de alta clientes y personal, y asigna roles.
- Ajusta saldos, suspende o anula packs, y anula un consumo devolviendo la
  entrada al cliente.
- Imprime pases físicos con QR fijo, para los packs donde lo habilite.
- Panel con entradas pendientes, actividad del día, ingresos y gráfico de uso.
- Aviso de **entradas sin cobrar**: quien entró durante un corte de red y cuya
  entrada no se pudo descontar después, para resolverlo con una nota.
- **Ficha de cliente**: todo lo que se sabe de una persona en una pantalla —
  saldo, hábitos, packs, consumos, actividad y dispositivos— con las acciones a
  mano. Ver más abajo.
- Bitácora de auditoría de todo lo que ocurre y exportación a CSV.
- Verificación de integridad contable con un clic.

---

## Puesta en marcha

Requisitos: **Node.js 22 o superior** (la versión con soporte a largo plazo).

```bash
npm install

cp .env.example .env
# Genera los tres secretos y pégalos en .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm start
```

El sistema queda en `http://localhost:3000`. La primera vez crea la cuenta
máster indicada en `MASTER_EMAIL`; si dejaste `MASTER_PASSWORD` vacío, imprime
una contraseña generada **una sola vez** en la consola.

Para probarlo con datos de ejemplo antes de usarlo de verdad:

```bash
npm run seed
```

Crea un máster, un operador y cinco clientes con packs y consumos repartidos en
las últimas dos semanas. Todos con la contraseña `Pista-Demo-2026`, que hay que
cambiar antes de abrir al público.

### Si nadie puede entrar al panel

```bash
npm run create-master -- --email admin@racinghobbies.ec --nombre "Tu nombre"
```

Crea la cuenta si no existe o le restablece la contraseña y le devuelve el rol
máster si ya existía. Es la salida de emergencia, y solo funciona desde el
servidor.

---

## Rutas de la interfaz

| Ruta        | Quién entra           | Para qué |
|-------------|-----------------------|----------|
| `/`         | cualquiera            | Entrar o crear cuenta |
| `/app`      | cualquier cuenta      | Saldo, QR e historial del cliente |
| `/escanear` | personal y máster     | Control de acceso en la puerta |
| `/admin`    | solo máster           | Administración completa |

---

## La cámara necesita HTTPS

Los navegadores solo dan acceso a la cámara en `localhost` o sobre **HTTPS**.
En la pista, el teléfono del operador no es `localhost`, así que **hay que
servir el sistema por HTTPS o el escáner no abrirá la cámara** (el ingreso
manual por código seguirá funcionando).

La forma más simple es poner Caddy delante, que gestiona el certificado solo:

```caddyfile
entradas.racinghobbies.ec {
    reverse_proxy localhost:3000
}
```

Con nginx hay que pasarle tres cabeceras —el nombre del sitio, el protocolo y
la IP de quien llama— y desactivar el búfer en el canal de tiempo real. Sin
`Host` y `X-Forwarded-Proto`, la aplicación cree estar sirviendo en
`http://localhost:3000` y rechaza por seguridad las peticiones del propio
sitio, que es exactamente lo que parece un ataque desde otro origen:

```nginx
# Ojo: un bloque que declara sus propias cabeceras deja de heredar las de
# fuera, así que se repiten en los dos en vez de ponerlas una sola vez.
location /api/events {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection        '';
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 24h;
}

location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

Caddy manda esas tres por su cuenta, así que el bloque de arriba basta tal cual.

Con proxy delante hay que poner `TRUST_PROXY=true`,
`TRUSTED_PROXY_IPS=127.0.0.1,::1` (si Caddy/nginx vive en la misma máquina) y
`COOKIE_SECURE=true` en `.env`. Para un proxy remoto, usa su IP o su red CIDR
en `TRUSTED_PROXY_IPS` y bloquea el acceso directo al puerto de Node. Así solo
un proxy conocido puede aportar `X-Forwarded-For`; aceptar esa cabecera desde
cualquier conexión permitiría falsificar IPs y esquivar los límites.

### Que el servicio se levante solo

```ini
# /etc/systemd/system/entradas.service
[Unit]
Description=Entradas Racing Hobbies
After=network.target

[Service]
Type=simple
User=racing
WorkingDirectory=/opt/entradas
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now entradas
```

---

## Cómo se protege el sistema

**Contra el uso del QR ajeno.** El QR no es un código fijo: lleva la hora y un
número de un solo uso, firmados con HMAC-SHA256 usando una clave derivada del
secreto del servidor y de un secreto propio de cada pack. Un QR vale
`QR_TTL_SECONDS` (120 por defecto) y **el mismo código nunca se acepta dos
veces**, ni siquiera dentro de esa ventana. Sin ambos secretos no se puede
fabricar uno válido, y el del pack nunca sale del servidor.

Los pases impresos (QR fijo) están desactivados salvo que el máster los active
pack por pack, porque un impreso sí es copiable. Al activarlos aparece
**Imprimir pase** en el detalle del pack: sale un cartón con el QR, el código y
el nombre del cliente. Ese código no cambia entre reimpresiones (es un objeto
físico), y desactivar la opción invalida al instante todos los pases
entregados.

**Contra el doble descuento.** Tres barreras independientes:

1. **Clave de idempotencia** — si el teléfono del operador pierde la señal y
   reintenta, el servidor devuelve la misma respuesta sin volver a descontar.
2. **Número de un solo uso del QR** — el mismo código no se acepta dos veces.
3. **Tiempo de espera por pack** — dos escaneos del mismo pack en menos de
   `REDEEM_COOLDOWN_SECONDS` se rechazan con un aviso claro, que es lo que
   ocurre cuando la cámara dispara dos veces.

Además, el descuento sucede dentro de una transacción con la condición
`remaining = <valor leído>`: aunque dos puestos escaneen a la vez, solo uno
puede ganar. Hay una prueba que lanza diez consumos simultáneos contra un pack
de tres y verifica que pasan exactamente tres.

**Contra la manipulación de saldos.** `packs.remaining` es una proyección: la
verdad está en `pack_movements`, donde toda alta, consumo, anulación y ajuste
deja un asiento con su saldo resultante. El panel máster verifica que ambos
coincidan, y las pruebas comprueban que una alteración directa de la base se
detecta.

**Sesiones.** La contraseña se guarda con scrypt (N=2¹⁶, r=8, p=1). El token de
acceso vive 15 minutos y solo en memoria del navegador; la sesión persiste con
una cookie `httpOnly`, `Secure`, `SameSite=Strict` que JavaScript no puede
leer; con HTTPS lleva el prefijo `__Host-`, así que nadie en la red ni en otro
subdominio puede plantar una propia. El token de refresco **rota en cada uso** y, si
alguna vez se presenta uno ya rotado, se asume robo y se revoca la sesión
completa. Suspender una cuenta, cambiarle el rol o cambiar la contraseña corta
el acceso al instante, sin esperar a que caduque nada. Suspenderla inutiliza
además sus entradas —también el pase impreso y el ingreso manual por código,
que no dependen de que esa persona inicie sesión— sin tocar su saldo.

Suspender una cuenta o cerrarle las sesiones **cierra también su canal en vivo
en el acto**: la pantalla de esa persona vuelve a la página de acceso sola, sin
esperar a que falle su siguiente petición.

**Lo demás.** Límites de intentos persistidos en base (sobreviven a un
reinicio), bloqueo temporal de cuenta tras 8 fallos —contado por la base, así
que ni una ráfaga de intentos simultáneos lo esquiva, y aplicado también a los
correos sin cuenta para no delatar cuáles están registrados—, política de seguridad de
contenido sin `unsafe-inline` ni `unsafe-eval`, consultas siempre
parametrizadas, validación de entrada con esquemas y mensajes en español,
cabeceras de seguridad, protección contra fórmulas en los CSV exportados, y
bitácora de auditoría de cada acción con su autor, hora y dirección IP.
Las respuestas de la API no se guardan en la caché del navegador, la base de
datos se crea legible solo por el usuario del servicio, la contraseña de la
clave de Apple Wallet nunca viaja en la línea de órdenes, y el servicio web que
consultan los teléfonos valida cada identificador y tiene su propio límite.

**Carga y configuración.** Las verificaciones de contraseña (cada una ocupa
unos 64 MB) tienen un tope de cuántas corren y cuántas esperan: una avalancha
de intentos desde muchas direcciones recibe «servidor ocupado» en vez de dejar
al servidor sin memoria, y ese rechazo nunca cuenta como intento fallido. En
producción la aplicación no arranca con los secretos o la contraseña de los
archivos de ejemplo, ni con un mismo secreto para dos usos.

**El repositorio.** `main` no admite empujones forzados ni borrado, Dependabot
avisa y corrige dependencias vulnerables, las acciones de GitHub van fijadas a
un commit y cada empujón comprueba que no se haya versionado ningún secreto.
El detalle está en `SECURITY.md`.

---

## Recuperar la contraseña

Con correo configurado, la página de acceso ofrece **¿Olvidaste tu
contraseña?**. La persona escribe su correo, recibe un enlace y elige una
contraseña nueva sin pasar por recepción. Sin correo, el botón no aparece y
el camino sigue siendo el de siempre: administración la restablece.

Cómo se protege (el detalle está en
`docs/superpowers/specs/2026-09-14-recuperacion-de-contrasena-design.md`):

- **No delata cuentas.** Pedir el enlace responde siempre lo mismo y antes de
  buscar la cuenta. Las cuentas inexistentes o suspendidas no reciben nada.
- **No sirve para bombardear a nadie.** Un correo por minuto y tres por hora
  por dirección, en silencio, además del límite por conexión.
- **El enlace es una llave de un solo uso.** 256 bits aleatorios; en la base
  solo queda su HMAC. Vale `PASSWORD_RESET_TTL_SECONDS` (30 minutos) y una sola
  vez, y pedir otro invalida el anterior. Cambiar la contraseña, el correo o el
  estado de la cuenta invalida los pendientes.
- **El token no se filtra.** Va en el fragmento de la dirección
  (`/restablecer#token=…`), que el navegador no manda al servidor ni al
  `Referer`, y la página lo borra de la barra al leerlo. El dominio del enlace
  sale de `PUBLIC_URL`, nunca de la petición.
- **Canjearlo cierra todo.** Se cierran las sesiones en todos los
  dispositivos, se levanta el bloqueo por intentos y **no** se abre sesión
  sola: se vuelve a entrar con la contraseña nueva.
- **Siempre hay aviso.** Cada cambio de contraseña —propio, por enlace o por
  administración— manda un correo a la persona. Nunca lleva la contraseña.

Cambiar la contraseña con sesión abierta exige la actual; cinco fallos en una
hora cierran esa sesión, para que quien robe una sesión abierta no pueda
quedarse probando. Los clientes lo hacen en **Mi cuenta** y el personal y el
máster desde el botón **Contraseña** de la cabecera.

### Configurar el correo

```ini
PUBLIC_URL=https://entradas.racinghobbies.ec
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=entradas@racinghobbies.ec
SMTP_PASSWORD_FILE=/etc/entradas/smtp-password
MAIL_FROM=Racing Hobbies <entradas@racinghobbies.ec>
```

El envío exige TLS con certificado válido (STARTTLS en el 587, TLS directo en
el 465). En producción `PUBLIC_URL` debe ser HTTPS o la recuperación no se
ofrece. Para desarrollar sin servidor de correo, `MAIL_TRANSPORT=consola`
escribe los mensajes en la terminal; en producción está prohibido, porque el
enlace da acceso a la cuenta.

---

## Operación diaria

**Vender un pack.** Administración → Packs → *Vender pack*. Se busca al cliente
(o se le crea antes en *Clientes y personal*), se elige el tamaño, se ajusta el
precio si hubo descuento y se registra la forma de pago. El cliente ve el pack
aparecer en su teléfono en el momento, sin recargar.

Los packs a la venta salen de `.env`: de fábrica son el de 5 y el de 10, y con
`PACK_CATALOG=5:2500,10:4500,20:8000` se venden los que haga falta, sin tocar
el código. Un tamaño fuera del catálogo se puede emitir igual, escribiendo su
precio a mano.

**Cobrar la entrada.** El operador abre `/escanear`, escribe el nombre de su
puesto una vez (queda guardado en ese teléfono) y enciende la cámara. Cada
escaneo válido muestra en grande cuántas entradas quedan y avisa cuando el
cliente baja de tres.

**Corregir un error.** Administración → Consumos → *Anular*. Pide el motivo,
devuelve la entrada al cliente y queda registrado quién lo hizo y por qué.

**Cierre de caja.** Administración → Resumen → *Exportar packs / consumos /
clientes*. Los CSV abren directamente en Excel con los acentos correctos.

**Buscar a alguien.** La búsqueda de clientes y de packs ignora tildes y
mayúsculas: "maria" encuentra a *María Chasís*, y "munoz" a *Andrés Muñoz*.
También busca por correo, por teléfono y por código de pack.

---

## La ficha del cliente

En **Clientes y personal**, *Abrir ficha* lleva a la pantalla donde vive todo lo
de esa persona. Tiene dirección propia (`/admin#cliente/<id>`), así que el
enlace se comparte, se recarga y funciona con el botón de atrás.

Arriba: quién es, cómo contactarlo, desde cuándo es cliente, su saldo, lo que ha
usado, lo que ha comprado, lo que ha gastado y cada cuánto vuelve. Debajo, seis
pestañas:

| Pestaña | Qué hay |
|---|---|
| **Resumen** | Packs con entradas, visitas por semana, qué días suele venir y lo último que pasó |
| **Packs** | Cada pack con su historial de movimientos, y las acciones: ajustar, suspender, anular, QR impreso, imprimir pase |
| **Consumos** | Cuándo entró, con qué pack, por qué vía, quién se lo registró y en qué puesto — con la opción de anular |
| **Actividad** | Un solo hilo cronológico con movimientos de entradas y eventos de la cuenta, más la bitácora técnica sin interpretar |
| **Acceso** | Estado de la cuenta, dispositivos con sesión abierta, restablecer contraseña, desbloquear, cerrar sesiones |
| **Datos** | Editar nombre, correo, teléfono, rol y estado, con la ficha técnica completa |

La línea de tiempo distingue lo que hizo el cliente de lo que hizo el personal,
y cada movimiento muestra el saldo con el que quedó el pack. Un ajuste sin
motivo no se puede guardar: la ficha es también el expediente que se consulta
cuando alguien reclama.
## El escáner sin conexión

Si se cae Internet en la pista, el puesto no se detiene. El operador sigue
leyendo QR y tecleando códigos: cada lectura se guarda en el teléfono y el
recuadro lo dice con un borde discontinuo y dos pitidos cortos —**Guardada sin
conexión: puede pasar**—. En cuanto vuelve la señal, el teléfono las envía solo,
en orden, y avisa de cuántas se cobraron.

Si alguien recarga la página o el teléfono se reinicia durante el corte, el
escáner abre igual (lo guarda un service worker) con el nombre de quien estaba
trabajando. Para eso basta con haber abierto el escáner con señal al empezar el
turno y no haber tocado **Salir**.

**Con las mismas reglas que en línea.** El servidor juzga cada lectura a la
hora en que se hizo, no a la hora en que llega:

- Un QR que valía cuando se leyó, vale; uno que ya había caducado, no. Una
  captura de pantalla vieja no se cuela por llegar tarde.
- El mismo QR leído por un puesto con señal y otro sin ella se cobra una sola
  vez: los nonces se conservan mientras pueda llegar una lectura guardada.
- Dos lecturas del mismo pack con segundos de diferencia siguen siendo un doble
  disparo, lleguen juntas o en otro orden.
- A quien entró antes del vencimiento de su pack no se le pierde la entrada
  porque la señal volvió al día siguiente.
- La hora del teléfono no importa: el servidor solo usa la diferencia entre
  cuándo se leyó y cuándo se envió, que es correcta aunque el reloj no lo sea.
- Si el cobro llegó al servidor justo antes del corte, la lectura se guarda con
  la misma clave de idempotencia y al enviarla recibe la respuesta original.

El consumo queda con la hora de lectura —es cuándo entró la persona, y así
cuenta en las cifras del día— y con la hora en que llegó, que se muestra en
administración como *Leída sin conexión*.

**Lo que no se pudo cobrar no se pierde.** Si al llegar la lectura el pack ya no
tenía saldo, estaba anulado o la cuenta suspendida, el teléfono la marca *por
revisar* con el motivo, y en **Resumen** aparece la tarjeta **Entradas sin
cobrar** con la persona, el pack, el puesto y quién la leyó. Se cierra con
*Marcar resuelta* y una nota («pagó en efectivo»), que queda en su ficha junto
con lo ocurrido.

**Qué no hace, a propósito.** El teléfono no valida la firma del QR (el secreto
no sale del servidor) ni descarga saldos o datos de clientes: un teléfono
perdido no se lleva nada. Sin red solo comprueba lo que puede comprobar solo —el
formato, que el QR no haya caducado y que no sea una lectura repetida—.

```ini
# Horas que puede esperar una lectura guardada. 0 apaga el modo: sin red, el
# escáner vuelve a pedir que se reintente a mano.
OFFLINE_SCAN_MAX_HOURS=24
```

El diseño completo está en
`docs/superpowers/specs/2026-09-14-escaner-sin-conexion-design.md`.

---

## Pases en la cartera del teléfono

El cliente puede guardar su pack en **Apple Wallet** o **Google Wallet**. El
pase muestra cuántas entradas le quedan y **el número baja solo**: cuando el
personal descuenta una, el sistema avisa al teléfono y este recoge el saldo
nuevo, sin abrir la app.

Es opcional y viene apagado. Cada plataforma se enciende por su cuenta, y solo
cuando están todas sus credenciales: sin ellas, la app no ofrece el botón y el
resto del sistema funciona igual. Lo que hay que conseguir está explicado paso
a paso en `.env.example`; en resumen, Apple pide una cuenta de desarrollador de
pago (un certificado de Pass Type ID y una clave de avisos) y Google una cuenta
de servicio con la API de Wallet activada, que es gratuita.

**Sobre el código del pase.** Un pase de cartera vive en el teléfono y no puede
renovar su QR cada treinta segundos, así que solo lleva código cuando el pack
tiene habilitado el **QR impreso** —la misma regla que el pase de cartón: lo
que no rota se puede copiar, y por eso lo habilita el máster pack por pack—.
Sin esa opción el pase sigue haciendo lo que la mayoría quiere: enseñar el
saldo al día. Para entrar, el cliente muestra el QR de la app.

Detrás de la actualización automática hay dos caminos distintos, uno por
plataforma: a Apple se le manda un aviso silencioso y es el teléfono quien
vuelve a pedir el pase (`/api/wallet/apple/v1/...`, el servicio web que define
Apple); a Google se le envía el saldo directamente a su API. En los dos casos
el disparador es el mismo canal en vivo que ya mueve la pantalla del cliente,
así que el camino del cobro no se toca.

---

## Copias de seguridad

Todo vive en un único archivo SQLite (`data/tickets.db`). La forma correcta de
copiarlo **con el sistema en marcha** es dejar que SQLite lo haga:

```bash
sqlite3 data/tickets.db ".backup '/respaldos/tickets-$(date +%F).db'"
```

Copiar el archivo con `cp` mientras el servidor escribe puede dar una copia
inservible. Una tarea diaria basta:

```cron
0 3 * * * sqlite3 /opt/entradas/data/tickets.db ".backup '/respaldos/tickets-$(date +\%F).db'"
```

---

## Desarrollo

```bash
npm run dev     # servidor con recarga automática
npm test        # suite completa (255 pruebas)
npm run seed    # datos de demostración
npm run test:ui # la interfaz en un navegador real (necesita Playwright)
npm run test:camara # el escáner leyendo un QR con la cámara
npm run test:e2e:sin-conexion # el escáner durante un corte de red
```

Las pruebas corren sobre una base en memoria y cubren todas las rutas de la API:
autenticación y rotación de sesiones, desbloqueo y restablecimiento de
contraseñas, emisión y ajuste de packs, las tres barreras contra el doble
descuento, concurrencia por HTTP, el canal de tiempo real (abriendo el flujo,
leyendo lo que llega y reanudándolo tras una caída), la búsqueda sin tildes, el
camino de actualización del esquema, el expediente del cliente, control de
acceso por rol y las cabeceras de seguridad. `npm ci && npm test` se ejecuta
también en cada empujón desde `.github/workflows/`.

Como la interfaz no pasa por ningún compilador, hay además comprobaciones
estáticas que hacen ese trabajo: que toda importación exista, que no se use una
función sin importarla, que cada `#identificador` que busca el JavaScript esté
en el HTML, y que no haya clases de CSS sin definir.

`tests/e2e/` contiene además pruebas en navegador real, que no entran en
`npm test` porque necesitan Playwright: `interfaz.mjs` levanta la aplicación en
el propio proceso y comprueba que la interfaz hace lo que dice (descargas,
formateo del código al teclearlo, actividad en vivo, un corte de red a mitad de
un cobro y el pase impreso); `camara.mjs` le da a Chromium un vídeo con un QR y
comprueba que el escáner lo lee y descuenta la entrada, con el lector nativo y
con el respaldo jsQR; `sin-conexion.mjs` corta la red en mitad del turno,
recarga la página sin señal y comprueba que todo se cobra al volver; y
`flujo-completo.mjs` recorre el sistema ya instalado
contra un servidor de verdad. El README de esa carpeta explica cómo ejecutarlas.

### Estructura

```
src/
  config.js            Configuración validada desde el entorno
  app.js               Ensamblado de Express
  server.js            Arranque, mantenimiento y apagado ordenado
  bootstrap.js         Creación de la cuenta máster inicial
  db/                  Conexión SQLite y migraciones incrementales
  lib/                 QR, contraseñas, tokens, límites, eventos en vivo,
                       texto, días del calendario y pases de cartera
  middleware/          Seguridad, autenticación, manejo de errores
  routes/              auth · packs · scan · admin · events · wallet
  services/            Reglas de negocio (packs, consumos, usuarios, sesiones,
                       expediente del cliente, auditoría, cifras del panel,
                       pases de cartera y lecturas sin conexión)
assets/                Iconos del pase de cartera
public/                Interfaz web sin compilación ni dependencias externas
tests/                 Pruebas automatizadas
scripts/               Utilidades de terminal
```

La interfaz no usa ningún framework ni descarga nada de Internet: se sirve tal
cual y funciona con la política de seguridad cerrada. La única librería de
terceros del navegador es `jsQR`, incluida en `public/vendor/` como respaldo
para leer códigos cuando el navegador no ofrece lector propio.

### Sobre las migraciones

`src/db/migrations.js` contiene una lista ordenada que se aplica una sola vez
cada una. Para cambiar el esquema se **agrega** una entrada al final; nunca se
edita ni se reordena una ya publicada, porque las bases existentes ya la
aplicaron.

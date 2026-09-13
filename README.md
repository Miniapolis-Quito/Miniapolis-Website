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
- No puede emitir packs, ajustar saldos ni ver la administración.
- Solo escanea quien está autorizado por su nombre: el rol de personal abre la
  pantalla, pero descontar entradas exige un permiso que el máster concede
  cuenta por cuenta y puede retirar en cualquier momento.

**Para el usuario máster**
- Vende packs, da de alta clientes y personal, y asigna roles.
- Decide quién puede escanear, de uno en uno, y se lo quita cuando quiera.
- Ajusta saldos, suspende o anula packs, y anula un consumo devolviendo la
  entrada al cliente.
- Imprime pases físicos con QR fijo, para los packs donde lo habilite.
- Panel con entradas pendientes, actividad del día, ingresos y gráfico de uso.
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
| `/escanear` | cuentas autorizadas   | Control de acceso en la puerta |
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

**Quién puede descontar entradas.** Tocar el saldo de un cliente exige un
permiso explícito por cuenta, no un rol. El personal y el máster entran al
sistema por su rol, pero `/api/scan` —escanear, consultar por código, consumo
manual e historial del puesto— rechaza a cualquier cuenta sin ese permiso, lo
tenga quien lo tenga: un máster sin autorizar tampoco escanea. El permiso solo
puede existir en cuentas de personal o máster; si a alguien se le baja a
cliente, lo pierde en la misma operación. Retirarlo **cierra sus sesiones en el
acto**, así que un teléfono que quedó abierto en la puerta deja de servir sin
esperar a que caduque nada, y su canal en vivo se corta con él. Cada concesión
y cada retirada queda en la bitácora con su propio nombre
(`usuario.escaneo_autorizado` y `usuario.escaneo_revocado`), de modo que
"¿quién podía escanear el sábado?" se responde mirando el registro.

**Cada quien en lo suyo.** Un cliente solo alcanza sus propios packs: su QR, sus
movimientos, su historial y sus pases de cartera se comprueban contra el dueño
del pack, y pedir los de otro devuelve un error, no datos. El personal
autorizado ve de quién es el pack que tiene delante y su saldo —lo que hace
falta en la puerta— pero no el correo del cliente ni los escaneos de sus
compañeros; el conjunto es del máster. El canal en vivo reparte por cuenta: el
cliente recibe lo suyo, y el movimiento de la pista solo llega a quien está
autorizado a escanear.

**Sesiones.** La contraseña se guarda con scrypt (N=2¹⁶, r=8, p=1). El token de
acceso vive 15 minutos y solo en memoria del navegador; la sesión persiste con
una cookie `httpOnly`, `Secure`, `SameSite=Strict` acotada a `/api/auth`, que
JavaScript no puede leer. El token de refresco **rota en cada uso** y, si
alguna vez se presenta uno ya rotado, se asume robo y se revoca la sesión
completa. Suspender una cuenta, cambiarle el rol o cambiar la contraseña corta
el acceso al instante, sin esperar a que caduque nada. Suspenderla inutiliza
además sus entradas —también el pase impreso y el ingreso manual por código,
que no dependen de que esa persona inicie sesión— sin tocar su saldo.

Suspender una cuenta o cerrarle las sesiones **cierra también su canal en vivo
en el acto**: la pantalla de esa persona vuelve a la página de acceso sola, sin
esperar a que falle su siguiente petición.

**Lo demás.** Límites de intentos persistidos en base (sobreviven a un
reinicio), bloqueo temporal de cuenta tras 8 fallos, política de seguridad de
contenido sin `unsafe-inline` ni `unsafe-eval`, consultas siempre
parametrizadas, validación de entrada con esquemas y mensajes en español,
cabeceras de seguridad, protección contra fórmulas en los CSV exportados, y
bitácora de auditoría de cada acción con su autor, hora y dirección IP.

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

**Autorizar a un operador.** Administración → Clientes y personal. Al crear la
cuenta se marca *Puede escanear entradas en la puerta*; si ya existe, la fila
tiene el botón *Dar escáner* / *Quitar escáner*. Una cuenta de personal recién
creada **no** puede escanear hasta que se le active: es a propósito, para que
prestar un usuario no sea prestar el saldo de los clientes. Las cuentas que ya
existían antes de esta versión conservan el permiso, para que actualizar no
deje la puerta sin operadores.

Al quitarlo, esa persona sale del sistema en el acto y su pantalla vuelve a la
página de acceso. Al final del turno, o si un teléfono se pierde, quitar el
permiso es más rápido que cambiar contraseñas.

**Cobrar la entrada.** El operador abre `/escanear`, escribe el nombre de su
puesto una vez (queda guardado en ese teléfono) y enciende la cámara. Cada
escaneo válido muestra en grande cuántas entradas quedan y avisa cuando el
cliente baja de tres. Si su cuenta no está autorizada, la pantalla se lo dice
en lugar de encender la cámara.

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
npm test        # suite completa (182 pruebas)
npm run seed    # datos de demostración
npm run test:ui # la interfaz en un navegador real (necesita Playwright)
npm run test:camara # el escáner leyendo un QR con la cámara
```

Las pruebas corren sobre una base en memoria y cubren todas las rutas de la API:
autenticación y rotación de sesiones, desbloqueo y restablecimiento de
contraseñas, emisión y ajuste de packs, las tres barreras contra el doble
descuento, concurrencia por HTTP, el canal de tiempo real (abriendo el flujo,
leyendo lo que llega y reanudándolo tras una caída), la búsqueda sin tildes, el
camino de actualización del esquema, el expediente del cliente, el control de
acceso —por rol y por el permiso de escaneo, incluido lo que ve cada quien y lo
que no— y las cabeceras de seguridad. `npm ci && npm test` se ejecuta
también en cada empujón desde `.github/workflows/`.

Como la interfaz no pasa por ningún compilador, hay además comprobaciones
estáticas que hacen ese trabajo: que toda importación exista, que no se use una
función sin importarla, que cada `#identificador` que busca el JavaScript esté
en el HTML, y que no haya clases de CSS sin definir.

`tests/e2e/` contiene además tres pruebas en navegador real, que no entran en
`npm test` porque necesitan Playwright: `interfaz.mjs` levanta la aplicación en
el propio proceso y comprueba que la interfaz hace lo que dice (descargas,
formateo del código al teclearlo, actividad en vivo, un corte de red a mitad de
un cobro y el pase impreso); `camara.mjs` le da a Chromium un vídeo con un QR y
comprueba que el escáner lo lee y descuenta la entrada, con el lector nativo y
con el respaldo jsQR; y `flujo-completo.mjs` recorre el sistema ya instalado
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
                       expediente del cliente, auditoría, cifras del panel
                       y pases de cartera)
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

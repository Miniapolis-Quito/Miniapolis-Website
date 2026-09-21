# Diseño: verificación en dos pasos

## Problema

El escáner de la puerta descuenta entradas del saldo de un cliente. La
administración emite packs, cambia roles, restablece contraseñas y ve los datos
de todo el mundo. Hasta ahora, lo único que separaba a cualquiera de eso era
una contraseña.

Una contraseña de mostrador es el peor caso posible de contraseña: se teclea
delante de una fila de gente, se comparte «solo esta vez» entre turnos, se
apunta en un papel pegado al monitor y se reutiliza de otro sitio que ya se
filtró. El sistema tiene defensas contra adivinarla —scrypt, bloqueo por
intentos contado en la base, límites que sobreviven a un reinicio—, pero
ninguna sirve cuando el atacante **ya la sabe**.

El resto del sistema está construido sobre la idea de que ninguna pieza sola
debe bastar: el QR necesita dos secretos, el pack impreso hay que habilitarlo
uno a uno, escanear exige un permiso aparte del rol. El acceso era la excepción.

## Objetivo

Que entrar a una cuenta con permisos exija **dos cosas distintas**: algo que se
sabe (la contraseña) y algo que se tiene (el teléfono). Y que la pista pueda
**exigírselo** a su equipo sin que eso deje a nadie encerrado fuera.

## Lo que no hace

- No sustituye a la contraseña: la suma. El primer paso sigue siendo el mismo,
  con su bloqueo por intentos y sus límites.
- No usa SMS. Un mensaje de texto se intercepta y depende de la operadora; el
  código TOTP se calcula en el teléfono, sin red.
- No inventa formato propio: es TOTP (RFC 6238) con SHA-1, seis dígitos y
  tramos de treinta segundos, que es lo que leen todas las aplicaciones de
  autenticación. Un segundo factor que solo funcione con una aplicación a
  medida no lo usa nadie.
- No recuerda dispositivos de confianza. Se pide el código en cada acceso: son
  pocos accesos al día y la excepción es justo lo que hay que auditar.

## Decisiones

### El secreto se guarda cifrado

`users.totp_secret` no guarda el secreto en claro, sino cifrado con AES-256-GCM
y una clave derivada del entorno (`lib/cifrado.js`). El motivo concreto es la
copia de seguridad: una base copiada a un disco, a un correo o a un servicio de
almacenamiento no puede llevarse los segundos factores de todo el equipo.

GCM autentica además del cifrado. Editar la base a mano para plantar otro
secreto no produce un secreto distinto: produce un descifrado que falla.

**Qué pasa si la clave cambia.** Si `TWOFA_SECRET` no está definida, se deriva
por HKDF de `ACCESS_TOKEN_SECRET`, para que una instalación en marcha se
actualice sin tocar su entorno. La consecuencia es que rotar el secreto de
acceso deja ilegibles los segundos factores. Ante eso el sistema **niega el
acceso** (`dos_factores_ilegible`) y pide acudir a la administración. La
alternativa —dejar entrar solo con la contraseña cuando el secreto no se puede
leer— convertiría un error de configuración en una puerta abierta, y sería
además la forma más fácil de atacar el sistema: romper el cifrado para saltarse
el segundo factor.

### Acertar la contraseña no abre sesión

El primer paso devuelve un **desafío**: una fila en `two_factor_challenges` de
la que solo se guarda el HMAC de su token, con caducidad de cinco minutos y un
contador de intentos. No se emite token de acceso ni se toca la cookie de
refresco, así que abandonar el acceso a medias no deja nada aprovechable en el
navegador.

El desafío existe porque los intentos hay que contarlos contra **ese acceso** y
no contra la cuenta: si los contara la cuenta, cualquiera que supiera un correo
podría dejar bloqueada a esa persona a base de códigos falsos. Cinco fallos
anulan el desafío y obligan a volver a escribir la contraseña, que es la parte
cara de repetir.

El contador se incrementa **dentro** de la transacción y el error se lanza
**fuera**. Lanzarlo dentro deshacía la transacción y con ella el incremento: el
desafío admitía códigos incorrectos sin fin. Hay una prueba que lo fija.

### Un código vale una sola vez

`users.totp_last_step` guarda el último tramo de treinta segundos aceptado, y
el consumo es un `UPDATE ... WHERE totp_last_step IS NULL OR totp_last_step <
?`: la condición del propio `UPDATE` es lo que hace único el uso, aunque dos
peticiones lleguen a la vez con el mismo número.

Efecto secundario conocido: quien activa el segundo factor y vuelve a entrar en
los mismos treinta segundos tiene que esperar al código siguiente. Es el
comportamiento correcto, y la interfaz lo dice con su propio mensaje
(«Ese código ya se usó»), distinto del de un código incorrecto.

### Códigos de respaldo

Diez códigos de diez caracteres del alfabeto sin ambigüedades (unos 49 bits
cada uno), guardados por su HMAC y gastados uno a uno. Se normalizan como los
códigos de pack —mayúsculas, sin separadores, con las confusiones típicas
(O/0→Q, I/L/1→7, U→V) corregidas— porque se copian de un papel.

Con esa entropía no hace falta un hash lento: un HMAC con la clave del servidor
basta, y permite buscarlos por su hash en una sola consulta. Renovarlos exige
un código del teléfono y anula la tanda anterior entera: quien pide códigos
nuevos es porque duda de los viejos.

### La política vive en la base, no en el entorno

«El personal tiene que usarla» se guarda en `settings` (clave `seguridad`) y se
enciende desde el panel, como el programa de fidelidad. Ponerla en el entorno
obligaría a reiniciar el servicio para cambiarla, justo cuando lo que se quiere
es encenderla el día que el equipo ya la tiene configurada.

**Solo puede encenderla quien ya la tenga puesta.** Sin esa regla, un máster sin
segundo factor se cerraría la administración con un clic y la única salida
sería entrar a la base a mano.

La comprobación se hace en `requireRole` y `requireScanner`, no en cada ruta:
así ninguna ruta nueva puede olvidarse de ella. Una cuenta de personal sin
segundo factor mientras esté exigido conserva `/api/auth/**` —entra, ve su
cuenta y la configura— pero no escanea ni abre el panel.

Los permisos, sin embargo, no viven solo en esos dos guardianes, y cerrar la
API dejando abierto todo lo demás habría sido entregar por otra puerta lo que
se acaba de negar. También quedan en suspenso:

- **El canal en vivo.** `channels.staff` lleva el nombre del cliente, el código
  del pack y el saldo de cada consumo según ocurre; `channels.admin`, el
  movimiento del panel. Una cuenta pendiente se suscribe solo al suyo, y si la
  política se enciende con el canal ya abierto, la revalidación periódica lo
  cierra —igual que cuando se retira el permiso de escaneo—, de modo que al
  reconectar recibe únicamente lo propio.
- **Las rutas de uso propio que hacen una excepción con el máster.** Consultar
  los movimientos de un pack ajeno o su pase de cartera pide sesión, no rol, y
  la excepción se decide con `req.user.role === 'master'`. Ahí se usa
  `actuaComoMaster()`, que es lo mismo más «y no tiene el segundo factor
  pendiente».

### El rescate está auditado

Retirar el segundo factor de una cuenta ajena es exactamente lo que intentaría
alguien que se hiciera con el panel del máster. Por eso el rescate deja
constancia en la bitácora con su autor, cierra las sesiones de esa cuenta y
manda un correo a la persona. Es la única acción del sistema que **debilita** la
seguridad de otra cuenta, así que es la que menos puede pasar en silencio.

## Esquema

```
users
  totp_secret        TEXT     cifrado (v1.iv.etiqueta.cuerpo)
  totp_enabled       INTEGER  0/1
  totp_confirmed_at  TEXT
  totp_last_step     INTEGER  último tramo aceptado (antirreutilización)

two_factor_recovery_codes   id · user_id · code_hash (único) · used_at · used_ip
two_factor_challenges       id · user_id · token_hash (único) · attempts ·
                            created_at · expires_at · consumed_at · ip · user_agent
```

Los desafíos vencidos se borran en la misma limpieza periódica que las cuotas,
los nonces y las sesiones: no sirven ni para auditar, porque el intento fallido
ya quedó en la bitácora.

## Rutas

| Ruta | Quién | Para qué |
|---|---|---|
| `POST /api/auth/login` | cualquiera | Primer paso. Con segundo factor devuelve `{ twoFactorRequired, challengeToken }` en vez de sesión. |
| `POST /api/auth/login/2fa` | cualquiera | Segundo paso: código del teléfono o de respaldo. |
| `GET /api/auth/2fa` | con sesión | Estado y si la pista se la exige a esa cuenta. |
| `POST /api/auth/2fa/setup` | con sesión | Secreto nuevo, QR y clave para teclear. No activa nada. |
| `POST /api/auth/2fa/activate` | con sesión | Confirma con el primer código; devuelve los de respaldo. |
| `POST /api/auth/2fa/recovery-codes` | con sesión | Renueva la tanda. Exige un código. |
| `POST /api/auth/2fa/disable` | con sesión | La quita. Exige contraseña **y** código. |
| `GET/PATCH /api/admin/security` | máster | La política y el estado del equipo. |
| `POST /api/admin/users/:id/2fa/disable` | máster | Rescate de quien perdió el teléfono. |

## Qué se probó

`tests/dos-factores.test.js` cubre el algoritmo (los cinco vectores del RFC
6238, incluido el que pasa de 32 bits), el cifrado (ida y vuelta, propósito
distinto, manipulación), y los caminos completos: alta, acceso en dos pasos,
reutilización de código y de desafío, código de respaldo gastado, tope de
intentos, renovación, baja, secreto ilegible, política del equipo y rescate.

`tests/e2e/dos-factores.mjs` lo recorre en un navegador real: que el QR se
dibuje, que la clave a mano tenga la forma que espera una aplicación de
autenticación, que la página de acceso pase al segundo paso, que un código de
respaldo entre, y que el panel del máster refleje todo ello.

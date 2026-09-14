# Recuperación y cambio de contraseña

## Objetivo

Que cualquier persona con cuenta pueda recuperar el acceso sin pasar por
recepción, y que cambiar la contraseña sea igual de seguro, sin abrir con ello
una puerta nueva para quien quiera entrar en una cuenta ajena. Sigue la guía
«Forgot Password» de OWASP.

## Recuperación por correo

### Pedir el enlace — `POST /api/auth/password/forgot`

- Responde **siempre** `202` con el mismo cuerpo, exista o no la cuenta, y
  **antes** de buscarla: la búsqueda, los límites y el envío ocurren después
  de responder. Ni el contenido ni el tiempo de respuesta dicen nada.
- Límite por IP visible (`429`): no revela nada de ninguna cuenta.
- Límites por correo **silenciosos** (uno por minuto y tres por hora): frenan
  el bombardeo de correos a una víctima sin delatar si la cuenta existe.
- Cuentas inexistentes o suspendidas: no se envía nada.
- Pedir un enlace nuevo invalida los anteriores de esa cuenta.

### El token

- 32 bytes aleatorios (256 bits) en base64url.
- En la base solo se guarda su HMAC-SHA256 con clave derivada del secreto del
  servidor. Quien lea la base no puede usar los enlaces pendientes.
- Vale `PASSWORD_RESET_TTL_SECONDS` (30 minutos por defecto) y una sola vez.

### El enlace

- `PUBLIC_URL/restablecer#token=…`. El dominio sale de la configuración,
  nunca de la cabecera `Host`: un atacante no puede hacer que el correo
  apunte a su servidor.
- El token va en el **fragmento**: el navegador no lo manda al servidor, así
  que no acaba en los logs del proxy ni en la cabecera `Referer`. Los
  escáneres de correo que abren enlaces no lo consumen: canjearlo exige un
  `POST` desde la página.
- La página borra el fragmento de la barra de direcciones nada más leerlo.

### Canjearlo — `POST /api/auth/password/reset`

- Contraseña nueva con la misma validación de robustez que el registro, y
  distinta de la actual. Si no la cumple, el enlace **no** se gasta.
- El canje es atómico: se marca como usado con una condición en la propia
  actualización, dentro de la misma transacción que cambia la contraseña. Dos
  canjes simultáneos del mismo enlace: solo uno gana.
- Al cambiarla se revocan todas las sesiones, se sube la versión de los
  tokens, se levanta el bloqueo por intentos fallidos y se invalidan los
  demás enlaces.
- **No** se inicia sesión automáticamente: se vuelve a la página de acceso.
- Se avisa por correo del cambio.

`POST /api/auth/password/reset/check` comprueba un enlace sin gastarlo, para
que la página diga «este enlace ya no sirve» antes de pedir nada.

### Se invalidan los enlaces pendientes cuando

- se cambia la contraseña por cualquier vía;
- administración cambia el correo, el rol o el estado de la cuenta;
- se pide un enlace nuevo.

## Cambio de contraseña con sesión

- Exige la contraseña actual (ya existía).
- **Nuevo:** cinco fallos con la contraseña actual en una hora cierran la
  sesión en uso. Quien roba una sesión abierta no puede quedarse probando
  contraseñas para después cambiarla.
- **Nuevo:** el personal y el máster también pueden cambiar la suya desde la
  cabecera; antes solo había formulario para clientes.
- **Nuevo:** confirmación de la contraseña nueva en la interfaz.
- **Corregido:** quien cambia su contraseña se queda dentro. El servidor avisa
  por el canal en vivo a todas las pantallas para que vuelvan a la de acceso, y
  ese aviso también echaba a la pestaña que hizo el cambio, a veces antes de
  recibir su sesión nueva. Ahora esa pestaña espera a que termine el cambio y
  sigue con la sesión nueva; las demás cierran como siempre. Es solo
  comportamiento de pantalla: quien decide si una sesión vale es el servidor.
- **Nuevo:** aviso por correo en cada cambio: propio, por enlace o por
  administración. El aviso nunca incluye la contraseña.

## Correo

- SMTP mediante nodemailer, con TLS obligatorio (salvo a un relé local) y
  certificados verificados. Sin acceso a archivos ni URL desde los mensajes.
- Sin configuración de correo o sin `PUBLIC_URL`, la recuperación queda
  apagada: la página de acceso sigue diciendo «acércate a recepción».
- Transportes auxiliares: `memoria` (solo en pruebas) y `consola` (solo fuera
  de producción, para desarrollar sin servidor de correo).
- Los textos del correo escapan el nombre de la persona en la versión HTML.

## Auditoría

- `password.recuperacion_solicitada`: se envió un enlace.
- `password.restablecida_por_correo`: se canjeó.
- `password.cambio_bloqueado`: sesión cerrada por fallos con la contraseña actual.

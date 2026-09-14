# Diseño: el escáner sigue cobrando sin conexión

## Problema

La pista vive de su puerta. Hoy, si se cae Internet, el escáner deja de
servir: la guía le pide al personal que **anote los códigos en papel** y los
descuente después a mano. En la práctica eso significa colas, códigos mal
copiados, entradas que nunca se cobran y ninguna constancia de quién entró.

El sistema ya tolera un corte breve (un único consumo pendiente con su clave
de idempotencia y un botón *Reintentar*), pero no una tarde entera sin señal,
ni que el teléfono se reinicie, ni que alguien recargue la página.

## Objetivo

Que el personal pueda seguir leyendo QR y códigos durante un corte, que cada
lectura quede guardada en el teléfono con su hora real, y que al volver la
señal el servidor la cobre **con las mismas reglas que si hubiera llegado en su
momento** — sin que ninguna barrera contra el fraude o el doble descuento se
relaje, y sin que una entrada que no se pudo cobrar pase desapercibida.

## Lo que no hace

- No valida la firma del QR en el teléfono: el secreto del pack nunca sale del
  servidor y así debe seguir.
- No descarga saldos ni nombres de clientes al teléfono. Un teléfono perdido
  no debe llevarse la lista de clientes.
- No toca la app del cliente. Si el cliente tampoco tiene señal, su QR caduca
  como siempre y el camino es el de siempre: el código del pack o el pase
  impreso.

## Servidor

### Hora de lectura

`POST /api/scan` y `POST /api/scan/manual` aceptan dos campos opcionales, que
van siempre juntos:

- `capturedAt`: cuándo se leyó el código, con el reloj del teléfono.
- `sentAt`: cuándo se envía, con el mismo reloj.

El servidor no se fía del reloj del teléfono, solo de la **diferencia** entre
los dos: `hora de lectura = ahora en el servidor − (sentAt − capturedAt)`. Un
teléfono con la hora mal puesta lee y envía con el mismo desfase, así que la
diferencia es correcta igual.

- Diferencia negativa (más de 5 s de margen) → `400 lectura_hora_invalida`.
- Diferencia mayor que `OFFLINE_SCAN_MAX_HOURS` → `409 lectura_vencida`. Con
  `OFFLINE_SCAN_MAX_HOURS=0` el modo queda apagado: solo se aceptan lecturas de
  hasta un minuto, que es lo que tarda un reintento de red.

### Reglas evaluadas a la hora de lectura

| Barrera | Cómo se aplica a una lectura diferida |
|---|---|
| Firma del QR | Igual que siempre. |
| Vigencia del QR | Se mide contra la hora de lectura: un QR que valía cuando se leyó, vale. Uno que ya había caducado, no. |
| Nonce de un solo uso | Igual que siempre. Los nonces se conservan ahora hasta que ya no pueda llegar ninguna lectura diferida de ese QR (`marca del QR + vigencia + ventana sin conexión`), así que el mismo QR leído por un puesto en línea y otro sin conexión solo se cobra una vez. |
| Tiempo de espera | Se busca cualquier consumo confirmado del pack a menos de `REDEEM_COOLDOWN_SECONDS` de la hora de lectura, antes o después. Dos lecturas del mismo pack con 5 s de diferencia siguen siendo un doble disparo aunque lleguen juntas una hora después; dos con 30 s, no. |
| Pack vencido | Cuenta la fecha de vencimiento a la hora de lectura: quien entró a las 23:50 del último día no pierde su entrada porque la señal volvió al día siguiente. |
| Pack anulado o suspendido, cuenta suspendida, sin saldo | Estado actual. Son decisiones de administración y el sistema no puede saber si fueron anteriores a la lectura. |
| Idempotencia | Igual: la clave de la lectura es la del primer intento en línea, así que si el servidor llegó a cobrarla antes del corte, la sincronización recibe la respuesta original en vez de un «QR ya usado». Las respuestas se recuerdan al menos una hora más que la ventana sin conexión: un código tecleado no tiene nonce, y olvidar la respuesta antes lo cobraría dos veces. |

### Qué se guarda

- `redemptions.created_at` es la **hora de lectura**: es cuándo entró la
  persona, y es lo que usan el historial del cliente y las cifras del día.
- `redemptions.synced_at` (nueva, nula en los consumos en línea) es cuándo
  llegó al servidor.
- `pack_movements.created_at` sigue siendo la hora en que cambió el saldo. El
  libro mayor se mantiene en orden y la verificación de integridad no cambia.

### Lecturas que no se pudieron cobrar

Cada rechazo definitivo de una lectura diferida deja un registro
`escaneo_sin_conexion.rechazado` en la auditoría con el pack, el cliente, el
motivo, la hora de lectura, el operador y el puesto, en la ficha del cliente.
El **Resumen** del máster muestra una tarjeta con los que nadie ha resuelto: son
personas que entraron sin que se les descontara la entrada. Se cierran con
*Marcar resuelta* y una nota (`escaneo_sin_conexion.resuelto`), que también
queda en la ficha.

## Teléfono del personal

### Cuándo se guarda una lectura

- Si el navegador ya sabe que no hay red, o el último intento falló por red,
  la lectura se guarda al instante, sin esperar a que falle otra petición.
- Si hay red, se intenta en línea con un límite de 6 s. Si falla por red o por
  tiempo, se guarda **con la misma clave de idempotencia**.

Antes de guardar se comprueba lo que se puede comprobar sin el servidor: que el
texto sea un QR de la pista o un código bien formado, que el QR no haya
caducado (con el desfase de reloj medido la última vez que hubo conexión), que
no esté ya guardado, y que no haya otra lectura guardada del mismo pack dentro
del tiempo de espera.

### Almacenamiento

Una clave de `localStorage` por lectura (`rh_lectura:<id>`): la escritura es
síncrona, así que una lectura confirmada en pantalla ya está en disco aunque el
teléfono se apague un segundo después, y dos pestañas nunca se pisan una lista
compartida. Cada lectura guarda quién la hizo: solo se envía con la sesión de
esa misma persona.

Si el navegador no deja guardar nada, el modo sigue funcionando en memoria y la
pantalla lo advierte.

### Sincronización

- Se dispara al volver la red, al reconectar el canal en vivo, cada 20 s
  mientras quede algo pendiente y con el botón *Enviar ahora*.
- Una sola pestaña sincroniza a la vez (Web Locks), en orden de lectura.
- Confirmada → se borra. Fallo de red, servidor ocupado o conflicto de
  concurrencia → se reintenta más tarde. Rechazo definitivo → pasa a *Por
  revisar* con el motivo, suena la alarma, y se queda en pantalla hasta que el
  operador toque *Entendido*.

### Abrir el escáner sin señal

Un service worker con alcance `/escanear` guarda la página y sus recursos
(red primero, caché si falla o tarda más de 4 s). Nunca toca `/api/`.

Si la página arranca sin red y en ese teléfono hubo una sesión de personal en
las últimas `OFFLINE_SCAN_MAX_HOURS` que no se cerró con *Salir*, el escáner
abre en modo sin conexión con el nombre de esa persona. Esa identidad se borra
al entrar con cualquier cuenta, al salir desde cualquier página y cuando el
servidor da la sesión por perdida. En cuanto vuelve la red se renueva la sesión
de verdad; si ya no es válida, se va a la página de acceso y las lecturas
esperan a que esa persona vuelva a entrar.

## Seguridad

- El endpoint es el mismo, solo para personal, con sus límites y su auditoría.
  Una lectura diferida no permite nada que el ingreso manual por código no
  permita ya a un operador.
- Una captura de pantalla vieja no sirve más que antes: el QR se juzga a la
  hora de lectura, y esa hora solo puede retrasarse hasta la ventana
  configurada.
- El teléfono solo guarda lo que leyó: código de pack y QR de corta vida. Nada
  de saldos, correos ni secretos.

## Pruebas

- API: lectura diferida válida, QR caducado al leerlo, lectura fuera de la
  ventana, hora imposible, reloj del teléfono desfasado, espera por hora de
  lectura en los dos sentidos, QR cobrado en línea y reenviado sin conexión,
  reintento de la misma clave, pack vencido después de la lectura, modo
  apagado, registro y tarjeta de rechazos, cifras del día por hora de lectura.
- Reglas del teléfono: módulo sin DOM probado con `node:test`.
- Estáticas: el service worker guarda todos los módulos que carga el escáner.
- Navegador (`tests/e2e/sin-conexion.mjs`): cortar la red, leer, recargar la
  página sin red, volver a tener red y ver el saldo del cliente bajar.

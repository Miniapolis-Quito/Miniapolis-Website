# Diseño: el programa de fidelidad «la casa invita»

## Problema

La pista ya sabe vender packs y recuperar a quien deja de venir. Lo que no
tiene es una razón para volver **antes** de que el cliente se enfríe: el que
viene cada sábado recibe exactamente el mismo trato que el que viene una vez al
año. Las pistas resuelven esto con una tarjeta de sellos —«cada diez lavados,
uno gratis»—, pero una tarjeta de cartón se pierde, se falsifica y obliga a
alguien del mostrador a acordarse de sellarla.

Hasta ahora, regalar entradas solo se podía hacer a mano: *Ajustar entradas* en
la ficha del cliente, con su motivo. Funciona para una cortesía puntual; no
para una promesa que el cliente pueda dar por hecha.

## Objetivo

Que la pista pueda prometer «cada N entradas usadas, la siguiente la ponemos
nosotros» y que esa promesa **se cumpla sola**: sin que nadie del mostrador
tenga que acordarse, sin que se pueda cobrar dos veces el mismo premio, y sin
que un premio ya ganado se pierda porque el servidor se reinició.

## Lo que no hace

- No es un monedero ni un sistema de puntos canjeables por cosas distintas: lo
  que se gana son entradas, que es lo que la pista vende.
- No cuenta dinero gastado, sino entradas usadas. Quien compra un pack y no
  viene no acumula nada: el programa premia venir, no comprar.
- No toca el camino del cobro en la puerta. El premio se evalúa **después** de
  descontar la entrada y nunca puede hacer que un escaneo falle.
- No permite regalar a mano desde esta pantalla: para eso ya está el ajuste de
  la ficha, que pide motivo y queda en el expediente.

## Modelo

### De dónde salió cada pack

`packs.origin` (`sale` · `transfer` · `loyalty`) responde a una pregunta que
antes se deducía del precio y de la forma de pago. Hace falta para tres cosas:

1. Las entradas de un pack de cortesía **no cuentan** para ganar el siguiente
   premio. Sin esta columna, la casa se invitaría a sí misma.
2. Un pack regalado no genera comprobante de compra: el aviso que sale es otro.
3. Los informes pueden separar lo vendido de lo regalado.

Las bases existentes se rellenan en la migración: los packs nacidos de una
transferencia se reconocen por cómo los crea el sistema (precio cero, forma de
pago `transferencia` y referencia `from:<código>`); el resto son ventas.

### El registro de premios

```sql
CREATE TABLE loyalty_rewards (
  id, user_id, pack_id, sequence, tickets, threshold, counted, created_at,
  UNIQUE (user_id, sequence)
);
```

`sequence` es el número de premio de esa persona (1, 2, 3…). Es único por
cliente, y es **la pieza que hace idempotente todo el proceso**: dos
evaluaciones simultáneas no pueden crear el mismo premio.

`threshold` se guarda en cada fila en vez de leerse de los ajustes, porque el
umbral puede cambiar y el progreso de quien ya ganó tiene que seguir cuadrando.

### El progreso no se guarda: se calcula

```
contadas    = entradas usadas (consumos confirmados, packs no-cortesía)
              desde `countingSince`
acreditadas = suma de `threshold` de los premios dados desde `countingSince`
avance      = max(0, contadas − acreditadas)
progreso    = avance mod umbral        falta = umbral − progreso
```

De ahí salen tres propiedades sin escribir una línea más:

- **Idempotencia.** Volver a evaluar lo mismo no regala nada: cada premio
  acredita sus entradas y el avance baja con él.
- **Anular un consumo resta.** Las contadas bajan; si el avance queda negativo
  se muestra en cero y el siguiente premio espera a que se recupere lo
  devuelto. Un premio ya entregado no se retira: el cliente ya entró con él.
- **Encender no premia por el pasado.** `countingSince` se fija al encender el
  programa, así que lo usado antes no cuenta. Apagarlo y volver a encenderlo
  fija un `countingSince` nuevo: el avance acumulado se pierde, y el panel lo
  advierte antes de apagar. Es la alternativa segura: si se conservara, una
  pausa larga podría soltar una ráfaga de premios al reanudarlo.

## Otorgar un premio: dos pasos

1. **Reservar** (en transacción): se recalcula el avance, y si llega al umbral
   se inserta la fila del premio con `pack_id = NULL`. La clave única decide
   quién gana si dos lecturas entran a la vez.
2. **Completar**: se emite el pack de cortesía (`origin = 'loyalty'`, precio
   cero, forma de pago *cortesía*, vencimiento según los ajustes), se anota su
   id en la reserva, se registra en la bitácora, se publica el evento en vivo y
   se encola el correo.

Separarlo en dos pasos es lo que hace que **un premio ganado no se pierda**. Si
el proceso se cae entre medias, o la cuenta del cliente está suspendida y no se
le puede acreditar nada, la reserva queda pendiente: el barrido de
mantenimiento la completa después. El panel muestra las reservas pendientes.

### Cuándo se evalúa

| Momento | Por qué |
|---|---|
| Después de cada consumo cobrado | Es cuando se gana. El premio aparece en el teléfono del cliente mientras sigue en la puerta. |
| Barrido de mantenimiento (cada 10 min) | Completa reservas pendientes y recoge lo que un reinicio o una cuenta suspendida dejaron a medias. |
| Al guardar los ajustes | Bajar el umbral puede dejar premios ya ganados; se entregan en el acto. |
| *Otorgar ahora*, en el panel | La misma revisión, a petición del máster. |

La evaluación posterior al cobro va **fuera de la transacción del consumo y en
silencio**: la puerta no puede detenerse por un regalo. Si algo falla, queda en
el registro y el barrido lo recoge.

## Ajustes

Viven en `settings` bajo la clave `loyalty`, como los de avisos, y se cambian
desde el panel sin tocar el entorno:

| Ajuste | De fábrica | Rango |
|---|---|---|
| `enabled` | **apagado** | — |
| `entriesPerReward` | 10 | 2–100 |
| `rewardTickets` | 1 | 1–20 |
| `rewardExpiryDays` | 60 | 0–365 (0 = no vence) |

El premio tiene que ser **menor** que las entradas que hay que usar para
ganarlo; si no, la pista regalaría más de lo que vende, y el sistema lo rechaza
con ese mensaje.

Viene apagado a propósito: una instalación que se actualiza no puede empezar a
regalar entradas por sorpresa.

## Avisos

El premio es un tipo más de la cola de correos (`loyalty_reward`), con la misma
mecánica de siempre: clave única por premio, revalidación antes de salir (si el
pack se anuló, se descarta) y reintentos. Dos diferencias, por lo que es:

- **No es un recordatorio.** Sale en el acto, sin esperar al horario de envío, y
  llega aunque la persona se haya dado de baja de los recordatorios: es un hecho
  de su saldo, igual que el comprobante de compra.
- **No genera comprobante de compra.** El pack de cortesía se excluye de esa
  detección; lo que llega es el correo del premio.

Si los avisos están apagados, el premio se entrega igual: solo no se anuncia.

## Interfaz

**Cliente** (`/app`): una tarjeta de sellos —un punto por entrada del ciclo, el
último marcado como premio— con cuántas entradas le faltan. Con umbrales
grandes, una barra. Al ganar, el evento en vivo lo celebra con un brindis y el
pack de cortesía aparece en su lista marcado como regalo, no como un pack de
precio cero.

**Puerta** (`/escanear`): el premio se gana en la puerta, así que quien escanea
recibe el aviso en su pantalla y puede decírselo a la persona que tiene delante,
en vez de que lo descubra sola en el correo.

**Máster** (`/admin` → Fidelidad): el estado del programa, lo regalado en
entradas y en dinero (al precio medio de la entrada vendida), los últimos
premios y **a quién le falta poco**, que es lo que el mostrador necesita para
poder decírselo cuando esa persona pase por recepción. La ficha del cliente
lleva su tarjeta y sus premios, para responder al «¿y mi entrada gratis?» sin
cambiar de pantalla.

## Seguridad y contabilidad

- Solo el máster ve y cambia el programa; el personal y los clientes reciben
  `403`.
- Cada premio deja una entrada propia en la bitácora
  (`fidelidad.recompensa_otorgada`) y el pack, su asiento `issue` en el libro
  mayor: la verificación de integridad sigue cuadrando.
- Un pack de cortesía vale cero, así que no infla los ingresos del panel.
- El QR impreso no se habilita en los packs regalados: lo que no rota se puede
  copiar, y un regalo no es motivo para relajar esa regla.

## Pruebas

`tests/fidelidad.test.js` cubre el encendido (y que no premie por el pasado),
la emisión del premio con todo su rastro, la idempotencia con escaneos
simultáneos por HTTP, que las entradas de cortesía no cuenten, la admisión
grupal, las anulaciones antes y después del premio, la cuenta suspendida, la
reserva huérfana que completa el barrido, los cambios de umbral, los avisos
(incluida la baja de recordatorios y el pack anulado) y el control de acceso.
`tests/e2e/fidelidad.mjs` recorre en un navegador real el encendido desde el
panel, la tarjeta de sellos llenándose en vivo, el premio llegando a la vez al
teléfono del cliente y a la pantalla de la puerta, y lo que queda después en el
panel y en la ficha.

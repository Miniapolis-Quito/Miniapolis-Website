# Avisos a clientes y clientes por recuperar

## Objetivo

El sistema cobra entradas muy bien, pero no hace nada para que el cliente
vuelva a comprar. Nadie se entera de que a alguien le queda una entrada, de que
un pack con saldo está a punto de vencer, o de que un cliente con entradas
pagadas lleva un mes sin venir. Cada uno de esos casos es dinero: una recompra
que no ocurre, una entrada pagada que se pierde y deja mal sabor, un cliente
que se va sin que nadie lo note.

Esta funcionalidad le da a la pista dos herramientas que se complementan:

1. **Avisos automáticos por correo**: comprobante al vender un pack y
   recordatorios cuando quedan pocas entradas, cuando se acaban, cuando un pack
   está por vencer y cuando alguien deja de venir.
2. **Clientes por recuperar**: una lista de trabajo en administración con esas
   mismas situaciones, lista para escribir por WhatsApp o llamar con un toque
   —que es como se habla con los clientes en Ecuador— y dejando constancia de
   quién contactó a quién.

La lista funciona aunque no haya correo configurado: una pista pequeña puede no
tener SMTP y aun así recuperar clientes a mano.

## Principios

- **Nada sale sin que el máster lo encienda.** Una instalación que se actualiza
  no empieza a escribir a sus clientes por sorpresa. Los avisos vienen
  apagados y se activan desde el panel, sin tocar `.env`.
- **Nunca un aviso viejo ni equivocado.** Cada aviso se vuelve a comprobar
  justo antes de enviarse: si el cliente ya compró otro pack, si le devolvieron
  una entrada o si el pack se anuló, el aviso se descarta con su motivo.
- **Nunca dos veces lo mismo.** Cada aviso automático lleva una clave única en
  la base (`notifications.dedupe_key`). Ni un reinicio ni dos ciclos
  simultáneos pueden duplicarlo.
- **Nunca de madrugada.** Los recordatorios esperan al horario de envío de la
  pista (por defecto de 9:00 a 20:00, en su zona horaria). El comprobante de
  compra sale en el acto, porque la persona está en el mostrador.
- **Sin agobiar.** Como mucho un recordatorio cada 48 horas por persona, y si ya
  se le recordó algo después de su última visita, no se le vuelve a escribir
  por inactividad.
- **Darse de baja es fácil y real.** Cada recordatorio lleva un enlace para no
  recibir más, y la cabecera `List-Unsubscribe` de un solo clic (RFC 8058) que
  Gmail y Outlook muestran junto al remitente. El cliente también lo cambia en
  «Mi cuenta». El comprobante de compra no es publicidad y siempre llega.

## Tipos de aviso

| Tipo (`kind`) | Cuándo | Clave única |
|---|---|---|
| `purchase` | Se emite un pack | `purchase:<pack>` |
| `low_balance` | Tras un consumo, al cliente le quedan entre 1 y el umbral (2) | `low_balance:<cliente>:<último pack>` |
| `depleted` | Tras un consumo, al cliente no le queda ninguna entrada usable | `depleted:<cliente>:<último pack>` |
| `expiring` | Un pack con saldo vence dentro de N días (7) | `expiring:<pack>:<vencimiento>` |
| `inactive` | Cliente con saldo sin venir desde hace N días (30) | `inactive:<cliente>:<última actividad>` |

- El «ciclo» de `low_balance` y `depleted` es el último pack comprado: una
  compra nueva abre un ciclo y permite volver a avisar más adelante.
- `expiring` lleva la fecha en la clave: si el máster amplía el vencimiento, el
  recordatorio puede volver a salir cuando se acerque la fecha nueva.
- «Última actividad» es la visita más reciente o la compra más reciente: quien
  acaba de comprar no está inactivo.
- Los avisos que dependen de un hecho (`purchase`, `low_balance`, `depleted`)
  solo se generan para hechos posteriores a la activación y de las últimas 48
  horas. Encender los avisos no escribe a todos los que compraron el año pasado.
- Las cuentas suspendidas no reciben nada. Quien se dio de baja no recibe
  recordatorios, pero sí comprobantes.

## Ciclo de vida

```
pending ──► sending ──► sent
   │           │
   │           └──► pending (fallo temporal, reintento a 5 min, 30 min, 2 h)
   │                   └──► failed (al cuarto intento)
   └──► discarded (ya no aplica, baja, cuenta suspendida, tipo apagado, caducado)
```

- **Detección** (`detectar`): consultas sobre el estado actual que insertan
  filas `pending` con `ON CONFLICT(dedupe_key) DO NOTHING`.
- **Despacho** (`despachar`): toma un lote por prioridad
  (`depleted` > `low_balance` > `purchase` > `expiring` > `inactive`),
  revalida, respeta el horario y el espaciado, lo marca `sending` con una
  actualización condicional y envía.
- Un aviso que quedó en `sending` porque el proceso se cayó a mitad vuelve a
  `pending` a los 15 minutos.
- Un aviso pendiente durante más de 7 días se descarta como `caducado`.
- El ciclo corre cada minuto y, además, pocos segundos después de una venta o
  un consumo, para que el comprobante llegue mientras la persona sigue en el
  mostrador. Nunca hay dos ciclos a la vez.

## Contactos a mano

`channel = 'whatsapp' | 'phone'` y `status = 'logged'`. Se registran al pulsar
**WhatsApp** o **Llamar** en la lista de clientes por recuperar. El enlace de
WhatsApp (`wa.me`) lleva ya escrito un mensaje breve que depende de la
situación. El número se normaliza con el prefijo del país (por defecto `593`):
`0991112233` → `593991112233`.

Un cliente contactado en los últimos 7 días sigue en la lista, al final y
marcado con quién lo contactó y cuándo, para que dos personas del mostrador no
le escriban lo mismo.

## Ajustes

Viven en la tabla `settings` (clave `notifications`), se editan desde el panel y
quedan en la auditoría:

| Ajuste | Por defecto | Rango |
|---|---|---|
| Avisos automáticos activados | no | — |
| Tipos activos | todos | — |
| Umbral de «quedan pocas» | 2 | 1–10 |
| Días antes del vencimiento | 7 | 1–60 |
| Días sin venir | 30 | 7–365 |
| Horario de envío | 9 a 20 | horas 0–24, desde < hasta |
| Prefijo de WhatsApp | 593 | 1–4 dígitos |

## Enlace de baja

- Token: `<id de usuario>.<HMAC-SHA256>` con clave derivada del secreto del
  servidor. No caduca y solo sirve para cambiar esa preferencia.
- En el cuerpo del correo: `PUBLIC_URL/recordatorios#t=<token>`. La página no
  da de baja al abrirse —los antivirus de correo abren los enlaces— sino al
  pulsar el botón, y ofrece volver a activarlos.
- En la cabecera: `List-Unsubscribe: <PUBLIC_URL/api/notifications/unsubscribe?t=<token>>`
  y `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. El proveedor de correo
  hace un POST sin cookies ni origen, que es justo lo que admite esa ruta.
- Sin `PUBLIC_URL` no hay enlaces: el correo dice que se desactivan en
  «Mi cuenta».

## Superficies

- **Administración → Avisos**: estado y ajustes, cifras de 30 días, clientes por
  recuperar en cuatro grupos (con las entradas pagadas en juego), e historial de
  avisos con su estado y motivo. Botón para mandarse un correo de prueba.
- **Ficha del cliente**: los avisos y contactos aparecen en la actividad; en
  Datos se ve y se cambia si recibe recordatorios.
- **App del cliente**: «Mi cuenta» tiene el interruptor de recordatorios cuando
  la pista los tiene activados.
- **`/recordatorios`**: página pública del enlace de baja.

## Fuera de alcance

- SMS o WhatsApp automáticos (necesitan un proveedor de pago y plantillas
  aprobadas por Meta).
- Campañas masivas con texto libre.

/**
 * Lo que se puede hacer con un pack o con un consumo, en un solo sitio.
 *
 * Estas acciones se ofrecen en dos pantallas —la ficha del cliente y el detalle
 * del pack en la pestaña de packs—, y estaban escritas dos veces. Ya se había
 * notado: una de las dos se quedó sin la acción de cambiar el vencimiento, y en
 * la otra faltaba avisar cuando una acción fallaba. Con una sola versión, lo
 * que se arregla se arregla en los dos lados.
 *
 * Quien llama decide qué hacer después de cada cambio (`alCambiar`) y cómo se
 * imprime un pase (`alImprimir`), que es lo único que cambia entre pantallas.
 */
import { el, brindis, confirmar, pedirTexto, fecha, finDelDiaIso } from './ui.js';
import { api } from './api.js';

/** Ejecuta una acción avisando por pantalla si falla, en vez de callar. */
async function intentar(accion) {
  try {
    await accion();
  } catch (error) {
    brindis(error.message, 'error');
  }
}

/** Ajuste manual de entradas: cuánto y por qué, siempre con motivo. */
export async function ajustarPack(pack, alCambiar) {
  const cantidad = await pedirTexto({
    titulo: `Ajustar entradas de ${pack.code}`,
    mensaje: 'Un número positivo acredita entradas y uno negativo las descuenta. El ajuste queda registrado con tu nombre.',
    etiqueta: 'Cantidad (por ejemplo: 2 o -1)',
    textoAceptar: 'Siguiente',
    minimo: 1,
  });
  if (cantidad === null) return;

  const delta = Number.parseInt(cantidad, 10);
  if (!Number.isInteger(delta) || delta === 0) {
    brindis('Escribe un número entero distinto de cero.', 'error');
    return;
  }

  const motivo = await pedirTexto({
    titulo: 'Motivo del ajuste',
    mensaje: `Se ${delta > 0 ? 'acreditarán' : 'descontarán'} ${Math.abs(delta)} entrada(s) en ${pack.code}.`,
    etiqueta: 'Motivo',
    textoAceptar: 'Aplicar ajuste',
  });
  if (!motivo) return;

  await intentar(async () => {
    await api.post(`/api/admin/packs/${pack.id}/adjust`, { delta, reason: motivo });
    brindis('Ajuste aplicado.', 'ok');
    await alCambiar?.();
  });
}

/** Anular es definitivo, así que el aviso dice exactamente qué se pierde. */
export async function anularPack(pack, alCambiar) {
  const seguro = await confirmar({
    titulo: `Anular ${pack.code}`,
    mensaje: `El pack quedará inutilizable de forma permanente y el cliente perderá sus ${pack.remaining} entrada(s) restantes. Esto no se puede deshacer.`,
    textoAceptar: 'Anular pack',
    peligro: true,
  });
  if (!seguro) return;

  await intentar(async () => {
    await api.patch(`/api/admin/packs/${pack.id}`, { status: 'cancelled' });
    brindis('Pack anulado.', 'ok');
    await alCambiar?.();
  });
}

/**
 * Cambia (o quita) la fecha de vencimiento.
 *
 * Darle fecha nueva a un pack vencido es, en el mostrador, devolverlo al
 * servicio: se hace en un solo movimiento, porque reactivarlo sin tocar la
 * fecha volvería a vencerlo en el acto.
 */
export async function cambiarVencimiento(pack, alCambiar) {
  const elegida = await pedirTexto({
    titulo: `Vencimiento de ${pack.code}`,
    mensaje: 'Déjalo vacío para que el pack no caduque.',
    etiqueta: 'Vence el',
    tipo: 'date',
    valorInicial: pack.expiresAt ? pack.expiresAt.slice(0, 10) : '',
    textoAceptar: 'Guardar fecha',
    minimo: 0,
  });
  if (elegida === null) return;

  // Hasta el final de ese día en la pista, no en la zona horaria de quien tenga
  // abierto el panel: el máster puede estar mirando desde otro país.
  const expiresAt = elegida ? finDelDiaIso(elegida) : null;
  const cambios = { expiresAt };
  const seguiraVigente = expiresAt === null || Date.parse(expiresAt) > Date.now();
  if (pack.status === 'expired' && seguiraVigente) cambios.status = 'active';

  await intentar(async () => {
    await api.patch(`/api/admin/packs/${pack.id}`, cambios);
    brindis(
      expiresAt ? `El pack vence el ${fecha(expiresAt, { conHora: false })}.` : 'El pack ya no caduca.',
      'ok',
    );
    await alCambiar?.();
  });
}

async function alternarEstado(pack, alCambiar) {
  const suspender = pack.status !== 'suspended';
  await intentar(async () => {
    await api.patch(`/api/admin/packs/${pack.id}`, { status: suspender ? 'suspended' : 'active' });
    brindis(suspender ? 'Pack suspendido.' : 'Pack reactivado.', 'ok');
    await alCambiar?.();
  });
}

async function alternarQrImpreso(pack, alCambiar) {
  await intentar(async () => {
    await api.patch(`/api/admin/packs/${pack.id}`, { allowStaticQr: !pack.allowStaticQr });
    brindis(pack.allowStaticQr ? 'QR impreso desactivado.' : 'QR impreso activado.', 'ok');
    await alCambiar?.();
  });
}

/**
 * Botones de acción de un pack, listos para insertar.
 *
 * @param {object} pack proyección pública del pack
 * @param {{alCambiar?: Function, alImprimir?: Function, extra?: Array}} opciones
 */
export function botonesDePack(pack, { alCambiar, alImprimir, extra = [] } = {}) {
  const boton = (texto, onClick, clase = 'boton--fantasma') =>
    el('button', { class: `boton boton--chico ${clase}`, type: 'button', onClick }, texto);

  return [
    ...extra,
    boton('Ajustar entradas', () => ajustarPack(pack, alCambiar)),
    pack.status !== 'cancelled'
      ? boton(
          pack.status === 'suspended' ? 'Reactivar pack' : 'Suspender pack',
          () => alternarEstado(pack, alCambiar),
          pack.status === 'suspended' ? 'boton--ok' : 'boton--fantasma',
        )
      : null,
    pack.status !== 'cancelled'
      ? boton(pack.expiresAt ? 'Cambiar vencimiento' : 'Poner vencimiento', () => cambiarVencimiento(pack, alCambiar))
      : null,
    boton(pack.allowStaticQr ? 'Desactivar QR impreso' : 'Activar QR impreso', () => alternarQrImpreso(pack, alCambiar)),
    pack.allowStaticQr && alImprimir ? boton('Imprimir pase', () => alImprimir(pack)) : null,
    pack.status !== 'cancelled' ? boton('Anular pack', () => anularPack(pack, alCambiar), 'boton--peligro') : null,
  ].filter(Boolean);
}

/**
 * Anula un consumo y devuelve la entrada al cliente.
 *
 * Se ofrece en tres sitios —la ficha, el detalle del pack y la lista de
 * consumos—, y estaba escrito tres veces con tres mensajes distintos para la
 * misma operación. El aviso nombra a quien se le devuelve y a qué pack, cuando
 * se sabe, porque es lo que quien anula necesita confirmar antes de pulsar.
 */
export async function anularConsumo(item, alCambiar) {
  const aQuien = item.customerName ? ` a ${item.customerName}` : '';
  const enQue = item.packCode ? ` en el pack ${item.packCode}` : '';
  const motivo = await pedirTexto({
    titulo: 'Anular consumo',
    mensaje: `Se devolverá una entrada${aQuien}${enQue}. Queda registrado quién lo hizo y por qué.`,
    etiqueta: 'Motivo de la anulación',
    textoAceptar: 'Anular y devolver',
  });
  if (!motivo) return;

  await intentar(async () => {
    await api.post(`/api/admin/redemptions/${item.id}/void`, { reason: motivo });
    brindis('Entrada devuelta al cliente.', 'ok');
    await alCambiar?.();
  });
}

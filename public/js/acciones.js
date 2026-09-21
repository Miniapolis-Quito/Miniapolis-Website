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
import { el, render, brindis, confirmar, pedirTexto, fecha, finDelDiaIso, copiar, conCarga } from './ui.js';
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
    mensaje: 'Un número positivo suma entradas y uno negativo las quita. El ajuste queda guardado con tu nombre.',
    etiqueta: 'Cantidad (por ejemplo: 2 o -1)',
    textoAceptar: 'Siguiente',
    minimo: 1,
  });
  if (cantidad === null) return;

  const delta = Number.parseInt(cantidad, 10);
  if (!Number.isInteger(delta) || delta === 0) {
    brindis('Escribe un número entero que no sea cero.', 'error');
    return;
  }

  const motivo = await pedirTexto({
    titulo: 'Motivo del ajuste',
    mensaje: `Se ${delta > 0 ? 'sumarán' : 'quitarán'} ${Math.abs(delta)} entrada(s) de ${pack.code}.`,
    etiqueta: 'Motivo',
    textoAceptar: 'Aplicar ajuste',
  });
  if (!motivo) return;

  await intentar(async () => {
    await api.post(`/api/admin/packs/${pack.id}/adjust`, { delta, reason: motivo });
    brindis('Listo, ajuste aplicado.', 'ok');
    await alCambiar?.();
  });
}

/** Anular es definitivo, así que el aviso dice exactamente qué se pierde. */
export async function anularPack(pack, alCambiar) {
  const seguro = await confirmar({
    titulo: `Anular ${pack.code}`,
    mensaje: `El pack quedará inutilizable para siempre y el cliente perderá las ${pack.remaining} entrada(s) que le quedan. Esto no se puede deshacer.`,
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
    mensaje: 'Déjalo vacío si quieres que el pack no venza.',
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
      expiresAt ? `El pack vence el ${fecha(expiresAt, { conHora: false })}.` : 'El pack ya no vence.',
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

// ---------------------------------------------------------------------------
// Entregar el pase de cartera en el mostrador
// ---------------------------------------------------------------------------

/** Cómo está el pase, en una frase que quien atiende pueda leer de un vistazo. */
function resumenDelPase(estado) {
  if (!estado.carteras.apple && !estado.carteras.google) {
    return 'Este sistema todavía no tiene ninguna cartera configurada.';
  }
  if (!estado.guardado) return 'El cliente todavía no ha guardado este pack en su teléfono.';

  const partes = [];
  if (estado.telefonos > 0) {
    partes.push(`Guardado en ${estado.telefonos} ${estado.telefonos === 1 ? 'teléfono' : 'teléfonos'} con Apple Wallet`);
  }
  if (estado.google) partes.push('guardado en Google Wallet');
  const donde = partes.join(' y ');
  return estado.alDia
    ? `${donde}. El saldo que ve el cliente está al día.`
    : `${donde}. Hay un cambio sin comunicar desde ${fecha(estado.pendienteDesde)}; el sistema lo sigue intentando.`;
}

/**
 * Entrega el pase al cliente ahí mismo: un QR en pantalla que escanea con la
 * cámara y le abre la página para guardarlo en su cartera.
 *
 * Se hace así y no mandándole un enlace porque en el mostrador el cliente está
 * delante: enseñarlo en pantalla no deja copia en ningún chat, y el permiso
 * caduca a los pocos minutos. Primero se muestra cómo está el pase —que es lo
 * que se pregunta la mitad de las veces— y solo si hace falta se genera el QR.
 */
export async function entregarPaseDeCartera(pack) {
  let cerrado = false;
  let cuenta = null;
  const cuerpo = el('div', { class: 'modal__cuerpo' }, el('h2', {}, `Pase de cartera · ${pack.code}`));
  const dialogo = el(
    'dialog',
    {},
    cuerpo,
    el(
      'div',
      { class: 'modal__pie' },
      el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => cerrar() }, 'Cerrar'),
    ),
  );

  function cerrar() {
    cerrado = true;
    clearInterval(cuenta);
    dialogo.close();
    dialogo.remove();
  }
  dialogo.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    cerrar();
  });
  document.body.append(dialogo);
  dialogo.showModal();

  const pintar = (...contenido) => {
    if (cerrado) return;
    render(cuerpo, el('h2', {}, `Pase de cartera · ${pack.code}`), ...contenido);
  };

  pintar(el('div', { class: 'cargando' }));

  let estado;
  try {
    estado = await api.get(`/api/admin/packs/${pack.id}/wallet`);
  } catch (error) {
    pintar(el('div', { class: 'aviso aviso--error' }, error.message));
    return;
  }
  if (cerrado) return;

  const hayCartera = estado.carteras.apple || estado.carteras.google;

  /** Pide una invitación nueva y la enseña con su cuenta atrás. */
  const mostrarInvitacion = async (boton) => {
    await conCarga(boton, async () => {
      let invitacion;
      try {
        invitacion = await api.post(`/api/admin/packs/${pack.id}/wallet/invitacion`);
      } catch (error) {
        brindis(error.message, 'error');
        return;
      }
      if (cerrado) return;

      const caducaEn = Date.now() + invitacion.validoMinutos * 60_000;
      const aviso = el('p', { class: 'tenue pequeno sin-margen' });
      const refrescar = () => {
        const quedan = Math.max(0, Math.round((caducaEn - Date.now()) / 1000));
        aviso.textContent =
          quedan > 0
            ? `Este código sirve ${Math.floor(quedan / 60)}:${String(quedan % 60).padStart(2, '0')} más.`
            : 'Este código ya caducó. Genera otro para volver a enseñarlo.';
      };
      refrescar();
      clearInterval(cuenta);
      cuenta = setInterval(refrescar, 1000);

      pintar(
        el('p', { class: 'tenue sin-margen' }, 'Pídele al cliente que apunte la cámara de su teléfono a este código.'),
        el('div', { class: 'cartera-qr mt', html: invitacion.qr }),
        el('div', { class: 'mt', style: 'text-align:center' }, aviso),
        el(
          'div',
          { class: 'fila-acciones centro-flex mt' },
          el(
            'button',
            {
              class: 'boton boton--chico boton--fantasma',
              type: 'button',
              onClick: async () => {
                brindis(
                  (await copiar(invitacion.url))
                    ? 'Enlace copiado. Recuerda que caduca en unos minutos.'
                    : 'No pudimos copiar el enlace; enseña el código en pantalla.',
                  'ok',
                );
              },
            },
            'Copiar enlace',
          ),
          el(
            'button',
            {
              class: 'boton boton--chico boton--fantasma',
              type: 'button',
              onClick: (evento) => mostrarInvitacion(evento.currentTarget),
            },
            'Generar otro',
          ),
        ),
      );
    });
  };

  pintar(
    el('p', { class: 'tenue sin-margen' }, resumenDelPase(estado)),
    // Un pack anulado o vencido no se entrega: su pase solo diría que ya no
    // sirve. El estado de arriba sigue siendo útil para dar soporte.
    hayCartera && !pack.usable
      ? el('p', { class: 'tenue-2 pequeno' }, 'Este pack ya no está activo, así que no hay pase que entregar.')
      : null,
    hayCartera && pack.usable
      ? el(
          'div',
          { class: 'fila-acciones mt' },
          el(
            'button',
            {
              class: 'boton boton--principal',
              type: 'button',
              onClick: (evento) => mostrarInvitacion(evento.currentTarget),
            },
            estado.guardado ? 'Volver a entregar el pase' : 'Entregar el pase',
          ),
        )
      : null,
  );
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
    boton('Pase de cartera', () => entregarPaseDeCartera(pack)),
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
    mensaje: `Se devolverá una entrada${aQuien}${enQue}. Quedará guardado quién lo hizo y por qué.`,
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

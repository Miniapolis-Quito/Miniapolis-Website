/**
 * Lo que dicen los avisos: los correos automáticos y el mensaje de WhatsApp que
 * propone la lista de clientes por recuperar.
 *
 * Todo sale de datos de la base, y todo lo que va a HTML se escapa aquí: un
 * nombre de cliente no puede colar marcado en un correo.
 */
import { config } from '../config.js';
import {
  escaparHtml, envolverHtml, boton, tablaDeDatos, momento, fechaLarga, saludo, primerNombre, dinero, plural,
} from '../lib/plantillaCorreo.js';

const FORMAS_DE_PAGO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  cortesia: 'Cortesía',
  otro: 'Otro',
};

const entradas = (n) => plural(n, 'entrada', 'entradas');

/** Días que faltan para un instante, contados hacia arriba. */
function diasHasta(instante, now) {
  return Math.ceil((Date.parse(instante) - now) / 86_400_000);
}

function cuandoVence(instante, now) {
  const dias = diasHasta(instante, now);
  return dias <= 1 ? 'en menos de un día' : `en ${dias} días`;
}

/** «5 entradas por $25,00 o 10 entradas por $45,00». */
function catalogoEnUnaFrase() {
  const opciones = config.packCatalog.map((p) => `${entradas(p.size)} por ${dinero(p.priceCents)}`);
  if (opciones.length <= 1) return opciones.join('');
  return `${opciones.slice(0, -1).join(', ')} o ${opciones.at(-1)}`;
}

function pieDeRecordatorio(enlaceBaja) {
  const motivo = `Recibes este recordatorio porque tienes una cuenta en ${config.brandName}.`;
  if (!enlaceBaja) {
    const como = 'Puedes desactivar los recordatorios en «Mi cuenta».';
    return { texto: [motivo, como], html: `${escaparHtml(motivo)} ${escaparHtml(como)}` };
  }
  return {
    texto: [motivo, `Si no quieres recibir más recordatorios: ${enlaceBaja}`],
    html:
      `${escaparHtml(motivo)} ` +
      `<a href="${escaparHtml(enlaceBaja)}" style="color:#666">No quiero recibir más recordatorios</a>.`,
  };
}

/**
 * Arma un correo con la misma estructura en texto y en HTML: saludo, párrafos,
 * una tabla de datos, un botón, un cierre y el pie.
 */
function componer({ usuario, asunto, parrafos, datos = null, accion = null, cierre = [], pie = null, cabeceras }) {
  const limpios = parrafos.filter(Boolean);
  const cierreLimpio = cierre.filter(Boolean);

  const texto = [saludo(usuario), ''];
  for (const parrafo of limpios) texto.push(parrafo, '');
  if (datos) texto.push(...datos.map(([clave, valor]) => `${clave}: ${valor}`), '');
  if (accion) texto.push(`${accion.texto}: ${accion.enlace}`, '');
  for (const parrafo of cierreLimpio) texto.push(parrafo, '');
  if (pie) texto.push('--', ...pie.texto);

  const html = envolverHtml(
    [
      escaparHtml(saludo(usuario)),
      ...limpios.map(escaparHtml),
      datos ? { html: tablaDeDatos(datos) } : null,
      accion ? boton(accion.enlace, accion.texto) : null,
      ...cierreLimpio.map(escaparHtml),
    ].filter(Boolean),
    { pie: pie?.html ?? null },
  );

  return { para: usuario.email, asunto, texto: texto.join('\n').trimEnd(), html, cabeceras };
}

const catalogoComoDatos = () => config.packCatalog.map((p) => [p.label, dinero(p.priceCents)]);

const CORREOS = {
  purchase({ usuario, pack, saldo, enlaceApp }) {
    const cortesia = pack.price_cents === 0 || pack.payment_method === 'cortesia';
    const forma = FORMAS_DE_PAGO[pack.payment_method];
    return {
      asunto: cortesia
        ? `Te acreditamos ${entradas(pack.size)} en ${config.brandShort}`
        : `Tu pack de ${entradas(pack.size)} en ${config.brandShort} está listo`,
      parrafos: [
        cortesia
          ? `Te acreditamos un pack de cortesía con ${entradas(pack.size)}. Ya puedes usarlas.`
          : `Gracias por tu compra. Tu pack de ${entradas(pack.size)} ya está activo.`,
      ],
      datos: [
        ['Código del pack', pack.code],
        ['Entradas', String(pack.size)],
        cortesia ? null : ['Importe', `${dinero(pack.price_cents, pack.currency)}${forma ? ` · ${forma}` : ''}`],
        pack.payment_reference ? ['Referencia', pack.payment_reference] : null,
        ['Fecha', momento(pack.created_at)],
        ['Vence', pack.expires_at ? fechaLarga(pack.expires_at) : 'No vence'],
      ].filter(Boolean),
      accion: enlaceApp ? { enlace: enlaceApp, texto: 'Ver mi QR de entrada' } : null,
      cierre: [
        saldo > pack.remaining ? `Con este pack tienes ${entradas(saldo)} disponibles en total.` : null,
        `Para entrar, muestra el QR de la app en la puerta. Si te quedas sin señal, dile tu código al personal: ${pack.code}.`,
      ],
      pie: {
        texto: ['Guarda este correo: es el comprobante de tu compra.'],
        html: 'Guarda este correo: es el comprobante de tu compra.',
      },
    };
  },

  low_balance({ saldo, enlaceApp, enlaceBaja }) {
    return {
      asunto: `${saldo === 1 ? 'Te queda' : 'Te quedan'} ${entradas(saldo)} en ${config.brandShort}`,
      parrafos: [
        `${saldo === 1 ? 'Te queda' : 'Te quedan'} ${entradas(saldo)}. Para no quedarte sin pista en tu próxima visita, ` +
          'puedes renovar tu pack en recepción. Estos son los packs a la venta:',
      ],
      datos: catalogoComoDatos(),
      accion: enlaceApp ? { enlace: enlaceApp, texto: 'Ver mis entradas' } : null,
      cierre: ['El pack nuevo aparece en tu teléfono en el momento en que lo compras.'],
      pie: pieDeRecordatorio(enlaceBaja),
    };
  },

  depleted({ enlaceApp, enlaceBaja }) {
    return {
      asunto: `Usaste tu última entrada en ${config.brandShort}`,
      parrafos: [
        'Acabas de usar tu última entrada. ¡Gracias por venir a la pista!',
        'Cuando quieras volver, compra un pack nuevo en recepción:',
      ],
      datos: catalogoComoDatos(),
      accion: enlaceApp ? { enlace: enlaceApp, texto: 'Ver mis entradas' } : null,
      cierre: ['Te esperamos pronto.'],
      pie: pieDeRecordatorio(enlaceBaja),
    };
  },

  expiring({ pack, now, enlaceApp, enlaceBaja }) {
    const una = pack.remaining === 1;
    const fecha = fechaLarga(pack.expires_at);
    return {
      asunto: una ? `Tu entrada vence el ${fecha}` : `Tus ${pack.remaining} entradas vencen el ${fecha}`,
      parrafos: [
        `Tu pack ${pack.code} tiene ${entradas(pack.remaining)} sin usar que ${una ? 'vence' : 'vencen'} ` +
          `el ${fecha} (${cuandoVence(pack.expires_at, now)}).`,
        `Aprovécha${una ? 'la' : 'las'} antes de esa fecha: después ya no se ${una ? 'podrá' : 'podrán'} usar.`,
      ],
      accion: enlaceApp ? { enlace: enlaceApp, texto: 'Ver mis entradas' } : null,
      pie: pieDeRecordatorio(enlaceBaja),
    };
  },

  inactive({ saldo, dias, proximoVencimiento, enlaceApp, enlaceBaja }) {
    return {
      asunto: `Te esperamos en la pista: tienes ${entradas(saldo)}`,
      parrafos: [
        `Hace ${dias} días que no te vemos por la pista y todavía tienes ${entradas(saldo)} ` +
          `${saldo === 1 ? 'disponible' : 'disponibles'}.`,
        proximoVencimiento
          ? `Ten en cuenta que tu pack ${proximoVencimiento.code} vence el ${fechaLarga(proximoVencimiento.expires_at)}.`
          : null,
        'Ven cuando quieras: solo tienes que mostrar tu QR en la entrada.',
      ],
      accion: enlaceApp ? { enlace: enlaceApp, texto: 'Ver mis entradas' } : null,
      pie: pieDeRecordatorio(enlaceBaja),
    };
  },
};

/**
 * Correo de un aviso.
 * @param {'purchase'|'low_balance'|'depleted'|'expiring'|'inactive'} tipo
 * @param {object} contexto lo que revalidó el servicio, más los enlaces
 */
export function correoDeAviso(tipo, contexto) {
  const plantilla = CORREOS[tipo];
  if (!plantilla) throw new Error(`No hay plantilla para el aviso «${tipo}».`);
  return componer({ usuario: contexto.usuario, cabeceras: contexto.cabeceras, ...plantilla(contexto) });
}

/**
 * Mensaje breve para abrir WhatsApp ya escrito. Lo envía una persona desde su
 * teléfono, así que suena a persona y no a sistema.
 */
export function mensajeDeWhatsapp(tipo, { usuario, saldo = 0, porVencer = null, dias = 0 }) {
  const nombre = primerNombre(usuario);
  const hola = `Hola${nombre ? `, ${nombre}` : ''}. Te escribimos de ${config.brandShort}.`;
  switch (tipo) {
    case 'low_balance':
      return `${hola} ${saldo === 1 ? 'Te queda' : 'Te quedan'} ${entradas(saldo)}. Si quieres, te dejamos listo un pack nuevo para tu próxima visita.`;
    case 'depleted':
      return `${hola} Vimos que ya no te quedan entradas. ¡Gracias por venir! Cuando quieras volver tenemos packs de ${catalogoEnUnaFrase()}. ¿Te separamos uno?`;
    case 'expiring': {
      const una = porVencer.tickets === 1;
      const fecha = fechaLarga(porVencer.expiresAt);
      const cuando = porVencer.packs > 1 ? `la primera el ${fecha}` : `el ${fecha}`;
      return `${hola} Tienes ${entradas(porVencer.tickets)} que ${una ? 'vence' : 'vencen'} pronto (${cuando}). ¡Aprovécha${una ? 'la' : 'las'} antes!`;
    }
    case 'inactive':
      return `${hola} Hace ${dias} días que no te vemos y todavía tienes ${entradas(saldo)}. ¡Te esperamos en la pista!`;
    default:
      return hola;
  }
}

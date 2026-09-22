/**
 * Piezas comunes de los correos que manda el sistema: escapado, fechas y dinero
 * en la zona y la moneda de la pista, y el envoltorio HTML.
 *
 * Un correo no puede usar la hoja de estilos de la web: los programas de correo
 * solo respetan los estilos escritos en cada etiqueta, por eso van aquí.
 */
import { config } from '../config.js';

export function escaparHtml(texto) {
  return String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** «14 de septiembre de 2026, 18:05», en la zona horaria de la pista. */
export function momento(instante) {
  return new Date(instante).toLocaleString('es-EC', {
    timeZone: config.timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

/** «14 de septiembre de 2026». */
export function fechaLarga(instante) {
  return new Date(instante).toLocaleDateString('es-EC', { timeZone: config.timezone, dateStyle: 'long' });
}

export function primerNombre(usuario) {
  return String(usuario?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function saludo(usuario) {
  const nombre = primerNombre(usuario);
  return nombre ? `Hola, ${nombre}:` : 'Hola:';
}

export function dinero(centavos, moneda = config.currency) {
  const valor = Number(centavos || 0) / 100;
  try {
    return new Intl.NumberFormat('es-EC', { style: 'currency', currency: moneda }).format(valor);
  } catch {
    return `$${valor.toFixed(2)}`;
  }
}

export function plural(cantidad, singular, pluralForma) {
  return `${cantidad} ${cantidad === 1 ? singular : pluralForma}`;
}

/** Un botón que se ve igual en Gmail, Outlook y Apple Mail. */
export function boton(enlace, texto) {
  return (
    `<a href="${escaparHtml(enlace)}" style="display:inline-block;background:#000;color:#9ad54d;padding:12px 20px;` +
    `border-radius:6px;text-decoration:none;font-weight:bold">${escaparHtml(texto)}</a>`
  );
}

/** Pares «dato: valor» en una tabla sencilla. Los valores se escapan aquí. */
export function tablaDeDatos(pares) {
  const filas = pares
    .map(
      ([clave, valor]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">${escaparHtml(clave)}</td>` +
        `<td style="padding:4px 0;font-weight:bold">${escaparHtml(valor)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px">${filas}</table>`;
}

/**
 * Envuelve el cuerpo del correo. Cada elemento de `bloques` es un párrafo con
 * HTML ya escapado, o `{ html }` para un bloque que no va dentro de un párrafo
 * (una tabla, por ejemplo). `pie` es HTML ya escapado que va fuera de la
 * tarjeta, en letra pequeña.
 */
export function envolverHtml(bloques, { pie = null } = {}) {
  const cuerpo = bloques
    .map((bloque) => (typeof bloque === 'object' ? bloque.html : `<p style="margin:0 0 16px">${bloque}</p>`))
    .join('\n');
  const piePagina = pie
    ? `<p style="max-width:560px;margin:16px auto 0;color:#666;font-size:12px;line-height:1.5">${pie}</p>`
    : '';
  return (
    '<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f6f6f2;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    `<div style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:8px">${cuerpo}</div>` +
    piePagina +
    '</body></html>'
  );
}

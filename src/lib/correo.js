/**
 * Envío de correo.
 *
 * Hoy lo usan la recuperación de contraseña y los avisos de cambio. Sin
 * configuración, el envío queda apagado y quien llama lo sabe por
 * `correoDisponible()`; nunca se inventa un servidor por defecto.
 *
 * Transportes:
 *  - `smtp`: el de verdad. TLS obligatorio con certificado verificado; solo un
 *    relé en la propia máquina puede ir sin cifrar.
 *  - `memoria`: guarda los mensajes en un buzón que leen las pruebas. Solo
 *    existe con NODE_ENV=test.
 *  - `consola`: escribe el mensaje en la salida estándar, para desarrollar sin
 *    servidor de correo. La configuración lo prohíbe en producción, porque el
 *    correo de recuperación lleva un enlace que da acceso a la cuenta.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporte = null;
const buzon = [];

/** Un salto de línea en una cabecera permitiría añadir cabeceras propias. */
const CARACTERES_DE_CONTROL = /[\r\n\u0000]/;

function transporteSmtp() {
  if (!transporte) {
    const { host, port, secure, requireTLS, user, password } = config.correo.smtp;
    transporte = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS,
      auth: user ? { user, pass: password } : undefined,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      // Un mensaje nunca debe poder adjuntar un archivo del servidor ni ir a
      // buscar una URL, aunque algún día se construya con datos de fuera.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporte;
}

export function correoDisponible() {
  return config.correo.enabled;
}

/**
 * Envía un mensaje de texto con su versión HTML.
 * @param {{para: string, asunto: string, texto: string, html?: string}} mensaje
 */
export async function enviarCorreo({ para, asunto, texto, html }) {
  if (!config.correo.enabled) throw new Error('El envío de correo no está configurado.');
  // Una coma o un punto y coma convertirían un solo destinatario en varios, y
  // los ángulos permitirían colar otra dirección detrás de un nombre.
  if (typeof para !== 'string' || CARACTERES_DE_CONTROL.test(para) || /[,;<>]/.test(para) || !para.includes('@')) {
    throw new Error('El destinatario del correo no es válido.');
  }
  if (typeof asunto !== 'string' || CARACTERES_DE_CONTROL.test(asunto)) {
    throw new Error('El asunto del correo no es válido.');
  }

  if (config.correo.modo === 'memoria') {
    buzon.push({ para, asunto, texto, html, enviadoEn: new Date().toISOString() });
    return;
  }
  if (config.correo.modo === 'consola') {
    process.stdout.write(`\n--- Correo para ${para} ---\nAsunto: ${asunto}\n\n${texto}\n--- Fin del correo ---\n\n`);
    return;
  }

  await transporteSmtp().sendMail({
    from: config.correo.from,
    to: para,
    subject: asunto,
    text: texto,
    html,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** Mensajes enviados con el transporte `memoria`. Solo para las pruebas. */
export function buzonDePrueba() {
  if (config.correo.modo !== 'memoria') throw new Error('El buzón de prueba solo existe con MAIL_TRANSPORT=memoria.');
  return buzon;
}

export function vaciarBuzon() {
  buzon.length = 0;
}

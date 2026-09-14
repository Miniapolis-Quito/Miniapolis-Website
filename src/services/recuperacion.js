/**
 * Recuperación de contraseña por correo y avisos de cambio.
 *
 * El diseño completo, con el porqué de cada decisión, está en
 * docs/superpowers/specs/2026-09-14-recuperacion-de-contrasena-design.md. Lo
 * esencial:
 *
 *  - Pedir un enlace responde siempre igual y antes de buscar la cuenta.
 *  - El token son 256 bits aleatorios; en la base solo queda su HMAC.
 *  - Vale un rato y una sola vez, y el canje es atómico.
 *  - El enlace lleva el token en el fragmento y el dominio de PUBLIC_URL.
 *  - Canjearlo cierra todas las sesiones y no abre ninguna nueva.
 */
import crypto from 'node:crypto';
import { getDb, inTransaction } from '../db/index.js';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { consume, reset as resetRateLimit } from '../lib/rateLimit.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../lib/passwords.js';
import { enviarCorreo } from '../lib/correo.js';
import * as users from './users.js';
import * as audit from './audit.js';
import { notificarSesionInvalida } from './sessions.js';

/** 32 bytes en base64url, sin relleno. */
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Entre dos correos de recuperación a la misma dirección. */
const ESPERA_ENTRE_ENVIOS_SECONDS = 60;
/** Correos de recuperación por dirección en una hora. */
const ENVIOS_POR_HORA = 3;
/** Días que se conserva un enlace ya vencido, por si hay que auditarlo. */
const DIAS_DE_CONSERVACION = 7;

const MENSAJE_ENLACE_INVALIDO =
  'Este enlace no es válido o ya caducó. Pide uno nuevo desde la página de acceso.';

export const enlaceInvalido = () => badRequest(MENSAJE_ENLACE_INVALIDO, null, 'enlace_invalido');

/**
 * ¿Se puede ofrecer la recuperación? Hace falta poder mandar correo y saber la
 * dirección pública con la que construir el enlace. En producción esa
 * dirección tiene que ser HTTPS: el enlace da acceso a la cuenta.
 */
export function disponible() {
  if (!config.correo.enabled || !config.publicUrl) return false;
  return !config.isProduction || config.publicUrl.startsWith('https://');
}

/** Lo único que se guarda de un token: no sirve para reconstruirlo. */
export function hashToken(token) {
  return crypto
    .createHmac('sha256', config.secrets.refreshToken)
    .update(`password-reset:${token}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Tareas después de responder
// ---------------------------------------------------------------------------

const tareasEnCurso = new Set();

/**
 * Ejecuta `tarea` cuando la respuesta ya salió. Así ni el tiempo de respuesta
 * ni un fallo del servidor de correo dicen nada a quien hizo la petición.
 */
function despuesDeResponder(tarea, descripcionDelFallo) {
  const promesa = new Promise((listo) => setImmediate(listo))
    .then(tarea)
    .catch((error) => logger.error(descripcionDelFallo, { message: error.message }))
    .finally(() => tareasEnCurso.delete(promesa));
  tareasEnCurso.add(promesa);
}

/** Espera a que terminen los envíos pendientes. Lo usan las pruebas. */
export async function esperarTareas() {
  while (tareasEnCurso.size > 0) await Promise.all([...tareasEnCurso]);
}

// ---------------------------------------------------------------------------
// Correos
// ---------------------------------------------------------------------------

function escaparHtml(texto) {
  return String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function momento(instante) {
  return new Date(instante).toLocaleString('es-EC', {
    timeZone: config.timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

function saludo(usuario) {
  const nombre = String(usuario.full_name ?? '').trim().split(/\s+/)[0];
  return nombre ? `Hola, ${nombre}:` : 'Hola:';
}

function envolverHtml(parrafos) {
  const cuerpo = parrafos.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('\n');
  return (
    '<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f6f6f2;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    `<div style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:8px">${cuerpo}</div>` +
    '</body></html>'
  );
}

export function correoDeRecuperacion(usuario, token, { ip = null, instante = Date.now() } = {}) {
  const enlace = `${config.publicUrl}/restablecer#token=${token}`;
  const minutos = Math.round(config.passwordReset.ttlSeconds / 60);
  const origen = `Solicitud recibida el ${momento(instante)}${ip ? ` desde la dirección ${ip}` : ''}.`;

  const texto = [
    saludo(usuario),
    '',
    `Alguien pidió restablecer la contraseña de tu cuenta de ${config.brandName}. Si fuiste tú, abre este enlace para elegir una nueva:`,
    '',
    enlace,
    '',
    `El enlace vale ${minutos} minutos y sirve una sola vez.`,
    '',
    'Si no lo pediste, ignora este correo: tu contraseña sigue siendo la misma y nadie puede cambiarla sin este enlace.',
    '',
    origen,
  ].join('\n');

  const html = envolverHtml([
    escaparHtml(saludo(usuario)),
    `Alguien pidió restablecer la contraseña de tu cuenta de ${escaparHtml(config.brandName)}. Si fuiste tú, usa este botón para elegir una nueva:`,
    `<a href="${escaparHtml(enlace)}" style="display:inline-block;background:#000;color:#3cfe3f;padding:12px 20px;` +
      'border-radius:6px;text-decoration:none;font-weight:bold">Elegir una contraseña nueva</a>',
    `Si el botón no funciona, copia esta dirección en tu navegador:<br><span style="word-break:break-all">${escaparHtml(enlace)}</span>`,
    `El enlace vale ${minutos} minutos y sirve una sola vez.`,
    'Si no lo pediste, ignora este correo: tu contraseña sigue siendo la misma y nadie puede cambiarla sin este enlace.',
    `<span style="color:#666;font-size:13px">${escaparHtml(origen)}</span>`,
  ]);

  return { para: usuario.email, asunto: `Restablece tu contraseña de ${config.brandShort}`, texto, html };
}

const COMO_SE_CAMBIO = {
  cuenta: 'desde tu cuenta',
  correo: 'con un enlace de recuperación enviado a este correo',
  administracion: 'por la administración de la pista',
};

export function correoDeCambio(usuario, { via, ip = null, instante = Date.now() }) {
  const como = COMO_SE_CAMBIO[via] ?? 'desde tu cuenta';
  const cuando = `el ${momento(instante)}${ip ? ` desde la dirección ${ip}` : ''}`;
  const dondeRestablecer = config.publicUrl ? `desde ${config.publicUrl}` : 'desde la página de acceso';

  const lineas = [
    `La contraseña de tu cuenta de ${config.brandName} se cambió ${como}, ${cuando}.`,
    'Por seguridad cerramos la sesión en todos tus dispositivos.',
    'Si fuiste tú, no tienes que hacer nada.',
    `Si no fuiste tú, restablécela ahora ${dondeRestablecer} con «¿Olvidaste tu contraseña?» y avisa en recepción.`,
  ];

  return {
    para: usuario.email,
    asunto: `Tu contraseña de ${config.brandShort} cambió`,
    texto: [saludo(usuario), '', ...lineas.flatMap((l) => [l, ''])].join('\n').trimEnd(),
    html: envolverHtml([escaparHtml(saludo(usuario)), ...lineas.map(escaparHtml)]),
  };
}

/** Avisa por correo de un cambio de contraseña, sin frenar la respuesta. */
export function avisarCambio(usuario, { via, ip = null } = {}) {
  if (!config.correo.enabled || !usuario?.email) return;
  const instante = Date.now();
  despuesDeResponder(
    () => enviarCorreo(correoDeCambio(usuario, { via, ip, instante })),
    'No se pudo enviar el aviso de cambio de contraseña',
  );
}

// ---------------------------------------------------------------------------
// Pedir el enlace
// ---------------------------------------------------------------------------

/**
 * Hace todo el trabajo de una solicitud. Devuelve qué pasó, pero eso es solo
 * para las pruebas y el registro: a quien pidió el enlace no le llega nada.
 */
export async function solicitar({ email, ip = null, userAgent = null, now = Date.now() }) {
  if (!disponible()) return { enviado: false, motivo: 'no_disponible' };
  const correo = users.normalizeEmail(email);

  // Las cuotas por dirección se gastan antes de saber si hay cuenta, y en
  // silencio: frenan el bombardeo de correos a una víctima sin delatar nada.
  if (!consume(`recuperacion-espera:${correo}`, { limit: 1, windowSeconds: ESPERA_ENTRE_ENVIOS_SECONDS, now }).allowed) {
    return { enviado: false, motivo: 'espera' };
  }
  if (!consume(`recuperacion-hora:${correo}`, { limit: ENVIOS_POR_HORA, windowSeconds: 3600, now }).allowed) {
    return { enviado: false, motivo: 'cuota' };
  }

  const usuario = users.findByEmail(correo);
  if (!usuario) return { enviado: false, motivo: 'sin_cuenta' };
  if (usuario.status !== 'active') return { enviado: false, motivo: 'suspendida' };

  const db = getDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const id = newId();
  const ahoraIso = new Date(now).toISOString();

  inTransaction(() => {
    // Solo vale el último enlace pedido.
    users.invalidarEnlacesDeRecuperacion(db, usuario.id, 'reemplazado', ahoraIso);
    db.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at, requested_ip, requested_user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      usuario.id,
      hashToken(token),
      ahoraIso,
      new Date(now + config.passwordReset.ttlSeconds * 1000).toISOString(),
      ip,
      userAgent ? String(userAgent).slice(0, 300) : null,
    );
    audit.record({
      actor: null,
      action: 'password.recuperacion_solicitada',
      entityType: 'user',
      entityId: usuario.id,
      ip,
      userAgent,
      db,
    });
  });

  try {
    await enviarCorreo(correoDeRecuperacion(usuario, token, { ip, instante: now }));
  } catch (error) {
    // Un enlace que nunca llegó no debe quedar vivo en la base.
    db.prepare(
      `UPDATE password_resets SET invalidated_at = ?, invalidated_reason = 'correo_fallido'
        WHERE id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
    ).run(new Date().toISOString(), id);
    logger.error('No se pudo enviar el correo de recuperación', { message: error.message, userId: usuario.id });
    return { enviado: false, motivo: 'correo' };
  }
  return { enviado: true };
}

/** La ruta responde primero y deja la solicitud para después. */
export function solicitarDespuesDeResponder(datos) {
  despuesDeResponder(() => solicitar(datos), 'Falló una solicitud de recuperación de contraseña');
}

// ---------------------------------------------------------------------------
// Usar el enlace
// ---------------------------------------------------------------------------

/**
 * ¿Sirve este token ahora mismo? No lo gasta.
 * @returns {{ok: true, fila: object, usuario: object} | {ok: false}}
 */
export function comprobar(token, { now = Date.now(), db = getDb() } = {}) {
  if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) return { ok: false };
  const fila = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashToken(token));
  if (!fila || fila.used_at || fila.invalidated_at) return { ok: false };
  if (fila.expires_at <= new Date(now).toISOString()) return { ok: false };
  const usuario = users.findById(fila.user_id, db);
  if (!usuario || usuario.status !== 'active') return { ok: false };
  return { ok: true, fila, usuario };
}

/** Canjea un enlace por una contraseña nueva. */
export async function restablecer({ token, newPassword, ip = null, userAgent = null }) {
  const previa = comprobar(token);
  if (!previa.ok) throw enlaceInvalido();
  const { usuario, fila } = previa;

  // Todo lo que puede rechazar la contraseña va antes del canje: una
  // contraseña que no sirve no debe gastar el enlace.
  const fuerza = validatePasswordStrength(newPassword, { email: usuario.email, fullName: usuario.full_name });
  if (!fuerza.ok) {
    throw badRequest(fuerza.errors[0], { fields: { newPassword: fuerza.errors.join(' ') } }, 'password_debil');
  }
  if (await verifyPassword(newPassword, usuario.password_hash)) {
    throw badRequest(
      'La contraseña nueva debe ser distinta a la anterior.',
      { fields: { newPassword: 'Debe ser distinta a la anterior.' } },
      'password_repetida',
    );
  }
  const passwordHash = await hashPassword(newPassword);

  const db = getDb();
  const ahoraIso = new Date().toISOString();
  const cambiado = inTransaction(() => {
    // El canje y el cambio van juntos y la condición está en la propia
    // actualización: de dos canjes simultáneos solo uno puede ganar, y un
    // enlace invalidado mientras se calculaba el hash ya no sirve.
    const canje = db
      .prepare(
        `UPDATE password_resets SET used_at = ?, used_ip = ?
          WHERE id = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
      )
      .run(ahoraIso, ip, fila.id, ahoraIso);
    if (canje.changes !== 1) return false;

    const actual = users.findById(usuario.id, db);
    if (!actual || actual.status !== 'active') return false;

    users.escribirPassword(db, usuario.id, passwordHash, { ahoraIso, motivo: 'password_reset' });
    audit.record({
      actor: { id: usuario.id, email: usuario.email },
      action: 'password.restablecida_por_correo',
      entityType: 'user',
      entityId: usuario.id,
      ip,
      userAgent,
      db,
    });
    return true;
  });
  if (!cambiado) throw enlaceInvalido();

  notificarSesionInvalida(usuario.id, 'password_cambiada');
  // Quien demostró tener el correo no debe seguir frenado por los intentos
  // fallidos de otro.
  resetRateLimit(`login-cuenta:${usuario.email_normalized}`);
  avisarCambio(usuario, { via: 'correo', ip });
  return { ok: true };
}

/** Borra los enlaces que vencieron hace más de una semana. */
export function purgar(now = Date.now()) {
  const limite = new Date(now - DIAS_DE_CONSERVACION * 86_400_000).toISOString();
  return getDb().prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(limite).changes;
}

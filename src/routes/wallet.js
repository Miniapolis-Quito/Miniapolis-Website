/**
 * Pases para la cartera del teléfono.
 *
 * Tres grupos de rutas muy distintos:
 *
 *  - Las del cliente, con su sesión: descargar el pase de Apple y pedir el
 *    enlace de Google.
 *  - Las de la invitación del mostrador, sin sesión: el personal le enseña al
 *    cliente un QR y este guarda su pase ahí mismo, sin tener que entrar a su
 *    cuenta delante de la cola. Lo que las abre es un permiso firmado que dura
 *    unos minutos y solo sirve para ese pack.
 *  - El servicio web de Apple (`/v1/...`), al que llama el teléfono por su
 *    cuenta, sin sesión: se identifica con la contraseña que lleva el propio
 *    pase dentro. Es el que hace que el saldo se actualice solo.
 */
import crypto from 'node:crypto';
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, actuaComoMaster } from '../middleware/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { badRequest, forbidden, notFound, unauthorized, servicioNoDisponible } from '../lib/errors.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as packsService from '../services/packs.js';
import * as users from '../services/users.js';
import * as wallet from '../services/wallet.js';
import { PUSH_TOKEN_VALIDO } from '../lib/apns.js';

export const router = express.Router();

/**
 * Formatos de lo que llega en las rutas del servicio web de Apple. Son rutas
 * sin sesión que cualquiera puede llamar, así que lo que no tiene la forma
 * esperada ni siquiera se busca en la base.
 */
const SERIAL_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;
const DISPOSITIVO_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;
const MARCA_DE_TIEMPO_VALIDA = /^[0-9TZ:.+-]{1,40}$/;
/** Los identificadores de pack son UUID; lo que no lo sea no llega a la base. */
const PACK_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cuota por conexión para el servicio web del teléfono. Es generosa porque
 * muchos clientes con datos móviles salen por la misma IP y cada aviso hace
 * que todos sus teléfonos vengan a por el pase a la vez.
 */
const limiteServicioApple = rateLimit({
  name: 'wallet-apple-ip',
  limit: 600,
  windowSeconds: 15 * 60,
  keyFn: (req) => `ip:${req.rateLimitIp ?? req.clientIp}`,
});

/** El registro de avisos del teléfono escribe en el log: cuota mucho más corta. */
const limiteLogApple = rateLimit({
  name: 'wallet-apple-log-ip',
  limit: 30,
  windowSeconds: 15 * 60,
  keyFn: (req) => `ip:${req.rateLimitIp ?? req.clientIp}`,
});

/**
 * Cuota de la invitación del mostrador. Una invitación se usa dos o tres veces
 * (abrir la página y pulsar un botón); esto deja margen de sobra para una
 * jornada entera desde la misma conexión y ninguno para probar firmas al azar.
 */
const limiteInvitacion = rateLimit({
  name: 'wallet-invitacion-ip',
  limit: 120,
  windowSeconds: 15 * 60,
  keyFn: (req) => `ip:${req.rateLimitIp ?? req.clientIp}`,
});

/** Rechaza un identificador de teléfono con una forma que Apple no usa. */
function exigirDispositivoValido(req, res, next) {
  if (DISPOSITIVO_VALIDO.test(req.params.deviceId)) return next();
  return next(badRequest('El identificador del teléfono no es válido.', null, 'dispositivo_invalido'));
}

/** Corta con un mensaje claro si esa cartera no está configurada. */
function exigirCartera(cual) {
  return (req, res, next) => {
    if (wallet.disponible()[cual]) return next();
    return next(
      notFound(
        cual === 'apple'
          ? 'Los pases para Apple Wallet no están configurados en este sistema.'
          : 'Los pases para Google Wallet no están configurados en este sistema.',
        'cartera_no_configurada',
      ),
    );
  };
}

/**
 * El pack tiene que ser del cliente que lo pide (o el máster, para dar soporte).
 * Se admite además un ticket firmado: el teléfono llega al pase navegando, y
 * una navegación no lleva la cabecera de sesión.
 */
function packDelCliente(req, { admitirTicket = false } = {}) {
  const tieneTicketValido =
    admitirTicket && typeof req.query.t === 'string' && wallet.ticketValido(req.params.packId, req.query.t);

  if (!tieneTicketValido && !req.user) {
    throw unauthorized('Necesitas iniciar sesión.');
  }

  const pack = packsService.findById(req.params.packId);
  if (!pack) throw notFound('Pack no encontrado.');

  if (tieneTicketValido) return pack;

  if (pack.user_id !== req.user.id && !actuaComoMaster(req.user)) {
    throw forbidden('Este pack no te pertenece.');
  }
  return pack;
}

/**
 * Pide el enlace de Google traduciendo sus fallos a algo que el cliente pueda
 * entender. Que Google no conteste no es culpa de quien pulsó el botón, y un
 * 500 seco le diría "algo salió mal" sin decirle qué hacer.
 */
async function enlaceDeGoogleOExplicacion(packId) {
  try {
    const url = await wallet.enlaceGoogle(packId);
    if (!url) throw notFound('Pack no encontrado.');
    return url;
  } catch (error) {
    if (error?.status) throw error;
    logger.warn('No se pudo preparar el pase de Google Wallet', { message: error.message });
    throw servicioNoDisponible(
      'Google Wallet no responde en este momento. Vuelve a intentarlo en un minuto; tus entradas no se ven afectadas.',
      'google_wallet_no_responde',
    );
  }
}

// ---------------------------------------------------------------------------
// Rutas del cliente
// ---------------------------------------------------------------------------

/** Permiso de corta vida con el que el teléfono va a buscar el pase. */
router.get(
  '/apple/ticket/:packId',
  requireAuth,
  exigirCartera('apple'),
  asyncHandler(async (req, res) => {
    const pack = packDelCliente(req);
    res.set('Cache-Control', 'no-store');
    res.json({
      url: `${config.publicUrl}/api/wallet/apple/pass/${pack.id}?t=${encodeURIComponent(wallet.firmarTicket(pack.id))}`,
      validoSegundos: config.tokens.streamTicketTtlSeconds,
    });
  }),
);

router.get(
  '/apple/pass/:packId',
  exigirCartera('apple'),
  rateLimit({
    name: 'pase-apple',
    limit: 60,
    windowSeconds: 15 * 60,
    keyFn: (req) => req.user?.id ?? `ip:${req.rateLimitIp ?? req.clientIp}`,
  }),
  asyncHandler(async (req, res) => {
    const pack = packDelCliente(req, { admitirTicket: true });
    const paseData = wallet.construirPaseApple(pack.id);
    if (!paseData) throw notFound('Pase no encontrado.');
    const { archivo } = paseData;
    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', `attachment; filename="${pack.code}.pkpass"`);
    res.set('Cache-Control', 'no-store');
    res.send(archivo);
  }),
);

router.get(
  '/google/pass/:packId',
  requireAuth,
  exigirCartera('google'),
  rateLimit({ name: 'pase-google', limit: 60, windowSeconds: 15 * 60, keyFn: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const pack = packDelCliente(req);
    const url = await enlaceDeGoogleOExplicacion(pack.id);
    res.set('Cache-Control', 'no-store');
    res.json({ url });
  }),
);

// ---------------------------------------------------------------------------
// Invitación del mostrador
// ---------------------------------------------------------------------------

/**
 * El permiso llega en el cuerpo, no en la dirección: la página lo guarda en el
 * fragmento (que no viaja al servidor) y lo manda aquí, así no queda escrito en
 * los registros del servidor ni en el historial de un teléfono prestado.
 */
function packDeLaInvitacion(req) {
  const packId = typeof req.body?.packId === 'string' ? req.body.packId : '';
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!PACK_VALIDO.test(packId) || !wallet.invitacionValida(packId, token)) {
    throw unauthorized(
      'Este enlace ya caducó. Pídele al personal que te lo muestre de nuevo.',
      'invitacion_invalida',
    );
  }
  const pack = packsService.findById(packId);
  if (!pack) throw notFound('Pack no encontrado.');
  return pack;
}

/** Qué pack es y qué carteras se le pueden ofrecer. Sin datos de más. */
router.post(
  '/invitacion',
  limiteInvitacion,
  asyncHandler(async (req, res) => {
    const pack = packDeLaInvitacion(req);
    const dueno = users.findById(pack.user_id);
    const usable = packsService.isUsable(pack, { owner: dueno ?? null });
    res.set('Cache-Control', 'no-store');
    res.json({
      // Lo justo para que el cliente reconozca que es su pack: ni su correo, ni
      // su teléfono, ni el resto de su ficha. Esta página la abre quien tenga
      // el enlace durante unos minutos.
      pack: {
        code: pack.code,
        size: pack.size,
        remaining: pack.remaining,
        expiresAt: pack.expires_at,
        usable: usable.ok,
      },
      titular: dueno?.full_name ?? '',
      carteras: wallet.disponible(),
    });
  }),
);

router.post(
  '/invitacion/apple',
  limiteInvitacion,
  exigirCartera('apple'),
  asyncHandler(async (req, res) => {
    const pack = packDeLaInvitacion(req);
    res.set('Cache-Control', 'no-store');
    res.json({
      url: `${config.publicUrl}/api/wallet/apple/pass/${pack.id}?t=${encodeURIComponent(wallet.firmarTicket(pack.id))}`,
      validoSegundos: config.tokens.streamTicketTtlSeconds,
    });
  }),
);

router.post(
  '/invitacion/google',
  limiteInvitacion,
  exigirCartera('google'),
  asyncHandler(async (req, res) => {
    const pack = packDeLaInvitacion(req);
    const url = await enlaceDeGoogleOExplicacion(pack.id);
    res.set('Cache-Control', 'no-store');
    res.json({ url });
  }),
);

// ---------------------------------------------------------------------------
// Servicio web de Apple
// ---------------------------------------------------------------------------

/**
 * El teléfono se identifica con la contraseña del propio pase. La comparación
 * es en tiempo constante: es un secreto, y compararlo carácter a carácter
 * dejaría medirlo desde fuera.
 */
function exigirPase(req, res, next) {
  const cabecera = req.get('authorization') || '';
  const token = cabecera.startsWith('ApplePass ') ? cabecera.slice(10).trim() : '';
  // El pase es de este tipo o no es de este sistema: un identificador de tipo
  // ajeno no debe abrir nada aunque la serie y la contraseña coincidan.
  if (
    !token ||
    req.params.passTypeId !== config.wallet.apple.passTypeId ||
    !SERIAL_VALIDO.test(req.params.serial)
  ) {
    return res.status(401).end();
  }
  const pase = wallet.paseDeSerie(req.params.serial);
  // Se compara siempre en tiempo constante, exista o no el pase en la base,
  // para no delatar por temporización qué números de serie están registrados.
  const authToken = pase ? pase.auth_token : '0'.repeat(32);
  const a = Buffer.from(token);
  const b = Buffer.from(authToken);
  const coincide = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!pase || !coincide) {
    return res.status(401).end();
  }
  req.pase = pase;
  return next();
}

/** El teléfono guarda el pase y pide que le avisen de los cambios. */
router.post(
  '/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
  exigirCartera('apple'),
  limiteServicioApple,
  exigirPase,
  exigirDispositivoValido,
  asyncHandler(async (req, res) => {
    const pushToken = req.body?.pushToken;
    // Solo hexadecimal: el token acaba dentro de la ruta de la petición a Apple.
    if (typeof pushToken !== 'string' || !PUSH_TOKEN_VALIDO.test(pushToken)) {
      throw badRequest('El identificador de avisos no es válido.', null, 'push_token_invalido');
    }
    const { yaEstaba } = wallet.registrarDispositivo({
      deviceId: req.params.deviceId,
      serial: req.params.serial,
      pushToken,
    });
    res.status(yaEstaba ? 200 : 201).end();
  }),
);

/** El teléfono deja de querer avisos (se borró el pase). */
router.delete(
  '/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
  exigirCartera('apple'),
  limiteServicioApple,
  exigirPase,
  exigirDispositivoValido,
  asyncHandler(async (req, res) => {
    wallet.olvidarDispositivo({ deviceId: req.params.deviceId, serial: req.params.serial });
    res.status(200).end();
  }),
);

/** Qué pases de este teléfono cambiaron desde la última vez. */
router.get(
  '/apple/v1/devices/:deviceId/registrations/:passTypeId',
  exigirCartera('apple'),
  limiteServicioApple,
  exigirDispositivoValido,
  asyncHandler(async (req, res) => {
    // Apple no pide contraseña en esta consulta; lo mínimo es que el tipo de
    // pase sea el nuestro y que la marca de tiempo tenga forma de marca.
    if (req.params.passTypeId !== config.wallet.apple.passTypeId) return res.status(404).end();
    const marca = req.query.passesUpdatedSince;
    if (marca !== undefined && (typeof marca !== 'string' || !MARCA_DE_TIEMPO_VALIDA.test(marca))) {
      throw badRequest('La marca de tiempo no es válida.', null, 'marca_invalida');
    }
    const desde = marca || null;
    const cambios = wallet.seriesActualizadas(req.params.deviceId, desde);
    if (!cambios) return res.status(204).end();
    res.json(cambios);
  }),
);

/** El pase al día. Es la petición que trae el saldo nuevo al teléfono. */
router.get(
  '/apple/v1/passes/:passTypeId/:serial',
  exigirCartera('apple'),
  limiteServicioApple,
  exigirPase,
  asyncHandler(async (req, res) => {
    const desde = req.get('if-modified-since');
    const cambiado = new Date(req.pase.updated_at);
    // Los segundos son lo único que viaja en la cabecera: comparar con más
    // precisión haría que un cambio del mismo segundo pareciera nuevo siempre.
    if (desde && Math.floor(cambiado.getTime() / 1000) <= Math.floor(new Date(desde).getTime() / 1000)) {
      return res.status(304).end();
    }

    const paseData = wallet.construirPaseApple(req.pase.pack_id);
    if (!paseData) return res.status(404).end();
    const { archivo } = paseData;
    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Last-Modified', cambiado.toUTCString());
    res.set('Cache-Control', 'no-store');
    res.send(archivo);
  }),
);

/** Los avisos de error que manda el propio teléfono; ayudan a diagnosticar. */
router.post(
  '/apple/v1/log',
  exigirCartera('apple'),
  limiteLogApple,
  (req, res) => {
    // Llega sin autenticar y de cualquiera: se aceptan solo textos, sin
    // caracteres de control (que permitirían fabricar líneas falsas en el
    // registro) y con tope de cantidad y de largo.
    const lineas = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 20) : [];
    for (const linea of lineas) {
      if (typeof linea !== 'string') continue;
      const detalle = linea.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, 400);
      logger.warn('Aviso del teléfono sobre un pase', { detalle });
    }
    res.status(200).end();
  },
);

export default router;

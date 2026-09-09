/**
 * Pases para la cartera del teléfono.
 *
 * Dos grupos de rutas muy distintos:
 *
 *  - Las del cliente, con su sesión: descargar el pase de Apple y pedir el
 *    enlace de Google.
 *  - El servicio web de Apple (`/v1/...`), al que llama el teléfono por su
 *    cuenta, sin sesión: se identifica con la contraseña que lleva el propio
 *    pase dentro. Es el que hace que el saldo se actualice solo.
 */
import crypto from 'node:crypto';
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as packsService from '../services/packs.js';
import * as wallet from '../services/wallet.js';

export const router = express.Router();

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
  const pack = packsService.findById(req.params.packId);
  if (!pack) throw notFound('Pack no encontrado.');

  if (admitirTicket && typeof req.query.t === 'string' && wallet.ticketValido(pack.id, req.query.t)) {
    return pack;
  }
  if (!req.user) throw unauthorized('Necesitas iniciar sesión.');
  if (pack.user_id !== req.user.id && req.user.role !== 'master') {
    throw forbidden('Este pack no te pertenece.');
  }
  return pack;
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
    keyFn: (req) => req.user?.id ?? `ip:${req.clientIp}`,
  }),
  asyncHandler(async (req, res) => {
    const pack = packDelCliente(req, { admitirTicket: true });
    const { archivo } = wallet.construirPaseApple(pack.id);
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
    const url = await wallet.enlaceGoogle(pack.id);
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
  const pase = wallet.paseDeSerie(req.params.serial);
  if (!pase || !token) return res.status(401).end();

  const a = Buffer.from(token);
  const b = Buffer.from(pase.auth_token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).end();
  }
  req.pase = pase;
  return next();
}

/** El teléfono guarda el pase y pide que le avisen de los cambios. */
router.post(
  '/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
  exigirCartera('apple'),
  exigirPase,
  asyncHandler(async (req, res) => {
    const pushToken = req.body?.pushToken;
    if (typeof pushToken !== 'string' || pushToken.length < 32 || pushToken.length > 200) {
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
  exigirPase,
  asyncHandler(async (req, res) => {
    wallet.olvidarDispositivo({ deviceId: req.params.deviceId, serial: req.params.serial });
    res.status(200).end();
  }),
);

/** Qué pases de este teléfono cambiaron desde la última vez. */
router.get(
  '/apple/v1/devices/:deviceId/registrations/:passTypeId',
  exigirCartera('apple'),
  asyncHandler(async (req, res) => {
    const desde = typeof req.query.passesUpdatedSince === 'string' ? req.query.passesUpdatedSince : null;
    const cambios = wallet.seriesActualizadas(req.params.deviceId, desde);
    if (!cambios) return res.status(204).end();
    res.json(cambios);
  }),
);

/** El pase al día. Es la petición que trae el saldo nuevo al teléfono. */
router.get(
  '/apple/v1/passes/:passTypeId/:serial',
  exigirCartera('apple'),
  exigirPase,
  asyncHandler(async (req, res) => {
    const desde = req.get('if-modified-since');
    const cambiado = new Date(req.pase.updated_at);
    // Los segundos son lo único que viaja en la cabecera: comparar con más
    // precisión haría que un cambio del mismo segundo pareciera nuevo siempre.
    if (desde && Math.floor(cambiado.getTime() / 1000) <= Math.floor(new Date(desde).getTime() / 1000)) {
      return res.status(304).end();
    }

    const { archivo } = wallet.construirPaseApple(req.pase.pack_id);
    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Last-Modified', cambiado.toUTCString());
    res.set('Cache-Control', 'no-store');
    res.send(archivo);
  }),
);

/** Los avisos de error que manda el propio teléfono; ayudan a diagnosticar. */
router.post(
  '/apple/v1/log',
  asyncHandler(async (req, res) => {
    for (const linea of (req.body?.logs ?? []).slice(0, 20)) {
      logger.warn('Aviso del teléfono sobre un pase', { detalle: String(linea).slice(0, 400) });
    }
    res.status(200).end();
  }),
);

export default router;

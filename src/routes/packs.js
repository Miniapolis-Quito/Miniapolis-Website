/** Rutas del cliente: sus packs, su saldo, su QR y su historial. */
import express from 'express';
import QRCode from 'qrcode';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, actuaComoMaster } from '../middleware/auth.js';
import { forbidden, notFound, badRequest } from '../lib/errors.js';
import { paginationSchema, transferPackSchema, createPackRequestSchema, parseOrThrow } from '../lib/validate.js';
import { buildQrPayload } from '../lib/qr.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as packs from '../services/packs.js';
import * as redemptions from '../services/redemptions.js';
import * as users from '../services/users.js';
import * as fidelidad from '../services/fidelidad.js';
import * as packRequests from '../services/packRequests.js';
import { config } from '../config.js';

export const router = express.Router();
router.use(requireAuth);

/** El máster puede consultar cualquier pack; el resto, solo los propios. */
function loadOwnPack(req) {
  const pack = packs.findById(req.params.id);
  if (!pack) throw notFound('Pack no encontrado.');
  if (pack.user_id !== req.user.id && !actuaComoMaster(req.user)) {
    throw forbidden('Este pack no te pertenece.');
  }
  const owner = pack.user_id === req.user.id ? { status: req.user.status } : users.findById(pack.user_id);
  return { pack, owner };
}

/** Saldo y packs del usuario autenticado. */
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      summary: packs.summaryForUser(req.user.id),
      packs: packs.listPacksForUser(req.user.id, { includeQr: true }),
      // Cómo va con el programa de fidelidad. Llega siempre: con el programa
      // apagado viene en `enabled: false` y la app no muestra nada.
      loyalty: fidelidad.progreso(req.user.id),
      qrConfig: { ttlSeconds: config.qr.ttlSeconds, refreshSeconds: config.qr.refreshSeconds },
      serverTime: new Date().toISOString(),
    });
  }),
);

/** Solo el saldo: respuesta mínima para refrescos frecuentes. */
router.get(
  '/mine/summary',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      summary: packs.summaryForUser(req.user.id),
      loyalty: fidelidad.progreso(req.user.id, { incluirPremios: false }),
      serverTime: new Date().toISOString(),
    });
  }),
);

/** Nuevo contenido de QR para un pack propio. */
router.get(
  '/:id/qr',
  rateLimit({ name: 'qr-user', limit: 600, windowSeconds: 15 * 60, keyFn: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const { pack, owner } = loadOwnPack(req);
    const usable = packs.isUsable(pack, { owner });
    if (!usable.ok) throw badRequest(usable.message, { reason: usable.reason }, `pack_${usable.reason}`);

    res.set('Cache-Control', 'no-store');
    res.json({
      payload: buildQrPayload(pack),
      code: pack.code,
      remaining: pack.remaining,
      ttlSeconds: config.qr.ttlSeconds,
      refreshSeconds: config.qr.refreshSeconds,
      generatedAt: new Date().toISOString(),
    });
  }),
);

/** Imagen SVG del QR, lista para mostrar o imprimir. */
router.get(
  '/:id/qr.svg',
  rateLimit({ name: 'qrsvg-user', limit: 600, windowSeconds: 15 * 60, keyFn: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const { pack, owner } = loadOwnPack(req);
    const wantsStatic = req.query.mode === 'static';

    if (wantsStatic && !pack.allow_static_qr) {
      throw forbidden('Este pack no tiene habilitado el QR impreso.', 'estatico_no_permitido');
    }
    const usable = packs.isUsable(pack, { owner });
    if (!usable.ok) throw badRequest(usable.message, { reason: usable.reason }, `pack_${usable.reason}`);

    const payload = buildQrPayload(pack, { static: wantsStatic });
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0b0f14', light: '#ffffff' },
    });

    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(svg);
  }),
);

/** Movimientos contables de un pack propio. */
router.get(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const { pack } = loadOwnPack(req);
    res.json({ items: packs.movements(pack.id) });
  }),
);

/** Historial de consumos del usuario autenticado. */
router.get(
  '/mine/history',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    res.json(redemptions.listRedemptions({ userId: req.user.id, limit, offset }));
  }),
);

/** La clave de idempotencia puede venir por cabecera (lo habitual) o en el cuerpo. */
function idempotencyKey(req, body) {
  const header = req.get('Idempotency-Key');
  const fromBody = body?.idempotencyKey;
  if (header && fromBody && header.trim() !== fromBody.trim()) {
    throw badRequest('La clave de idempotencia de la cabecera no coincide con la del cuerpo.', null, 'idempotencia_invalida');
  }
  const key = header || fromBody;
  if (!key) return undefined;
  const value = String(key).trim();
  if (value.length < 8 || value.length > 80 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw badRequest('La clave de idempotencia no tiene un formato válido.', null, 'idempotencia_invalida');
  }
  return value;
}

const transferLimiter = rateLimit({
  name: 'transfer-user',
  limit: 20,
  windowSeconds: 15 * 60,
  keyFn: (req) => req.user?.id,
  message: 'Has hecho demasiadas transferencias en poco tiempo. Espera unos minutos.',
});

/** Transfiere entradas de un pack propio a otro cliente registrado. */
router.post(
  '/:id/transfer',
  transferLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(transferPackSchema, req.body, badRequest);
    const result = packs.transferTickets(req.params.id, {
      ...data,
      idempotencyKey: idempotencyKey(req, req.body),
      actor: req.user,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    if (result.idempotentReplay) res.set('Idempotent-Replay', 'true');
    res.json(result);
  }),
);

/** Historial de transferencias (enviadas y recibidas) del cliente autenticado. */
router.get(
  '/transfers',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    const direction = ['all', 'sent', 'received'].includes(req.query.direction) ? req.query.direction : 'all';
    res.json(packs.listTransfersForUser(req.user.id, { limit, offset, direction }));
  }),
);

/** Catálogo de packs a la venta, para mostrar precios en la app. */
router.get(
  '/catalog',
  asyncHandler(async (req, res) => {
    res.json({
      currency: config.currency,
      items: config.packCatalog.map((p) => ({ size: p.size, priceCents: p.priceCents, label: p.label })),
    });
  }),
);

const requestLimiter = rateLimit({
  name: 'pack-request-user',
  limit: 15,
  windowSeconds: 15 * 60,
  keyFn: (req) => req.user?.id,
  message: 'Has hecho demasiadas solicitudes en poco tiempo. Espera unos minutos.',
});

/** El cliente solicita la compra o recarga de un pack con su comprobante de pago. */
router.post(
  '/requests',
  requestLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(createPackRequestSchema, req.body, badRequest);
    const key = idempotencyKey(req, req.body);
    const request = packRequests.createRequest({
      userId: req.user.id,
      ...data,
      idempotencyKey: key,
      actor: req.user,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    if (request.idempotentReplay) res.set('Idempotent-Replay', 'true');
    res.status(request.idempotentReplay ? 200 : 201).json({ ok: true, request });
  }),
);

/** Consulta las solicitudes de recarga del usuario autenticado. */
router.get(
  '/requests/mine',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    res.json(packRequests.listRequests({ userId: req.user.id, limit, offset }));
  }),
);

/** Cancela una solicitud pendiente propia. */
router.post(
  '/requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const request = packRequests.cancelRequest(req.params.id, {
      userId: req.user.id,
      actor: req.user,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    res.json({ ok: true, request });
  }),
);

export default router;

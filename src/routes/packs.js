/** Rutas del cliente: sus packs, su saldo, su QR y su historial. */
import express from 'express';
import QRCode from 'qrcode';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { forbidden, notFound, badRequest } from '../lib/errors.js';
import { paginationSchema, parseOrThrow } from '../lib/validate.js';
import { buildQrPayload } from '../lib/qr.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as packs from '../services/packs.js';
import * as redemptions from '../services/redemptions.js';
import * as users from '../services/users.js';
import { config } from '../config.js';

export const router = express.Router();
router.use(requireAuth);

/** El máster puede consultar cualquier pack; el resto, solo los propios. */
function loadOwnPack(req) {
  const pack = packs.findById(req.params.id);
  if (!pack) throw notFound('Pack no encontrado.');
  if (pack.user_id !== req.user.id && req.user.role !== 'master') {
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
    res.json({ summary: packs.summaryForUser(req.user.id), serverTime: new Date().toISOString() });
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

export default router;

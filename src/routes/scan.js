/** Rutas del personal de pista: escanear, consultar y consumir entradas. */
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireStaff } from '../middleware/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { scanSchema, manualRedeemSchema, paginationSchema, parseOrThrow } from '../lib/validate.js';
import { parseQrPayload, verifyQrPayload } from '../lib/qr.js';
import * as packsService from '../services/packs.js';
import * as redemptions from '../services/redemptions.js';
import { getDb } from '../db/index.js';

export const router = express.Router();
router.use(requireStaff);

/** La clave de idempotencia puede venir por cabecera (lo habitual) o en el cuerpo. */
function idempotencyKey(req, body) {
  const header = req.get('Idempotency-Key');
  const key = body.idempotencyKey || header;
  if (!key) return undefined;
  const value = String(key).trim();
  if (value.length < 8 || value.length > 80 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw badRequest('La clave de idempotencia no tiene un formato válido.', null, 'idempotencia_invalida');
  }
  return value;
}

const scanLimiter = rateLimit({
  name: 'scan-user',
  limit: 600,
  windowSeconds: 15 * 60,
  keyFn: (req) => req.user?.id,
  message: 'Se registraron demasiados escaneos seguidos desde este dispositivo. Espera un momento.',
});

/** Consume una entrada a partir del QR del cliente. */
router.post(
  '/',
  scanLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(scanSchema, req.body, badRequest);
    const result = redemptions.redeemByQr({
      payload: data.payload,
      scanner: req.user,
      deviceLabel: data.deviceLabel,
      idempotencyKey: idempotencyKey(req, data),
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    if (result.idempotentReplay) res.set('Idempotent-Replay', 'true');
    res.status(result.statusCode).json(result.body);
  }),
);

/**
 * Comprueba un QR sin consumir nada. Sirve para que el personal confirme el
 * saldo antes de descontar, o para diagnosticar un código que falla.
 */
router.post(
  '/verify',
  scanLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(scanSchema, req.body, badRequest);
    const parsed = parseQrPayload(data.payload);
    if (!parsed.ok) throw badRequest('El código no corresponde a una entrada válida.', { reason: parsed.reason }, 'qr_invalido');

    const pack = packsService.findByCode(parsed.code);
    if (!pack) throw notFound('No existe ningún pack con ese código.', 'pack_no_encontrado');

    const verification = verifyQrPayload(parsed, pack);
    const owner = getDb().prepare('SELECT id, full_name, status FROM users WHERE id = ?').get(pack.user_id);
    const usable = packsService.isUsable(pack, { owner });

    res.json({
      valid: verification.ok && usable.ok,
      signatureOk: verification.ok,
      reason: verification.ok ? (usable.ok ? null : usable.reason) : verification.reason,
      message: verification.ok ? (usable.ok ? 'Código válido.' : usable.message) : 'El código no es válido o venció.',
      pack: packsService.toPublicPack(pack),
      customer: owner ? { id: owner.id, fullName: owner.full_name } : null,
    });
  }),
);

/** Consumo manual por código, para cuando la cámara no coopera. */
router.post(
  '/manual',
  scanLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(manualRedeemSchema, req.body, badRequest);
    const result = redemptions.redeemByCode({
      code: data.code,
      scanner: req.user,
      deviceLabel: data.deviceLabel,
      idempotencyKey: idempotencyKey(req, data),
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    if (result.idempotentReplay) res.set('Idempotent-Replay', 'true');
    res.status(result.statusCode).json(result.body);
  }),
);

/** Consulta de un pack por código, sin consumir. */
router.get(
  '/lookup/:code',
  rateLimit({ name: 'lookup-user', limit: 300, windowSeconds: 15 * 60, keyFn: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const pack = packsService.findByLooseCode(req.params.code);
    if (!pack) throw notFound('No existe ningún pack con ese código.', 'pack_no_encontrado');
    const owner = getDb().prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(pack.user_id);
    const usable = packsService.isUsable(pack, { owner });
    res.json({
      pack: packsService.toPublicPack(pack),
      customer: owner ? { id: owner.id, fullName: owner.full_name, email: owner.email } : null,
      usable: usable.ok,
      reason: usable.ok ? null : usable.reason,
      message: usable.ok ? 'Pack disponible.' : usable.message,
      recentRedemptions: redemptions.listRedemptions({ packId: pack.id, limit: 5 }).items,
    });
  }),
);

/** Últimos escaneos hechos por este dispositivo o por todo el personal. */
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    const scannerId = req.query.scope === 'todos' ? null : req.user.id;
    res.json(redemptions.listRedemptions({ scannerId, limit, offset }));
  }),
);

export default router;

/** Registro, inicio y cierre de sesión, y renovación de tokens. */
import express from 'express';
import { config } from '../config.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit, reset as resetRateLimit } from '../lib/rateLimit.js';
import { badRequest, forbidden, tooManyRequests, unauthorized } from '../lib/errors.js';
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  updateProfileSchema,
  parseOrThrow,
} from '../lib/validate.js';
import { validatePasswordStrength } from '../lib/passwords.js';
import * as users from '../services/users.js';
import * as sessions from '../services/sessions.js';
import * as audit from '../services/audit.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from '../lib/cookies.js';
import { summaryForUser } from '../services/packs.js';

export const router = express.Router();

function sessionResponse(user) {
  return {
    user: users.toPublicUser(user),
    summary: user.role === 'customer' ? summaryForUser(user.id) : undefined,
  };
}

/** Límite por IP y, en login, también por cuenta, para frenar fuerza bruta. */
const loginLimiter = rateLimit({
  name: 'login-ip',
  limit: 20,
  windowSeconds: 15 * 60,
  message: 'Demasiados intentos desde esta conexión. Espera unos minutos.',
});

const registerLimiter = rateLimit({
  name: 'registro-ip',
  limit: 10,
  windowSeconds: 60 * 60,
  message: 'Demasiadas cuentas creadas desde esta conexión. Inténtalo más tarde.',
});

const refreshLimiter = rateLimit({ name: 'refresh-ip', limit: 120, windowSeconds: 15 * 60 });

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    if (!config.security.allowSelfRegistration) {
      throw forbidden('El registro público está desactivado. Pide tu cuenta en recepción.', 'registro_cerrado');
    }
    const data = parseOrThrow(registerSchema, req.body, badRequest);

    const strength = validatePasswordStrength(data.password, { email: data.email, fullName: data.fullName });
    if (!strength.ok) {
      throw badRequest(strength.errors[0], { fields: { password: strength.errors.join(' ') } }, 'password_debil');
    }

    const user = await users.createUser({
      email: data.email,
      password: data.password,
      fullName: data.fullName,
      phone: data.phone,
      role: 'customer',
    });

    const { accessToken, refreshToken } = sessions.issueSession(user, {
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    setRefreshCookie(res, refreshToken);

    audit.record({
      actor: { id: user.id, email: user.email },
      action: 'cuenta.registrada',
      entityType: 'user',
      entityId: user.id,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({ accessToken, ...sessionResponse(user) });
  }),
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(loginSchema, req.body, badRequest);

    // Segundo límite, esta vez por cuenta: protege a un usuario concreto aunque
    // el atacante rote de dirección IP.
    const accountLimiter = rateLimit({
      name: 'login-cuenta',
      limit: 12,
      windowSeconds: 15 * 60,
      keyFn: () => data.email,
      message: 'Demasiados intentos para esta cuenta. Espera unos minutos.',
    });
    await new Promise((resolve, reject) => {
      accountLimiter(req, res, (error) => (error ? reject(error) : resolve()));
    });

    const result = await users.authenticate(data.email, data.password);

    if (!result.ok) {
      audit.record({
        actor: null,
        action: 'login.fallido',
        entityType: 'user',
        entityId: null,
        metadata: { email: data.email, reason: result.reason },
        ip: req.clientIp,
        userAgent: req.get('user-agent'),
      });
      if (result.reason === 'bloqueado') {
        throw tooManyRequests(
          `Cuenta bloqueada temporalmente por seguridad. Vuelve a intentarlo en ${Math.ceil((result.retryAfterSeconds || 900) / 60)} minutos.`,
          { retryAfterSeconds: result.retryAfterSeconds },
        );
      }
      if (result.reason === 'suspendido') {
        throw forbidden('Tu cuenta está suspendida. Contacta con el administrador.', 'cuenta_suspendida');
      }
      throw unauthorized('Correo o contraseña incorrectos.', 'credenciales_invalidas');
    }

    // Login correcto: se devuelve la cuota consumida para no penalizar al usuario legítimo.
    resetRateLimit(`login-cuenta:${data.email}`);
    if (req.rateLimitKey) resetRateLimit(req.rateLimitKey);

    const { accessToken, refreshToken } = sessions.issueSession(result.user, {
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    setRefreshCookie(res, refreshToken);

    audit.record({
      actor: { id: result.user.id, email: result.user.email },
      action: 'login.exitoso',
      entityType: 'user',
      entityId: result.user.id,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });

    res.json({ accessToken, ...sessionResponse(result.user) });
  }),
);

router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const token = readRefreshToken(req);
    if (!token) throw unauthorized('No hay sesión que renovar.', 'sin_refresh_token');

    const result = sessions.rotate(token, { ip: req.clientIp, userAgent: req.get('user-agent') });
    if (!result.ok) {
      clearRefreshCookie(res);
      const messages = {
        reutilizado: 'Detectamos un uso sospechoso de tu sesión y la cerramos por seguridad. Vuelve a entrar.',
        expirado: 'Tu sesión expiró. Vuelve a entrar.',
        suspendido: 'Tu cuenta está suspendida. Contacta con el administrador.',
      };
      throw unauthorized(messages[result.reason] || 'Tu sesión ya no es válida. Vuelve a entrar.', `refresh_${result.reason}`);
    }

    setRefreshCookie(res, result.refreshToken);
    res.json({ accessToken: result.accessToken, ...sessionResponse(result.user) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = readRefreshToken(req);
    if (token) sessions.revokeByToken(token, 'logout');
    clearRefreshCookie(res);
    if (req.user) {
      audit.record({
        actor: { id: req.user.id, email: req.user.email },
        action: 'logout',
        entityType: 'user',
        entityId: req.user.id,
        ip: req.clientIp,
      });
    }
    res.json({ ok: true });
  }),
);

/** Cierra la sesión en todos los dispositivos. */
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const count = sessions.revokeAllForUser(req.user.id, 'logout_all');
    clearRefreshCookie(res);
    audit.record({
      actor: req.user,
      action: 'logout.todos',
      entityType: 'user',
      entityId: req.user.id,
      metadata: { sesiones: count },
      ip: req.clientIp,
    });
    res.json({ ok: true, sesionesCerradas: count });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  rateLimit({ name: 'password-user', limit: 10, windowSeconds: 60 * 60, keyFn: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(changePasswordSchema, req.body, badRequest);
    const strength = validatePasswordStrength(data.newPassword, {
      email: req.user.email,
      fullName: req.user.fullName,
    });
    if (!strength.ok) {
      throw badRequest(strength.errors[0], { fields: { newPassword: strength.errors.join(' ') } }, 'password_debil');
    }
    if (data.newPassword === data.currentPassword) {
      throw badRequest('La contraseña nueva debe ser distinta a la actual.', {
        fields: { newPassword: 'Debe ser distinta a la actual.' },
      });
    }

    await users.changePassword(req.user.id, data.currentPassword, data.newPassword);

    audit.record({
      actor: req.user,
      action: 'password.cambiada',
      entityType: 'user',
      entityId: req.user.id,
      ip: req.clientIp,
    });

    // El cambio revoca todas las sesiones: se abre una nueva para quien lo hizo.
    const user = users.findById(req.user.id);
    const { accessToken, refreshToken } = sessions.issueSession(user, {
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    setRefreshCookie(res, refreshToken);
    res.json({ ok: true, accessToken, ...sessionResponse(user) });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = users.findById(req.user.id);
    res.json(sessionResponse(user));
  }),
);

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(updateProfileSchema, req.body, badRequest);
    const user = users.updateUser(req.user.id, data);
    audit.record({
      actor: req.user,
      action: 'perfil.actualizado',
      entityType: 'user',
      entityId: req.user.id,
      metadata: data,
      ip: req.clientIp,
    });
    res.json(sessionResponse(user));
  }),
);

router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      items: sessions
        .listForUser(req.user.id)
        .map((fila) => sessions.toPublicSession(fila, { currentSessionId: req.user.sessionId })),
    });
  }),
);

export default router;

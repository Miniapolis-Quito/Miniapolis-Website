/** Registro, inicio y cierre de sesión, y renovación de tokens. */
import express from 'express';
import { config } from '../config.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit, consume, reset as resetRateLimit } from '../lib/rateLimit.js';
import QRCode from 'qrcode';
import { badRequest, forbidden, notFound, tooManyRequests, unauthorized } from '../lib/errors.js';
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  resetTokenSchema,
  resetPasswordSchema,
  twoFactorLoginSchema,
  twoFactorConfirmSchema,
  twoFactorDisableSchema,
  parseOrThrow,
} from '../lib/validate.js';
import { validatePasswordStrength, verifyPassword } from '../lib/passwords.js';
import * as users from '../services/users.js';
import * as sessions from '../services/sessions.js';
import * as audit from '../services/audit.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from '../lib/cookies.js';
import { summaryForUser } from '../services/packs.js';
import * as recuperacion from '../services/recuperacion.js';
import * as avisos from '../services/avisos.js';
import * as dosFactores from '../services/dosFactores.js';

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

/**
 * El segundo paso tiene su propio techo por conexión, además del tope de
 * intentos que lleva cada desafío. Sin él, alguien con la contraseña podría
 * pedir desafíos nuevos sin parar y probar seis dígitos de cinco en cinco.
 */
const segundoPasoLimiter = rateLimit({
  name: 'login-2fa-ip',
  limit: 30,
  windowSeconds: 15 * 60,
  message: 'Demasiados códigos desde esta conexión. Espera unos minutos.',
});

/** Configurar el segundo factor también se limita, por cuenta. */
const gestionDosFactoresLimiter = rateLimit({
  name: 'dos-factores-user',
  limit: 20,
  windowSeconds: 15 * 60,
  keyFn: (req) => req.user?.id,
  message: 'Demasiados intentos con la verificación en dos pasos. Espera unos minutos.',
});

/**
 * Abre la sesión y responde. Es el final común del acceso: cuando no hay
 * segundo factor se llega aquí desde /login, y cuando lo hay desde /login/2fa.
 */
function abrirSesion(req, res, user, { metadata = null, estado = 200 } = {}) {
  const { accessToken, refreshToken } = sessions.issueSession(user, {
    ip: req.clientIp,
    userAgent: req.get('user-agent'),
  });
  setRefreshCookie(res, refreshToken);

  audit.record({
    actor: { id: user.id, email: user.email },
    action: 'login.exitoso',
    entityType: 'user',
    entityId: user.id,
    metadata,
    ip: req.clientIp,
    userAgent: req.get('user-agent'),
  });

  return res.status(estado).json({ accessToken, ...sessionResponse(user) });
}

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

    // Login correcto: se devuelve la cuota de la cuenta para no penalizar a su
    // dueño. La de la conexión no se toca: si un acierto la vaciara, bastaría
    // con entrar de vez en cuando a una cuenta propia para seguir probando
    // contraseñas ajenas sin límite desde la misma IP.
    resetRateLimit(`login-cuenta:${data.email}`);

    // Con verificación en dos pasos, acertar la contraseña no abre sesión:
    // abre un desafío de unos minutos. La cookie de refresco no se toca, así
    // que quedarse a medias no deja nada utilizable en el navegador.
    if (result.user.totp_enabled) {
      const desafio = dosFactores.crearDesafio(result.user, {
        ip: req.clientIp,
        userAgent: req.get('user-agent'),
      });
      audit.record({
        actor: { id: result.user.id, email: result.user.email },
        action: 'login.segundo_paso_pendiente',
        entityType: 'user',
        entityId: result.user.id,
        ip: req.clientIp,
        userAgent: req.get('user-agent'),
      });
      return res.json({
        twoFactorRequired: true,
        challengeToken: desafio.token,
        expiresInSeconds: desafio.expiresInSeconds,
        digits: config.twoFactor.digitos,
      });
    }

    return abrirSesion(req, res, result.user);
  }),
);

/**
 * Segundo paso del acceso. El desafío dice de quién es; el código dice que el
 * teléfono está delante. Un código de respaldo sirve igual y se gasta.
 */
router.post(
  '/login/2fa',
  segundoPasoLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(twoFactorLoginSchema, req.body, badRequest);
    const resultado = dosFactores.resolverDesafio(data.challengeToken, data.code, { ip: req.clientIp });

    const user = users.findById(resultado.userId);
    if (!user) throw unauthorized('Tu cuenta ya no existe.', 'usuario_inexistente');
    if (user.status !== 'active') {
      throw forbidden('Tu cuenta está suspendida. Contacta con el administrador.', 'cuenta_suspendida');
    }

    return abrirSesion(req, res, user, {
      metadata: { segundoFactor: resultado.via, codigosRestantes: resultado.codigosRestantes },
    });
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
      if (result.reason === 'reutilizado') {
        audit.record({
          actor: result.userId ? { id: result.userId } : null,
          action: 'sesion.token_reutilizado',
          entityType: 'user',
          entityId: result.userId ?? null,
          metadata: { motivo: 'reutilizacion_detectada' },
          ip: req.clientIp,
          userAgent: req.get('user-agent'),
        });
      }
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

/** Fallos seguidos con la contraseña actual que se toleran en una hora. */
const FALLOS_DE_PASSWORD_ACTUAL = 5;

/**
 * Cuenta un fallo con la contraseña actual. Al llegar al máximo cierra la
 * sesión en uso: quien roba una sesión abierta no puede quedarse probando
 * contraseñas para después cambiarla y quedarse con la cuenta.
 */
function registrarFalloDePasswordActual(req, res) {
  const cuota = consume(`password-actual-fallos:${req.user.id}`, {
    limit: FALLOS_DE_PASSWORD_ACTUAL,
    windowSeconds: 60 * 60,
  });
  if (cuota.allowed && cuota.remaining > 0) return;

  sessions.revokeSessionFamily(req.user.sessionId, 'password_actual_fallida');
  clearRefreshCookie(res);
  audit.record({
    actor: req.user,
    action: 'password.cambio_bloqueado',
    entityType: 'user',
    entityId: req.user.id,
    ip: req.clientIp,
    userAgent: req.get('user-agent'),
  });
  throw unauthorized(
    'Demasiados intentos con la contraseña actual. Por seguridad cerramos esta sesión: vuelve a entrar.',
    'sesion_cerrada_por_intentos',
  );
}

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

    try {
      await users.changePassword(req.user.id, data.currentPassword, data.newPassword);
    } catch (error) {
      if (error?.code === 'password_incorrecta') registrarFalloDePasswordActual(req, res);
      throw error;
    }
    resetRateLimit(`password-actual-fallos:${req.user.id}`);

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
    recuperacion.avisarCambio(user, { via: 'cuenta', ip: req.clientIp });
    res.json({ ok: true, accessToken, ...sessionResponse(user) });
  }),
);

// ---------------------------------------------------------------------------
// Verificación en dos pasos
// ---------------------------------------------------------------------------

/** Cómo está la cuenta y si la pista se la exige. */
router.get(
  '/2fa',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(dosFactores.estado(req.user));
  }),
);

/**
 * Empieza la configuración: entrega el secreto, el QR para escanearlo y el
 * mismo secreto en texto por si la cámara no colabora. Todavía no cambia nada:
 * hasta confirmar con un código, la cuenta entra como siempre.
 */
router.post(
  '/2fa/setup',
  requireAuth,
  gestionDosFactoresLimiter,
  asyncHandler(async (req, res) => {
    const alta = dosFactores.iniciarAlta(req.user);
    // El QR se dibuja en el servidor: la página no necesita ninguna librería de
    // terceros y la política de contenidos puede seguir cerrada a cal y canto.
    const qrDataUrl = await QRCode.toDataURL(alta.otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.json({ ...alta, qrDataUrl });
  }),
);

/** Confirma la configuración con el primer código y entrega los de respaldo. */
router.post(
  '/2fa/activate',
  requireAuth,
  gestionDosFactoresLimiter,
  asyncHandler(async (req, res) => {
    const { code } = parseOrThrow(twoFactorConfirmSchema, req.body, badRequest);
    const recoveryCodes = dosFactores.activar(req.user, code, {
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });

    // Las sesiones que se abrieron solo con la contraseña dejan de valer; la
    // que acaba de activarla sigue viva para poder apuntar los códigos.
    const cerradas = sessions.revokeOtherSessions(req.user.id, req.user.sessionId, 'dos_factores_activada');

    res.json({
      ok: true,
      recoveryCodes,
      sesionesCerradas: cerradas,
      estado: dosFactores.estado(req.user),
    });
  }),
);

/**
 * Renueva los códigos de respaldo. Pide un código del teléfono: quien tenga la
 * pantalla abierta un momento no puede llevarse una tanda nueva.
 */
router.post(
  '/2fa/recovery-codes',
  requireAuth,
  gestionDosFactoresLimiter,
  asyncHandler(async (req, res) => {
    const { code } = parseOrThrow(twoFactorConfirmSchema, req.body, badRequest);
    dosFactores.exigirCodigo(req.user, code, { ip: req.clientIp });
    const recoveryCodes = dosFactores.renovarCodigos(req.user, {
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    res.json({ ok: true, recoveryCodes, estado: dosFactores.estado(req.user) });
  }),
);

/**
 * La quita. Pide la contraseña y un código: con solo una sesión robada no se
 * puede desarmar el segundo factor.
 */
router.post(
  '/2fa/disable',
  requireAuth,
  gestionDosFactoresLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(twoFactorDisableSchema, req.body, badRequest);

    const cuenta = users.findById(req.user.id);
    if (!cuenta) throw unauthorized('Tu sesión ya no es válida. Vuelve a entrar.');
    if (!(await verifyPassword(data.password, cuenta.password_hash))) {
      // Se cuenta igual que un fallo al cambiar la contraseña: al quinto, esta
      // sesión se cierra sola.
      registrarFalloDePasswordActual(req, res);
      throw badRequest(
        'La contraseña no es correcta.',
        { fields: { password: 'Contraseña incorrecta.' } },
        'password_incorrecta',
      );
    }
    dosFactores.exigirCodigo(req.user, data.code, { ip: req.clientIp });
    resetRateLimit(`password-actual-fallos:${req.user.id}`);

    dosFactores.desactivar(cuenta, {
      motivo: 'usuario',
      actor: req.user,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, estado: dosFactores.estado(req.user) });
  }),
);

// ---------------------------------------------------------------------------
// Recuperación de contraseña por correo
// ---------------------------------------------------------------------------

/** Visible: por conexión no revela nada de ninguna cuenta. */
const recuperacionLimiter = rateLimit({
  name: 'recuperacion-ip',
  limit: 10,
  windowSeconds: 60 * 60,
  message: 'Demasiadas solicitudes desde esta conexión. Inténtalo más tarde.',
});

const canjeLimiter = rateLimit({
  name: 'restablecer-ip',
  limit: 30,
  windowSeconds: 15 * 60,
  message: 'Demasiados intentos desde esta conexión. Espera unos minutos.',
});

function exigirRecuperacion(req, res, next) {
  if (recuperacion.disponible()) return next();
  return next(
    notFound(
      'La recuperación por correo no está disponible. Acércate a recepción y te ayudamos.',
      'recuperacion_no_disponible',
    ),
  );
}

/**
 * Pide un enlace. La respuesta sale antes de buscar la cuenta y es la misma
 * para cualquier dirección: ni su contenido ni su tiempo dicen si existe.
 */
router.post(
  '/password/forgot',
  exigirRecuperacion,
  recuperacionLimiter,
  asyncHandler(async (req, res) => {
    const { email } = parseOrThrow(forgotPasswordSchema, req.body, badRequest);
    const minutos = Math.round(config.passwordReset.ttlSeconds / 60);
    res.status(202).json({
      ok: true,
      message:
        `Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva. ` +
        `Vale ${minutos} minutos. Revisa también la carpeta de spam.`,
    });
    recuperacion.solicitarDespuesDeResponder({ email, ip: req.clientIp, userAgent: req.get('user-agent') });
  }),
);

/** Comprueba un enlace sin gastarlo, para no pedir la contraseña en vano. */
router.post(
  '/password/reset/check',
  exigirRecuperacion,
  canjeLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parseOrThrow(resetTokenSchema, req.body, badRequest);
    const resultado = recuperacion.comprobar(token);
    if (!resultado.ok) throw recuperacion.enlaceInvalido();
    res.json({ valid: true, expiresAt: resultado.fila.expires_at });
  }),
);

/** Canjea el enlace. No abre sesión: se vuelve a entrar con la contraseña nueva. */
router.post(
  '/password/reset',
  exigirRecuperacion,
  canjeLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(resetPasswordSchema, req.body, badRequest);
    await recuperacion.restablecer({
      token: data.token,
      newPassword: data.newPassword,
      ip: req.clientIp,
      userAgent: req.get('user-agent'),
    });
    clearRefreshCookie(res);
    res.json({
      ok: true,
      message: 'Contraseña cambiada. Cerramos la sesión en todos tus dispositivos; entra con la nueva.',
    });
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
    const { emailReminders, ...cambios } = parseOrThrow(updateProfileSchema, req.body, badRequest);
    if (Object.values(cambios).some((valor) => valor !== undefined)) {
      users.updateUser(req.user.id, cambios);
      audit.record({
        actor: req.user,
        action: 'perfil.actualizado',
        entityType: 'user',
        entityId: req.user.id,
        metadata: cambios,
        ip: req.clientIp,
      });
    }
    if (emailReminders !== undefined) {
      avisos.cambiarPreferencia(req.user.id, emailReminders, {
        via: 'cuenta',
        actor: req.user,
        ip: req.clientIp,
        userAgent: req.get('user-agent'),
      });
    }
    res.json(sessionResponse(users.findById(req.user.id)));
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

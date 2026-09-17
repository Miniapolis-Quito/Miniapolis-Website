/** Panel del usuario máster: clientes, packs, consumos, reportes y auditoría. */
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireMaster } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import {
  createUserSchema,
  updateUserSchema,
  issuePackSchema,
  adjustPackSchema,
  updatePackSchema,
  voidRedemptionSchema,
  resolveOfflineRejectionSchema,
  notificationSettingsSchema,
  notificationContactSchema,
  notificationTestSchema,
  notificationListSchema,
  paginationSchema,
  passwordSchema,
  parseOrThrow,
} from '../lib/validate.js';
import { validatePasswordStrength, generarPasswordTemporal } from '../lib/passwords.js';
import { config } from '../config.js';
import * as fechas from '../lib/fechas.js';
import * as users from '../services/users.js';
import * as packsService from '../services/packs.js';
import * as redemptions from '../services/redemptions.js';
import * as sessions from '../services/sessions.js';
import * as audit from '../services/audit.js';
import * as panel from '../services/panel.js';
import * as expediente from '../services/expediente.js';
import * as recuperacion from '../services/recuperacion.js';
import * as sinConexion from '../services/sinConexion.js';
import * as avisos from '../services/avisos.js';

export const router = express.Router();
router.use(requireMaster);

const actorContext = (req) => ({ actor: req.user, ip: req.clientIp, userAgent: req.get('user-agent') });

// ---------------------------------------------------------------------------
// Panel general
// ---------------------------------------------------------------------------

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    res.json(panel.resumen());
  }),
);

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    res.json(
      users.listUsers({
        limit,
        offset,
        search: typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : '',
        role: ['master', 'staff', 'customer'].includes(req.query.role) ? req.query.role : null,
        status: ['active', 'suspended'].includes(req.query.status) ? req.query.status : null,
      }),
    );
  }),
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(createUserSchema, req.body, badRequest);

    // Sin contraseña indicada se genera una temporal que el máster comunica al cliente.
    const generated = data.password ? null : generarPasswordTemporal();
    const password = data.password ?? generated;

    const strength = validatePasswordStrength(password, { email: data.email, fullName: data.fullName });
    if (!strength.ok) {
      throw badRequest(strength.errors[0], { fields: { password: strength.errors.join(' ') } }, 'password_debil');
    }

    if (data.scanEnabled && !users.puedeLlevarPermisoDeEscaneo(data.role)) {
      throw badRequest(
        'Solo una cuenta de personal o máster puede escanear entradas.',
        { fields: { scanEnabled: 'Cambia el rol a personal para habilitar el escáner.' } },
        'escaneo_rol_invalido',
      );
    }

    const user = await users.createUser({
      email: data.email,
      password,
      fullName: data.fullName,
      phone: data.phone,
      role: data.role,
      scanEnabled: data.scanEnabled === true,
      createdBy: req.user.id,
    });

    audit.record({
      ...actorContext(req),
      action: 'usuario.creado',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        email: user.email,
        role: user.role,
        scanEnabled: Boolean(user.scan_enabled),
        passwordGenerada: Boolean(generated),
      },
    });

    // El permiso de escaneo deja su propia entrada en la bitácora: quién puede
    // tocar el saldo de un cliente es la pregunta que más se audita.
    if (user.scan_enabled) {
      audit.record({
        ...actorContext(req),
        action: 'usuario.escaneo_autorizado',
        entityType: 'user',
        entityId: user.id,
        metadata: { email: user.email, alCrear: true },
      });
    }

    res.status(201).json({
      user: users.toPublicUser(user),
      // Solo se muestra una vez, en la respuesta de creación.
      temporaryPassword: generated,
    });
  }),
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(expediente.expediente(req.params.id));
  }),
);

/** Línea de tiempo del cliente, paginada para "ver más". */
router.get(
  '/users/:id/timeline',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    if (!users.findById(req.params.id)) throw notFound('Usuario no encontrado.');
    res.json(expediente.lineaDeTiempo(req.params.id, { limit, offset }));
  }),
);

/** Bitácora de auditoría acotada a este cliente. */
router.get(
  '/users/:id/audit',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    if (!users.findById(req.params.id)) throw notFound('Usuario no encontrado.');
    res.json(expediente.auditoria(req.params.id, { limit, offset }));
  }),
);

/** Consumos del cliente, paginados. */
router.get(
  '/users/:id/redemptions',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    if (!users.findById(req.params.id)) throw notFound('Usuario no encontrado.');
    res.json(redemptions.listRedemptions({ userId: req.params.id, limit, offset }));
  }),
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(updateUserSchema, req.body, badRequest);
    const target = users.findById(req.params.id);
    if (!target) throw notFound('Usuario no encontrado.');

    // Protecciones para no quedarse nunca sin administrador ni bloquearse a uno mismo.
    if (target.id === req.user.id && data.role && data.role !== 'master') {
      throw forbidden('No puedes quitarte a ti mismo el rol de máster.', 'auto_degradacion');
    }
    if (target.id === req.user.id && data.status === 'suspended') {
      throw forbidden('No puedes suspender tu propia cuenta.', 'auto_suspension');
    }
    if (target.role === 'master' && (data.role !== undefined && data.role !== 'master')) {
      if (target.status === 'active' && users.countActiveByRole('master') <= 1) {
        throw conflict('Debe quedar al menos un usuario máster.', 'ultimo_master');
      }
    }
    if (target.role === 'master' && data.status === 'suspended' && users.countActiveByRole('master') <= 1) {
      throw conflict('Debe quedar al menos un usuario máster activo.', 'ultimo_master');
    }

    // Pedir el permiso de escaneo para una cuenta que va a quedar como cliente
    // se rechaza en vez de ignorarse: así el máster ve por qué no se aplicó.
    const rolResultante = data.role ?? target.role;
    if (data.scanEnabled === true && !users.puedeLlevarPermisoDeEscaneo(rolResultante)) {
      throw badRequest(
        'Solo una cuenta de personal o máster puede escanear entradas.',
        { fields: { scanEnabled: 'Cambia el rol a personal para habilitar el escáner.' } },
        'escaneo_rol_invalido',
      );
    }

    // Los recordatorios tienen su propio registro, que dice desde dónde se
    // cambiaron: no se mezclan con los datos de la cuenta.
    const { emailReminders, ...cambios } = data;
    const permisoAntes = Boolean(target.scan_enabled);
    let user = target;
    if (Object.values(cambios).some((valor) => valor !== undefined)) {
      user = users.updateUser(req.params.id, cambios);
      audit.record({
        ...actorContext(req),
        action: 'usuario.actualizado',
        entityType: 'user',
        entityId: user.id,
        metadata: cambios,
      });
    }

    // Conceder o retirar el escáner se registra aparte, con su propio nombre,
    // para que se pueda filtrar la bitácora por esa sola pregunta.
    const permisoDespues = Boolean(user.scan_enabled);
    if (permisoDespues !== permisoAntes) {
      audit.record({
        ...actorContext(req),
        action: permisoDespues ? 'usuario.escaneo_autorizado' : 'usuario.escaneo_revocado',
        entityType: 'user',
        entityId: user.id,
        metadata: {
          email: user.email,
          // Bajar de rol retira el permiso sin haberlo pedido; conviene que la
          // bitácora diga cuál de las dos cosas pasó.
          motivo: cambios.scanEnabled === undefined ? 'cambio_de_rol' : 'decision_del_master',
        },
      });
    }

    if (emailReminders !== undefined) {
      avisos.cambiarPreferencia(target.id, emailReminders, { via: 'administracion', ...actorContext(req) });
    }
    res.json({ user: users.toPublicUser(users.findById(target.id)) });
  }),
);

/** Restablece la contraseña de un usuario y devuelve una temporal. */
router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const target = users.findById(req.params.id);
    if (!target) throw notFound('Usuario no encontrado.');

    let password = req.body?.password;
    let generated = null;
    if (password === undefined || password === null || password === '') {
      generated = generarPasswordTemporal();
      password = generated;
    } else {
      password = parseOrThrow(passwordSchema, password, badRequest);
      const strength = validatePasswordStrength(password, { email: target.email, fullName: target.full_name });
      if (!strength.ok) throw badRequest(strength.errors[0], { fields: { password: strength.errors.join(' ') } }, 'password_debil');
    }

    await users.setPassword(target.id, password);
    // La persona se entera aunque no haya sido ella quien lo pidió. El aviso
    // nunca lleva la contraseña: esa se entrega en mano.
    recuperacion.avisarCambio(target, { via: 'administracion' });
    audit.record({
      ...actorContext(req),
      action: 'usuario.password_restablecida',
      entityType: 'user',
      entityId: target.id,
      metadata: { email: target.email },
    });
    res.json({ ok: true, temporaryPassword: generated });
  }),
);

router.post(
  '/users/:id/unlock',
  asyncHandler(async (req, res) => {
    const user = users.unlockUser(req.params.id);
    if (!user) throw notFound('Usuario no encontrado.');
    audit.record({ ...actorContext(req), action: 'usuario.desbloqueado', entityType: 'user', entityId: user.id });
    res.json({ user: users.toPublicUser(user) });
  }),
);

router.post(
  '/users/:id/revoke-sessions',
  asyncHandler(async (req, res) => {
    const target = users.findById(req.params.id);
    if (!target) throw notFound('Usuario no encontrado.');
    const count = sessions.revokeAllForUser(target.id, 'revocada_por_master');
    audit.record({
      ...actorContext(req),
      action: 'usuario.sesiones_revocadas',
      entityType: 'user',
      entityId: target.id,
      metadata: { sesiones: count },
    });
    res.json({ ok: true, sesionesCerradas: count });
  }),
);

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

router.get(
  '/packs',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    res.json(
      packsService.listPacks({
        limit,
        offset,
        status: typeof req.query.status === 'string' ? req.query.status : null,
        search: typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : '',
        userId: typeof req.query.userId === 'string' ? req.query.userId : null,
      }),
    );
  }),
);

router.post(
  '/packs',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(issuePackSchema, req.body, badRequest);
    const pack = packsService.issuePack({ ...data, ...actorContext(req) });
    res.status(201).json({ pack });
  }),
);

router.get(
  '/packs/:id',
  asyncHandler(async (req, res) => {
    const pack = packsService.findById(req.params.id);
    if (!pack) throw notFound('Pack no encontrado.');
    const owner = users.findById(pack.user_id);
    res.json({
      pack: packsService.toPublicPack(pack, { owner }),
      owner: users.toPublicUser(owner),
      movements: packsService.movements(pack.id),
      redemptions: redemptions.listRedemptions({ packId: pack.id, limit: 50 }).items,
    });
  }),
);

router.patch(
  '/packs/:id',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(updatePackSchema, req.body, badRequest);
    res.json({ pack: packsService.updatePack(req.params.id, data, actorContext(req)) });
  }),
);

router.post(
  '/packs/:id/adjust',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(adjustPackSchema, req.body, badRequest);
    res.json({ pack: packsService.adjustPack(req.params.id, { ...data, ...actorContext(req) }) });
  }),
);

// ---------------------------------------------------------------------------
// Consumos
// ---------------------------------------------------------------------------

router.get(
  '/redemptions',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    res.json(
      redemptions.listRedemptions({
        limit,
        offset,
        userId: typeof req.query.userId === 'string' ? req.query.userId : null,
        packId: typeof req.query.packId === 'string' ? req.query.packId : null,
        scannerId: typeof req.query.scannerId === 'string' ? req.query.scannerId : null,
        since: typeof req.query.since === 'string' ? req.query.since : null,
        status: ['confirmed', 'voided'].includes(req.query.status) ? req.query.status : null,
      }),
    );
  }),
);

router.post(
  '/redemptions/:id/void',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(voidRedemptionSchema, req.body, badRequest);
    res.json(redemptions.voidRedemption(req.params.id, { ...data, ...actorContext(req) }));
  }),
);

// ---------------------------------------------------------------------------
// Lecturas sin conexión que no se pudieron cobrar
// ---------------------------------------------------------------------------

router.get(
  '/offline-rejections',
  asyncHandler(async (req, res) => {
    const { limit } = parseOrThrow(paginationSchema, req.query, badRequest);
    res.json(sinConexion.pendientes({ limit }));
  }),
);

router.post(
  '/offline-rejections/:id/resolve',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(resolveOfflineRejectionSchema, req.body, badRequest);
    res.json(sinConexion.resolver(req.params.id, { note: data.note, ...actorContext(req) }));
  }),
);

// ---------------------------------------------------------------------------
// Avisos a clientes y clientes por recuperar
// ---------------------------------------------------------------------------

router.get(
  '/notifications/overview',
  asyncHandler(async (req, res) => {
    res.json(avisos.resumen());
  }),
);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    res.json(avisos.listar(parseOrThrow(notificationListSchema, req.query, badRequest)));
  }),
);

router.put(
  '/notifications/settings',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(notificationSettingsSchema, req.body, badRequest);
    res.json(avisos.guardarAjustes(data, actorContext(req)));
  }),
);

/** Revisa y envía ahora, sin esperar al siguiente ciclo. */
router.post(
  '/notifications/run',
  asyncHandler(async (req, res) => {
    res.json(await avisos.ciclo());
  }),
);

router.post(
  '/notifications/test',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(notificationTestSchema, req.body, badRequest);
    res.json(await avisos.enviarPrueba({ ...data, ...actorContext(req) }));
  }),
);

router.post(
  '/notifications/contacts',
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(notificationContactSchema, req.body, badRequest);
    res.status(201).json(avisos.registrarContacto({ ...data, actor: req.user }));
  }),
);

router.post(
  '/notifications/:id/retry',
  asyncHandler(async (req, res) => {
    res.json(avisos.reintentar(req.params.id));
  }),
);

// ---------------------------------------------------------------------------
// Auditoría, integridad y exportación
// ---------------------------------------------------------------------------

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseOrThrow(paginationSchema, req.query, badRequest);
    res.json(
      audit.list({
        limit,
        offset,
        action: typeof req.query.action === 'string' ? req.query.action : undefined,
        entityId: typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
        actorId: typeof req.query.actorId === 'string' ? req.query.actorId : undefined,
      }),
    );
  }),
);

router.get(
  '/integrity',
  asyncHandler(async (req, res) => {
    res.json(packsService.checkIntegrity());
  }),
);

/** Exportación a CSV para contabilidad. */
router.get(
  '/export/:entity.csv',
  asyncHandler(async (req, res) => {
    const entity = req.params.entity;

    const escape = (value) => {
      if (value === null || value === undefined) return '';
      let text = String(value);
      // Excel y LibreOffice interpretan como fórmula cualquier celda que empiece
      // por =, +, -, @, | o %. Un nombre de cliente no debería poder ejecutar nada al
      // abrir el reporte, así que se antepone un apóstrofo, que la hoja de
      // cálculo entiende como "esto es texto".
      // Algunas hojas recortan espacios iniciales antes de interpretar la
      // celda, por lo que " =1+1" también puede convertirse en fórmula.
      // Un tabulador o un retorno de carro al principio también los tratan
      // algunas hojas como el arranque de una fórmula (recomendación de OWASP),
      // y LibreOffice acepta además las formas de ancho completo de los signos.
      if (/^(?:[\t\r]|\s*[=+\-@|%\uFF1D\uFF0B\uFF0D\uFF20\uFF5C\uFF05])/.test(text)) text = `'${text}`;
      return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const toCsv = (headers, rows) =>
      // Marca de orden de bytes: sin ella Excel abre los acentos mal.
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\r\n');

    let csv;
    if (entity === 'packs') {
      const { items } = packsService.listPacks({ limit: 5000 });
      csv = toCsv(
        ['codigo', 'cliente', 'correo', 'tamano', 'restantes', 'usadas', 'estado', 'precio', 'moneda', 'vence', 'creado'],
        items.map((p) => [p.code, p.ownerName, p.ownerEmail, p.size, p.remaining, p.used, p.status, (p.priceCents / 100).toFixed(2), p.currency, p.expiresAt, p.createdAt]),
      );
    } else if (entity === 'consumos') {
      const { items } = redemptions.listRedemptions({ limit: 5000 });
      csv = toCsv(
        // `sincronizado` va al final y solo tiene valor en lo leído sin conexión:
        // `fecha` es cuándo entró la persona y esta, cuándo se cobró.
        ['fecha', 'pack', 'cliente', 'operador', 'metodo', 'cantidad', 'restantes', 'estado', 'dispositivo', 'sincronizado'],
        items.map((r) => [r.createdAt, r.packCode, r.customerName, r.scannerName, r.method, r.quantity ?? 1, r.remainingAfter, r.status, r.deviceLabel, r.syncedAt]),
      );
    } else if (entity === 'clientes') {
      const { items } = users.listUsers({ limit: 5000 });
      csv = toCsv(
        ['nombre', 'correo', 'telefono', 'rol', 'estado', 'entradas_disponibles', 'packs_activos', 'creado'],
        items.map((u) => [u.fullName, u.email, u.phone, u.role, u.status, u.availableTickets, u.activePacks, u.createdAt]),
      );
    } else {
      throw notFound('Ese reporte no existe.');
    }

    audit.record({ ...actorContext(req), action: 'reporte.exportado', entityType: 'export', entityId: entity });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    const hoy = fechas.diaLocal(new Date(), config.timezone);
    res.set('Content-Disposition', `attachment; filename="${entity}-${hoy}.csv"`);
    res.send(csv);
  }),
);

export default router;

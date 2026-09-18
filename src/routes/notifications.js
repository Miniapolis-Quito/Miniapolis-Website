/**
 * Preferencia de recordatorios desde el enlace del correo, sin sesión.
 *
 * El token solo sirve para esto: cambiar si esa persona recibe recordatorios.
 * La página no da de baja al abrirse —los filtros de correo abren los enlaces
 * para analizarlos— sino al pulsar el botón. La baja de un clic que ofrecen
 * Gmail y Outlook (RFC 8058) llega como un POST a `/unsubscribe`, sin cookies
 * ni origen y con el token en la dirección, porque su cuerpo es un formulario
 * que no dice nada más.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { badRequest } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as users from '../services/users.js';
import * as avisos from '../services/avisos.js';

export const router = express.Router();

router.use(
  rateLimit({
    name: 'recordatorios-ip',
    limit: 60,
    windowSeconds: 15 * 60,
    message: 'Hay demasiadas solicitudes desde esta conexión. Espera unos minutos.',
  }),
);

function usuarioDelEnlace(req) {
  const token =
    typeof req.body?.token === 'string' ? req.body.token : typeof req.query.t === 'string' ? req.query.t : '';
  const userId = avisos.usuarioDelToken(token);
  const usuario = userId ? users.findById(userId) : null;
  if (!usuario) {
    throw badRequest(
      'Este enlace no es válido. Usa el del último correo que te enviamos, o cambia la preferencia en «Mi cuenta».',
      null,
      'enlace_invalido',
    );
  }
  return usuario;
}

/** Lo justo para saludar: ni el correo ni el apellido salen de aquí. */
const respuesta = (usuario, emailReminders) => ({
  firstName: String(usuario.full_name ?? '').trim().split(/\s+/)[0] || null,
  emailReminders,
});

router.post(
  '/preferences',
  asyncHandler(async (req, res) => {
    const usuario = usuarioDelEnlace(req);
    res.json(respuesta(usuario, Boolean(usuario.email_reminders)));
  }),
);

for (const [ruta, activar] of [
  ['/unsubscribe', false],
  ['/resubscribe', true],
]) {
  router.post(
    ruta,
    asyncHandler(async (req, res) => {
      const usuario = usuarioDelEnlace(req);
      const resultado = avisos.cambiarPreferencia(usuario.id, activar, {
        via: 'enlace',
        ip: req.clientIp,
        userAgent: req.get('user-agent'),
      });
      res.json(respuesta(usuario, resultado.emailReminders));
    }),
  );
}

export default router;

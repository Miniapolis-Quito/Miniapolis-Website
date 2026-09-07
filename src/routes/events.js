/**
 * Canal de tiempo real (Server-Sent Events).
 *
 * El cliente se conecta con `fetch` y cabecera Authorization, así que el token
 * nunca viaja en la URL (donde acabaría en los logs del servidor o del proxy).
 * Cada conexión recibe solo los canales que le corresponden por rol.
 */
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { hub, channels } from '../lib/events.js';
import { summaryForUser } from '../services/packs.js';
import { isSessionActive } from '../services/sessions.js';
import * as users from '../services/users.js';
import { logger } from '../lib/logger.js';

export const router = express.Router();

const HEARTBEAT_MS = 25_000;
/** Cada cuánto se revisa que la sesión que abrió el canal siga siendo válida. */
const REVALIDACION_MS = 10_000;
/**
 * Conexiones en vivo que se le permiten a la vez a una misma persona. Da de
 * sobra para varias pestañas y el teléfono a la vez, y evita que una pestaña
 * enganchada en un bucle de reconexión acumule sockets sin fin.
 */
const MAXIMO_POR_USUARIO = 8;

/** Canales a los que puede suscribirse cada rol. */
function channelsFor(user) {
  const list = [channels.user(user.id)];
  if (user.role === 'staff' || user.role === 'master') list.push(channels.staff);
  if (user.role === 'master') list.push(channels.admin);
  return list;
}

/**
 * ¿Sigue siendo válida la sesión que abrió este canal?
 *
 * Una conexión de tiempo real dura horas, así que solo comprobar los permisos
 * al abrirla no basta: si al usuario lo suspenden o le cierran la sesión, su
 * pantalla seguiría recibiendo datos hasta que hiciera otra petición.
 */
function sesionSigueViva(usuario) {
  if (!isSessionActive(usuario.sessionId)) return false;
  const fila = users.findById(usuario.id);
  return Boolean(fila) && fila.status === 'active' && fila.role === usuario.role;
}

function writeEvent(res, { id, type, data }) {
  res.write(`id: ${id}\n`);
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get('/', requireAuth, (req, res) => {
  const subscribed = channelsFor(req.user);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Evita que un proxy inverso (nginx) acumule la respuesta en un búfer.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Sin tiempo de espera: una conexión SSE está inactiva por definición.
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  const client = {
    userId: req.user.id,
    role: req.user.role,
    connectedAt: Date.now(),
    // El hub la usa para cerrar las conexiones sobrantes de este mismo usuario.
    cerrar: () => cleanup(),
  };
  const unregister = hub.registerClient(client);
  hub.limitarPorUsuario(req.user.id, MAXIMO_POR_USUARIO);

  // Estado inicial, para que la interfaz pinte datos correctos sin otra petición.
  writeEvent(res, {
    id: 0,
    type: 'conectado',
    data: {
      user: { id: req.user.id, role: req.user.role },
      summary: req.user.role === 'customer' ? summaryForUser(req.user.id) : null,
      serverTime: new Date().toISOString(),
      heartbeatSeconds: HEARTBEAT_MS / 1000,
    },
  });

  // Reenvío de lo que el cliente se haya perdido mientras estuvo desconectado.
  const lastEventId = Number.parseInt(req.get('Last-Event-ID') || req.query.lastEventId || '', 10);
  if (Number.isInteger(lastEventId) && lastEventId > 0) {
    for (const missed of hub.replay(subscribed, lastEventId)) writeEvent(res, missed);
  }

  const unsubscribe = hub.subscribe(subscribed, (event) => {
    try {
      writeEvent(res, event);
    } catch (error) {
      logger.warn('No se pudo escribir un evento SSE', { message: error.message });
    }
  });

  const heartbeat = setInterval(() => {
    try {
      // Un comentario SSE mantiene viva la conexión sin generar un evento.
      res.write(`: latido ${Date.now()}\n\n`);
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);

  // Red de seguridad por si el aviso inmediato no llegara (por ejemplo, si la
  // sesión se revocó desde otro proceso).
  const revalidacion = setInterval(() => {
    try {
      if (!sesionSigueViva(req.user)) {
        writeEvent(res, { id: 0, type: 'sesion.invalida', data: { motivo: 'sesion_cerrada' } });
        cleanup();
      }
    } catch {
      cleanup();
    }
  }, REVALIDACION_MS);

  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(revalidacion);
    unsubscribe();
    unregister();
    try {
      res.end();
    } catch {
      /* la conexión ya estaba cerrada */
    }
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

export default router;

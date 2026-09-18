/**
 * Canal de tiempo real (Server-Sent Events).
 *
 * El cliente se conecta con `fetch` y cabecera Authorization, así que el token
 * nunca viaja en la URL (donde acabaría en los logs del servidor o del proxy).
 * Cada conexión recibe solo los canales que le corresponden por rol.
 */
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pendienteDeActivar } from '../services/dosFactores.js';
import { rateLimit } from '../lib/rateLimit.js';
import { hub, channels } from '../lib/events.js';
import { summaryForUser } from '../services/packs.js';
import { isSessionActive } from '../services/sessions.js';
import * as users from '../services/users.js';
import { logger } from '../lib/logger.js';

export const router = express.Router();

const eventsLimiter = rateLimit({
  name: 'events-connect',
  limit: 120,
  windowSeconds: 15 * 60,
  keyFn: (req) => req.user?.id ?? `ip:${req.rateLimitIp ?? req.clientIp}`,
  message: 'Demasiadas aperturas de canal en poco tiempo. Espera un momento.',
});

const HEARTBEAT_MS = 25_000;
/** Cada cuánto se revisa que la sesión que abrió el canal siga siendo válida. */
const REVALIDACION_MS = 10_000;
/**
 * Conexiones en vivo que se le permiten a la vez a una misma persona. Da de
 * sobra para varias pestañas y el teléfono a la vez, y evita que una pestaña
 * enganchada en un bucle de reconexión acumule sockets sin fin.
 */
const MAXIMO_POR_USUARIO = 8;

/**
 * Canales a los que puede suscribirse cada cuenta.
 *
 * Todo el mundo recibe el suyo. El canal del personal lleva el nombre del
 * cliente, el código del pack y el saldo de cada consumo según ocurre, así que
 * solo llega a quien está autorizado a escanear: una cuenta de personal sin
 * ese permiso no tiene por qué ver pasar el movimiento de la pista.
 *
 * Lo mismo vale para el segundo factor: mientras la pista lo exija y una
 * cuenta del equipo no lo tenga, sus permisos están en suspenso. Cerrarle la
 * API y dejarle el canal abierto sería entregarle por otra puerta exactamente
 * los datos que se le acaban de negar.
 */
function channelsFor(user) {
  const list = [channels.user(user.id)];
  if (pendienteDeActivar(user)) return list;
  if ((user.role === 'staff' || user.role === 'master') && user.scanEnabled) list.push(channels.staff);
  if (user.role === 'master') list.push(channels.admin);
  return list;
}

/** ¿Este canal recibe algo más que lo de su propia cuenta? */
function tieneCanalesDeEquipo(user) {
  return channelsFor(user).length > 1;
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
  if (!fila || fila.status !== 'active' || fila.role !== usuario.role) return false;
  // Perder el permiso de escaneo corta el canal: retirarlo revoca la sesión,
  // y esta comprobación lo cubre también si el cambio vino de otro proceso.
  // Ganarlo no cierra nada: los canales nuevos llegan al recargar la pantalla.
  if (usuario.scanEnabled && !fila.scan_enabled) return false;
  // Que la pista pase a exigir el segundo factor cierra el canal del equipo
  // igual que retirar el permiso: al reconectar, esa cuenta ya solo recibe lo
  // suyo hasta que lo active. Nadie se queda sin su propio canal por esto:
  // quien solo tenía el suyo no entra aquí.
  if (tieneCanalesDeEquipo(usuario) && pendienteDeActivar({ role: fila.role, totp_enabled: fila.totp_enabled })) {
    return false;
  }
  return true;
}

function writeEvent(res, { id, type, data }) {
  res.write(`id: ${id}\n`);
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get('/', requireAuth, eventsLimiter, (req, res) => {
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
    cerrar: ({ motivo } = {}) => {
      if (motivo === 'reemplazado') {
        writeEvent(res, { id: 0, type: 'canal.reemplazado', data: { motivo } });
      }
      cleanup();
    },
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
  req.socket?.on('close', cleanup);
});

export default router;

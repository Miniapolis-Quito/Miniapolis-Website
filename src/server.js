/** Punto de entrada: levanta el servidor HTTP y gestiona el apagado ordenado. */
import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { closeDb } from './db/index.js';
import { ensureMasterAccount } from './bootstrap.js';
import { purgeExpired } from './services/sessions.js';
import { expireDuePacks } from './services/packs.js';
import { purgar as purgarRecuperaciones } from './services/recuperacion.js';
import * as avisos from './services/avisos.js';
import * as fidelidad from './services/fidelidad.js';

const app = createApp();
await ensureMasterAccount();

const server = http.createServer(app);

// Un cliente lento no debe poder mantener una conexión abierta indefinidamente,
// pero SSE necesita conexiones largas: por eso se desactiva el timeout de
// petición y se conserva el de cabeceras.
server.headersTimeout = 20_000;
// SSE mantiene una respuesta abierta, no una petición entrante. Un límite para
// recibir la petición protege las rutas JSON de clientes que envían el cuerpo
// a cuentagotas; el canal SSE no se ve afectado y ya emite latidos.
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000;

/** Tareas de mantenimiento periódicas. */
const maintenance = setInterval(
  () => {
    try {
      const expired = expireDuePacks();
      const purged = purgeExpired();
      const enlaces = purgarRecuperaciones();
      const descartados = avisos.purgar();
      // Premios ganados que no se llegaron a entregar: un proceso que se cayó a
      // mitad, una cuenta que estaba suspendida, un umbral que se bajó.
      const premios = fidelidad.evaluarPendientes().premios;
      if (expired || purged || enlaces || descartados || premios) {
        logger.info('Mantenimiento', {
          packsVencidos: expired,
          sesionesPurgadas: purged,
          enlacesPurgados: enlaces,
          avisosDescartadosPurgados: descartados,
          premiosDeFidelidad: premios,
        });
      }
    } catch (error) {
      logger.error('Fallo en la tarea de mantenimiento', { message: error.message });
    }
  },
  10 * 60 * 1000,
);
maintenance.unref();

/** Comprobantes y recordatorios a clientes. No envían nada hasta que el máster los activa. */
const detenerAvisos = avisos.iniciar();

server.listen(config.port, config.host, () => {
  const address = server.address();
  logger.info(`${config.brandName} — sistema de entradas escuchando`, {
    url: `http://${config.host}:${address.port}`,
    entorno: config.env,
    baseDeDatos: config.databaseFile,
  });
});

let shuttingDown = false;
/**
 * @param {number} codigo con qué código sale el proceso. Una señal es un cierre
 * pedido (0); una excepción no capturada es un fallo (1), y así lo ve el
 * supervisor —systemd con `Restart=on-failure`, Docker, pm2— para relanzarlo.
 */
function shutdown(signal, codigo = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Señal ${signal} recibida; cerrando ordenadamente.`);
  clearInterval(maintenance);
  detenerAvisos();

  server.close(() => {
    closeDb();
    logger.info('Servidor cerrado.');
    process.exit(codigo);
  });

  // Si alguna conexión (por ejemplo SSE) no cierra a tiempo, se fuerza la salida.
  setTimeout(() => {
    logger.warn('Cierre forzado tras el tiempo de espera.');
    try {
      server.closeAllConnections?.();
      closeDb();
    } finally {
      process.exit(codigo);
    }
  }, 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Promesa rechazada sin manejar', { message: reason?.message || String(reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('Excepción no capturada', { message: error.message, stack: error.stack });
  shutdown('uncaughtException', 1);
});

export { server, app };

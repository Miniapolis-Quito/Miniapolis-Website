/** Punto de entrada: levanta el servidor HTTP y gestiona el apagado ordenado. */
import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { closeDb } from './db/index.js';
import { ensureMasterAccount } from './bootstrap.js';
import { purgeExpired } from './services/sessions.js';
import { expireDuePacks } from './services/packs.js';

const app = createApp();
await ensureMasterAccount();

const server = http.createServer(app);

// Un cliente lento no debe poder mantener una conexión abierta indefinidamente,
// pero SSE necesita conexiones largas: por eso se desactiva el timeout de
// petición y se conserva el de cabeceras.
server.headersTimeout = 20_000;
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

/** Tareas de mantenimiento periódicas. */
const maintenance = setInterval(
  () => {
    try {
      const expired = expireDuePacks();
      const purged = purgeExpired();
      if (expired || purged) logger.info('Mantenimiento', { packsVencidos: expired, sesionesPurgadas: purged });
    } catch (error) {
      logger.error('Fallo en la tarea de mantenimiento', { message: error.message });
    }
  },
  10 * 60 * 1000,
);
maintenance.unref();

server.listen(config.port, config.host, () => {
  const address = server.address();
  logger.info(`${config.brandName} — sistema de entradas escuchando`, {
    url: `http://${config.host}:${address.port}`,
    entorno: config.env,
    baseDeDatos: config.databaseFile,
  });
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Señal ${signal} recibida; cerrando ordenadamente.`);
  clearInterval(maintenance);

  server.close(() => {
    closeDb();
    logger.info('Servidor cerrado.');
    process.exit(0);
  });

  // Si alguna conexión (por ejemplo SSE) no cierra a tiempo, se fuerza la salida.
  setTimeout(() => {
    logger.warn('Cierre forzado tras el tiempo de espera.');
    try {
      server.closeAllConnections?.();
      closeDb();
    } finally {
      process.exit(0);
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
  shutdown('uncaughtException');
});

export { server, app };

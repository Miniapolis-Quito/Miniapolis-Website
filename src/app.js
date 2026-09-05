/** Ensamblado de la aplicación Express. */
import path from 'node:path';
import express from 'express';
import { config, ROOT_DIR } from './config.js';
import { getDb } from './db/index.js';
import { securityHeaders, clientIp, cors, sameOriginOnly } from './middleware/security.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { cookieParser } from './lib/cookies.js';
import { rateLimit } from './lib/rateLimit.js';
import authRoutes from './routes/auth.js';
import packRoutes from './routes/packs.js';
import scanRoutes from './routes/scan.js';
import adminRoutes from './routes/admin.js';
import eventRoutes from './routes/events.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export function createApp() {
  getDb(); // Abre la base y aplica migraciones antes de aceptar tráfico.

  const app = express();

  app.disable('x-powered-by');
  app.set('etag', 'strong');
  // El parser simple evita por completo el análisis de objetos anidados en la
  // query string, que es donde suelen aparecer sorpresas.
  app.set('query parser', 'simple');
  if (config.security.trustProxy) app.set('trust proxy', true);

  app.use(clientIp);
  app.use(securityHeaders);
  app.use(cors);
  app.use(cookieParser);
  app.use(express.json({ limit: config.security.maxBodyBytes, strict: true }));
  app.use(sameOriginOnly);
  app.use(authenticate);

  // Red de seguridad ante abuso o un bucle en el cliente. Se cuenta por usuario
  // cuando hay sesión: si toda la pista sale por una misma dirección IP (lo
  // normal con datos móviles), nadie debe gastar la cuota de los demás.
  app.use(
    '/api/',
    rateLimit({
      name: 'api-global',
      limit: 1500,
      windowSeconds: 15 * 60,
      keyFn: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.clientIp}`),
      message: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
    }),
  );

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------
  app.get('/api/health', (req, res) => {
    let dbOk = true;
    try {
      getDb().prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      service: 'racing-hobbies-tickets',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      brandName: config.brandName,
      brandShort: config.brandShort,
      currency: config.currency,
      timezone: config.timezone,
      packCatalog: config.packCatalog,
      allowSelfRegistration: config.security.allowSelfRegistration,
      minPasswordLength: config.security.minPasswordLength,
      qr: { ttlSeconds: config.qr.ttlSeconds, refreshSeconds: config.qr.refreshSeconds },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/packs', packRoutes);
  app.use('/api/scan', scanRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/events', eventRoutes);

  app.use('/api', notFoundHandler);

  // -------------------------------------------------------------------------
  // Interfaz web
  // -------------------------------------------------------------------------
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      dotfiles: 'ignore',
      etag: true,
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  const page = (file) => (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, file));
  };

  app.get('/', page('index.html'));
  app.get('/app', page('app.html'));
  app.get('/escanear', page('scan.html'));
  app.get('/admin', page('admin.html'));

  app.use((req, res) => {
    res.status(404).set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  app.use(errorHandler);

  return app;
}

export default createApp;

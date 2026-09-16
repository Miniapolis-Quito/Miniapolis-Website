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
import walletRoutes from './routes/wallet.js';
import notificationRoutes from './routes/notifications.js';
import * as wallet from './services/wallet.js';
import * as recuperacion from './services/recuperacion.js';
import * as avisos from './services/avisos.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export function createApp() {
  getDb(); // Abre la base y aplica migraciones antes de aceptar tráfico.
  // Los pases de la cartera se enteran de los cambios por el mismo canal en
  // vivo que la pantalla del cliente, sin tocar el camino del consumo.
  wallet.escucharCambios();

  const app = express();

  app.disable('x-powered-by');
  app.set('etag', 'strong');
  // El parser simple evita por completo el análisis de objetos anidados en la
  // query string, que es donde suelen aparecer sorpresas.
  app.set('query parser', 'simple');
  if (config.security.trustedProxyIps.length > 0) {
    app.set('trust proxy', config.security.trustedProxyIps);
  }

  app.use(clientIp);
  app.use(securityHeaders);
  app.use(cors);
  app.use(cookieParser);
  app.use(express.json({ limit: config.security.maxBodyBytes, strict: true }));
  app.use(sameOriginOnly);
  app.use(authenticate);

  // Casi todo lo que responde la API es personal (saldos, códigos, sesiones,
  // datos de clientes). Sin esto, el navegador podía guardar esas respuestas en
  // disco y servirlas desde el historial en un equipo compartido del mostrador
  // después de cerrar la sesión. Una ruta concreta puede cambiarlo si lo necesita.
  app.use('/api/', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Red de seguridad ante abuso o un bucle en el cliente. Se cuenta por usuario
  // cuando hay sesión: si toda la pista sale por una misma dirección IP (lo
  // normal con datos móviles), nadie debe gastar la cuota de los demás.
  app.use(
    '/api/',
    rateLimit({
      name: 'api-global',
      limit: 1500,
      windowSeconds: 15 * 60,
      keyFn: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.rateLimitIp ?? req.clientIp}`),
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
      // El escáner decide con esto si guarda lecturas cuando se cae la red, y
      // descarta en el teléfono lo que el servidor rechazaría igual: una
      // lectura demasiado vieja o un doble disparo sobre el mismo pack.
      offlineScan: {
        enabled: config.offlineScan.enabled,
        maxAgeSeconds: config.offlineScan.maxAgeSeconds,
        cooldownSeconds: config.redemption.cooldownSeconds,
      },
      // La interfaz solo ofrece guardar el pase en las carteras que estén
      // configuradas de verdad.
      wallet: wallet.disponible(),
      // La página de acceso solo ofrece «¿Olvidaste tu contraseña?» si hay
      // correo con que mandar el enlace.
      passwordRecovery: recuperacion.disponible(),
      // «Mi cuenta» solo ofrece el interruptor de recordatorios si la pista
      // los manda de verdad.
      emailReminders: avisos.recordatoriosDisponibles(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/packs', packRoutes);
  app.use('/api/scan', scanRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.use('/api', notFoundHandler);

  // -------------------------------------------------------------------------
  // Interfaz web
  // -------------------------------------------------------------------------
  // Los archivos de la interfaz no llevan huella en el nombre, así que una
  // caché larga dejaría a los navegadores ejecutando la versión anterior
  // después de un despliegue. `no-cache` no significa "no guardar": el
  // navegador conserva el archivo y solo pregunta si cambió, y el ETag hace
  // que la respuesta habitual sea un 304 sin cuerpo. Lo único con caché larga
  // es `/vendor/`, que son librerías de terceros fijadas a una versión.
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      dotfiles: 'ignore',
      etag: true,
      lastModified: true,
      maxAge: 0,
      setHeaders: (res, filePath) => {
        const esVendor = filePath.includes(`${path.sep}vendor${path.sep}`);
        res.setHeader(
          'Cache-Control',
          esVendor && config.isProduction ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
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
  // La página del enlace de recuperación no manda Referer a ninguna parte. El
  // token viaja en el fragmento y la página lo borra, pero no cuesta nada
  // cerrar también esta vía.
  app.get('/restablecer', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    page('restablecer.html')(req, res);
  });
  // El enlace de baja de los recordatorios, con el mismo cuidado: su token va
  // en el fragmento y la página tampoco manda Referer.
  app.get('/recordatorios', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    page('recordatorios.html')(req, res);
  });

  app.use((req, res) => {
    res.status(404).set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  app.use(errorHandler);

  return app;
}

export default createApp;

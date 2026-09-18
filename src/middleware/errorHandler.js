/** Traducción de errores a respuestas JSON coherentes. */
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

/**
 * 404 de la API. Va montado bajo /api, así que cualquier petición que llegue
 * aquí es una ruta de API inexistente y debe responder JSON, nunca la página
 * de error en HTML (un cliente que espera JSON no sabría qué hacer con ella).
 */
export function notFoundHandler(req, res) {
  return res
    .status(404)
    .json({ error: { code: 'ruta_no_encontrada', message: 'Ese recurso no existe.' } });
}

// eslint-disable-next-line no-unused-vars -- Express identifica el handler de errores por su aridad.
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error('Error de aplicación', { code: error.code, message: error.message, path: req.path });
    }
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
  }

  // Cuerpo JSON malformado o demasiado grande (lanzado por express.json()).
  if (error?.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: { code: 'cuerpo_muy_grande', message: 'La información enviada es demasiado grande.' } });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res
      .status(400)
      .json({ error: { code: 'json_invalido', message: 'El cuerpo de la petición no es JSON válido.' } });
  }

  logger.error('Error no controlado', {
    message: error?.message,
    stack: config.isProduction ? undefined : error?.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    error: {
      code: 'error_interno',
      message: 'Algo salió mal. Intenta de nuevo en un momento.',
    },
  });
}

/** Envuelve handlers async para que sus rechazos lleguen al errorHandler. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

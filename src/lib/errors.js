/**
 * Errores de aplicación con código estable y mensaje en español listo para
 * mostrar al usuario. El middleware de errores los traduce a HTTP.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, details, code = 'solicitud_invalida') =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Necesitas iniciar sesión.', code = 'no_autenticado') =>
  new AppError(401, code, message);
export const forbidden = (message = 'No tienes permiso para hacer esto.', code = 'sin_permiso') =>
  new AppError(403, code, message);
export const notFound = (message = 'No encontramos lo que buscas.', code = 'no_encontrado') =>
  new AppError(404, code, message);
export const conflict = (message, code = 'conflicto', details) => new AppError(409, code, message, details);
export const tooManyRequests = (message, details) =>
  new AppError(429, 'demasiados_intentos', message, details);
export const serverError = (message = 'Ocurrió un error inesperado.') =>
  new AppError(500, 'error_interno', message);

/**
 * Middleware de compresión HTTP (Gzip / Deflate / Brotli).
 *
 * Comprime respuestas de texto, JSON, CSS, JavaScript y SVG cuando el cliente
 * lo admite (Accept-Encoding: gzip / deflate / br).
 *
 * Reglas de seguridad y fluidez:
 * - Omite explícitamente `text/event-stream` (SSE) y respuestas con `no-transform`
 *   para garantizar latencia cero y evitar búferes en tiempo real.
 * - Solo comprime cargas superiores al umbral (1 KB) para no desperdiciar CPU
 *   en respuestas diminutas.
 * - Fija siempre `Vary: Accept-Encoding` para cachés intermedias.
 */
import compressionLib from 'compression';

export function compression() {
  return compressionLib({
    threshold: 1024,
    filter: (req, res) => {
      const cacheControl = res.getHeader('Cache-Control') || '';
      const contentType = res.getHeader('Content-Type') || '';

      if (
        String(cacheControl).includes('no-transform') ||
        String(contentType).includes('text/event-stream') ||
        req.headers.accept === 'text/event-stream'
      ) {
        return false;
      }

      return compressionLib.filter(req, res);
    },
  });
}

export default compression;

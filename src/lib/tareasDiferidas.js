/**
 * Trabajo que se hace después de contestar.
 *
 * Mandar un correo tarda, puede fallar y —sobre todo— su duración cuenta cosas:
 * si la respuesta a «he olvidado mi contraseña» esperase al servidor de correo,
 * el tiempo que tarda diría si esa dirección tiene cuenta. Lo mismo vale para
 * los avisos de seguridad del segundo factor. Aquí se aparcan esas tareas para
 * el siguiente ciclo de eventos, se registra su fallo y nunca se propaga a la
 * petición que las provocó.
 */
import { logger } from './logger.js';

const enCurso = new Set();

/** Ejecuta `tarea` cuando la respuesta ya salió. */
export function despuesDeResponder(tarea, descripcionDelFallo) {
  const promesa = new Promise((listo) => setImmediate(listo))
    .then(tarea)
    .catch((error) => logger.error(descripcionDelFallo, { message: error?.message }))
    .finally(() => enCurso.delete(promesa));
  enCurso.add(promesa);
  return promesa;
}

/** Espera a que terminen las tareas pendientes. Lo usan las pruebas. */
export async function esperarTareas() {
  while (enCurso.size > 0) await Promise.all([...enCurso]);
}

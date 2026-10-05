/**
 * Portada: las cuentas, sin tocar el documento.
 *
 * Todo lo de aquí son funciones puras y probadas: qué jornada está abierta,
 * cómo corre el cronómetro de los récords y cuánto se ha leído de la página.
 * portada.js las usa para pintar.
 */

/** Recorta un valor al rango [min, max]. */
export function limitar(valor, min = 0, max = 1) {
  return Math.min(max, Math.max(min, valor));
}

/** Frenada suave: rápido al principio, se posa al final. */
export function easeOutCubic(t) {
  return 1 - (1 - limitar(t)) ** 3;
}

/** Cuenta de 0 al valor final con frenada; `t` es 0..1 del tiempo total. */
export function valorContado(objetivo, t) {
  return objetivo * easeOutCubic(t);
}

/**
 * Un tiempo de vuelta en texto. Con `ancho`, se rellena con ceros a la
 * izquierda para que la cifra no cambie de ancho mientras corre.
 */
export function tiempoEnTexto(valor, decimales = 2, ancho = 0) {
  return Number(valor).toFixed(decimales).padStart(ancho, '0');
}

/** Cuánto se ha recorrido de la página: 0 arriba del todo, 1 al final. */
export function progresoLectura(desplazado, altoDocumento, altoVentana) {
  const recorrible = altoDocumento - altoVentana;
  if (recorrible <= 0) return 1;
  return limitar(desplazado / recorrible);
}

const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const quitarTildes = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** «Sábados» → 6. Devuelve -1 si no es un día. */
export function diaDeTexto(texto) {
  const limpio = quitarTildes(String(texto).trim().toLowerCase());
  if (limpio in DIAS) return DIAS[limpio];
  const singular = limpio.replace(/s$/, '');
  return singular in DIAS ? DIAS[singular] : -1;
}

/** «19:00 — 23:30» → [1140, 1410] minutos desde la medianoche. */
export function rangoDeTexto(texto) {
  const horas = [...String(texto).matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return horas.length >= 2 ? [horas[0], horas[1]] : null;
}

/** Ecuador no cambia de hora: UTC−5 todo el año. */
export function horaEcuador(ahora = new Date()) {
  const local = new Date(ahora.getTime() - 5 * 3600 * 1000);
  return { dia: local.getUTCDay(), minutos: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * Estado de una jornada de la tabla de horarios respecto a `ahora`:
 * 'abierto' (dentro del rango), 'antes' (es hoy y todavía no abre),
 * 'cerrado' (es hoy y ya cerró) o '' (otro día).
 */
export function estadoJornada(dia, rango, ahora = new Date()) {
  if (dia < 0 || !rango) return '';
  const hora = horaEcuador(ahora);
  if (hora.dia !== dia) return '';
  if (hora.minutos < rango[0]) return 'antes';
  return hora.minutos < rango[1] ? 'abierto' : 'cerrado';
}

/** Lo que dice la etiqueta de una jornada según su estado. */
export function textoJornada(estado, rango) {
  if (estado === 'abierto') return 'Abierto ahora';
  if (estado === 'antes' && rango) {
    const h = String(Math.floor(rango[0] / 60)).padStart(2, '0');
    const m = String(rango[0] % 60).padStart(2, '0');
    return `Hoy desde las ${h}:${m}`;
  }
  if (estado === 'cerrado') return 'Hoy ya cerró';
  return '';
}

/**
 * Fechas en la zona horaria de la pista.
 *
 * El servidor puede estar en UTC (lo habitual en un VPS) mientras la pista vive
 * en América/Guayaquil. Sin esto, "entradas usadas hoy" cambiaría de día a las
 * 19:00 hora local, en plena tarde de carreras, y el gráfico diario repartiría
 * la actividad de una misma jornada entre dos barras.
 *
 * No hay dependencias: se usa Intl, que ya trae Node con los datos de zonas.
 */

/** Descompone un instante en las partes de fecha y hora de una zona dada. */
function partesEn(timeZone, at) {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const partes = {};
  for (const parte of formato.formatToParts(at)) {
    if (parte.type !== 'literal') partes[parte.type] = Number(parte.value);
  }
  // A medianoche, `hour12: false` puede devolver 24 en lugar de 0.
  if (partes.hour === 24) partes.hour = 0;
  return partes;
}

/**
 * Minutos que la zona va por delante de UTC en ese instante
 * (América/Guayaquil = -300).
 */
export function desfaseMinutos(timeZone, at = new Date()) {
  const p = partesEn(timeZone, at);
  const comoSiFueraUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Se comparan segundos enteros: las partes no traen milisegundos.
  return Math.round((comoSiFueraUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Instante en que empezó el día en curso según esa zona. */
export function inicioDelDia(timeZone, at = new Date()) {
  const p = partesEn(timeZone, at);
  const transcurrido = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + at.getMilliseconds();
  return new Date(at.getTime() - transcurrido);
}

/** Fecha 'YYYY-MM-DD' del día en curso según esa zona. */
export function claveDia(timeZone, at = new Date()) {
  const p = partesEn(timeZone, at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Modificador para las funciones de fecha de SQLite, que solo saben de UTC:
 * `strftime('%Y-%m-%d', created_at, '-300 minutes')` agrupa por día local.
 */
export function modificadorSqlite(timeZone, at = new Date()) {
  const minutos = desfaseMinutos(timeZone, at);
  return `${minutos >= 0 ? '+' : '-'}${Math.abs(minutos)} minutes`;
}

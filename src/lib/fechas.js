/**
 * Días del calendario, en la zona horaria de la pista.
 *
 * Todo se guarda en UTC, que es lo correcto para un instante. Pero «hoy» no es
 * un instante: es el día que ve quien atiende el mostrador. Un servidor suele
 * correr en UTC, así que sin esto un escaneo de las siete de la tarde en
 * Guayaquil (UTC-5) cae en el día siguiente y el panel cuenta la tarde del
 * viernes como actividad del sábado.
 *
 * La zona sale de `TZ_DISPLAY`, así que esto vale igual para una pista en
 * cualquier otro sitio, con o sin horario de verano.
 */

const formateadores = new Map();

function formateador(zona) {
  let fmt = formateadores.get(zona);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formateadores.set(zona, fmt);
  }
  return fmt;
}

function partes(instante, zona) {
  const salida = {};
  for (const { type, value } of formateador(zona).formatToParts(instante)) {
    if (type !== 'literal') salida[type] = Number(value);
  }
  return salida;
}

/**
 * Desplazamiento de la zona respecto a UTC, en minutos, en ese instante
 * concreto (no es constante: hay zonas con horario de verano).
 */
export function desplazamientoMinutos(instante, zona) {
  const p = partes(instante, zona);
  const comoSiFueraUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Los milisegundos no entran en el formateo, así que se descartan a ambos lados.
  return (comoSiFueraUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000;
}

/** Día del calendario ("2026-09-06") al que pertenece ese instante en la zona. */
export function diaLocal(instante, zona) {
  const p = partes(instante, zona);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Instante exacto en que empieza ese día del calendario en la zona.
 * @param {string} dia formato "AAAA-MM-DD"
 */
export function inicioDelDia(dia, zona) {
  const [anio, mes, diaDelMes] = dia.split('-').map(Number);
  const medianocheComoUtc = Date.UTC(anio, mes - 1, diaDelMes);
  // Se tantea con el desplazamiento del mediodía —lejos de cualquier salto de
  // horario— y luego se corrige con el que rige de verdad en ese instante.
  const tanteo = desplazamientoMinutos(new Date(medianocheComoUtc + 12 * 3600_000), zona);
  const candidato = medianocheComoUtc - tanteo * 60_000;
  const real = desplazamientoMinutos(new Date(candidato), zona);
  return new Date(real === tanteo ? candidato : medianocheComoUtc - real * 60_000);
}

/** Los últimos `cantidad` días del calendario, del más antiguo al de hoy. */
export function ultimosDias(cantidad, zona, ahora = new Date()) {
  const [anio, mes, dia] = diaLocal(ahora, zona).split('-').map(Number);
  // La aritmética va sobre el calendario, no sobre instantes: sumar días en UTC
  // nunca se salta uno, pase lo que pase con el horario de verano.
  const base = Date.UTC(anio, mes - 1, dia);
  const dias = [];
  for (let i = cantidad - 1; i >= 0; i -= 1) {
    dias.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dias;
}

/** Instante en que empezó el día de hoy en la zona. */
export function inicioDeHoy(zona, ahora = new Date()) {
  return inicioDelDia(diaLocal(ahora, zona), zona);
}

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

/** 1000 → «1.000»: el separador de miles de Ecuador es el punto. */
export function formatoMiles(n) {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Inclinación de la marquesina según la velocidad del desplazamiento
 * (px/s): se tuerce hacia atrás al bajar rápido y nunca más de ±8°.
 */
export function inclinacionPorVelocidad(velocidad, tope = 8, escala = 420) {
  const grados = -velocidad / escala;
  return Math.max(-tope, Math.min(tope, Math.round(grados * 100) / 100)) || 0;
}

/**
 * En qué punto del recorrido (0..1) se enciende cada una de las `n` curvas
 * del plano: repartidas entre el 20 % y el 95 % de la vuelta.
 */
export function posicionesEnRecorrido(n, desde = 0.2, hasta = 0.95) {
  if (n <= 0) return [];
  if (n === 1) return [desde];
  return Array.from({ length: n }, (_, i) => Math.round((desde + (i * (hasta - desde)) / (n - 1)) * 1000) / 1000);
}

/**
 * Imán de un botón: cuánto se desplaza hacia el puntero, en px. `desvio` es
 * la distancia al centro dividida por la mitad del tamaño (-1..1).
 */
export function atraccion(desvio, fuerza = 10) {
  return Math.round(limitar(desvio, -1, 1) * fuerza * 100) / 100;
}

/**
 * Una hora que rueda como un tablero de salidas: las cifras aún no fijadas
 * cambian al azar y el resto del texto (dos puntos, guion, espacios) queda
 * quieto. Con `p` = 1 devuelve el texto final; las cifras se fijan de
 * izquierda a derecha. `azar` se puede inyectar para probarla.
 */
export function cifrasRodando(texto, p, azar = Math.random) {
  const cifras = [...texto].filter((c) => /\d/.test(c)).length;
  const fijadas = Math.floor(limitar(p) * cifras);
  let vistas = 0;
  return [...texto].map((c) => {
    if (!/\d/.test(c)) return c;
    vistas += 1;
    return vistas <= fijadas ? c : String(Math.floor(azar() * 10));
  }).join('');
}

/**
 * La vuelta por sectores: en cuál está el lector según lo recorrido de cada
 * sector (0..1, en orden). Es el último que ya empezó; -1 si todavía no
 * arrancó ninguno (se está en la apertura, antes de la salida).
 */
export function sectorEnCurso(progresos) {
  for (let i = progresos.length - 1; i >= 0; i -= 1) {
    if (progresos[i] > 0) return i;
  }
  return -1;
}

/** La vuelta termina cuando el último sector se recorre entero. */
export function vueltaCompleta(progresos) {
  return progresos.length > 0 && progresos[progresos.length - 1] >= 0.995;
}

/**
 * Lo recorrido de cada sector (0..1) en una posición de desplazamiento.
 * `inicios` son las posiciones, crecientes, en que empieza cada sector; cada
 * uno termina donde empieza el siguiente y el último, en `fin`.
 */
export function progresosDeSectores(posicion, inicios, fin) {
  return inicios.map((inicio, i) => {
    const final = i + 1 < inicios.length ? inicios[i + 1] : fin;
    if (final <= inicio) return posicion >= inicio ? 1 : 0;
    return limitar((posicion - inicio) / (final - inicio));
  });
}

/**
 * El tiempo de la vuelta como en un cronómetro: «1:42.3» (minutos, segundos
 * y décimas). Sin tiempo que mostrar (negativo, no numérico o de una hora o
 * más, que ya no es una vuelta sino una pestaña olvidada) devuelve ''.
 */
export function tiempoDeVuelta(ms) {
  if (!Number.isFinite(ms) || ms < 0 || ms >= 3_600_000) return '';
  const decimas = Math.floor(ms / 100);
  const minutos = Math.floor(decimas / 600);
  const segundos = Math.floor((decimas % 600) / 10);
  return `${minutos}:${String(segundos).padStart(2, '0')}.${decimas % 10}`;
}

// ---------------------------------------------------------------------------
// La cinta de cronometraje: el avance de lectura de la cabecera
// ---------------------------------------------------------------------------

/**
 * En qué sector va la lectura `avance` (0..1). `marcas` son los puntos de
 * la cinta (0..1, crecientes) en que empieza cada sector; es el último que
 * ya se pasó, y -1 en la parrilla, antes del primero.
 */
export function sectorEnAvance(marcas, avance) {
  for (let i = marcas.length - 1; i >= 0; i -= 1) {
    if (avance > marcas[i]) return i;
  }
  return -1;
}

/**
 * La estela de la cabeza (0..1) en el fotograma siguiente: se estira deprisa
 * con la velocidad del desplazamiento (px/ms; `tope` la llena entera) y se
 * recoge despacio, como la luz de un faro en una foto de exposición larga.
 * Lo que ya no se ve vale 0, para que el bucle que la pinta pueda parar.
 */
export function estelaSiguiente(estela, velocidad, tope = 3) {
  const objetivo = limitar(Math.abs(velocidad) / tope);
  const siguiente = estela + (objetivo - estela) * (objetivo > estela ? 0.35 : 0.1);
  return siguiente < 0.004 ? 0 : siguiente;
}

/**
 * Dónde va la lectura de telemetría (px desde la izquierda) para que cuelgue
 * siempre bajo la cabeza: en la parrilla sale alineada a la izquierda de la
 * cabeza, en la meta a la derecha, y entre medias se desliza sin saltos. Nunca
 * se sale de la cinta: queda a `margen` de cada borde.
 */
export function posicionLectura(avance, ancho, anchoLectura, margen = 8) {
  const x = limitar(avance) * (ancho - anchoLectura);
  return Math.round(limitar(x, margen, Math.max(margen, ancho - anchoLectura - margen)));
}

// ---------------------------------------------------------------------------
// La próxima jornada, para el rótulo de la apertura
// ---------------------------------------------------------------------------

/**
 * La próxima vez que la pista está abierta, a partir de las jornadas de la
 * tabla de horarios (`[{ dia, rango }]`). Si está abierta ahora, cuándo
 * cierra; si no, qué día y a qué hora abre. Sin jornadas válidas, null.
 */
export function proximaJornada(jornadas, ahora = new Date()) {
  const validas = jornadas.filter((j) => j.dia >= 0 && j.rango);
  if (!validas.length) return null;
  const hora = horaEcuador(ahora);
  const abierta = validas.find((j) => j.dia === hora.dia && hora.minutos >= j.rango[0] && hora.minutos < j.rango[1]);
  if (abierta) return { abierta: true, dia: abierta.dia, dias: 0, minutos: abierta.rango[1], dentroDe: 0 };
  let mejor = null;
  for (const j of validas) {
    let dias = (j.dia - hora.dia + 7) % 7;
    if (dias === 0 && hora.minutos >= j.rango[0]) dias = 7;
    const espera = dias * 1440 + j.rango[0] - hora.minutos;
    if (!mejor || espera < mejor.dentroDe) mejor = { abierta: false, dia: j.dia, dias, minutos: j.rango[0], dentroDe: espera };
  }
  return mejor;
}

const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const reloj = (minutos) => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

/** Lo que dice el rótulo de la apertura sobre la próxima jornada. */
export function textoProximaJornada(proxima) {
  if (!proxima) return '';
  if (proxima.abierta) return `Pista abierta hasta las ${reloj(proxima.minutos)}`;
  if (proxima.dias === 0) return `Abre hoy a las ${reloj(proxima.minutos)}`;
  if (proxima.dias === 1) return `Abre mañana a las ${reloj(proxima.minutos)}`;
  return `Abre el ${NOMBRES_DIA[proxima.dia]} a las ${reloj(proxima.minutos)}`;
}

/**
 * Cuánto empuja el desplazamiento a la marquesina: 1 es su paso de crucero y
 * crece con la velocidad (px/s) hasta `tope` veces. Siempre positivo; el
 * sentido lo pone hacia dónde se desplaza.
 */
export function empujePorVelocidad(velocidad, escala = 260, tope = 7) {
  const empuje = 1 + Math.abs(Number(velocidad) || 0) / escala;
  return Math.round(Math.min(tope, empuje) * 100) / 100;
}

/**
 * La onda de la bandera de meta en el vértice (i, j) de la tela en el
 * instante `t` (s). `desplazamiento` (-1..1) es cuánto sube o baja ese punto;
 * crece del mástil (columna 0, casi quieta) al extremo libre. `luz` (-1..1)
 * es la pendiente: crestas iluminadas, valles en sombra.
 */
export function onda(i, j, t, columnas = 40) {
  const fase = i * 0.42 + j * 0.18 - t * 3.1;
  const libre = Math.min(1, 0.25 + (i / Math.max(1, columnas)) * 1.5);
  return { desplazamiento: Math.sin(fase) * libre, luz: Math.cos(fase) };
}

/**
 * Cuánto se aparta una foto de la galería del foco (0 en el centro de la
 * pantalla, 1 a partir de algo más de media pantalla de distancia).
 */
export function enfoqueGaleria(centroFoto, centroPantalla, anchoPantalla) {
  return limitar(Math.abs(centroFoto - centroPantalla) / Math.max(1, anchoPantalla * 0.55));
}

/**
 * Foto finish del tablero de récords. Un solo reloj corre para todos desde
 * `inicio` y cada piloto cruza la meta en su tiempo: hasta entonces su cifra
 * es la del reloj y su barra avanza hacia la meta (0..1); al cruzar se queda
 * en su marca.
 */
export function enCarrera(reloj, inicio, final) {
  const tiempo = Math.min(reloj, final);
  const tramo = final - inicio;
  return { tiempo, avance: tramo > 0 ? limitar((tiempo - inicio) / tramo) : 1, llego: reloj >= final };
}

/**
 * Cuándo arranca el reloj común: una décima redonda que deja `ventaja`
 * segundos de carrera antes de la primera llegada.
 */
export function salidaDeCarrera(finales, ventaja = 0.6) {
  return Math.floor((Math.min(...finales) - ventaja) * 10) / 10;
}

/**
 * Cuándo cruza cada uno, en segundos de escena: las diferencias reales, a
 * cámara lenta (`lentitud` veces más despacio) para que se vean.
 */
export function momentosDeLlegada(finales, inicio, lentitud = 2) {
  return finales.map((final) => Math.max(0, (final - inicio) * lentitud));
}

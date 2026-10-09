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
// La vuelta récord, reconstruida a partir del trazado
// ---------------------------------------------------------------------------

/** Gravedad, para pasar la aceleración lateral a «g». */
const G = 9.81;

/**
 * Curvatura (1/radio) en cada punto de un trazado cerrado, por la
 * circunferencia que pasa por el punto y sus vecinos a `salto` muestras. Un
 * salto de varias muestras suaviza el ruido de un trazado muestreado.
 */
export function curvaturas(puntos, salto = 3) {
  const n = puntos.length;
  if (n < 3) return puntos.map(() => 0);
  return puntos.map((b, i) => {
    const a = puntos[(i - salto + n) % n];
    const c = puntos[(i + salto) % n];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const doble = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const producto = ab * bc * ca;
    return producto > 0 ? (2 * doble) / producto : 0;
  });
}

/**
 * Perfil de velocidad de una vuelta cerrada, como lo calcula un ingeniero de
 * pista: en cada punto, lo más rápido que permite el agarre en la curva
 * (√(a_lat · R)), sin pasar de la punta; después, la aceleración limita lo
 * que se gana a la salida de cada curva y la frenada lo que hay que perder
 * antes de la siguiente. La vuelta es cerrada: se repasa dos veces para que
 * la salida de meta herede la velocidad con que se cruza.
 */
export function perfilDeVelocidad(curvatura, paso, { punta = 20, agarre = 12, aceleracion = 8, frenada = 14 } = {}) {
  const n = curvatura.length;
  const v = curvatura.map((k) => Math.min(punta, k > 0 ? Math.sqrt(agarre / k) : punta));
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    for (let i = 1; i <= n; i += 1) {
      const actual = i % n;
      v[actual] = Math.min(v[actual], Math.sqrt(v[i - 1] ** 2 + 2 * aceleracion * paso));
    }
    for (let i = n - 2; i >= -1; i -= 1) {
      const actual = (i + n) % n;
      const siguiente = (i + 1) % n;
      v[actual] = Math.min(v[actual], Math.sqrt(v[siguiente] ** 2 + 2 * frenada * paso));
    }
  }
  return v;
}

/**
 * La telemetría completa de una vuelta: para cada muestra del trazado, la
 * distancia (0..1), el tiempo (s), la velocidad (km/h), el acelerador y el
 * freno (0..1) y la aceleración lateral (g). Se escala para que la vuelta
 * mida `longitud` metros y dure exactamente `tiempo` segundos: es la
 * recreación de una vuelta concreta, no una simulación libre.
 */
export function telemetriaDeVuelta(puntos, { longitud = 172, tiempo = 12.46, ...limites } = {}) {
  const n = puntos.length;
  if (n < 3 || !(longitud > 0) || !(tiempo > 0)) return [];
  let perimetro = 0;
  for (let i = 0; i < n; i += 1) {
    const a = puntos[i];
    const b = puntos[(i + 1) % n];
    perimetro += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (!(perimetro > 0)) return [];
  const escala = longitud / perimetro;
  const metros = puntos.map((p) => ({ x: p.x * escala, y: p.y * escala }));
  const paso = longitud / n;
  const curvatura = curvaturas(metros);
  const v = perfilDeVelocidad(curvatura, paso, limites);
  // Tiempo de cada tramo con la velocidad media entre sus extremos.
  const tramos = v.map((vi, i) => paso / Math.max(0.1, (vi + v[(i + 1) % n]) / 2));
  const bruto = tramos.reduce((s, t) => s + t, 0);
  const factor = bruto / tiempo;
  const { aceleracion = 8, frenada = 14 } = limites;
  let t = 0;
  return v.map((vi, i) => {
    const velocidad = vi * factor;
    const siguiente = v[(i + 1) % n] * factor;
    const a = (siguiente ** 2 - velocidad ** 2) / (2 * paso);
    const aceleraMax = aceleracion * factor ** 2;
    const frenaMax = frenada * factor ** 2;
    const cruzando = Math.abs(a) < aceleraMax * 0.04;
    const muestra = {
      d: i / n,
      t,
      v: velocidad * 3.6,
      acelerador: a > 0 && !cruzando ? limitar(0.55 + (0.45 * a) / aceleraMax) : cruzando ? (vi >= (limites.punta ?? 20) - 0.01 ? 1 : 0.42) : 0,
      freno: a < 0 && !cruzando ? limitar(-a / frenaMax) : 0,
      gLat: (velocidad ** 2 * curvatura[i]) / G,
    };
    t += tramos[i] / factor;
    return muestra;
  });
}

/**
 * La telemetría en un instante `t` de la vuelta (s), interpolada entre las
 * dos muestras que lo rodean. Pasado el final, la línea de meta.
 */
export function muestraEnTiempo(telemetria, t, tiempo = 12.46) {
  if (!telemetria.length) return null;
  const objetivo = limitar(t, 0, tiempo);
  let bajo = 0;
  let alto = telemetria.length - 1;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (telemetria[medio].t <= objetivo) bajo = medio;
    else alto = medio - 1;
  }
  const a = telemetria[bajo];
  const b = telemetria[bajo + 1] ?? { ...telemetria[0], d: 1, t: tiempo };
  const f = b.t > a.t ? limitar((objetivo - a.t) / (b.t - a.t)) : 0;
  const mezcla = (clave) => a[clave] + (b[clave] - a[clave]) * f;
  return { d: mezcla('d'), t: objetivo, v: mezcla('v'), acelerador: mezcla('acelerador'), freno: mezcla('freno'), gLat: mezcla('gLat') };
}

/**
 * Los parciales de la vuelta: el tiempo de cada uno de los `sectores`
 * tramos iguales del recorrido. Suman exactamente el tiempo de la vuelta.
 */
export function parcialesDeVuelta(telemetria, sectores = 3, tiempo = 12.46) {
  if (!telemetria.length || sectores < 1) return [];
  const cortes = Array.from({ length: sectores - 1 }, (_, i) => {
    const limite = (i + 1) / sectores;
    const j = telemetria.findIndex((m) => m.d >= limite);
    if (j <= 0) return tiempo;
    const a = telemetria[j - 1];
    const b = telemetria[j];
    return a.t + ((b.t - a.t) * (limite - a.d)) / (b.d - a.d || 1);
  });
  const marcas = [0, ...cortes, tiempo];
  return marcas.slice(1).map((m, i) => m - marcas[i]);
}

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

/**
 * Portada: la vuelta récord, en telemetría.
 *
 * El récord de la tabla (12.46 s) contado como lo vería un ingeniero desde el
 * muro de boxes: el cronómetro, la velocidad, el acelerador, el freno, la
 * fuerza lateral, los tres parciales, el auto sobre el mapa y la traza de
 * velocidad de toda la vuelta.
 *
 * Nada se inventa a mano: el trazado es el mismo del plano de la ficha
 * técnica, la longitud es la de la ficha («172 m») y el tiempo, el del primer
 * puesto de la tabla. De ahí, las funciones puras de portada-calculos.js
 * sacan cuánto puede ir el auto en cada curva y cuánto gana en cada recta.
 *
 * Este módulo solo pinta un instante de la vuelta (`pintar(t)`). Quién mueve
 * el tiempo lo decide portada-escenas.js: en pantalla ancha, el
 * desplazamiento; en el teléfono, el reloj. Sin movimiento la vuelta se
 * queda en la meta, con el tiempo del récord y los tres parciales.
 */
import { limitar, muestraEnTiempo, parcialesDeVuelta, telemetriaDeVuelta, tiempoEnTexto } from './portada-calculos.js';

const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/** Muestras del trazado: una cada medio metro, más o menos. */
const MUESTRAS = 360;
/** La gráfica mide 1000 × 180 unidades; la traza deja aire arriba y abajo. */
const ANCHO = 1000;
const BASE = 172;
const ALTO_UTIL = 150;

/** Lo que dice la página: el tiempo del líder y la longitud de la ficha. */
function leerDatos() {
  const tiempo = Number.parseFloat($('.tiempo--lider .tiempo__marca')?.textContent ?? '');
  const fila = $$('.ficha__fila').find((f) => /recorrido/i.test($('dt', f)?.textContent ?? ''));
  const longitud = Number.parseFloat(($('strong', fila ?? document.createElement('div'))?.textContent ?? '').replace(',', '.'));
  return {
    tiempo: Number.isFinite(tiempo) && tiempo > 0 ? tiempo : 12.46,
    longitud: Number.isFinite(longitud) && longitud > 0 ? longitud : 172,
  };
}

let instancia;

export function montarTelemetria() {
  if (instancia !== undefined) return instancia;
  instancia = null;
  const raiz = $('.telemetria');
  const trazado = $('#telemetria-trazado');
  if (!raiz || typeof trazado?.getTotalLength !== 'function') return instancia;
  const largo = trazado.getTotalLength();
  if (!(largo > 0)) return instancia;

  const { tiempo, longitud } = leerDatos();
  const puntos = Array.from({ length: MUESTRAS }, (_, i) => {
    const p = trazado.getPointAtLength((largo * i) / MUESTRAS);
    return { x: p.x, y: p.y };
  });
  const telemetria = telemetriaDeVuelta(puntos, { longitud, tiempo });
  if (!telemetria.length) return instancia;
  const parciales = parcialesDeVuelta(telemetria, 3, tiempo);
  const acumulados = parciales.reduce((lista, p, i) => [...lista, lista[i] + p], [0]);

  // La traza de velocidad: la escala acaba en la decena por encima de la punta.
  const tope = Math.ceil(Math.max(...telemetria.map((m) => m.v)) / 10) * 10 + 10;
  const y = (v) => (BASE - (limitar(v / tope) * ALTO_UTIL)).toFixed(1);
  const linea = [...telemetria, { ...telemetria[0], d: 1 }]
    .map((m, i) => `${i ? 'L' : 'M'}${(m.d * ANCHO).toFixed(1)} ${y(m.v)}`).join('');
  $('.telemetria__traza', raiz)?.setAttribute('d', linea);
  $('.telemetria__fantasma', raiz)?.setAttribute('d', linea);
  $('.telemetria__area', raiz)?.setAttribute('d', `${linea}L${ANCHO} 180L0 180Z`);

  const nodos = {
    cifra: $('.telemetria__cifra', raiz),
    velocidad: $('.telemetria__velocidad', raiz),
    fuerza: $('.telemetria__fuerza', raiz),
    acelerador: $('.telemetria__acelerador', raiz),
    freno: $('.telemetria__freno', raiz),
    auto: $('.telemetria__mapa-auto', raiz),
    recorte: $('.telemetria__recorte', raiz),
    cursor: $('.telemetria__cursor', raiz),
    parciales: $$('.telemetria__parcial', raiz).map((li) => ({ li, cifra: $('b', li) })),
  };
  const ancho = String(tiempo.toFixed(2)).length;
  // Solo se escribe lo que cambió: el desplazamiento llama a esto en cada fotograma.
  const ultimo = new Map();
  const escribir = (nodo, clave, valor, aplicar) => {
    if (!nodo || ultimo.get(clave) === valor) return;
    ultimo.set(clave, valor);
    aplicar(nodo, valor);
  };
  const texto = (nodo, valor) => { nodo.textContent = valor; };

  function pintar(t) {
    const m = muestraEnTiempo(telemetria, t, tiempo);
    if (!m) return;
    const enMeta = m.t >= tiempo;
    escribir(nodos.cifra, 'cifra', tiempoEnTexto(m.t, 2, ancho), texto);
    escribir(nodos.velocidad, 'velocidad', String(Math.round(m.v)), texto);
    escribir(nodos.fuerza, 'fuerza', m.gLat.toFixed(1), texto);
    escribir(nodos.acelerador, 'acelerador', m.acelerador.toFixed(3), (n, v) => { n.style.transform = `scaleX(${v})`; });
    escribir(nodos.freno, 'freno', m.freno.toFixed(3), (n, v) => { n.style.transform = `scaleX(${v})`; });
    // El auto se interpola entre las muestras ya medidas: sin pedirle al
    // navegador que vuelva a recorrer la curva en cada fotograma.
    const exacto = m.d * MUESTRAS;
    const a = puntos[Math.floor(exacto) % MUESTRAS];
    const b = puntos[(Math.floor(exacto) + 1) % MUESTRAS];
    const f = exacto - Math.floor(exacto);
    escribir(nodos.auto, 'auto', `${(a.x + (b.x - a.x) * f).toFixed(2)} ${(a.y + (b.y - a.y) * f).toFixed(2)}`, (n, v) => {
      const [cx, cy] = v.split(' ');
      n.setAttribute('cx', cx);
      n.setAttribute('cy', cy);
    });
    const recorrido = enMeta ? '0' : (1 - m.d).toFixed(4);
    escribir(trazado, 'mapa', recorrido, (n, v) => { n.style.strokeDasharray = '1'; n.style.strokeDashoffset = v; });
    // La traza se descubre por la distancia (el eje x), no por lo largo de
    // la línea: un recorte que avanza con el auto.
    const x = (enMeta ? ANCHO : m.d * ANCHO).toFixed(1);
    escribir(nodos.recorte, 'recorte', x, (n, v) => n.setAttribute('width', v));
    escribir(nodos.cursor, 'cursor', x, (n, v) => n.setAttribute('transform', `translate(${v} 0)`));
    const sector = enMeta ? parciales.length : Math.min(parciales.length - 1, Math.floor(m.d * parciales.length));
    nodos.parciales.forEach(({ li, cifra }, i) => {
      const valor = i < sector ? tiempoEnTexto(parciales[i], 2, 5) : i === sector ? tiempoEnTexto(m.t - acumulados[i], 2, 5) : '—';
      escribir(cifra, `parcial${i}`, valor, texto);
      escribir(li, `estado${i}`, i < sector ? 'hecho' : i === sector ? 'curso' : '', (n, v) => {
        n.classList.toggle('telemetria__parcial--hecho', v === 'hecho');
        n.classList.toggle('telemetria__parcial--en-curso', v === 'curso');
      });
    });
    escribir(raiz, 'meta', String(enMeta), (n, v) => n.classList.toggle('telemetria--meta', v === 'true'));
  }

  // Sin nadie que la mueva, la vuelta está terminada: el tiempo del récord.
  pintar(tiempo);
  instancia = { raiz, tiempo, pintar };
  return instancia;
}

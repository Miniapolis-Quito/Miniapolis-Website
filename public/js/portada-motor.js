/**
 * Motor de scroll de la portada.
 *
 * No secuestra el scroll: la página se desplaza de forma nativa y aquí solo se
 * suaviza lo que se pinta, para dar inercia. Publica variables CSS y el CSS
 * hace el resto:
 *
 *   :root   --scroll (0..1 de la página), --vel (-1..1), --vel-abs, --scroll-px
 *   escena  --p (0..1 de su recorrido)
 *
 * Las funciones de arriba son puras y están probadas. Nada de esto toca el
 * documento al importarse.
 */

export const limitar = (valor, minimo = 0, maximo = 1) => Math.min(maximo, Math.max(minimo, valor));

/** Acerca `actual` a `objetivo`; el resultado no depende de los fotogramas por segundo. */
export function suavizar(actual, objetivo, rigidez, dt) {
  return actual + (objetivo - actual) * (1 - Math.exp(-rigidez * dt));
}

/** Progreso de una escena fija (sticky): 0 al fijarse, 1 al soltarse. */
export function progresoFijo(scroll, inicio, largo) {
  if (largo <= 0) return scroll >= inicio ? 1 : 0;
  return limitar((scroll - inicio) / largo);
}

/** Progreso de una escena que cruza la pantalla: 0 al asomar por abajo, 1 al salir por arriba. */
export function progresoVista(scroll, altoVentana, top, alto) {
  return limitar((scroll + altoVentana - top) / (altoVentana + Math.max(alto, 1)));
}

/**
 * Hasta dónde llega el progreso de una escena `vista` al llegar al final de la
 * página. Una escena que queda cerca del pie (o en una pantalla muy alta) nunca
 * alcanza p = 1: sin este tope su animación se quedaría a medias.
 */
export function progresoMaximo(altoEscena, restanteDebajo, altoVentana) {
  const alto = Math.max(altoEscena, 1);
  return limitar((alto + Math.max(0, restanteDebajo)) / (altoVentana + alto));
}

export function normalizarVelocidad(pxPorSegundo, maximo = 2400) {
  return limitar(pxPorSegundo / maximo, -1, 1);
}

/** Un tramo [desde, hasta] de p convertido a 0..1. */
export function fase(p, desde, hasta) {
  if (hasta <= desde) return p >= desde ? 1 : 0;
  return limitar((p - desde) / (hasta - desde));
}

export const easeOutCubic = (t) => 1 - (1 - limitar(t)) ** 3;

/** Progreso de cada cuentakilómetros: termina antes de que el tablero se vaya. */
export function progresoCifra(p, indice) {
  return easeOutCubic(fase(p, 0.18 + indice * 0.1, 0.54 + indice * 0.1));
}

/** Cuántas luces de cambio hay encendidas: enteras, y todas al llegar a 1. */
export function lucesEncendidas(p, total) {
  const q = limitar(p);
  if (q >= 1) return total;
  return Math.floor(q * total + 1e-9);
}

export function digitosDe(texto) {
  return [...String(texto)].filter((c) => c >= '0' && c <= '9').map(Number);
}

/** Cuánto ha entrado un panel del riel: 0 fuera por la derecha, 1 al pasar la mitad de la pantalla. */
export function entradaPanel(izquierdaEnPantalla, anchoVentana) {
  if (anchoVentana <= 0) return 1;
  return limitar((anchoVentana - izquierdaEnPantalla) / (anchoVentana * 0.5));
}

/**
 * Entrada de una pieza de contenido según su borde superior en pantalla:
 * 0 mientras sigue bajo la ventana, 1 cuando ya subió un 30 % de su alto.
 * `retraso` (px) escalona las piezas de una misma fila de izquierda a derecha.
 */
export function entradaPieza(arriba, altoVentana, retraso = 0) {
  if (altoVentana <= 0) return 1;
  return easeOutCubic((altoVentana - arriba - retraso) / (altoVentana * 0.3));
}

/**
 * Salida de una pieza: 0 mientras se lee y 1 cuando ya pasó entera bajo la
 * cabecera (`techo`). Acelera al final, como un auto que se aleja.
 */
export function salidaPieza(arriba, altoPieza, techo) {
  const t = limitar((techo - arriba) / Math.max(altoPieza, 1));
  return t * t;
}

/**
 * Cifras que se cuentan como una lectura de telemetría: cada número del texto
 * sube de 0 a su valor con `t` (0..1) y el resto se deja intacto. Conserva el
 * separador decimal original y, con `rellenar`, los ceros a la izquierda para
 * que un cronómetro no cambie de ancho mientras corre.
 */
export function interpolarCifras(texto, t, { rellenar = false } = {}) {
  const q = limitar(t);
  return String(texto).replace(/\d+(?:[.,]\d+)?/g, (numero) => {
    const separador = numero.match(/[.,]/)?.[0] ?? '';
    const [entera, decimal = ''] = separador ? numero.split(separador) : [numero];
    const final = Number(`${entera}.${decimal || 0}`);
    const valor = q >= 1 ? final : final * q;
    let [e, d = ''] = valor.toFixed(decimal.length).split('.');
    if (rellenar) e = e.padStart(entera.length, '0');
    return separador ? `${e}${separador}${d}` : e;
  });
}

// ---------------------------------------------------------------------------
// Motor (DOM)
// ---------------------------------------------------------------------------

/**
 * Una escena se registra con su elemento y un modo:
 *  - 'fija': contenedor alto con un marco `position: sticky` dentro.
 *  - 'vista': cruza la pantalla de abajo arriba.
 * `alActualizar` solo se llama cuando `p` cambia. Como la portada tiene pocas
 * escenas, todas se sincronizan siempre: depender de la visibilidad del
 * `IntersectionObserver` puede dejar una escena dormida al invertir el scroll
 * justo en los límites de la página.
 */
/** Lo que se inclina con la velocidad del scroll (lee `--vel`). */
export const SELECTOR_VELOCIDAD = [
  '.portada__salida-copy', '.portada__cinta', '.portada__recta-cabeza h2', '.cifra__num',
  '.portada__riel', '.portada__intro h2', '.portada__info-cabeza h2',
].join(', ');

export function crearMotor() {
  const raiz = document.documentElement;
  // Solo estos elementos leen la velocidad. Escribirla en <main> obligaba a
  // recalcular los estilos de toda la página en cada fotograma del scroll.
  const conVelocidad = [...document.querySelectorAll(SELECTOR_VELOCIDAD)];
  const progreso = document.querySelector('.entrada__progreso span');
  const estela = document.querySelector('.portada__estela');
  const escenas = [];
  let alto = window.innerHeight;
  let ancho = window.innerWidth;
  let suave = window.scrollY;
  let velocidad = 0;
  let ultimo = 0;
  let corriendo = false;
  let midiendo = false;

  let limiteScroll = 1;
  let ultVel = null;
  let ultVelAbs = null;
  let ultScroll = null;
  let ultScrollPx = null;

  function calcular(e) {
    return e.modo === 'fija'
      ? progresoFijo(suave, e.top, e.alto - alto)
      : progresoVista(suave, alto, e.top, e.alto);
  }

  function pintar() {
    for (const e of escenas) {
      const p = calcular(e);
      if (Math.abs(p - e.p) < 0.0004) continue;
      e.p = p;
      // Las piezas lejanas no pueden verse todavía. Dejamos que su progreso
      // avance, pero aplazamos sus escrituras CSS hasta que se acerquen a la
      // ventana; así el scroll no recalcula toda la portada en cada fotograma.
      if (e.modo !== 'fija' && (e.top > suave + alto * 1.5 || e.top + e.alto < suave - alto * .75)) continue;
      if (e.publicar) e.el.style.setProperty('--p', p.toFixed(4));
      e.alActualizar?.(p, { velocidad, ancho, alto });
    }
  }

  function cuadro(ahora) {
    const dt = Math.min(0.1, Math.max(0.001, (ahora - ultimo) / 1000));
    ultimo = ahora;
    const objetivo = window.scrollY;
    const previo = suave;
    // La posición sigue al scroll real: suavizada, todo lo atado al scroll
    // llegaba ~0,1 s tarde y la recta fija flotaba detrás del dedo. Solo la
    // velocidad (las inclinaciones) se suaviza.
    suave = objetivo;
    velocidad = suavizar(velocidad, normalizarVelocidad((suave - previo) / dt), 10, dt);
    const quieto = Math.abs(objetivo - suave) < 0.1 && Math.abs(velocidad) < 0.003;
    if (quieto) { suave = objetivo; velocidad = 0; }

    // En pasos de 0,02: la inclinación no se distingue más fina y se escribe menos.
    const vStr = (Math.round(velocidad * 50) / 50).toFixed(2);
    if (vStr !== ultVel) {
      ultVel = vStr;
      for (const nodo of conVelocidad) nodo.style.setProperty('--vel', vStr);
    }
    const vAbsStr = Math.abs(velocidad).toFixed(2);
    if (vAbsStr !== ultVelAbs) {
      ultVelAbs = vAbsStr;
      estela?.style.setProperty('--vel-abs', vAbsStr);
    }
    const sStr = limitar(suave / limiteScroll).toFixed(3);
    if (sStr !== ultScroll) {
      ultScroll = sStr;
      (progreso || raiz).style.setProperty('--scroll', sStr);
    }
    const sPxStr = suave.toFixed(0);
    if (sPxStr !== ultScrollPx) {
      ultScrollPx = sPxStr;
      estela?.style.setProperty('--scroll-px', sPxStr);
    }
    pintar();
    for (const fn of alCuadro) fn({ velocidad, suave, dt, fraccion: limitar(suave / limiteScroll) });

    if (quieto) { corriendo = false; return; }
    requestAnimationFrame(cuadro);
  }

  function despertar() {
    if (corriendo) return;
    corriendo = true;
    ultimo = performance.now();
    requestAnimationFrame(cuadro);
  }

  /** Mide posiciones absolutas una vez (y al cambiar el tamaño), no en cada fotograma. */
  function medir() {
    alto = window.innerHeight;
    ancho = window.innerWidth;
    const y = window.scrollY;
    limiteScroll = Math.max(raiz.scrollHeight - alto, 1);
    for (const e of escenas) {
      const r = e.el.getBoundingClientRect();
      e.top = r.top + y;
      e.alto = r.height;
      e.p = -1;
    }
    for (const fn of alMedir) fn();
    despertar();
  }

  const alMedir = [];
  const alCuadro = [];

  const medirEnFotograma = () => {
    if (midiendo) return;
    midiendo = true;
    requestAnimationFrame(() => { midiendo = false; medir(); });
  };

  return {
    /** `publicar: false` no escribe `--p`: cada escritura invalida los estilos
     *  de todo el subárbol, y muchas escenas solo usan su `alActualizar`. */
    registrar(el, { modo = 'vista', alActualizar, publicar = true } = {}) {
      const escena = { el, modo, alActualizar, publicar, top: 0, alto: 0, p: -1 };
      escenas.push(escena);
      return escena;
    },
    iniciar() {
      window.addEventListener('scroll', despertar, { passive: true });
      window.addEventListener('resize', medirEnFotograma, { passive: true });
      window.addEventListener('load', medirEnFotograma, { once: true });
      document.fonts?.ready.then(medirEnFotograma);
      new ResizeObserver(medirEnFotograma).observe(document.body);
      medir();
    },
    /** Ejecuta `fn` ahora y cada vez que se vuelven a medir las escenas. */
    alMedir(fn) {
      alMedir.push(fn);
      fn();
    },
    /**
     * Ejecuta `fn` en cada fotograma mientras la página se mueve, y una última
     * vez ya en reposo (velocidad 0) para que lo animado vuelva a su ritmo base.
     */
    alCuadro(fn) {
      alCuadro.push(fn);
    },
    medir,
  };
}

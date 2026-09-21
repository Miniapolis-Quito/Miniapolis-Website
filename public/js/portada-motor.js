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

// ---------------------------------------------------------------------------
// Motor (DOM)
// ---------------------------------------------------------------------------

/**
 * Una escena se registra con su elemento y un modo:
 *  - 'fija': contenedor alto con un marco `position: sticky` dentro.
 *  - 'vista': cruza la pantalla de abajo arriba.
 * `alActualizar` solo se llama cuando `p` cambia y la escena está cerca de la
 * pantalla. El bucle se duerme en cuanto el scroll se asienta.
 */
export function crearMotor() {
  const raiz = document.documentElement;
  const escenas = [];
  let alto = window.innerHeight;
  let ancho = window.innerWidth;
  let suave = window.scrollY;
  let velocidad = 0;
  let ultimo = 0;
  let corriendo = false;
  let midiendo = false;

  const maximo = () => Math.max(raiz.scrollHeight - alto, 1);

  function calcular(e) {
    return e.modo === 'fija'
      ? progresoFijo(suave, e.top, e.alto - alto)
      : progresoVista(suave, alto, e.top, e.alto);
  }

  function pintar() {
    for (const e of escenas) {
      if (!e.visible) continue;
      const p = calcular(e);
      if (Math.abs(p - e.p) < 0.0004) continue;
      e.p = p;
      e.el.style.setProperty('--p', p.toFixed(4));
      e.alActualizar?.(p, { velocidad, ancho, alto });
    }
  }

  function cuadro(ahora) {
    const dt = Math.min(0.05, Math.max(0.001, (ahora - ultimo) / 1000));
    ultimo = ahora;
    const objetivo = window.scrollY;
    const previo = suave;
    suave = suavizar(suave, objetivo, 9, dt);
    velocidad = suavizar(velocidad, normalizarVelocidad((suave - previo) / dt), 10, dt);
    const quieto = Math.abs(objetivo - suave) < 0.1 && Math.abs(velocidad) < 0.003;
    if (quieto) { suave = objetivo; velocidad = 0; }

    raiz.style.setProperty('--vel', velocidad.toFixed(3));
    raiz.style.setProperty('--vel-abs', Math.abs(velocidad).toFixed(3));
    raiz.style.setProperty('--scroll', limitar(suave / maximo()).toFixed(4));
    raiz.style.setProperty('--scroll-px', suave.toFixed(1));
    pintar();

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
    for (const e of escenas) {
      const r = e.el.getBoundingClientRect();
      e.top = r.top + y;
      e.alto = r.height;
      e.p = -1;
    }
    despertar();
  }

  const medirEnFotograma = () => {
    if (midiendo) return;
    midiendo = true;
    requestAnimationFrame(() => { midiendo = false; medir(); });
  };

  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      const escena = escenas.find((e) => e.el === entrada.target);
      if (!escena) continue;
      escena.visible = entrada.isIntersecting;
      escena.p = -1;
    }
    despertar();
  }, { rootMargin: '25% 0px 25% 0px' });

  return {
    registrar(el, { modo = 'vista', alActualizar } = {}) {
      const escena = { el, modo, alActualizar, top: 0, alto: 0, p: -1, visible: false };
      escenas.push(escena);
      observador.observe(el);
      medir();
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
    medir,
  };
}

/**
 * Capa de movimiento de la interfaz.
 *
 * Aquí vive todo lo que se mueve por cuenta propia: el titular que se arma
 * palabra a palabra, las fotos que se descubren con una cortinilla, el
 * paralaje suave del desplazamiento, la barra de progreso de lectura, el
 * subrayado que viaja entre pestañas y los números que suben hasta su valor.
 *
 * Tres reglas que no se rompen:
 *
 *  - Quien pide menos movimiento no recibe ninguno. Toda función sale antes de
 *    tocar el documento si el sistema lo pide, y el contenido se queda como
 *    estaba: visible, en su sitio y legible.
 *  - Nada de esto puede esconder contenido. Lo que se oculta para animarse
 *    lleva siempre una red de seguridad que lo devuelve a la vista aunque la
 *    animación no llegue a dispararse.
 *  - Se puede llamar dos veces. Las pantallas que se repintan tras consultar
 *    al servidor vuelven a montar esto, así que cada pieza marca lo que ya
 *    trabajó y no lo repite.
 */

/** Cuánto se separan en el tiempo dos piezas de una misma tanda. */
const ESCALON_MS = 55;

/** Si una animación no llegó a dispararse, esto la da por buena igualmente. */
const RED_DE_SEGURIDAD_MS = 2600;

export function sinMovimiento() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Marca un nodo como ya trabajado por una pieza concreta. */
function yaHecho(nodo, marca) {
  if (nodo.dataset[marca] === '1') return true;
  nodo.dataset[marca] = '1';
  return false;
}

// ---------------------------------------------------------------------------
// Titulares que se arman palabra a palabra
// ---------------------------------------------------------------------------

/**
 * Envuelve cada palabra en dos capas: la de fuera recorta y la de dentro sube.
 * Así la palabra no aparece, *entra* — que es lo que hace que un titular se
 * lea como el arranque de algo y no como texto que estaba ahí.
 *
 * Solo se parten los nodos de texto. Los elementos hijos (`<em>`, `<sup>`, un
 * `<br>`) se conservan tal cual y se entra dentro de ellos, porque llevan su
 * propio color y su propio significado.
 */
function partirEnPalabras(raiz, contador) {
  for (const hijo of [...raiz.childNodes]) {
    if (hijo.nodeType === Node.TEXT_NODE) {
      const trozos = hijo.textContent.split(/(\s+)/);
      if (!trozos.some((t) => t.trim())) continue;
      const fragmento = document.createDocumentFragment();
      for (const trozo of trozos) {
        if (!trozo) continue;
        if (!trozo.trim()) {
          fragmento.append(trozo);
          continue;
        }
        const fuera = document.createElement('span');
        fuera.className = 'palabra';
        const dentro = document.createElement('span');
        dentro.className = 'palabra__texto';
        dentro.textContent = trozo;
        dentro.style.setProperty('--retraso', `${contador.n * 42}ms`);
        contador.n += 1;
        fuera.append(dentro);
        fragmento.append(fuera);
      }
      hijo.replaceWith(fragmento);
    } else if (hijo.nodeType === Node.ELEMENT_NODE && hijo.tagName !== 'BR') {
      partirEnPalabras(hijo, contador);
    }
  }
}

/**
 * Prepara los titulares de una zona y los enciende cuando entran en pantalla.
 * El selector va por fuera porque cada pantalla decide qué es titular suyo.
 */
export function revelarTitulares(selector = '[data-titular]') {
  if (sinMovimiento() || typeof IntersectionObserver !== 'function') return;
  const titulares = [...document.querySelectorAll(selector)].filter((n) => !yaHecho(n, 'titularPartido'));
  if (titulares.length === 0) return;

  for (const titular of titulares) {
    partirEnPalabras(titular, { n: 0 });
    titular.classList.add('titular-animado');
  }

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.classList.add('titular-animado--visible');
        observador.unobserve(entrada.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
  );
  for (const titular of titulares) observador.observe(titular);

  // Un titular que no se lee es un fallo mucho peor que un titular sin entrada.
  setTimeout(() => {
    for (const titular of titulares) titular.classList.add('titular-animado--visible');
  }, RED_DE_SEGURIDAD_MS);
}

// ---------------------------------------------------------------------------
// Fotografías: cortinilla al entrar y paralaje al desplazar
// ---------------------------------------------------------------------------

/**
 * Las fotos se descubren con una cortinilla que sube, y la imagen de dentro
 * termina de asentarse desde una escala un poco mayor. Es el gesto de una
 * bandera que se levanta, no un desvanecido.
 */
export function revelarFiguras(selector = '.pagina-entrada figure') {
  if (sinMovimiento() || typeof IntersectionObserver !== 'function') return;
  const figuras = [...document.querySelectorAll(selector)].filter((n) => !yaHecho(n, 'figuraRevelada'));
  if (figuras.length === 0) return;

  for (const figura of figuras) figura.classList.add('figura-revela');

  const observador = new IntersectionObserver(
    (entradas) => {
      let retraso = 0;
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.style.setProperty('--retraso', `${retraso}ms`);
        entrada.target.classList.add('figura-revela--visible');
        observador.unobserve(entrada.target);
        retraso += ESCALON_MS;
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
  );
  for (const figura of figuras) observador.observe(figura);

  setTimeout(() => {
    for (const figura of figuras) figura.classList.add('figura-revela--visible');
  }, RED_DE_SEGURIDAD_MS);
}

/**
 * Paralaje: la imagen se mueve algo más despacio que la página dentro de su
 * propio marco. Muy poco —unos píxeles—, lo justo para que la página tenga
 * profundidad sin que nadie se maree.
 */
export function montarParalaje(selector = '.pagina-entrada figure img') {
  if (sinMovimiento()) return;
  const imagenes = [...document.querySelectorAll(selector)].filter((n) => !yaHecho(n, 'paralajeMontado'));
  if (imagenes.length === 0) return;

  /** Recorrido total del efecto, en píxeles. */
  const RECORRIDO = 26;
  let pendiente = false;

  const colocar = () => {
    pendiente = false;
    const alto = window.innerHeight || 1;
    for (const imagen of imagenes) {
      const caja = imagen.getBoundingClientRect();
      if (caja.bottom < -200 || caja.top > alto + 200) continue;
      // 0 cuando el marco entra por abajo, 1 cuando sale por arriba.
      const avance = (alto - caja.top) / (alto + caja.height);
      const desvio = (avance - 0.5) * -RECORRIDO;
      imagen.style.setProperty('--paralaje', `${desvio.toFixed(2)}px`);
      // Mientras corre la cortinilla manda su transición; en cuanto termina,
      // el paralaje pasa a ir pegado al desplazamiento.
      if (!imagen.dataset.paralaje && imagen.closest('figure')?.classList.contains('figura-revela--visible')) {
        imagen.dataset.paralaje = 'esperando';
        setTimeout(() => { imagen.dataset.paralaje = '1'; }, 1200);
      }
    }
  };

  const alDesplazar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(colocar);
  };

  for (const imagen of imagenes) imagen.classList.add('con-paralaje');
  colocar();
  window.addEventListener('scroll', alDesplazar, { passive: true });
  window.addEventListener('resize', alDesplazar, { passive: true });
}

/**
 * El filete que remata cada rótulo de sección se traza de izquierda a derecha
 * cuando la sección entra en pantalla.
 */
export function trazarRotulos(selector = '.entrada__kicker') {
  if (sinMovimiento() || typeof IntersectionObserver !== 'function') return;
  const rotulos = [...document.querySelectorAll(selector)].filter((n) => !yaHecho(n, 'rotuloTrazado'));
  if (rotulos.length === 0) return;

  for (const rotulo of rotulos) rotulo.classList.add('rotulo-traza');

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.classList.add('rotulo-traza--visible');
        observador.unobserve(entrada.target);
      }
    },
    { threshold: 0.6 },
  );
  for (const rotulo of rotulos) observador.observe(rotulo);

  setTimeout(() => {
    for (const rotulo of rotulos) rotulo.classList.add('rotulo-traza--visible');
  }, RED_DE_SEGURIDAD_MS);
}

/**
 * Un destello recorre el logotipo una sola vez al cargar. Es el guiño de una
 * carrocería bajo los focos: dura poco y no se repite, así que no distrae.
 */
export function destellarMarca(selector = '.entrada__marca-sello, .marca__sello') {
  if (sinMovimiento()) return;
  const sello = document.querySelector(selector);
  if (!sello || yaHecho(sello, 'marcaDestellada')) return;
  sello.classList.add('marca-destella');
}

// ---------------------------------------------------------------------------
// Barra de progreso de lectura y cabecera que se compacta
// ---------------------------------------------------------------------------

/**
 * Una línea finísima arriba del todo que avanza con la lectura. En un sistema
 * que se mira como un puesto de telemetría, saber cuánto queda es información,
 * no adorno.
 */
export function montarProgresoLectura() {
  if (sinMovimiento()) return;
  if (document.querySelector('.progreso-lectura')) return;

  const barra = document.createElement('div');
  barra.className = 'progreso-lectura';
  barra.setAttribute('aria-hidden', 'true');
  document.body.prepend(barra);

  let pendiente = false;
  const pintar = () => {
    pendiente = false;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const avance = total > 40 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
    barra.style.setProperty('--avance', String(avance));
  };
  const alDesplazar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };
  pintar();
  window.addEventListener('scroll', alDesplazar, { passive: true });
  window.addEventListener('resize', alDesplazar, { passive: true });
}

/**
 * La cabecera se estrecha en cuanto la página se mueve: gana sitio para el
 * contenido y deja claro que ya no estamos arriba del todo.
 */
export function montarCabeceraAlDesplazar(selector = '.entrada__barra, .barra') {
  const cabecera = document.querySelector(selector);
  if (!cabecera || yaHecho(cabecera, 'cabeceraDesplazada')) return;

  let pendiente = false;
  const mirar = () => {
    pendiente = false;
    cabecera.classList.toggle('esta-desplazada', window.scrollY > 18);
  };
  const alDesplazar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(mirar);
  };
  mirar();
  window.addEventListener('scroll', alDesplazar, { passive: true });
}

// ---------------------------------------------------------------------------
// Números que suben hasta su valor
// ---------------------------------------------------------------------------

/** Cuánto dura la cuenta. Lo justo para verla, no para esperarla. */
const CUENTA_MS = 900;

/**
 * Sube un número desde cero hasta el que ya está escrito, conservando su
 * formato: separadores de miles, decimales, símbolo de moneda y lo que lleve
 * delante o detrás. Se trabaja sobre el texto que ya pintó el servidor, así
 * que si esto no se ejecuta el dato correcto está igualmente en pantalla.
 */
let observadorNumeros = null;

export function animarNumeros(raiz = document, selector = '[data-contar]') {
  if (sinMovimiento() || typeof IntersectionObserver !== 'function') return;

  observadorNumeros ??= new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        contar(entrada.target);
        observadorNumeros.unobserve(entrada.target);
      }
    },
    { threshold: 0.4 },
  );

  for (const nodo of raiz.querySelectorAll(selector)) {
    if (!yaHecho(nodo, 'numeroContado')) observadorNumeros.observe(nodo);
  }
}

/**
 * El panel y la ficha pintan sus métricas después de preguntar al servidor, y
 * el saldo del cliente cambia en vivo. En vez de obligar a cada pantalla a
 * avisar, se vigila el documento: cualquier número que aparezca marcado entra
 * solo en la cuenta.
 */
export function vigilarNumeros() {
  if (sinMovimiento() || typeof MutationObserver !== 'function') return;
  if (yaHecho(document.body, 'vigilanciaNumeros')) return;

  new MutationObserver((cambios) => {
    for (const cambio of cambios) {
      for (const nodo of cambio.addedNodes) {
        if (nodo.nodeType !== Node.ELEMENT_NODE) continue;
        if (nodo.matches?.('[data-contar]') && !yaHecho(nodo, 'numeroContado')) {
          observadorNumeros?.observe(nodo);
        }
        if (nodo.querySelector?.('[data-contar]')) animarNumeros(nodo);
      }
      if (cambio.type === 'attributes' && cambio.target.matches?.('[data-contar]')) {
        animarNumeros(cambio.target.parentNode ?? document);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-contar'] });
}

function contar(nodo) {
  const original = nodo.textContent;
  // El primer grupo de dígitos del texto, con sus separadores: «$1.234,50» da
  // «1.234,50», y se respeta lo que haya antes y después.
  const encontrado = original.match(/-?[\d.,]*\d/);
  if (!encontrado) return;
  const crudo = encontrado[0];
  const decimal = /,\d{1,2}$/.test(crudo) ? ',' : /\.\d{1,2}$/.test(crudo) && !/\d\.\d{3}/.test(crudo) ? '.' : null;
  const numero = Number(
    decimal === ',' ? crudo.replace(/\./g, '').replace(',', '.') : crudo.replace(/,/g, ''),
  );
  if (!Number.isFinite(numero)) return;

  const decimales = decimal ? (crudo.split(decimal)[1] || '').length : 0;
  const antes = original.slice(0, encontrado.index);
  const despues = original.slice(encontrado.index + crudo.length);
  const formato = new Intl.NumberFormat('es-EC', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });

  const arranque = performance.now();
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - arranque) / CUENTA_MS);
    // Frena al final: el número «aterriza» en su valor en vez de chocar.
    const suave = 1 - Math.pow(1 - t, 3);
    nodo.textContent = `${antes}${formato.format(numero * suave)}${despues}`;
    if (t < 1) requestAnimationFrame(paso);
    else nodo.textContent = original;
  };
  requestAnimationFrame(paso);
}

// ---------------------------------------------------------------------------
// Subrayado que viaja entre pestañas
// ---------------------------------------------------------------------------

/**
 * El subrayado de la pestaña activa se desliza hasta la nueva en vez de
 * apagarse aquí y encenderse allá. El viaje explica qué pasó; el salto, no.
 *
 * Lo dibuja un elemento propio del grupo de pestañas: así no depende de que
 * las dos pestañas existan a la vez ni de en qué orden cambia `aria-selected`.
 */
/**
 * En un teléfono la tira de pestañas no cabe y se desplaza de lado. Al cambiar
 * de pestaña, la nueva se trae al centro: si no, se toca una que está medio
 * cortada en el borde y se queda ahí, cortada.
 *
 * Va aparte del indicador porque esto no es decoración: sin ello, quien pide
 * menos movimiento se quedaría sin ver qué pestaña tiene abierta.
 */
export function montarPestanasDesplazables(selector = '.pestanas') {
  for (const grupo of document.querySelectorAll(selector)) {
    if (yaHecho(grupo, 'pestanasDesplazables')) continue;
    grupo.classList.add('pestanas--desplazable');

    // Solo se difumina el lado por el que de verdad queda algo. Un degradado
    // fijo a los dos lados miente al final de la tira y, de paso, se come
    // media pestaña activa cuando es la última.
    const marcarBordes = () => {
      const margen = 4;
      grupo.classList.toggle('hay-antes', grupo.scrollLeft > margen);
      grupo.classList.toggle('hay-despues', grupo.scrollLeft + grupo.clientWidth < grupo.scrollWidth - margen);
    };

    const centrar = () => {
      const activa = grupo.querySelector('[aria-selected="true"]');
      if (activa && grupo.scrollWidth > grupo.clientWidth + 2) {
        const objetivo = activa.offsetLeft - (grupo.clientWidth - activa.offsetWidth) / 2;
        grupo.scrollTo({ left: Math.max(0, objetivo), behavior: sinMovimiento() ? 'auto' : 'smooth' });
      }
      marcarBordes();
    };

    centrar();
    new MutationObserver(centrar).observe(grupo, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    grupo.addEventListener('scroll', marcarBordes, { passive: true });
    window.addEventListener('resize', marcarBordes, { passive: true });
  }
}

export function montarIndicadorPestanas(selector = '.pestanas') {
  if (sinMovimiento()) return;
  for (const grupo of document.querySelectorAll(selector)) {
    if (yaHecho(grupo, 'indicadorPestanas')) continue;

    const barra = document.createElement('span');
    barra.className = 'pestanas__indicador';
    barra.setAttribute('aria-hidden', 'true');
    grupo.append(barra);
    grupo.classList.add('pestanas--con-indicador');

    const colocar = () => {
      const activa = grupo.querySelector('[aria-selected="true"]');
      if (!activa) {
        barra.classList.remove('pestanas__indicador--visible');
        return;
      }
      // `offsetLeft`, no la posición en pantalla: la barra vive dentro del
      // grupo, que en un teléfono se desplaza de lado, así que tiene que ir en
      // coordenadas del contenido o se queda en la pestaña anterior en cuanto
      // la tira se mueve.
      if (activa.offsetWidth === 0) return;
      barra.style.setProperty('--x', `${activa.offsetLeft}px`);
      barra.style.setProperty('--ancho', `${activa.offsetWidth}px`);
      barra.classList.add('pestanas__indicador--visible');
    };

    colocar();
    // `aria-selected` lo cambian pantallas distintas y de maneras distintas:
    // mirar el atributo es lo único que vale para todas.
    new MutationObserver(colocar).observe(grupo, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    window.addEventListener('resize', colocar, { passive: true });
  }
}

// ---------------------------------------------------------------------------
// Pulsación con origen: la onda sale del dedo
// ---------------------------------------------------------------------------

/**
 * Al pulsar, un destello nace justo donde cayó el dedo o el ratón. Es la
 * confirmación más barata que existe de que el botón recibió la pulsación,
 * y en la pista —con guantes y a pleno sol— esa confirmación importa.
 */
export function montarOndaBotones() {
  if (sinMovimiento()) return;
  if (yaHecho(document.body, 'ondaBotones')) return;

  document.addEventListener(
    'pointerdown',
    (evento) => {
      const boton = evento.target instanceof Element ? evento.target.closest('.boton, .pestana') : null;
      if (!boton || boton.disabled) return;
      const caja = boton.getBoundingClientRect();
      boton.style.setProperty('--onda-x', `${evento.clientX - caja.left}px`);
      boton.style.setProperty('--onda-y', `${evento.clientY - caja.top}px`);
      boton.classList.remove('con-onda');
      // Forzar el reflujo reinicia la animación cuando se pulsa dos veces
      // seguidas; sin esto, la segunda pulsación no muestra nada.
      void boton.offsetWidth;
      boton.classList.add('con-onda');
    },
    { passive: true },
  );
}

// ---------------------------------------------------------------------------
// Inclinación 3D, temporizador QR y atracción magnética
// ---------------------------------------------------------------------------

/**
 * Inclinación 3D suave en tarjetas y figuras fotográficas bajo el ratón.
 */
export function montarInclinacion3D(selector = '.pagina-entrada figure, .entrada__media-destacada') {
  if (sinMovimiento() || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  const elementos = [...document.querySelectorAll(selector)].filter((el) => !yaHecho(el, 'inclinacion3d'));
  for (const elem of elementos) {
    let rafId = null;
    const alMover = (e) => {
      const rect = elem.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        elem.style.transform = `perspective(1000px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg) scale3d(1.012, 1.012, 1.012)`;
      });
    };
    const alSalir = () => {
      if (rafId) cancelAnimationFrame(rafId);
      elem.style.transform = '';
    };
    elem.addEventListener('mousemove', alMover, { passive: true });
    elem.addEventListener('mouseleave', alSalir, { passive: true });
  }
}

/**
 * Temporizador visual en vivo para la rotación del código QR.
 */
export function montarTemporizadorQr() {
  if (sinMovimiento()) return;
  const estado = document.querySelector('#qr-estado');
  if (!estado || yaHecho(estado, 'temporizadorQr')) return;

  const temporizador = document.createElement('div');
  temporizador.className = 'qr-temporizador';
  const barra = document.createElement('div');
  barra.className = 'qr-temporizador__barra';
  temporizador.append(barra);
  estado.after(temporizador);

  const cuentaNodo = document.querySelector('#qr-cuenta');
  if (!cuentaNodo) return;

  let duracionMaxima = 120;
  const actualizarBarra = () => {
    const valor = parseInt(cuentaNodo.textContent, 10);
    if (!Number.isNaN(valor)) {
      if (valor > duracionMaxima) duracionMaxima = valor;
      const porcentaje = Math.max(0, Math.min(100, (valor / duracionMaxima) * 100));
      barra.style.width = `${porcentaje}%`;
    }
  };

  new MutationObserver(actualizarBarra).observe(cuentaNodo, { childList: true, characterData: true, subtree: true });
  actualizarBarra();
}

/**
 * Micro-interacción magnética para botones principales en escritorio.
 */
export function montarEfectoMagnetico(selector = '.entrada__accion, .entrada__enlace') {
  if (sinMovimiento() || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  const botones = [...document.querySelectorAll(selector)].filter((b) => !yaHecho(b, 'magnetico'));
  for (const boton of botones) {
    const alMover = (e) => {
      const rect = boton.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      boton.style.transform = `translate3d(${(dx * 0.15).toFixed(1)}px, ${(dy * 0.15).toFixed(1)}px, 0)`;
    };
    const alSalir = () => {
      boton.style.transform = '';
    };
    boton.addEventListener('mousemove', alMover, { passive: true });
    boton.addEventListener('mouseleave', alSalir, { passive: true });
  }
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/**
 * Enciende todo lo que corresponda a la pantalla actual. Se puede volver a
 * llamar cuando una pantalla termina de pintar su contenido.
 */
export function montarMovimiento() {
  montarCabeceraAlDesplazar();
  destellarMarca();
  montarOndaBotones();
  montarPestanasDesplazables();
  montarIndicadorPestanas();
  animarNumeros();
  vigilarNumeros();
  montarTemporizadorQr();
  if (document.body.classList.contains('pagina-entrada')) {
    montarProgresoLectura();
    revelarTitulares('.entrada__hero h1, .entrada__seccion-cabeza h2, .entrada__acceso-intro h2, .entrada__media-destacada-copy h3');
    revelarFiguras();
    montarParalaje();
    trazarRotulos();
    montarInclinacion3D();
    montarEfectoMagnetico();
  }
}

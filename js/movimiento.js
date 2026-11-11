/**
 * Capa de movimiento de la interfaz.
 *
 * Aquí vive lo poco que se mueve por cuenta propia: el subrayado que viaja
 * entre pestañas y la barra del código QR.
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

export function sinMovimiento() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Marca un nodo como ya trabajado por una pieza concreta. */
function yaHecho(nodo, marca) {
  if (nodo.dataset[marca] === '1') return true;
  nodo.dataset[marca] = '1';
  return false;
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
// Temporizador del código QR
// ---------------------------------------------------------------------------


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

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/**
 * Enciende todo lo que corresponda a la pantalla actual. Se puede volver a
 * llamar cuando una pantalla termina de pintar su contenido.
 */
export function montarMovimiento() {
  montarCabeceraAlDesplazar();
  montarPestanasDesplazables();
  montarIndicadorPestanas();
  montarTemporizadorQr();
}

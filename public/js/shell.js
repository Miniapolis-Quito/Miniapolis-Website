/** Cabecera común: marca, navegación por rol, estado en vivo y cierre de sesión. */
import { el, render, $, configurarFormato } from './ui.js';
import { montarMovimiento } from './movimiento.js';
import { cerrarSesion, getUsuario, puedeEscanear } from './api.js';
import { textoEstado } from './realtime.js';
import { abrirCambioPassword } from './cuenta.js';
import { abrirSeguridad } from './dos-factores.js';

/** Marca de fábrica: la que traen escritas las páginas y el logotipo oficial.
 *  Si el despliegue configura otra, `aplicarMarca` la sustituye. */
const MARCA_POR_DEFECTO = 'Miniápolis #3';
const MARCA_CORTA_POR_DEFECTO = 'Miniápolis';

const MIS_ENTRADAS = { href: '/app', texto: 'Mis entradas' };
const ESCANEAR = { href: '/escanear', texto: 'Escanear', soloConEscaner: true };

const NAV_POR_ROL = {
  customer: [MIS_ENTRADAS],
  staff: [ESCANEAR, MIS_ENTRADAS],
  master: [{ href: '/admin', texto: 'Administración' }, ESCANEAR, MIS_ENTRADAS],
};

/**
 * Enlaces que le corresponden a esta persona.
 *
 * El escáner desaparece del menú si su cuenta no está autorizada: no es la
 * defensa (esa está en el servidor), pero evita que alguien acabe en una
 * pantalla que no puede usar y crea que el sistema está roto.
 */
function enlacesPara(usuario) {
  const autorizado = puedeEscanear(usuario);
  return (NAV_POR_ROL[usuario?.role] || []).filter((entrada) => !entrada.soloConEscaner || autorizado);
}

export function montarCabecera(contenedor, { marca = MARCA_CORTA_POR_DEFECTO } = {}) {
  const usuario = getUsuario();
  const rutaActual = window.location.pathname;

  const indicador = el('span', { class: 'punto', 'aria-hidden': 'true' });
  const textoIndicador = el('span', {}, 'Conectando…');

  const nav = el(
    'nav',
    { class: 'barra__nav', 'aria-label': 'Secciones' },
    enlacesPara(usuario).map((entrada) =>
      el(
        'a',
        {
          class: 'boton boton--nav',
          href: entrada.href,
          'aria-current': entrada.href === rutaActual ? 'page' : null,
        },
        entrada.texto,
      ),
    ),
  );

  render(
    contenedor,
    el(
      'div',
      { class: 'contenedor' },
      el(
        'div',
        { class: 'barra__interior' },
        el(
          'a',
          {
            class: 'barra__marca subrayado-no',
            href: usuario ? '/app' : '/',
            // El logotipo es decorativo y el nombre se oculta a la vista en
            // pantallas estrechas, así que el enlace lleva su propio nombre.
            'aria-label': `${marca} — inicio`,
          },
          el(
            'span',
            { class: 'marca__sello', 'aria-hidden': 'true' },
            el('img', {
              class: 'marca__logo',
              src: '/images/miniapolis-logo-oficial.webp',
              width: '1000',
              height: '425',
              alt: '',
            }),
          ),
          el('span', {}, marca),
        ),
        nav,
        el('span', { class: 'estado-conexion', title: 'Estado de la conexión en vivo' }, indicador, textoIndicador),
        // Los clientes cambian su contraseña y configuran el segundo factor en
        // «Mi cuenta»; el personal y el máster, desde aquí.
        usuario && usuario.role !== 'customer'
          ? el(
              'button',
              { class: 'boton boton--fantasma boton--chico', type: 'button', onClick: () => abrirCambioPassword() },
              'Contraseña',
            )
          : null,
        usuario && usuario.role !== 'customer'
          ? el(
              'button',
              { class: 'boton boton--fantasma boton--chico', type: 'button', onClick: () => abrirSeguridad() },
              'Seguridad',
            )
          : null,
        usuario
          ? el(
              'button',
              {
                class: 'boton boton--fantasma boton--chico',
                type: 'button',
                onClick: async () => {
                  await cerrarSesion();
                  window.location.replace('/');
                },
              },
              'Salir',
            )
          : null,
      ),
    ),
  );

  return {
    /** Refleja el estado de la conexión SSE en la cabecera. */
    actualizarEstado(estado) {
      indicador.className = `punto ${estado === 'conectado' ? 'punto--vivo' : estado === 'desconectado' ? 'punto--caido' : ''}`;
      textoIndicador.textContent = textoEstado(estado);
    },
  };
}

/** Muestra el nombre del usuario donde corresponda. */
export function saludo() {
  const usuario = getUsuario();
  if (!usuario) return '';
  return usuario.fullName.split(' ')[0];
}

/**
 * Revela los bloques de la página cuando entran en pantalla.
 *
 * La clase la pone este código y nunca el HTML: si el JavaScript no llega a
 * ejecutarse, la página se ve completa igual, sin nada transparente. Cada
 * bloque se revela una sola vez —lo que se repinta después no vuelve a
 * aparecer— y quien pide menos movimiento no ve ninguna animación.
 */
/**
 * Qué se revela: los bloques de primer nivel de la página y los del contenido
 * del cliente, que llega después de consultar al servidor.
 *
 * Los paneles de pestaña quedan fuera a propósito. Su contenido se carga
 * después de abrirlos, así que un bloque podía quedar marcado antes de tener
 * altura, no llegar a considerarse visible y dejar la pestaña **en blanco**.
 * Para ellos basta la animación de CSS al pasar de oculto a visible, que no
 * depende de JavaScript ni deja nada transparente.
 */
const BLOQUES_REVELABLES = 'main > *, main #contenido > *';

/** Si algo no llegó a revelarse, se muestra igual: nunca una pantalla en blanco. */
const RED_DE_SEGURIDAD_MS = 2500;

let observadorRevelado = null;

export function revelarAlEntrar() {
  const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (sinMovimiento || typeof IntersectionObserver !== 'function') return;

  const bloques = [...document.querySelectorAll(BLOQUES_REVELABLES)].filter(
    (nodo) =>
      !nodo.hidden &&
      !nodo.classList.contains('revelar') &&
      !nodo.classList.contains('revelar--visible') &&
      nodo.getBoundingClientRect().height > 0,
  );
  if (bloques.length === 0) return;

  for (const bloque of bloques) bloque.classList.add('revelar');

  observadorRevelado ??= new IntersectionObserver(
    (entradas) => {
      // Los que entran juntos se escalonan; así la página se arma de arriba
      // abajo en vez de encenderse de golpe.
      let retraso = 0;
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const nodo = entrada.target;
        nodo.style.setProperty('animation-delay', `${retraso}ms`);
        nodo.classList.add('revelar--visible');
        observadorRevelado.unobserve(nodo);
        retraso += 70;
      }
    },
    // Se adelanta un poco a la entrada real: cuando la persona llega, el
    // bloque ya terminó de aparecer.
    { rootMargin: '0px 0px -8% 0px', threshold: 0.02 },
  );
  for (const bloque of bloques) observadorRevelado.observe(bloque);

  // Si algo quedó marcado sin revelarse —porque creció fuera de la pantalla,
  // porque el observador no disparó, porque el navegador hizo otra cosa—, se
  // le quita la marca y se ve con normalidad. Un adorno nunca puede esconder
  // el contenido.
  setTimeout(() => {
    for (const bloque of bloques) {
      if (!bloque.classList.contains('revelar--visible')) bloque.classList.remove('revelar');
    }
  }, RED_DE_SEGURIDAD_MS);
}

// Lo que ya está en el HTML se revela solo. Las pantallas que pintan su
// contenido después de consultar al servidor vuelven a llamar a
// `revelarAlEntrar()` cuando terminan.
requestAnimationFrame(revelarAlEntrar);
requestAnimationFrame(montarMovimiento);

/** Aplica la marca cargada del servidor a los textos de la página. */
export async function aplicarMarca(configuracion) {
  if (!configuracion) return;
  configurarFormato(configuracion);
  document.title = document.title.replace(MARCA_POR_DEFECTO, configuracion.brandName || MARCA_POR_DEFECTO);
  for (const nodo of document.querySelectorAll('[data-marca]')) {
    nodo.textContent = configuracion.brandName;
  }
  const marca = $('.barra__marca span:last-child');
  if (marca && configuracion.brandShort) marca.textContent = configuracion.brandShort;
}

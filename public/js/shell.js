/** Cabecera común: marca, navegación por rol, estado en vivo y cierre de sesión. */
import { el, render, $ } from './ui.js';
import { cerrarSesion, getUsuario } from './api.js';
import { textoEstado } from './realtime.js';

const NAV_POR_ROL = {
  customer: [{ href: '/app', texto: 'Mis entradas' }],
  staff: [
    { href: '/escanear', texto: 'Escanear' },
    { href: '/app', texto: 'Mis entradas' },
  ],
  master: [
    { href: '/admin', texto: 'Administración' },
    { href: '/escanear', texto: 'Escanear' },
    { href: '/app', texto: 'Mis entradas' },
  ],
};

export function montarCabecera(contenedor, { marca = 'Racing Hobbies' } = {}) {
  const usuario = getUsuario();
  const rutaActual = window.location.pathname;

  const indicador = el('span', { class: 'punto', 'aria-hidden': 'true' });
  const textoIndicador = el('span', {}, 'Conectando…');

  const nav = el(
    'nav',
    { class: 'barra__nav', 'aria-label': 'Secciones' },
    (NAV_POR_ROL[usuario?.role] || []).map((entrada) =>
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
          { class: 'barra__marca subrayado-no', href: usuario ? '/app' : '/' },
          el('span', { class: 'logo', 'aria-hidden': 'true' }, 'RH'),
          el('span', {}, marca),
        ),
        nav,
        el('span', { class: 'estado-conexion', title: 'Estado de la conexión en vivo' }, indicador, textoIndicador),
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

/** Aplica la marca cargada del servidor a los textos de la página. */
export async function aplicarMarca(configuracion) {
  if (!configuracion) return;
  document.title = document.title.replace('Racing Hobbies', configuracion.brandShort || 'Racing Hobbies');
  for (const nodo of document.querySelectorAll('[data-marca]')) {
    nodo.textContent = configuracion.brandName;
  }
  const marca = $('.barra__marca span:last-child');
  if (marca && configuracion.brandShort) marca.textContent = configuracion.brandShort;
}

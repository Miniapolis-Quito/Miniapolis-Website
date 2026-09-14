/**
 * Ficha del cliente: todo lo que el sistema sabe de una persona en una sola
 * pantalla, con las acciones a mano.
 *
 * Vive en su propio módulo porque es la vista más grande del panel, y se abre
 * por dirección (`/admin#cliente/<id>`) para que se pueda compartir el enlace y
 * sobreviva a recargar la página.
 */
import {
  $, el, render, brindis, fecha, relativo, dinero, plural, metrica, telefono, estadoPack, METODOS,
  mostrarAviso, mostrarErroresCampo, datosFormulario, conCarga, confirmar, pedirTexto, copiar,
} from './ui.js';
import { api } from './api.js';
import { botonesDePack, anularConsumo } from './acciones.js';

const ROLES = { customer: 'Cliente', staff: 'Personal de pista', master: 'Máster' };

const RAZONES_MOVIMIENTO = {
  issue: 'Pack emitido',
  redeem: 'Entrada usada',
  void: 'Entrada devuelta',
  adjust: 'Ajuste manual',
  cancel: 'Pack anulado',
  restore: 'Pack restaurado',
};

const ACCIONES_CUENTA = {
  'cuenta.registrada': 'Creó su cuenta',
  'usuario.creado': 'Cuenta creada por administración',
  'usuario.actualizado': 'Datos modificados',
  'usuario.desbloqueado': 'Cuenta desbloqueada',
  'usuario.password_restablecida': 'Contraseña restablecida por administración',
  'usuario.sesiones_revocadas': 'Sesiones cerradas por administración',
  'perfil.actualizado': 'Actualizó sus datos',
  'password.cambiada': 'Cambió su contraseña',
  'password.recuperacion_solicitada': 'Pidió un enlace para recuperar su contraseña',
  'password.restablecida_por_correo': 'Restableció su contraseña con el enlace del correo',
  'password.cambio_bloqueado': 'Sesión cerrada por fallar la contraseña actual al cambiarla',
  'login.exitoso': 'Inició sesión',
  'login.fallido': 'Intento de acceso fallido',
  logout: 'Cerró sesión',
  'logout.todos': 'Cerró sesión en todos sus dispositivos',
  'escaneo.rechazado': 'Código rechazado en la puerta',
  'escaneo_sin_conexion.rechazado': 'Entró durante un corte de red y su entrada no se pudo cobrar',
  'escaneo_sin_conexion.resuelto': 'Entrada sin cobrar marcada como resuelta',
};

/** Estado de la ficha abierta. */
const estado = { userId: null, datos: null, pestana: 'resumen', opciones: {} };

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------

function iniciales(nombre) {
  const partes = String(nombre || '?').trim().split(/\s+/).slice(0, 2);
  return partes.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}


function seccion(titulo, ...contenido) {
  return el('section', { class: 'tarjeta' }, el('div', { class: 'tarjeta__titulo' }, el('h2', {}, titulo)), ...contenido);
}

function vacio(icono, mensaje) {
  return el('div', { class: 'ficha__vacio' }, el('div', { class: 'vacio__icono' }, icono), el('p', { class: 'sin-margen' }, mensaje));
}

// ---------------------------------------------------------------------------
// Carga y navegación
// ---------------------------------------------------------------------------

async function recargar({ conservarPestana = true } = {}) {
  const pestana = conservarPestana ? estado.pestana : 'resumen';
  estado.datos = await api.get(`/api/admin/users/${estado.userId}`);
  estado.pestana = pestana;
  pintar();
  estado.opciones.alCambiar?.();
}

/**
 * Abre la ficha de un cliente.
 * @param {string} userId
 * @param {{contenedor:HTMLElement, alVolver:Function, alCambiar:Function,
 *          onVenderPack:Function, usuarioActual:object}} opciones
 */
export async function abrirFicha(userId, opciones) {
  estado.userId = userId;
  estado.opciones = opciones;
  estado.pestana = 'resumen';

  render(
    opciones.contenedor,
    el('div', { class: 'ficha__vacio' }, el('div', { class: 'cargando cargando--grande' }), el('p', { class: 'mt' }, 'Cargando la ficha…')),
  );

  try {
    estado.datos = await api.get(`/api/admin/users/${userId}`);
  } catch (error) {
    render(
      opciones.contenedor,
      el('div', { class: 'aviso aviso--error' }, error.message),
      el('button', { class: 'boton boton--fantasma mt', type: 'button', onClick: () => opciones.alVolver() }, 'Volver'),
    );
    return;
  }
  pintar();
}

export function cerrarFicha() {
  estado.userId = null;
  estado.datos = null;
}

// ---------------------------------------------------------------------------
// Pintado
// ---------------------------------------------------------------------------

function pintar() {
  const { user, summary, stats } = estado.datos;
  const esUnoMismo = user.id === estado.opciones.usuarioActual?.id;

  render(
    estado.opciones.contenedor,
    el(
      'div',
      { class: 'ficha' },
      el(
        'button',
        { class: 'ficha__volver', type: 'button', onClick: () => estado.opciones.alVolver() },
        el('span', { 'aria-hidden': 'true' }, '←'),
        el('span', {}, 'Volver a clientes y personal'),
      ),
      cabecera(user, esUnoMismo),
      el(
        'div',
        { class: 'rejilla rejilla--metricas' },
        metrica(String(summary.availableTickets), 'Entradas disponibles', 'metrica--acento'),
        metrica(String(summary.usedTickets), 'Entradas usadas'),
        metrica(String(summary.purchasedTickets), 'Entradas compradas'),
        metrica(dinero(stats.gastadoCents, estado.datos.currency), 'Total gastado'),
      ),
      franjaHabitos(stats),
      pestanas(),
      el('div', { id: 'ficha-panel' }, panelActual()),
    ),
  );
}

function cabecera(user, esUnoMismo) {
  return el(
    'header',
    { class: 'ficha__cabecera' },
    el('div', { class: `avatar avatar--${user.role}`, 'aria-hidden': 'true' }, iniciales(user.fullName)),
    el(
      'div',
      { class: 'ficha__identidad' },
      el('div', { class: 'ficha__nombre' }, user.fullName),
      el(
        'div',
        { class: 'ficha__contacto' },
        el('a', { href: `mailto:${user.email}` }, user.email),
        user.phone ? el('a', { href: `tel:${user.phone}` }, telefono(user.phone)) : null,
      ),
      el(
        'div',
        { class: 'ficha__etiquetas' },
        el('span', { class: 'etiqueta etiqueta--info' }, ROLES[user.role] || user.role),
        el(
          'span',
          { class: `etiqueta etiqueta--${user.status === 'active' ? 'ok' : 'error'}` },
          user.status === 'active' ? 'Activo' : 'Suspendido',
        ),
        user.locked ? el('span', { class: 'etiqueta etiqueta--alerta' }, 'Bloqueado por intentos') : null,
        el('span', { class: 'etiqueta' }, `Cliente desde ${fecha(user.createdAt, { conHora: false })}`),
      ),
    ),
    el(
      'div',
      { class: 'ficha__acciones' },
      el(
        'button',
        {
          class: 'boton boton--principal boton--chico',
          type: 'button',
          onClick: () => estado.opciones.onVenderPack(estado.datos.user),
        },
        'Vender pack',
      ),
      el(
        'button',
        { class: 'boton boton--fantasma boton--chico', type: 'button', onClick: () => irAPestana('datos') },
        'Editar datos',
      ),
      esUnoMismo
        ? null
        : el(
            'button',
            {
              class: `boton boton--chico ${user.status === 'active' ? 'boton--peligro' : 'boton--ok'}`,
              type: 'button',
              onClick: () => alternarSuspension(user),
            },
            user.status === 'active' ? 'Suspender' : 'Reactivar',
          ),
    ),
  );
}

/** Traduce la media de días entre visitas a algo que una persona diría. */
function cadenciaTexto(dias) {
  if (dias < 1.5) return 'casi todos los días';
  if (dias < 14) {
    const n = Math.round(dias);
    return `cada ${n === 1 ? 'día' : `${n} días`}`;
  }
  if (dias < 60) {
    const semanas = Math.round(dias / 7);
    return `cada ${semanas === 1 ? 'semana' : `${semanas} semanas`}`;
  }
  const meses = Math.round(dias / 30);
  return `cada ${meses === 1 ? 'mes' : `${meses} meses`}`;
}

function franjaHabitos(stats) {
  if (!stats.visitas) {
    return el('p', { class: 'habitos' }, 'Todavía no ha usado ninguna entrada.');
  }
  return el(
    'div',
    { class: 'habitos' },
    el('span', {}, 'Última visita ', el('strong', {}, relativo(stats.ultimaVisita))),
    el('span', {}, 'Primera visita ', el('strong', {}, fecha(stats.primeraVisita, { conHora: false }))),
    el('span', {}, 'Visitas ', el('strong', {}, String(stats.visitas))),
    stats.cadenciaDias ? el('span', {}, 'Vuelve ', el('strong', {}, cadenciaTexto(stats.cadenciaDias))) : null,
  );
}

const PESTANAS = [
  ['resumen', 'Resumen'],
  ['packs', 'Packs'],
  ['consumos', 'Consumos'],
  ['actividad', 'Actividad'],
  ['acceso', 'Acceso'],
  ['datos', 'Datos'],
];

function pestanas() {
  return el(
    'div',
    { class: 'pestanas', role: 'tablist', 'aria-label': 'Secciones de la ficha' },
    PESTANAS.map(([clave, texto]) =>
      el(
        'button',
        {
          class: 'pestana',
          role: 'tab',
          type: 'button',
          dataset: { pestana: clave },
          'aria-selected': String(estado.pestana === clave),
          onClick: () => irAPestana(clave),
        },
        texto,
      ),
    ),
  );
}

function irAPestana(clave) {
  estado.pestana = clave;
  for (const boton of document.querySelectorAll('.ficha .pestana')) {
    boton.setAttribute('aria-selected', String(boton.dataset.pestana === clave));
  }
  render($('#ficha-panel'), panelActual());
}

function panelActual() {
  return {
    resumen: panelResumen,
    packs: panelPacks,
    consumos: panelConsumos,
    actividad: panelActividad,
    acceso: panelAcceso,
    datos: panelDatos,
  }[estado.pestana]();
}

// ---------------------------------------------------------------------------
// Pestaña: Resumen
// ---------------------------------------------------------------------------

function panelResumen() {
  const { stats, packs, timeline } = estado.datos;
  const activos = packs.filter((p) => p.usable);
  const maximoSemana = Math.max(1, ...stats.porSemana.map((s) => s.visitas));
  const maximoDia = Math.max(1, ...stats.porDiaSemana.map((d) => d.visitas));

  return el(
    'div',
    { class: 'rejilla rejilla--2 alinea-arriba' },
    el(
      'div',
      { class: 'columna' },
      seccion(
        'Packs con entradas',
        activos.length
          ? el('div', { class: 'columna' }, activos.map((pack) => miniPack(pack)))
          : vacio('🎟️', 'No tiene packs con entradas disponibles.'),
      ),
      seccion(
        'Visitas por semana',
        stats.visitas
          ? el(
              'div',
              {},
              el(
                'div',
                { class: 'grafico' },
                stats.porSemana.map((s) =>
                  el('div', {
                    class: 'grafico__barra',
                    style: `height:${Math.max(3, (s.visitas / maximoSemana) * 100)}%`,
                    title: `Semana del ${fecha(s.semana, { conHora: false })}: ${plural(s.visitas, 'visita', 'visitas')}`,
                  }),
                ),
              ),
              el(
                'div',
                { class: 'fila fila--entre mt' },
                el('span', { class: 'tenue-2 pequeno' }, fecha(stats.porSemana[0].semana, { conHora: false })),
                el('span', { class: 'tenue-2 pequeno' }, 'esta semana'),
              ),
            )
          : vacio('📅', 'Sin visitas registradas todavía.'),
      ),
    ),
    el(
      'div',
      { class: 'columna' },
      seccion(
        'Qué días viene',
        stats.visitas
          ? el(
              'div',
              { class: 'semana' },
              stats.porDiaSemana.map((d) =>
                el(
                  'div',
                  { class: 'semana__fila' },
                  el('span', { class: 'semana__nombre' }, d.dia),
                  el(
                    'div',
                    { class: 'semana__barra' },
                    el('div', { class: 'semana__relleno', style: `width:${(d.visitas / maximoDia) * 100}%` }),
                  ),
                  el('span', { class: 'semana__valor' }, String(d.visitas)),
                ),
              ),
            )
          : vacio('🏁', 'Aún no hay un patrón que mostrar.'),
      ),
      seccion(
        'Lo último que pasó',
        timeline.items.length
          ? el(
              'div',
              {},
              el('ul', { class: 'tiempo' }, timeline.items.slice(0, 6).map((e) => filaTiempo(e))),
              el(
                'button',
                { class: 'boton boton--fantasma boton--chico mt', type: 'button', onClick: () => irAPestana('actividad') },
                'Ver toda la actividad',
              ),
            )
          : vacio('🕐', 'Sin actividad registrada.'),
      ),
    ),
  );
}

function miniPack(pack) {
  const marca = estadoPack(pack);
  const porcentaje = pack.size > 0 ? (pack.remaining / pack.size) * 100 : 0;
  return el(
    'article',
    { class: `mini-pack ${pack.usable ? '' : 'mini-pack--inactivo'}` },
    el(
      'div',
      { class: 'mini-pack__fila' },
      el('span', { class: 'mini-pack__codigo' }, pack.code),
      el('span', { class: `etiqueta etiqueta--${marca.clase}` }, marca.texto),
    ),
    el(
      'div',
      { class: 'mini-pack__fila' },
      el(
        'div',
        {},
        el('span', { class: 'mini-pack__saldo' }, String(pack.remaining)),
        el('span', { class: 'tenue' }, ` de ${pack.size}`),
      ),
      el('span', { class: 'tenue-2 pequeno' }, dinero(pack.priceCents, pack.currency)),
    ),
    el('div', { class: 'barra-progreso' }, el('div', { class: 'barra-progreso__relleno', style: `width:${porcentaje}%` })),
    pack.expiresAt ? el('div', { class: 'tenue-2 pequeno' }, `Vence el ${fecha(pack.expiresAt, { conHora: false })}`) : null,
  );
}

// ---------------------------------------------------------------------------
// Pestaña: Packs
// ---------------------------------------------------------------------------

function panelPacks() {
  const { packs } = estado.datos;
  if (!packs.length) {
    return seccion('Packs', vacio('🎟️', 'Este cliente todavía no tiene packs.'));
  }
  return el('div', { class: 'columna' }, packs.map((pack) => tarjetaPackDetallada(pack)));
}

function tarjetaPackDetallada(pack) {
  const marca = estadoPack(pack);
  const porcentaje = pack.size > 0 ? (pack.remaining / pack.size) * 100 : 0;
  const movimientos = el('div', { class: 'mt' });
  let abierto = false;

  const alternarMovimientos = async (boton) => {
    abierto = !abierto;
    boton.textContent = abierto ? 'Ocultar movimientos' : 'Ver movimientos';
    if (!abierto) {
      render(movimientos);
      return;
    }
    render(movimientos, el('div', { class: 'cargando' }));
    try {
      const detalle = await api.get(`/api/admin/packs/${pack.id}`);
      render(
        movimientos,
        el(
          'ul',
          { class: 'tiempo' },
          detalle.movements.map((m) =>
            filaTiempo({
              tipo: 'movimiento',
              clave: m.reason,
              delta: m.delta,
              balanceAfter: m.balanceAfter,
              createdAt: m.createdAt,
              actorName: m.actorName,
              nota: m.note,
              packCode: pack.code,
            }, { ocultarPack: true }),
          ),
        ),
      );
    } catch (error) {
      render(movimientos, el('div', { class: 'aviso aviso--error' }, error.message));
    }
  };

  return el(
    'article',
    { class: `tarjeta ${pack.usable ? '' : 'pack--inactivo'}` },
    el(
      'div',
      { class: 'fila fila--entre' },
      el(
        'div',
        {},
        el('div', { class: 'pack__codigo' }, pack.code),
        el(
          'div',
          { class: 'tenue-2 pequeno' },
          `Pack de ${pack.size} · ${dinero(pack.priceCents, pack.currency)}` +
            (pack.paymentMethod ? ` · ${pack.paymentMethod}` : '') +
            ` · emitido el ${fecha(pack.createdAt, { conHora: false })}`,
        ),
      ),
      el('span', { class: `etiqueta etiqueta--${marca.clase}` }, marca.texto),
    ),
    el(
      'div',
      { class: 'fila fila--entre mt' },
      el(
        'div',
        {},
        el('span', { class: 'pack__restantes' }, String(pack.remaining)),
        el('span', { class: 'tenue' }, ` de ${pack.size} · ${plural(pack.used, 'usada', 'usadas')}`),
      ),
      pack.allowStaticQr ? el('span', { class: 'etiqueta etiqueta--alerta' }, 'QR impreso activo') : null,
    ),
    el('div', { class: 'barra-progreso mt' }, el('div', { class: 'barra-progreso__relleno', style: `width:${porcentaje}%` })),
    pack.expiresAt ? el('div', { class: 'tenue-2 pequeno mt' }, `Vence el ${fecha(pack.expiresAt, { conHora: false })}`) : null,
    pack.note ? el('div', { class: 'tenue-2 pequeno' }, `Nota: ${pack.note}`) : null,
    el(
      'div',
      { class: 'fila mt' },
      botonesDePack(pack, {
        alCambiar: recargar,
        alImprimir: (elegido) => estado.opciones.onImprimirPase(elegido, estado.datos.user),
        extra: [
          el(
            'button',
            { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: (e) => alternarMovimientos(e.currentTarget) },
            'Ver movimientos',
          ),
        ],
      }),
    ),
    movimientos,
  );
}



// ---------------------------------------------------------------------------
// Pestaña: Consumos
// ---------------------------------------------------------------------------

function panelConsumos() {
  const contenedor = el('div');
  let cargados = [];
  let total = 0;

  const pintarLista = () => {
    render(
      contenedor,
      cargados.length
        ? el(
            'div',
            {},
            el(
              'div',
              { class: 'tabla-envoltura' },
              el(
                'table',
                {},
                el(
                  'thead',
                  {},
                  el(
                    'tr',
                    {},
                    el('th', {}, 'Cuándo'),
                    el('th', {}, 'Pack'),
                    el('th', {}, 'Cómo'),
                    el('th', {}, 'Quién lo registró'),
                    el('th', { class: 'num' }, 'Quedaban'),
                    el('th', {}, ''),
                  ),
                ),
                el(
                  'tbody',
                  {},
                  cargados.map((item) =>
                    el(
                      'tr',
                      {},
                      el(
                        'td',
                        {},
                        el('div', {}, fecha(item.createdAt)),
                        el('div', { class: 'tenue-2 pequeno' }, relativo(item.createdAt)),
                      ),
                      el('td', { class: 'mono' }, item.packCode),
                      el(
                        'td',
                        {},
                        el('span', { class: 'etiqueta' }, METODOS[item.method] || item.method),
                        item.deviceLabel ? el('div', { class: 'tenue-2 pequeno' }, item.deviceLabel) : null,
                        item.syncedAt
                          ? el('div', { class: 'tenue-2 pequeno', title: `Cobrada el ${fecha(item.syncedAt)}` }, 'Leída sin conexión')
                          : null,
                      ),
                      el('td', { class: 'pequeno' }, item.scannerName || 'sistema'),
                      el('td', { class: 'num' }, String(item.remainingAfter)),
                      el(
                        'td',
                        {},
                        item.status === 'confirmed'
                          ? el(
                              'button',
                              { class: 'boton boton--chico boton--peligro', type: 'button', onClick: () => anularConsumo(item, recargar) },
                              'Anular',
                            )
                          : el(
                              'div',
                              {},
                              el('span', { class: 'etiqueta etiqueta--error' }, 'Anulado'),
                              item.voidReason ? el('div', { class: 'tenue-2 pequeno' }, item.voidReason) : null,
                            ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            cargados.length < total
              ? el(
                  'button',
                  {
                    class: 'boton boton--fantasma boton--bloque mt',
                    type: 'button',
                    onClick: (e) => cargarMas(e.currentTarget),
                  },
                  `Ver más (${total - cargados.length} restantes)`,
                )
              : el('p', { class: 'tenue-2 pequeno mt sin-margen' }, `${plural(total, 'consumo registrado', 'consumos registrados')}.`),
          )
        : vacio('🏁', 'Este cliente todavía no ha usado ninguna entrada.'),
    );
  };

  const cargarMas = async (boton) => {
    await conCarga(boton, async () => {
      const pagina = await api.get(`/api/admin/users/${estado.userId}/redemptions?limit=50&offset=${cargados.length}`);
      cargados = cargados.concat(pagina.items);
      total = pagina.total;
      pintarLista();
    });
  };

  cargados = estado.datos.redemptions.items;
  total = estado.datos.redemptions.total;
  pintarLista();

  return seccion('Historial de consumos', contenedor);
}


// ---------------------------------------------------------------------------
// Pestaña: Actividad (línea de tiempo + auditoría)
// ---------------------------------------------------------------------------

function panelActividad() {
  const contenedor = el('div');
  let cargados = estado.datos.timeline.items;
  let total = estado.datos.timeline.total;

  const pintarLista = () => {
    render(
      contenedor,
      cargados.length
        ? el(
            'div',
            {},
            el('ul', { class: 'tiempo' }, cargados.map((e) => filaTiempo(e))),
            cargados.length < total
              ? el(
                  'button',
                  { class: 'boton boton--fantasma boton--bloque mt', type: 'button', onClick: (e) => cargarMas(e.currentTarget) },
                  `Ver más (${total - cargados.length} restantes)`,
                )
              : el('p', { class: 'tenue-2 pequeno mt sin-margen' }, 'Fin del historial.'),
          )
        : vacio('🕐', 'Sin actividad registrada.'),
    );
  };

  const cargarMas = async (boton) => {
    await conCarga(boton, async () => {
      const pagina = await api.get(`/api/admin/users/${estado.userId}/timeline?limit=60&offset=${cargados.length}`);
      cargados = cargados.concat(pagina.items);
      total = pagina.total;
      pintarLista();
    });
  };

  pintarLista();

  return el(
    'div',
    { class: 'columna' },
    seccion('Todo lo que ha pasado', el('p', { class: 'tenue pequeno' }, 'Movimientos de entradas y eventos de la cuenta, del más reciente al más antiguo.'), contenedor),
    seccion(
      'Bitácora técnica',
      el('p', { class: 'tenue pequeno' }, 'El registro sin interpretar, tal como quedó guardado. Útil para revisar un caso a fondo.'),
      estado.datos.audit.items.length
        ? el(
            'div',
            { class: 'tabla-envoltura' },
            el(
              'table',
              {},
              el('thead', {}, el('tr', {}, el('th', {}, 'Cuándo'), el('th', {}, 'Acción'), el('th', {}, 'Quién'), el('th', {}, 'Detalle'))),
              el(
                'tbody',
                {},
                estado.datos.audit.items.map((a) =>
                  el(
                    'tr',
                    {},
                    el('td', { class: 'pequeno tenue', title: fecha(a.createdAt) }, relativo(a.createdAt)),
                    el('td', {}, el('span', { class: 'etiqueta' }, a.action)),
                    el(
                      'td',
                      { class: 'pequeno' },
                      a.porElCliente ? 'el propio cliente' : a.actorName || a.actorEmail || 'sistema',
                      a.ip ? el('div', { class: 'tenue-2 pequeno' }, a.ip) : null,
                    ),
                    el('td', { class: 'pequeno tenue-2 mono celda-json' }, a.metadata ? JSON.stringify(a.metadata) : ''),
                  ),
                ),
              ),
            ),
          )
        : vacio('📋', 'Sin registros.'),
    ),
  );
}

/** Una entrada de la línea de tiempo, ya sea un movimiento o un evento de cuenta. */
function filaTiempo(evento, { ocultarPack = false } = {}) {
  const esMovimiento = evento.tipo === 'movimiento';

  const iconos = {
    issue: '🎟️', redeem: '🏎️', void: '↩️', adjust: '⚖️', cancel: '🚫', restore: '♻️',
  };
  const iconosCuenta = {
    'login.exitoso': '🔑', 'login.fallido': '⚠️', logout: '🚪', 'logout.todos': '🚪',
    'password.cambiada': '🔒', 'usuario.password_restablecida': '🔒',
    'password.recuperacion_solicitada': '✉️', 'password.restablecida_por_correo': '🔒',
    'password.cambio_bloqueado': '⛔',
    'perfil.actualizado': '✏️', 'usuario.actualizado': '✏️',
    'cuenta.registrada': '🎉', 'usuario.creado': '🎉',
    'usuario.desbloqueado': '🔓', 'usuario.sesiones_revocadas': '🚪',
    'escaneo.rechazado': '⛔',
    'escaneo_sin_conexion.rechazado': '⛔', 'escaneo_sin_conexion.resuelto': '✅',
  };

  const titulo = esMovimiento
    ? RAZONES_MOVIMIENTO[evento.clave] || evento.clave
    : ACCIONES_CUENTA[evento.clave] || evento.clave;

  const icono = esMovimiento ? iconos[evento.clave] || '•' : iconosCuenta[evento.clave] || '•';
  const modificador = esMovimiento
    ? evento.delta > 0
      ? 'tiempo__icono--suma'
      : 'tiempo__icono--resta'
    : ['login.fallido', 'escaneo.rechazado', 'escaneo_sin_conexion.rechazado'].includes(evento.clave)
      ? 'tiempo__icono--aviso'
      : '';

  const detalles = [];
  if (esMovimiento) {
    if (!ocultarPack && evento.packCode) detalles.push(evento.packCode);
    if (evento.metodo) detalles.push(METODOS[evento.metodo] || evento.metodo);
    if (evento.puesto) detalles.push(evento.puesto);
    if (evento.actorName) detalles.push(evento.porElCliente ? 'el propio cliente' : evento.actorName);
    if (evento.estadoConsumo === 'voided') detalles.push('consumo anulado después');
  } else {
    // Una entrada sin cobrar dice de qué pack era y por qué no se cobró; su
    // resolución, qué se hizo. Es lo que se busca cuando alguien pregunta.
    if (evento.metadata?.packCode && evento.clave.startsWith('escaneo_sin_conexion.')) detalles.push(evento.metadata.packCode);
    if (evento.actorName && !evento.porElCliente) detalles.push(`por ${evento.actorName}`);
    if (evento.ip) detalles.push(evento.ip);
  }
  const notaCuenta =
    evento.clave === 'escaneo_sin_conexion.rechazado' ? evento.metadata?.message
    : evento.clave === 'escaneo_sin_conexion.resuelto' ? evento.metadata?.note
    : null;

  return el(
    'li',
    { class: 'tiempo__item' },
    el('div', { class: `tiempo__icono ${modificador}` }, icono),
    el(
      'div',
      { class: 'tiempo__cuerpo' },
      el('div', { class: 'tiempo__titulo' }, titulo),
      detalles.length ? el('div', { class: 'tiempo__detalle' }, detalles.join(' · ')) : null,
      evento.nota ? el('div', { class: 'tiempo__detalle' }, evento.nota) : null,
      notaCuenta ? el('div', { class: 'tiempo__detalle' }, notaCuenta) : null,
      el('div', { class: 'tiempo__meta', title: fecha(evento.createdAt) }, relativo(evento.createdAt)),
      esMovimiento && evento.balanceAfter !== null && evento.balanceAfter !== undefined
        ? el(
            'span',
            { class: 'tiempo__saldo' },
            `${evento.delta > 0 ? '+' : ''}${evento.delta} · quedan ${evento.balanceAfter}`,
          )
        : null,
    ),
  );
}

// ---------------------------------------------------------------------------
// Pestaña: Acceso (sesiones y seguridad de la cuenta)
// ---------------------------------------------------------------------------

/** Nombre legible de un dispositivo a partir de su cadena de navegador. */
function nombreDispositivo(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Dispositivo desconocido';
  const sistema =
    /iPhone|iPad/i.test(ua) ? 'iPhone o iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X/i.test(ua) ? 'Mac'
    : /Linux/i.test(ua) ? 'Linux'
    : 'Dispositivo';
  const navegador =
    /Edg\//i.test(ua) ? 'Edge'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : null;
  return navegador ? `${sistema} · ${navegador}` : sistema;
}

const MOTIVOS_REVOCACION = {
  logout: 'cerró sesión',
  logout_all: 'cerró todas sus sesiones',
  rotated: 'reemplazada al renovarse',
  password_changed: 'cambió su contraseña',
  account_changed: 'se modificó la cuenta',
  token_reuse: 'uso sospechoso detectado',
  revocada_por_master: 'cerrada por administración',
};

function panelAcceso() {
  const { user, sessions } = estado.datos;
  const activas = sessions.filter((s) => !s.revokedAt && s.expiresAt > new Date().toISOString());
  const esUnoMismo = user.id === estado.opciones.usuarioActual?.id;

  return el(
    'div',
    { class: 'columna' },
    seccion(
      'Estado de la cuenta',
      el(
        'div',
        { class: 'columna' },
        el(
          'div',
          { class: 'aviso ' + (user.locked ? 'aviso--alerta' : user.status === 'active' ? 'aviso--ok' : 'aviso--error') },
          user.locked
            ? 'La cuenta está bloqueada temporalmente por intentos fallidos de acceso. Puedes desbloquearla aquí mismo.'
            : user.status === 'active'
              ? `Cuenta activa. ${plural(activas.length, 'sesión abierta', 'sesiones abiertas')}.`
              : 'Cuenta suspendida: no puede entrar ni usar sus entradas.',
        ),
        el(
          'div',
          { class: 'fila' },
          el(
            'button',
            { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: () => restablecerPassword(user) },
            'Restablecer contraseña',
          ),
          user.locked
            ? el(
                'button',
                {
                  class: 'boton boton--chico boton--ok',
                  type: 'button',
                  onClick: async () => {
                    await api.post(`/api/admin/users/${user.id}/unlock`, {});
                    brindis('Cuenta desbloqueada.', 'ok');
                    recargar();
                  },
                },
                'Desbloquear cuenta',
              )
            : null,
          activas.length
            ? el(
                'button',
                { class: 'boton boton--chico boton--peligro', type: 'button', onClick: () => cerrarSesiones(user) },
                esUnoMismo ? 'Cerrar mis otras sesiones' : 'Cerrar todas sus sesiones',
              )
            : null,
        ),
        el(
          'p',
          { class: 'tenue-2 pequeno sin-margen' },
          'Última entrada: ' + (user.lastLoginAt ? `${fecha(user.lastLoginAt)} (${relativo(user.lastLoginAt)})` : 'nunca'),
        ),
      ),
    ),
    seccion(
      'Dispositivos y sesiones',
      sessions.length
        ? el(
            'div',
            { class: 'columna' },
            sessions.map((s) => {
              const revocada = Boolean(s.revokedAt) || s.expiresAt <= new Date().toISOString();
              return el(
                'div',
                { class: `dispositivo ${revocada ? 'dispositivo--revocada' : ''}` },
                el('span', { class: 'punto ' + (revocada ? '' : 'punto--vivo') }),
                el(
                  'div',
                  {},
                  el('div', {}, nombreDispositivo(s.userAgent)),
                  el(
                    'div',
                    { class: 'tenue-2 pequeno' },
                    `${s.ip || 'sin dirección'} · abierta ${relativo(s.createdAt)}` +
                      (s.lastUsedAt ? ` · usada ${relativo(s.lastUsedAt)}` : ''),
                  ),
                  revocada
                    ? el(
                        'div',
                        { class: 'tenue-2 pequeno' },
                        s.revokedAt
                          ? `Cerrada ${relativo(s.revokedAt)}${s.revokeReason ? `: ${MOTIVOS_REVOCACION[s.revokeReason] || s.revokeReason}` : ''}`
                          : 'Caducada',
                      )
                    : null,
                ),
                el(
                  'span',
                  { class: `etiqueta ${revocada ? '' : 'etiqueta--ok'}` },
                  revocada ? 'Cerrada' : 'Abierta',
                ),
              );
            }),
          )
        : vacio('📱', 'Nunca ha iniciado sesión.'),
    ),
  );
}

async function restablecerPassword(user) {
  const seguro = await confirmar({
    titulo: 'Restablecer contraseña',
    mensaje: `Se generará una contraseña temporal para ${user.fullName} y se cerrarán todas sus sesiones. Tendrás que entregársela.`,
    textoAceptar: 'Generar contraseña',
  });
  if (!seguro) return;
  try {
    const respuesta = await api.post(`/api/admin/users/${user.id}/reset-password`, {});
    const copiada = await copiar(respuesta.temporaryPassword);
    await confirmar({
      titulo: 'Contraseña temporal',
      mensaje:
        `${respuesta.temporaryPassword}\n\n` +
        (copiada ? 'Ya está copiada al portapapeles. ' : '') +
        'Entrégasela al cliente y pídele que la cambie al entrar. No se volverá a mostrar.',
      textoAceptar: 'Entendido',
    });
    recargar();
  } catch (error) {
    brindis(error.message, 'error');
  }
}

async function cerrarSesiones(user) {
  const seguro = await confirmar({
    titulo: 'Cerrar sesiones',
    mensaje: `${user.fullName} tendrá que volver a entrar en todos sus dispositivos. Si tiene la app abierta, volverá a la pantalla de acceso en el acto.`,
    textoAceptar: 'Cerrar sesiones',
    peligro: true,
  });
  if (!seguro) return;
  try {
    const r = await api.post(`/api/admin/users/${user.id}/revoke-sessions`, {});
    brindis(`${plural(r.sesionesCerradas, 'sesión cerrada', 'sesiones cerradas')}.`, 'ok');
    recargar();
  } catch (error) {
    brindis(error.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Pestaña: Datos (edición)
// ---------------------------------------------------------------------------

function panelDatos() {
  const { user } = estado.datos;
  const esUnoMismo = user.id === estado.opciones.usuarioActual?.id;
  const aviso = el('div', { class: 'aviso', hidden: true });

  const formulario = el(
    'form',
    {
      novalidate: true,
      onSubmit: async (evento) => {
        evento.preventDefault();
        const form = evento.currentTarget;
        mostrarErroresCampo(form, {});
        mostrarAviso(aviso, '');

        const datos = datosFormulario(form);
        const cambios = {};
        if (datos.fullName !== user.fullName) cambios.fullName = datos.fullName;
        if (datos.email !== user.email) cambios.email = datos.email;
        if ((datos.phone || '') !== (user.phone || '')) cambios.phone = datos.phone || '';
        if (datos.role !== user.role) cambios.role = datos.role;
        if (datos.status !== user.status) cambios.status = datos.status;

        if (Object.keys(cambios).length === 0) {
          mostrarAviso(aviso, 'No hay cambios que guardar.', 'alerta');
          return;
        }

        // Cambiar rol, correo o estado cierra las sesiones del cliente: conviene
        // avisarlo antes y no después.
        if (cambios.role || cambios.email || cambios.status) {
          const seguro = await confirmar({
            titulo: 'Confirmar cambios',
            mensaje:
              'Modificar el rol, el correo o el estado cierra las sesiones abiertas de esta persona, ' +
              'que tendrá que volver a entrar. ¿Seguimos?',
            textoAceptar: 'Guardar cambios',
          });
          if (!seguro) return;
        }

        await conCarga(form.querySelector('button[type="submit"]'), async () => {
          try {
            await api.patch(`/api/admin/users/${user.id}`, cambios);
            brindis('Datos actualizados.', 'ok');
            await recargar();
          } catch (error) {
            mostrarErroresCampo(form, error.campos || {});
            mostrarAviso(aviso, error.message, 'error');
          }
        });
      },
    },
    el(
      'div',
      { class: 'rejilla rejilla--2' },
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'ficha-nombre' }, 'Nombre completo'),
        el('input', { id: 'ficha-nombre', name: 'fullName', type: 'text', value: user.fullName, required: true }),
        el('div', { class: 'campo__error' }),
      ),
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'ficha-email' }, 'Correo electrónico'),
        el('input', {
          id: 'ficha-email', name: 'email', type: 'email', value: user.email,
          required: true, autocapitalize: 'off', spellcheck: 'false',
        }),
        el('div', { class: 'campo__ayuda' }, 'Es también su usuario para entrar.'),
        el('div', { class: 'campo__error' }),
      ),
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'ficha-telefono' }, 'Teléfono'),
        el('input', { id: 'ficha-telefono', name: 'phone', type: 'tel', inputmode: 'tel', value: user.phone || '', placeholder: '+593 99 000 0000' }),
        el('div', { class: 'campo__error' }),
      ),
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'ficha-rol' }, 'Rol'),
        el(
          'select',
          { id: 'ficha-rol', name: 'role', disabled: esUnoMismo },
          Object.entries(ROLES).map(([valor, texto]) => el('option', { value: valor, selected: valor === user.role }, texto)),
        ),
        el(
          'div',
          { class: 'campo__ayuda' },
          esUnoMismo
            ? 'No puedes cambiarte el rol a ti mismo.'
            : 'El personal puede escanear y consultar. El máster puede todo.',
        ),
        el('div', { class: 'campo__error' }),
      ),
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'ficha-estado' }, 'Estado'),
        el(
          'select',
          { id: 'ficha-estado', name: 'status', disabled: esUnoMismo },
          el('option', { value: 'active', selected: user.status === 'active' }, 'Activo'),
          el('option', { value: 'suspended', selected: user.status === 'suspended' }, 'Suspendido'),
        ),
        el(
          'div',
          { class: 'campo__ayuda' },
          esUnoMismo ? 'No puedes suspender tu propia cuenta.' : 'Una cuenta suspendida no puede entrar ni usar sus entradas.',
        ),
        el('div', { class: 'campo__error' }),
      ),
    ),
    aviso,
    el('button', { class: 'boton boton--principal', type: 'submit' }, 'Guardar cambios'),
  );

  return el(
    'div',
    { class: 'columna' },
    seccion('Datos del cliente', formulario),
    seccion(
      'Ficha técnica',
      el(
        'div',
        { class: 'tabla-envoltura' },
        el(
          'table',
          {},
          el(
            'tbody',
            {},
            [
              ['Identificador', user.id],
              ['Alta en el sistema', `${fecha(user.createdAt)} (${relativo(user.createdAt)})`],
              ['Última modificación', `${fecha(user.updatedAt)} (${relativo(user.updatedAt)})`],
              ['Último acceso', user.lastLoginAt ? `${fecha(user.lastLoginAt)} (${relativo(user.lastLoginAt)})` : 'Nunca'],
              ['Packs comprados', String(estado.datos.stats.packsComprados)],
              ['Total gastado', dinero(estado.datos.stats.gastadoCents, estado.datos.currency)],
            ].map(([clave, valor]) =>
              el('tr', {}, el('th', { class: 'celda-clave' }, clave), el('td', { class: 'mono pequeno' }, valor)),
            ),
          ),
        ),
      ),
    ),
  );
}

async function alternarSuspension(user) {
  const suspender = user.status === 'active';
  const seguro = await confirmar({
    titulo: suspender ? `Suspender a ${user.fullName}` : `Reactivar a ${user.fullName}`,
    mensaje: suspender
      ? 'No podrá entrar ni usar sus entradas, y su sesión se cerrará en el acto. Sus packs se conservan.'
      : 'Volverá a tener acceso normal y podrá usar sus entradas.',
    textoAceptar: suspender ? 'Suspender' : 'Reactivar',
    peligro: suspender,
  });
  if (!seguro) return;
  try {
    await api.patch(`/api/admin/users/${user.id}`, { status: suspender ? 'suspended' : 'active' });
    brindis(suspender ? 'Cuenta suspendida.' : 'Cuenta reactivada.', 'ok');
    recargar();
  } catch (error) {
    brindis(error.message, 'error');
  }
}

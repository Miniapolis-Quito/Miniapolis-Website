/**
 * Panel del usuario máster: resumen, clientes, packs, consumos y auditoría.
 */
import { $, $$, el, render, icono, esqueleto, brindis, fecha, finDelDiaIso, horaCorta, relativo, dinero, plural, metrica, estadoPack, METODOS,
         mostrarAviso, mostrarErroresCampo, datosFormulario, conCarga, confirmar, pedirTexto, copiar } from './ui.js';
import { api, iniciarPagina, getUsuario, redirigirAlPerderSesion } from './api.js';
import { ConexionEnVivo } from './realtime.js';
import { montarCabecera, aplicarMarca } from './shell.js';
import { abrirFicha, cerrarFicha } from './ficha.js';
import { botonesDePack, anularConsumo } from './acciones.js';
import { cargarAvisos, montarAvisos } from './avisos.js';

const estado = {
  configuracion: null,
  panel: 'resumen',
  clienteSeleccionado: null,
  /** Desde qué pestaña se abrió la ficha, para volver a ella al cerrarla. */
  panelPrevio: null,
  mostrandoFicha: false,
};
let cabecera;
/** Lo asigna `montarDialogoPack`; evita colgar una función del objeto window. */
let abrirDialogoPack = () => {};

const ROLES = { customer: 'Cliente', staff: 'Personal', master: 'Máster' };

/**
 * Envuelve una acción de un botón para que un fallo se vea en pantalla.
 * Sin esto, una consulta que falla (sin señal, permisos revocados) dejaba el
 * panel exactamente igual, sin abrir nada y sin decir por qué.
 */
function alPulsar(accion) {
  return () => Promise.resolve(accion()).catch((error) => brindis(error.message, 'error'));
}

function temporizador(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

const CARGADORES = {
  resumen: cargarResumen,
  clientes: cargarUsuarios,
  packs: cargarPacks,
  consumos: cargarConsumos,
  avisos: cargarAvisos,
  auditoria: cargarAuditoria,
};

/**
 * Enrutado por fragmento de dirección.
 *
 * La ficha de un cliente es una vista propia, no un diálogo: así se puede
 * compartir el enlace, volver con el botón del navegador y recargar sin perderla.
 */
function rutaActual() {
  const coincide = /^#cliente\/([A-Za-z0-9-]+)$/.exec(window.location.hash);
  return coincide ? { vista: 'ficha', userId: coincide[1] } : { vista: 'paneles' };
}

function aplicarRuta() {
  const ruta = rutaActual();
  const ficha = $('#ficha-cliente');
  const pestanas = $('#pestanas-admin');
  const encabezado = $('#encabezado-admin');

  if (ruta.vista === 'ficha') {
    // Una ficha también se abre desde un enlace dentro de un panel (avisos,
    // entradas sin cobrar): al cerrarla se vuelve a ese panel.
    if (!estado.mostrandoFicha) {
      estado.panelPrevio = estado.panelPrevio || (estado.panel === 'resumen' ? 'clientes' : estado.panel);
    }
    estado.mostrandoFicha = true;
    encabezado.hidden = true;
    pestanas.hidden = true;
    for (const panel of $$('[id^="panel-"]')) panel.hidden = true;
    ficha.hidden = false;
    abrirFicha(ruta.userId, {
      contenedor: ficha,
      usuarioActual: getUsuario(),
      alVolver: () => {
        window.location.hash = '';
      },
      alCambiar: () => {
        // El listado de fondo puede haber quedado desactualizado.
        if (estado.panel === 'clientes') cargarUsuarios().catch(() => {});
        if (estado.panel === 'packs') cargarPacks().catch(() => {});
      },
      onVenderPack: (cliente) => abrirDialogoPack(cliente),
      onImprimirPase: (pack, propietario) => imprimirPase(pack, propietario),
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

  // Al cerrar la ficha se vuelve a la pestaña desde la que se abrió. Si se
  // llegó por enlace directo no hay historia, y clientes es lo más útil.
  const volviendoDeFicha = estado.mostrandoFicha;
  estado.mostrandoFicha = false;

  cerrarFicha();
  encabezado.hidden = false;
  ficha.hidden = true;
  render(ficha);
  pestanas.hidden = false;
  abrirPanel(volviendoDeFicha ? (estado.panelPrevio ?? 'clientes') : estado.panel);
}

function abrirPanel(nombre) {
  estado.panel = nombre;
  // Solo las pestañas principales: dentro de los paneles hay otras (los grupos
  // de avisos) que no son paneles.
  for (const pestana of $$('#pestanas-admin .pestana')) {
    pestana.setAttribute('aria-selected', String(pestana.dataset.panel === nombre));
  }
  for (const panel of $$('[id^="panel-"]')) {
    panel.hidden = panel.id !== `panel-${nombre}`;
  }
  // Si se cambia de pestaña desde el final de una lista larga, el panel nuevo
  // empezaría fuera de la pantalla. Se sube hasta las pestañas, nunca hacia
  // abajo: si ya se ven, no se mueve nada.
  const pestanas = $('#pestanas-admin');
  const desde = pestanas?.getBoundingClientRect().top ?? 0;
  if (desde < 0) window.scrollTo({ top: window.scrollY + desde - 16, behavior: 'smooth' });
  CARGADORES[nombre]?.().catch((error) => mostrarAviso($('#aviso'), error.message, 'error'));
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

/**
 * Un día del calendario ("2026-09-06") como instante, para poder darle formato.
 * Se toma el mediodía UTC a propósito: es la única hora que cae en ese mismo
 * día en cualquier zona horaria, así que la fecha mostrada nunca se corre.
 */
function mediodiaDe(dia) {
  return `${dia}T12:00:00Z`;
}


async function cargarResumen() {
  const datos = await api.get('/api/admin/dashboard');

  render(
    $('#metricas'),
    // Solo un número de la fila va en verde: el que manda. `--acento` y `--ok`
    // son dos verdes casi idénticos, así que pintarlos uno al lado del otro no
    // distinguía nada —parecía un descuido— y le quitaba fuerza al dato que sí
    // tiene que verse primero.
    metrica(String(datos.totals.pendingTickets), 'Entradas por usar', 'metrica--acento'),
    metrica(String(datos.redemptions.today), 'Entradas usadas hoy'),
    metrica(String(datos.totals.activePacks), 'Packs activos'),
    metrica(dinero(datos.totals.revenueCents, datos.totals.currency), 'Ingresos registrados'),
    metrica(String(datos.users.customers), 'Clientes'),
    metrica(String(datos.redemptions.week), 'Usadas esta semana'),
    metrica(String(datos.totals.issuedTickets), 'Entradas emitidas'),
    metrica(String(datos.users.staff), 'Personal de pista'),
  );

  // Gráfico de barras de los últimos 14 días. El calendario lo arma el
  // servidor, que es quien conoce la zona horaria de la pista: aquí solo se
  // dibuja lo que llega.
  const dias = datos.dailySeries;
  const maximo = Math.max(1, ...dias.map((d) => d.count));
  // Sin escala, una barra alta no dice nada: puede ser el día de 3 entradas o
  // el de 30. El máximo de la quincena va junto al título.
  $('#grafico-maximo').textContent = `Máx. ${plural(Math.max(...dias.map((d) => d.count)), 'entrada', 'entradas')}/día`;
  render(
    $('#grafico'),
    dias.map((d) =>
      el('div', {
        class: 'grafico__barra',
        style: `height:${Math.max(3, (d.count / maximo) * 100)}%`,
        title: `${fecha(mediodiaDe(d.date), { conHora: false })}: ${plural(d.count, 'entrada', 'entradas')}`,
      }),
    ),
  );
  $('#grafico-desde').textContent = fecha(mediodiaDe(dias[0].date), { conHora: false });

  // El verde de la etiqueta dice «hay alguien mirando». Con cero pantallas
  // conectadas no hay nada que celebrar: la etiqueta se queda neutra.
  const conexiones = $('#conexiones-vivas');
  conexiones.textContent = plural(datos.liveConnections, 'pantalla conectada', 'pantallas conectadas');
  conexiones.classList.toggle('etiqueta--info', datos.liveConnections > 0);

  const filaDeAcceso = (item) =>
    el(
      'li',
      { class: 'lista__item' },
      el('span', { class: 'icono-lista' }, icono(item.status === 'voided' ? 'devolver' : 'ok')),
      el(
        'div',
        { class: 'crece' },
        el('div', {}, item.customerName),
        el('div', { class: 'tenue-2 pequeno' }, `${horaCorta(item.createdAt)} · ${item.packCode} · ${item.scannerName || 'sistema'}`),
      ),
      item.quantity > 1 ? el('span', { class: 'etiqueta etiqueta--info' }, `${item.quantity} entradas`) : null,
      el('span', { class: 'etiqueta' }, `Quedan ${item.remainingAfter}`),
    );

  // La lista va en dos columnas dentro de un bloque ancho, y son dos listas de
  // verdad: partirla en dos es lo único que deja que cada columna empiece sin
  // línea encima sin depender de cuántos accesos haya devuelto el servidor.
  const mitad = Math.ceil(datos.recent.length / 2);
  render(
    $('#ultimos-consumos'),
    datos.recent.length === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Sin actividad todavía.'))
      : el(
          'div',
          { class: 'columnas-lista' },
          el('ul', { class: 'lista' }, datos.recent.slice(0, mitad).map(filaDeAcceso)),
          datos.recent.length > mitad
            ? el('ul', { class: 'lista' }, datos.recent.slice(mitad).map(filaDeAcceso))
            : null,
        ),
  );

  pintarIntegridad(datos.integrity);
  pintarNoCobradas(datos.offlineRejections);
  pintarSolicitudesRecarga(datos.pendingPackRequests);
}

/** Motivos de rechazo más frecuentes, dichos como los diría recepción. */
const MOTIVOS_NO_COBRADA = {
  pack_sin_entradas: 'El pack ya no tenía entradas',
  pack_expirado: 'El pack estaba vencido',
  pack_suspendido: 'El pack estaba suspendido',
  pack_cancelado: 'El pack estaba anulado',
  cliente_suspendido: 'La cuenta estaba suspendida',
  qr_expirado: 'Mostró un QR vencido',
  qr_ya_usado: 'El QR ya se había usado',
  qr_firma: 'El QR no era auténtico',
  espera_activa: 'Lectura repetida del mismo pack',
  pack_no_encontrado: 'El código no existe',
  lectura_vencida: 'Se envió demasiado tarde',
};

/**
 * Entradas que el escáner dejó pasar sin conexión y no se pudieron cobrar
 * después. Es dinero que se escapa: la tarjeta solo aparece si hay alguna, y
 * cada una se cierra con una nota que queda en la ficha del cliente.
 */
function pintarNoCobradas(lecturas) {
  const tarjeta = $('#tarjeta-no-cobradas');
  tarjeta.hidden = !lecturas?.count;
  if (tarjeta.hidden) return;

  $('#contador-no-cobradas').textContent = plural(lecturas.count, 'pendiente', 'pendientes');
  render(
    $('#lista-no-cobradas'),
    el(
      'ul',
      { class: 'lista' },
      lecturas.items.map((lectura) =>
        el(
          'li',
          { class: 'lista__item' },
          el('span', { class: 'icono-lista' }, icono('prohibido')),
          el(
            'div',
            { class: 'crece' },
            lectura.customerId
              ? el('a', { href: `#cliente/${lectura.customerId}` }, lectura.customerName || 'Cliente')
              : el('div', {}, 'Cliente desconocido'),
            el(
              'div',
              { class: 'tenue-2 pequeno' },
              [fecha(lectura.capturedAt), lectura.packCode, lectura.scannerName, lectura.deviceLabel].filter(Boolean).join(' · '),
            ),
            el('div', { class: 'pequeno' }, MOTIVOS_NO_COBRADA[lectura.reason] || lectura.message),
          ),
          el(
            'button',
            {
              class: 'boton boton--chico boton--fantasma',
              type: 'button',
              onClick: alPulsar(() => resolverNoCobrada(lectura)),
            },
            'Marcar resuelta',
          ),
        ),
      ),
    ),
    lecturas.count > lecturas.items.length
      ? el('p', { class: 'tenue-2 pequeno mt' }, `Se muestran las ${lecturas.items.length} más recientes.`)
      : null,
  );
}

async function resolverNoCobrada(lectura) {
  const nota = await pedirTexto({
    titulo: 'Marcar como resuelta',
    mensaje: `${lectura.customerName || 'Cliente desconocido'} · ${lectura.packCode || 'sin código'}. Explica qué se hizo: queda en su ficha.`,
    etiqueta: 'Cómo se resolvió',
    textoAceptar: 'Marcar resuelta',
  });
  if (!nota) return;
  await api.post(`/api/admin/offline-rejections/${encodeURIComponent(lectura.id)}/resolve`, { note: nota });
  brindis('Entrada marcada como resuelta.', 'ok');
  await cargarResumen();
}

const METODOS_PAGO = {
  transfer: 'Transferencia bancaria',
  deuna: 'DeUna',
  cash: 'Efectivo',
};

let solicitudARechazar = null;

function pintarSolicitudesRecarga(solicitudes) {
  const tarjeta = $('#tarjeta-solicitudes-recarga');
  tarjeta.hidden = !solicitudes?.count;
  if (tarjeta.hidden) return;

  $('#contador-solicitudes-recarga').textContent = plural(solicitudes.count, 'pendiente', 'pendientes');
  render(
    $('#lista-solicitudes-recarga'),
    el(
      'ul',
      { class: 'lista' },
      solicitudes.items.map((req) => {
        let waUrl = null;
        if (req.customerPhone) {
          const limpio = req.customerPhone.replace(/\D/g, '');
          const telIntl = limpio.startsWith('0') ? `593${limpio.slice(1)}` : limpio;
          if (telIntl.length >= 8) {
            waUrl = `https://wa.me/${telIntl}?text=${encodeURIComponent(`Hola ${req.customerName || ''}, te escribimos de Miniápolis sobre tu solicitud de pack de ${req.tickets} entradas (${req.paymentReference || ''}).`)}`;
          }
        }

        return el(
          'li',
          { class: 'lista__item' },
          el('span', { class: 'icono-lista' }, icono('pack')),
          el(
            'div',
            { class: 'crece' },
            el(
              'div',
              { class: 'fila' },
              req.userId
                ? el('a', { href: `#cliente/${req.userId}` }, req.customerName || 'Cliente')
                : el('strong', {}, req.customerName || 'Cliente'),
              el('span', { class: 'etiqueta etiqueta--info' }, `${req.tickets} entradas`),
              el('span', { class: 'etiqueta' }, dinero(req.priceCents, req.currency)),
            ),
            el(
              'div',
              { class: 'tenue-2 pequeno' },
              [
                METODOS_PAGO[req.paymentMethod] || req.paymentMethod,
                req.paymentReference ? `Ref: ${req.paymentReference}` : 'Sin comprobante',
                relativo(req.createdAt),
              ].filter(Boolean).join(' · '),
            ),
            req.customerNotes
              ? el('div', { class: 'pequeno mt tenue' }, `Nota: «${req.customerNotes}»`)
              : null,
          ),
          el(
            'div',
            { class: 'fila' },
            waUrl
              ? el(
                  'a',
                  {
                    class: 'boton boton--chico boton--fantasma',
                    href: waUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    title: 'Contactar por WhatsApp',
                  },
                  icono('chat'),
                  'WhatsApp',
                )
              : null,
            el(
              'button',
              {
                class: 'boton boton--chico boton--fantasma',
                type: 'button',
                onClick: alPulsar(() => abrirRechazoSolicitud(req)),
              },
              'Rechazar',
            ),
            el(
              'button',
              {
                class: 'boton boton--chico boton--primario',
                type: 'button',
                onClick: alPulsar(() => aprobarSolicitud(req)),
              },
              icono('ok'),
              'Aprobar',
            ),
          ),
        );
      }),
    ),
    solicitudes.count > solicitudes.items.length
      ? el('p', { class: 'tenue-2 pequeno mt' }, `Se muestran las ${solicitudes.items.length} solicitudes más recientes.`)
      : null,
  );
}

async function aprobarSolicitud(req) {
  const confirmado = await confirmar({
    titulo: 'Aprobar pago y emitir pack',
    mensaje: `¿Confirmas que recibiste el pago de ${dinero(req.priceCents, req.currency)} (${req.paymentReference || 'sin comprobante'}) de ${req.customerName || 'el cliente'}? Se emitirá inmediatamente el pack de ${req.tickets} entradas.`,
    textoAceptar: 'Sí, aprobar y emitir pack',
  });
  if (!confirmado) return;

  await api.post(`/api/admin/pack-requests/${encodeURIComponent(req.id)}/approve`);
  brindis(`Pack de ${req.tickets} entradas emitido exitosamente para ${req.customerName || 'el cliente'}.`, 'ok');
  await cargarResumen();
}

function abrirRechazoSolicitud(req) {
  solicitudARechazar = req;
  const dialogo = $('#dialogo-rechazar-solicitud');
  const form = $('#form-rechazar-solicitud');
  form.reset();
  mostrarErroresCampo(form, {});
  mostrarAviso($('#aviso-rechazar-solicitud'), null);

  $('#rechazar-solicitud-subtitulo').textContent =
    `Cliente: ${req.customerName || 'Cliente'} · ${req.tickets} entradas (${dinero(req.priceCents, req.currency)}) · Ref: ${req.paymentReference || 'Sin comprobante'}`;

  dialogo.showModal();
  $('#rechazar-solicitud-motivo').focus();
}

function montarDialogoRechazo() {
  const dialogo = $('#dialogo-rechazar-solicitud');
  const form = $('#form-rechazar-solicitud');
  const motivoInput = $('#rechazar-solicitud-motivo');

  $('#btn-cerrar-rechazar-solicitud').addEventListener('click', () => {
    dialogo.close();
  });

  $('#btn-motivo-no-recibida').addEventListener('click', () => {
    motivoInput.value = 'Transferencia no reflejada en la cuenta bancaria.';
    motivoInput.focus();
  });

  $('#btn-motivo-ilegible').addEventListener('click', () => {
    motivoInput.value = 'Comprobante o número de referencia ilegible/inválido.';
    motivoInput.focus();
  });

  $('#btn-motivo-monto').addEventListener('click', () => {
    motivoInput.value = 'El monto transferido no coincide con el valor del pack.';
    motivoInput.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!solicitudARechazar) return;

    const motivo = motivoInput.value.trim();
    if (!motivo) {
      mostrarErroresCampo(form, { reason: 'Indica el motivo del rechazo.' });
      return;
    }

    try {
      await conCarga(form.querySelector('button[type="submit"]'), async () => {
        await api.post(`/api/admin/pack-requests/${encodeURIComponent(solicitudARechazar.id)}/reject`, {
          adminNotes: motivo,
        });
      });
      dialogo.close();
      brindis('Solicitud rechazada.', 'aviso');
      await cargarResumen();
    } catch (err) {
      mostrarAviso($('#aviso-rechazar-solicitud'), err.message, 'error');
    }
  });
}

function pintarIntegridad(integridad) {
  render(
    $('#integridad'),
    integridad.ok
      ? el(
          'div',
          { class: 'aviso aviso--ok' },
          icono('ok'),
          'Contabilidad correcta: el saldo de todos los packs coincide con su historial de movimientos.',
        )
      : el(
          'div',
          { class: 'aviso aviso--error' },
          icono('aviso'),
          el(
            'div',
            {},
            el('strong', {}, 'Se detectaron diferencias contables.'),
            el(
              'div',
              { class: 'pequeno' },
              `${integridad.mismatches.length} pack(s) con saldo distinto al de su historial. ` +
                'Revisa la bitácora de auditoría y avisa al soporte técnico.',
            ),
            el('div', { class: 'mono pequeno mt' }, integridad.mismatches.map((m) => m.code).join(', ')),
          ),
        ),
  );
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

/**
 * Espera con forma mientras llega la primera respuesta. Solo la primera: en un
 * refresco por un evento en vivo, cambiar la tabla por barras grises sería un
 * parpadeo constante mientras se trabaja.
 */
function mostrarEspera(selector, filas = 5) {
  const contenedor = $(selector);
  if (contenedor && contenedor.children.length === 0) render(contenedor, esqueleto(filas));
}

async function cargarUsuarios() {
  mostrarEspera('#tabla-usuarios');
  const parametros = new URLSearchParams({ limit: '100' });
  const busqueda = $('#buscar-usuarios').value.trim();
  if (busqueda) parametros.set('search', busqueda);
  if ($('#filtro-rol').value) parametros.set('role', $('#filtro-rol').value);
  if ($('#filtro-estado').value) parametros.set('status', $('#filtro-estado').value);

  const { items, total } = await api.get(`/api/admin/users?${parametros}`);

  if (items.length === 0) {
    render($('#tabla-usuarios'), el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Ningún usuario coincide con la búsqueda.')));
    return;
  }

  render(
    $('#tabla-usuarios'),
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
            el('th', {}, 'Nombre'),
            el('th', {}, 'Contacto'),
            el('th', {}, 'Rol'),
            el('th', { class: 'num' }, 'Entradas'),
            el('th', {}, 'Estado'),
            el('th', {}, 'Acciones'),
          ),
        ),
        el(
          'tbody',
          {},
          items.map((usuario) =>
            el(
              'tr',
              {},
              el(
                'td',
                {},
                el('div', {}, usuario.fullName),
                el('div', { class: 'tenue-2 pequeno' }, `Alta ${fecha(usuario.createdAt, { conHora: false })}`),
              ),
              el(
                'td',
                {},
                el('div', { class: 'pequeno' }, usuario.email),
                usuario.phone ? el('div', { class: 'tenue-2 pequeno' }, usuario.phone) : null,
              ),
              el(
                'td',
                {},
                el('span', { class: 'etiqueta' }, ROLES[usuario.role] || usuario.role),
                usuario.scanEnabled
                  ? el('div', { class: 'mt-mini' }, el('span', { class: 'etiqueta etiqueta--ok' }, 'Escáner'))
                  : null,
              ),
              el(
                'td',
                { class: 'num' },
                el('strong', { class: usuario.availableTickets ? 'resalte' : '' }, String(usuario.availableTickets)),
                el('div', { class: 'tenue-2 pequeno' }, plural(usuario.activePacks, 'pack', 'packs')),
              ),
              el(
                'td',
                {},
                el(
                  'span',
                  { class: `etiqueta etiqueta--${usuario.status === 'active' ? 'ok' : 'error'}` },
                  usuario.status === 'active' ? 'Activo' : 'Suspendido',
                ),
                usuario.locked ? el('div', {}, el('span', { class: 'etiqueta etiqueta--alerta' }, 'Bloqueado')) : null,
              ),
              el(
                'td',
                {},
                el(
                  'div',
                  { class: 'fila' },
                  el('button', { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: () => verUsuario(usuario.id) }, 'Abrir ficha'),
                  el(
                    'button',
                    { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: alPulsar(() => abrirDialogoPack(usuario)) },
                    'Vender',
                  ),
                  // Conceder o retirar el escáner, solo donde el permiso puede existir.
                  usuario.role === 'customer'
                    ? null
                    : el(
                        'button',
                        {
                          class: `boton boton--chico ${usuario.scanEnabled ? 'boton--peligro' : 'boton--fantasma'}`,
                          type: 'button',
                          onClick: alPulsar(() => cambiarPermisoDeEscaneo(usuario)),
                        },
                        usuario.scanEnabled ? 'Quitar escáner' : 'Dar escáner',
                      ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    el('p', { class: 'tenue-2 pequeno mt' }, `${total} usuario(s) en total.`),
  );
}

/**
 * Concede o retira el permiso para escanear en la puerta.
 *
 * Retirarlo cierra las sesiones de esa cuenta: si el teléfono se quedó abierto
 * en el escáner, deja de servir en el acto y no al caducar el token.
 */
async function cambiarPermisoDeEscaneo(usuario) {
  const quitar = Boolean(usuario.scanEnabled);
  const propio = usuario.id === getUsuario()?.id;

  const confirmado = await confirmar({
    titulo: quitar ? 'Quitar el escáner' : 'Autorizar el escáner',
    mensaje: quitar
      ? `${usuario.fullName} dejará de poder descontar entradas y se cerrará su sesión.` +
        (propio ? ' Es tu propia cuenta: tendrás que volver a entrar y autorizarte otra vez.' : '')
      : `${usuario.fullName} podrá descontar entradas a cualquier cliente desde la puerta.`,
    textoAceptar: quitar ? 'Quitar permiso' : 'Autorizar',
    peligro: quitar,
  });
  if (!confirmado) return;

  await api.patch(`/api/admin/users/${usuario.id}`, { scanEnabled: !quitar });
  brindis(quitar ? `${usuario.fullName} ya no puede escanear.` : `${usuario.fullName} ya puede escanear.`, 'ok');
  await cargarUsuarios();
}

/** Abre la ficha de un cliente cambiando la dirección, que dispara el enrutado. */
function verUsuario(userId) {
  estado.panelPrevio = estado.panel;
  window.location.hash = `#cliente/${userId}`;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

async function cargarPacks() {
  mostrarEspera('#tabla-packs');
  const parametros = new URLSearchParams({ limit: '100' });
  const busqueda = $('#buscar-packs').value.trim();
  if (busqueda) parametros.set('search', busqueda);
  if ($('#filtro-pack-estado').value) parametros.set('status', $('#filtro-pack-estado').value);

  const { items, total } = await api.get(`/api/admin/packs?${parametros}`);

  if (items.length === 0) {
    render($('#tabla-packs'), el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Ningún pack coincide con la búsqueda.')));
    return;
  }

  render(
    $('#tabla-packs'),
    el(
      'div',
      { class: 'tabla-envoltura' },
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el('tr', {},
            el('th', {}, 'Código'),
            el('th', {}, 'Cliente'),
            el('th', { class: 'num' }, 'Restantes'),
            el('th', {}, 'Estado'),
            el('th', {}, 'Emitido'),
            el('th', {}, ''),
          ),
        ),
        el(
          'tbody',
          {},
          items.map((pack) => {
            const marca = estadoPack(pack);
            return el(
              'tr',
              {},
              el('td', { class: 'mono' }, pack.code),
              el('td', {}, el('div', {}, pack.ownerName), el('div', { class: 'tenue-2 pequeno' }, pack.ownerEmail)),
              el('td', { class: 'num' }, el('strong', {}, String(pack.remaining)), ` / ${pack.size}`),
              el('td', {}, el('span', { class: `etiqueta etiqueta--${marca.clase}` }, marca.texto)),
              el('td', { class: 'pequeno tenue' }, fecha(pack.createdAt, { conHora: false })),
              el('td', {}, el('button', { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: alPulsar(() => verPack(pack.id)) }, 'Abrir')),
            );
          }),
        ),
      ),
    ),
    el('p', { class: 'tenue-2 pequeno mt' }, `${total} pack(s) en total.`),
  );
}

async function verPack(packId) {
  const datos = await api.get(`/api/admin/packs/${packId}`);
  const pack = datos.pack;
  const marca = estadoPack(pack);

  async function recargar() {
    await verPack(packId);
    cargarPacks().catch(() => {});
  }

  render(
    $('#detalle-cuerpo'),
    el(
      'div',
      { class: 'fila fila--entre' },
      el('h2', { class: 'sin-margen mono' }, pack.code),
      el('span', { class: `etiqueta etiqueta--${marca.clase}` }, marca.texto),
    ),
    el('p', { class: 'tenue sin-margen' }, `${datos.owner.fullName} · ${datos.owner.email}`),
    el(
      'div',
      { class: 'rejilla rejilla--3 mt' },
      metrica(String(pack.remaining), 'Restantes', 'metrica--acento'),
      metrica(String(pack.used), 'Usadas'),
      metrica(dinero(pack.priceCents, pack.currency), 'Precio'),
    ),
    el(
      'div',
      { class: 'fila mt' },
      botonesDePack(pack, { alCambiar: recargar, alImprimir: (p) => imprimirPase(p, datos.owner) }),
    ),
    pack.expiresAt ? el('p', { class: 'tenue pequeno mt' }, `Vence el ${fecha(pack.expiresAt, { conHora: false })}`) : null,
    pack.note ? el('p', { class: 'tenue pequeno' }, `Nota: ${pack.note}`) : null,

    el('h3', { class: 'mt-2' }, 'Movimientos'),
    el(
      'ul',
      { class: 'lista' },
      datos.movements.map((movimiento) =>
        el(
          'li',
          { class: 'lista__item' },
          el(
            'span',
            { class: `etiqueta etiqueta--${movimiento.delta > 0 ? 'ok' : 'error'}` },
            `${movimiento.delta > 0 ? '+' : ''}${movimiento.delta}`,
          ),
          el(
            'div',
            { class: 'crece' },
            el('div', { class: 'pequeno' }, {
              issue: 'Emisión del pack',
              redeem: 'Entrada consumida',
              void: 'Consumo anulado',
              adjust: 'Ajuste manual',
              cancel: 'Anulación',
              restore: 'Restauración',
            }[movimiento.reason] || movimiento.reason),
            el('div', { class: 'tenue-2 pequeno' }, `${fecha(movimiento.createdAt)}${movimiento.actorName ? ` · ${movimiento.actorName}` : ''}`),
            movimiento.note ? el('div', { class: 'tenue-2 pequeno' }, movimiento.note) : null,
          ),
          el('span', { class: 'tenue pequeno' }, `Saldo ${movimiento.balanceAfter}`),
        ),
      ),
    ),

    el('h3', { class: 'mt-2' }, 'Consumos'),
    datos.redemptions.length === 0
      ? el('p', { class: 'tenue pequeno' }, 'Sin consumos.')
      : el('ul', { class: 'lista' }, datos.redemptions.map((item) => filaConsumo(item, recargar))),
  );
  $('#dialogo-detalle').showModal();
}

/**
 * Prepara el pase físico de un pack y abre el diálogo de impresión.
 *
 * Solo tiene sentido con el QR impreso habilitado: ese código no caduca, que es
 * justo lo que necesita un cartón entregado en mano (y lo que lo hace copiable,
 * por eso viene desactivado de fábrica).
 */
async function imprimirPase(pack, propietario) {
  const zona = $('#pase-impreso');
  try {
    const svg = await api.get(`/api/packs/${pack.id}/qr.svg?mode=static`);
    render(
      zona,
      el(
        'div',
        { class: 'pase' },
        el(
          'header',
          { class: 'pase__cabecera' },
          el(
            'div',
            { class: 'pase__marca' },
            el('img', {
              class: 'pase__logo',
              src: '/images/miniapolis-logo-oficial.webp',
              width: '1000',
              height: '425',
              alt: 'Miniápolis #3',
            }),
          ),
          el('div', { class: 'pase__titulo' }, `Pase de ${pack.size} entradas`),
        ),
        el('div', { class: 'pase__qr', html: svg }),
        el('div', { class: 'pase__codigo' }, pack.code),
        el('div', { class: 'pase__cliente' }, propietario?.fullName || ''),
        el(
          'div',
          { class: 'pase__pie' },
          pack.expiresAt
            ? `Válido hasta el ${fecha(pack.expiresAt, { conHora: false })}`
            : 'Sin fecha de vencimiento',
        ),
      ),
    );
    zona.hidden = false;

    document.body.classList.add('imprimiendo-pase');

    // La limpieza se hace al terminar de imprimir, no justo después de llamar a
    // `print()`: en los navegadores móviles esa llamada vuelve enseguida y el
    // diálogo aparece más tarde, así que borrar el pase de inmediato imprimiría
    // una hoja en blanco. El temporizador es el plan B por si el navegador no
    // avisa del final.
    let limpiado = false;
    const limpiar = () => {
      if (limpiado) return;
      limpiado = true;
      clearTimeout(respaldo);
      window.removeEventListener('afterprint', limpiar);
      document.body.classList.remove('imprimiendo-pase');
      zona.hidden = true;
      render(zona);
    };
    const respaldo = setTimeout(limpiar, 120_000);
    window.addEventListener('afterprint', limpiar, { once: true });

    // Un par de cuadros para que el navegador pinte el pase antes de imprimir.
    await new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo)));
    window.print();
  } catch (error) {
    document.body.classList.remove('imprimiendo-pase');
    zona.hidden = true;
    render(zona);
    brindis(error.message, 'error');
  }
}

function filaConsumo(item, alCambiar) {
  return el(
    'li',
    { class: 'lista__item' },
    el('span', { class: 'icono-lista' }, icono(item.status === 'voided' ? 'devolver' : 'ok')),
    el(
      'div',
      { class: 'crece' },
      el('div', { class: 'pequeno' }, `${fecha(item.createdAt)} · ${METODOS[item.method] || item.method}`),
      el(
        'div',
        { class: 'tenue-2 pequeno' },
        `${item.scannerName || 'sistema'}${item.deviceLabel ? ` · ${item.deviceLabel}` : ''}`,
      ),
      item.voidReason ? el('div', { class: 'tenue-2 pequeno' }, `Anulado: ${item.voidReason}`) : null,
    ),
    item.status === 'confirmed'
      ? el(
          'button',
          {
            class: 'boton boton--chico boton--peligro',
            type: 'button',
            onClick: () => anularConsumo(item, alCambiar),
          },
          'Anular',
        )
      : el('span', { class: 'etiqueta etiqueta--error' }, 'Anulado'),
  );
}

// ---------------------------------------------------------------------------
// Consumos y auditoría
// ---------------------------------------------------------------------------

async function cargarConsumos() {
  mostrarEspera('#tabla-consumos');
  const { items, total } = await api.get('/api/admin/redemptions?limit=100');
  render(
    $('#tabla-consumos'),
    items.length === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Sin consumos registrados.'))
      : el('ul', { class: 'lista' }, items.map((item) =>
          el(
            'li',
            { class: 'lista__item' },
            el('span', { class: 'icono-lista' }, icono(item.status === 'voided' ? 'devolver' : 'ok')),
            el(
              'div',
              { class: 'crece' },
              el('div', {}, item.customerName),
              el(
                'div',
                { class: 'tenue-2 pequeno' },
                `${fecha(item.createdAt)} · ${item.packCode} · ${METODOS[item.method] || item.method} · ${item.scannerName || 'sistema'}`,
              ),
              item.syncedAt
                ? el('div', { class: 'tenue-2 pequeno' }, `Leída sin conexión; cobrada el ${fecha(item.syncedAt)}`)
                : null,
              item.voidReason ? el('div', { class: 'tenue-2 pequeno' }, `Anulado: ${item.voidReason}`) : null,
            ),
            item.quantity > 1 ? el('span', { class: 'etiqueta etiqueta--info' }, `${item.quantity} entradas`) : null,
            el('span', { class: 'etiqueta' }, `Quedaban ${item.remainingAfter}`),
            item.status === 'confirmed'
              ? el(
                  'button',
                  {
                    class: 'boton boton--chico boton--peligro',
                    type: 'button',
                    onClick: () => anularConsumo(item, cargarConsumos),
                  },
                  'Anular',
                )
              : null,
          ),
        )),
    el('p', { class: 'tenue-2 pequeno mt' }, `${total} consumo(s) registrados.`),
  );
}

async function cargarAuditoria() {
  mostrarEspera('#tabla-auditoria', 6);
  const { items, total } = await api.get('/api/admin/audit?limit=100');
  render(
    $('#tabla-auditoria'),
    items.length === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Sin registros todavía.'))
      : el(
          'div',
          { class: 'tabla-envoltura' },
          el(
            'table',
            {},
            el('thead', {}, el('tr', {}, el('th', {}, 'Cuándo'), el('th', {}, 'Acción'), el('th', {}, 'Quién'), el('th', {}, 'Detalle'))),
            el(
              'tbody',
              {},
              items.map((registro) =>
                el(
                  'tr',
                  {},
                  el('td', { class: 'pequeno tenue', title: fecha(registro.createdAt) }, relativo(registro.createdAt)),
                  el('td', {}, el('span', { class: 'etiqueta' }, registro.action)),
                  el(
                    'td',
                    { class: 'pequeno' },
                    registro.actorName || registro.actorEmail || 'sistema',
                    el('div', { class: 'tenue-2 pequeno' }, registro.ip || ''),
                  ),
                  el(
                    'td',
                    { class: 'pequeno tenue-2 mono' },
                    registro.metadata ? JSON.stringify(registro.metadata).slice(0, 160) : '',
                  ),
                ),
              ),
            ),
          ),
        ),
    el('p', { class: 'tenue-2 pequeno mt' }, `${total} registro(s).`),
  );
}

// ---------------------------------------------------------------------------
// Exportación de reportes
// ---------------------------------------------------------------------------

/**
 * Descarga un reporte CSV.
 *
 * No puede ser un enlace: la API se autentica con la cabecera `Authorization`
 * y el token vive solo en memoria, así que una navegación normal llegaría sin
 * sesión y devolvería un 401 en vez del archivo. Se pide con `fetch` y se
 * entrega al navegador como archivo local.
 */
async function descargarReporte(entidad) {
  const archivo = await api.get(`/api/admin/export/${entidad}.csv`, { comoBlob: true });
  const nombre = `${entidad}-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(archivo);
  const enlace = el('a', { href: url, download: nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // La URL temporal se libera después: revocarla en el mismo instante deja la
  // descarga a medias en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return nombre;
}

// ---------------------------------------------------------------------------
// Diálogos de alta
// ---------------------------------------------------------------------------

function montarDialogoUsuario() {
  const dialogo = $('#dialogo-usuario');
  const formulario = $('#form-usuario');

  const selectorRol = $('#usuario-rol');
  const casillaEscaner = $('#usuario-escaner');

  // La casilla solo tiene sentido para quien está detrás del mostrador; al
  // volver a "Cliente" se desmarca, para no crear a nadie con un permiso que
  // el servidor rechazaría de todos modos.
  function ajustarCasillaEscaner() {
    const esPersonal = selectorRol.value === 'staff' || selectorRol.value === 'master';
    $('#campo-escaner').hidden = !esPersonal;
    if (!esPersonal) casillaEscaner.checked = false;
  }
  selectorRol.addEventListener('change', ajustarCasillaEscaner);

  $('#btn-nuevo-usuario').addEventListener('click', () => {
    formulario.reset();
    casillaEscaner.checked = false;
    ajustarCasillaEscaner();
    mostrarErroresCampo(formulario, {});
    mostrarAviso($('#aviso-usuario'), '');
    dialogo.showModal();
    // Quien abre este diálogo viene a escribir un nombre: el cursor ya está ahí.
    $('#usuario-nombre').focus();
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErroresCampo(formulario, {});
    const datos = datosFormulario(formulario);
    if (!datos.phone) delete datos.phone;
    if (!datos.password) delete datos.password;
    // Una casilla sin marcar no aparece en el formulario, así que el permiso
    // se lee del elemento y viaja siempre como booleano explícito.
    datos.scanEnabled = casillaEscaner.checked;

    await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
      try {
        const respuesta = await api.post('/api/admin/users', datos);
        dialogo.close();
        await cargarUsuarios();
        if (respuesta.temporaryPassword) {
          await copiar(respuesta.temporaryPassword);
          await confirmar({
            titulo: 'Usuario creado',
            mensaje:
              `Contraseña temporal de ${respuesta.user.fullName} (copiada al portapapeles): ` +
              `${respuesta.temporaryPassword}. Entrégasela y pídele que la cambie al entrar.`,
            textoAceptar: 'Entendido',
          });
        } else {
          brindis(`${respuesta.user.fullName} creado.`, 'ok');
        }
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso($('#aviso-usuario'), error.message, 'error');
      }
    });
  });
}

function montarDialogoPack() {
  const dialogo = $('#dialogo-pack');
  const formulario = $('#form-pack');
  const buscador = $('#pack-cliente');
  const resultados = $('#resultados-cliente');

  function precioDeLista(size) {
    return estado.configuracion?.packCatalog?.find((p) => p.size === Number(size))?.priceCents ?? 0;
  }

  function pintarCatalogo() {
    render(
      $('#pack-size'),
      (estado.configuracion?.packCatalog ?? []).map((entrada) =>
        el('option', { value: String(entrada.size) }, `${entrada.label} — ${dinero(entrada.priceCents)}`),
      ),
    );
    $('#pack-precio').value = (precioDeLista($('#pack-size').value) / 100).toFixed(2);
  }

  $('#pack-size').addEventListener('change', (evento) => {
    $('#pack-precio').value = (precioDeLista(evento.target.value) / 100).toFixed(2);
  });

  function seleccionarCliente(cliente) {
    estado.clienteSeleccionado = cliente;
    $('#pack-user-id').value = cliente.id;
    buscador.value = `${cliente.fullName} (${cliente.email})`;
    render(resultados);
  }

  const buscar = temporizador(async () => {
    const termino = buscador.value.trim();
    if (termino.length < 2 || estado.clienteSeleccionado?.fullName === termino) {
      render(resultados);
      return;
    }
    try {
      const { items } = await api.get(`/api/admin/users?limit=8&search=${encodeURIComponent(termino)}`);
      render(
        resultados,
        items.length === 0
          ? el('div', { class: 'tenue pequeno' }, 'Sin coincidencias. Crea el usuario primero.')
          : items.map((cliente) =>
              el(
                'button',
                { class: 'lista__item opcion-lista', type: 'button', onClick: () => seleccionarCliente(cliente) },
                el(
                  'div',
                  { class: 'crece' },
                  el('div', {}, cliente.fullName),
                  el('div', { class: 'tenue-2 pequeno' }, `${cliente.email} · ${plural(cliente.availableTickets, 'entrada', 'entradas')}`),
                ),
                el('span', { class: 'etiqueta' }, ROLES[cliente.role] || cliente.role),
              ),
            ),
      );
    } catch {
      render(resultados);
    }
  }, 250);

  buscador.addEventListener('input', () => {
    estado.clienteSeleccionado = null;
    $('#pack-user-id').value = '';
    buscar();
  });

  $('#btn-nuevo-pack').addEventListener('click', () => abrirDialogoPack(null));

  abrirDialogoPack = (cliente) => {
    formulario.reset();
    mostrarErroresCampo(formulario, {});
    mostrarAviso($('#aviso-pack'), '');
    render(resultados);
    pintarCatalogo();
    estado.clienteSeleccionado = null;
    $('#pack-user-id').value = '';
    buscador.value = '';
    if (cliente) seleccionarCliente(cliente);
    $('#dialogo-detalle').close();
    dialogo.showModal();
    // Con cliente ya elegido lo siguiente es el precio; si no, hay que buscarlo.
    (cliente ? $('#pack-precio') : buscador).focus();
  };

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErroresCampo(formulario, {});

    const userId = $('#pack-user-id').value;
    if (!userId) {
      mostrarAviso($('#aviso-pack'), 'Selecciona primero un cliente de la lista.', 'error');
      return;
    }

    const precioTexto = $('#pack-precio').value;
    const cuerpo = {
      userId,
      size: Number($('#pack-size').value),
      priceCents: precioTexto === '' ? undefined : Math.round(Number(precioTexto) * 100),
      paymentMethod: $('#pack-pago').value,
      paymentReference: $('#pack-referencia').value.trim() || undefined,
      note: $('#pack-nota').value.trim() || undefined,
      allowStaticQr: $('#pack-estatico').checked,
    };
    const vence = $('#pack-vence').value;
    if (vence) {
      // La fecha elegida vale hasta el final de ese día.
      // Vale hasta el final de ese día en la pista.
      cuerpo.expiresAt = finDelDiaIso(vence);
    }
    for (const clave of Object.keys(cuerpo)) if (cuerpo[clave] === undefined) delete cuerpo[clave];

    await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
      try {
        const respuesta = await api.post('/api/admin/packs', cuerpo);
        dialogo.close();
        brindis(`Pack ${respuesta.pack.code} emitido con ${respuesta.pack.size} entradas.`, 'ok', 6000);
        await Promise.all([cargarUsuarios().catch(() => {}), cargarPacks().catch(() => {})]);
        verPack(respuesta.pack.id);
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso($('#aviso-pack'), error.message, 'error');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

(async () => {
  const sesion = await iniciarPagina({ rolesPermitidos: ['master'] });
  if (!sesion) return;

  cabecera = montarCabecera($('#cabecera'));
  try {
    estado.configuracion = await fetch('/api/config').then((r) => r.json());
    aplicarMarca(estado.configuracion);
  } catch {
    /* opcional */
  }

  for (const pestana of $$('#pestanas-admin .pestana')) {
    pestana.addEventListener('click', () => abrirPanel(pestana.dataset.panel));
  }
  for (const boton of $$('[data-cerrar]')) {
    boton.addEventListener('click', () => boton.closest('dialog')?.close());
  }

  montarDialogoUsuario();
  montarDialogoPack();
  montarAvisos();
  montarDialogoRechazo();

  const buscarUsuarios = temporizador(() => cargarUsuarios().catch(() => {}), 280);
  $('#buscar-usuarios').addEventListener('input', buscarUsuarios);
  $('#filtro-rol').addEventListener('change', () => cargarUsuarios());
  $('#filtro-estado').addEventListener('change', () => cargarUsuarios());

  const buscarPacks = temporizador(() => cargarPacks().catch(() => {}), 280);
  $('#buscar-packs').addEventListener('input', buscarPacks);
  $('#filtro-pack-estado').addEventListener('change', () => cargarPacks());

  for (const boton of $$('[data-exportar]')) {
    boton.addEventListener('click', () =>
      conCarga(boton, async () => {
        try {
          const nombre = await descargarReporte(boton.dataset.exportar);
          brindis(`Reporte ${nombre} descargado.`, 'ok');
        } catch (error) {
          brindis(`No se pudo exportar: ${error.message}`, 'error');
        }
      }),
    );
  }

  $('#btn-recargar-consumos').addEventListener('click', () => cargarConsumos());
  $('#btn-recargar-auditoria').addEventListener('click', () => cargarAuditoria());
  $('#btn-verificar').addEventListener(
    'click',
    alPulsar(async () => {
      const integridad = await api.get('/api/admin/integrity');
      pintarIntegridad(integridad);
      brindis(integridad.ok ? 'Contabilidad verificada: todo cuadra.' : 'Se encontraron diferencias.', integridad.ok ? 'ok' : 'error');
    }),
  );

  window.addEventListener('hashchange', aplicarRuta);
  aplicarRuta();

  const refrescarPanelActual = temporizador(() => {
    // Con la ficha abierta manda ella: se refresca sola con sus propios eventos.
    if (rutaActual().vista === 'ficha') return;
    CARGADORES[estado.panel]?.().catch(() => {});
  }, 600);

  redirigirAlPerderSesion();

  new ConexionEnVivo({
    onEstado: (nuevo) => cabecera.actualizarEstado(nuevo),
    onEvento: (tipo) => {
      if (tipo === 'conectado') return;
      // Cualquier cambio relevante refresca la vista abierta, sin encadenar
      // recargas si llegan varios eventos seguidos.
      refrescarPanelActual();
    },
  }).iniciar();
})();

/**
 * Panel del usuario máster: resumen, clientes, packs, consumos y auditoría.
 */
import { $, $$, el, render, brindis, fecha, horaCorta, relativo, dinero, plural, estadoPack, METODOS,
         mostrarAviso, mostrarErroresCampo, datosFormulario, conCarga, confirmar, pedirTexto, copiar } from './ui.js';
import { api, iniciarPagina, getUsuario, redirigirAlPerderSesion } from './api.js';
import { ConexionEnVivo } from './realtime.js';
import { montarCabecera, aplicarMarca } from './shell.js';

const estado = { configuracion: null, panel: 'resumen', clienteSeleccionado: null };
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
  auditoria: cargarAuditoria,
};

function abrirPanel(nombre) {
  estado.panel = nombre;
  for (const pestana of $$('.pestana')) {
    pestana.setAttribute('aria-selected', String(pestana.dataset.panel === nombre));
  }
  for (const panel of $$('[id^="panel-"]')) {
    panel.hidden = panel.id !== `panel-${nombre}`;
  }
  CARGADORES[nombre]?.().catch((error) => mostrarAviso($('#aviso'), error.message, 'error'));
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

function tarjetaMetrica(valor, etiqueta, modificador = '') {
  return el(
    'div',
    { class: 'tarjeta' },
    el(
      'div',
      { class: `metrica ${modificador}` },
      el('div', { class: 'metrica__valor' }, valor),
      el('div', { class: 'metrica__etiqueta' }, etiqueta),
    ),
  );
}

async function cargarResumen() {
  const datos = await api.get('/api/admin/dashboard');

  render(
    $('#metricas'),
    tarjetaMetrica(String(datos.totals.pendingTickets), 'Entradas por usar', 'metrica--acento'),
    tarjetaMetrica(String(datos.redemptions.today), 'Entradas usadas hoy', 'metrica--ok'),
    tarjetaMetrica(String(datos.totals.activePacks), 'Packs activos'),
    tarjetaMetrica(dinero(datos.totals.revenueCents, datos.totals.currency), 'Ingresos registrados'),
    tarjetaMetrica(String(datos.users.customers), 'Clientes'),
    tarjetaMetrica(String(datos.redemptions.week), 'Usadas esta semana'),
    tarjetaMetrica(String(datos.totals.issuedTickets), 'Entradas emitidas'),
    tarjetaMetrica(String(datos.users.staff), 'Personal de pista'),
  );

  // Gráfico de barras de los últimos 14 días.
  const porDia = new Map(datos.dailySeries.map((d) => [d.date, d.count]));
  const dias = [];
  for (let i = 13; i >= 0; i -= 1) {
    const dia = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dias.push({ dia, total: porDia.get(dia) ?? 0 });
  }
  const maximo = Math.max(1, ...dias.map((d) => d.total));
  render(
    $('#grafico'),
    dias.map((d) =>
      el('div', {
        class: 'grafico__barra',
        style: `height:${Math.max(3, (d.total / maximo) * 100)}%`,
        title: `${d.dia}: ${plural(d.total, 'entrada', 'entradas')}`,
      }),
    ),
  );
  $('#grafico-desde').textContent = fecha(dias[0].dia, { conHora: false });

  $('#conexiones-vivas').textContent = `${plural(datos.liveConnections, 'pantalla conectada', 'pantallas conectadas')}`;

  render(
    $('#ultimos-consumos'),
    datos.recent.length === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Sin actividad todavía.'))
      : el(
          'ul',
          { class: 'lista' },
          datos.recent.map((item) =>
            el(
              'li',
              { class: 'lista__item' },
              el('span', { class: 'icono-lista' }, item.status === 'voided' ? '↩️' : '✅'),
              el(
                'div',
                { class: 'crece' },
                el('div', {}, item.customerName),
                el('div', { class: 'tenue-2 pequeno' }, `${horaCorta(item.createdAt)} · ${item.packCode} · ${item.scannerName || 'sistema'}`),
              ),
              el('span', { class: 'etiqueta' }, `Quedan ${item.remainingAfter}`),
            ),
          ),
        ),
  );

  pintarIntegridad(datos.integrity);
}

function pintarIntegridad(integridad) {
  render(
    $('#integridad'),
    integridad.ok
      ? el(
          'div',
          { class: 'aviso aviso--ok' },
          '✅ Contabilidad correcta: el saldo de todos los packs coincide con su historial de movimientos.',
        )
      : el(
          'div',
          { class: 'aviso aviso--error' },
          el(
            'div',
            {},
            el('strong', {}, '⚠️ Se detectaron diferencias contables.'),
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

async function cargarUsuarios() {
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
              el('td', {}, el('span', { class: 'etiqueta' }, ROLES[usuario.role] || usuario.role)),
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
                  el('button', { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: alPulsar(() => verUsuario(usuario.id)) }, 'Ver'),
                  el(
                    'button',
                    { class: 'boton boton--chico boton--principal', type: 'button', onClick: alPulsar(() => abrirDialogoPack(usuario)) },
                    'Vender',
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

async function verUsuario(userId) {
  const datos = await api.get(`/api/admin/users/${userId}`);
  const usuario = datos.user;

  const acciones = el(
    'div',
    { class: 'fila mt' },
    el(
      'button',
      { class: 'boton boton--chico boton--principal', type: 'button', onClick: () => abrirDialogoPack(usuario) },
      'Vender pack',
    ),
    el(
      'button',
      {
        class: 'boton boton--chico boton--fantasma',
        type: 'button',
        onClick: async () => {
          try {
            const respuesta = await api.post(`/api/admin/users/${userId}/reset-password`, {});
            const clave = respuesta.temporaryPassword;
            await copiar(clave);
            await confirmar({
              titulo: 'Contraseña restablecida',
              mensaje: `Nueva contraseña temporal (ya copiada al portapapeles): ${clave}`,
              textoAceptar: 'Entendido',
            });
          } catch (error) {
            brindis(error.message, 'error');
          }
        },
      },
      'Restablecer contraseña',
    ),
    usuario.locked
      ? el(
          'button',
          {
            class: 'boton boton--chico boton--ok',
            type: 'button',
            onClick: async () => {
              try {
                await api.post(`/api/admin/users/${userId}/unlock`, {});
                brindis('Cuenta desbloqueada.', 'ok');
                verUsuario(userId);
              } catch (error) {
                brindis(error.message, 'error');
              }
            },
          },
          'Desbloquear',
        )
      : null,
    usuario.id === getUsuario().id
      ? null
      : el(
          'button',
          {
            class: `boton boton--chico ${usuario.status === 'active' ? 'boton--peligro' : 'boton--ok'}`,
            type: 'button',
            onClick: async () => {
              const suspender = usuario.status === 'active';
              const seguro = await confirmar({
                titulo: suspender ? 'Suspender cuenta' : 'Reactivar cuenta',
                mensaje: suspender
                  ? `${usuario.fullName} no podrá entrar ni usar sus entradas hasta que la reactives.`
                  : `${usuario.fullName} volverá a tener acceso normal.`,
                textoAceptar: suspender ? 'Suspender' : 'Reactivar',
                peligro: suspender,
              });
              if (!seguro) return;
              try {
                await api.patch(`/api/admin/users/${userId}`, { status: suspender ? 'suspended' : 'active' });
                brindis(suspender ? 'Cuenta suspendida.' : 'Cuenta reactivada.', 'ok');
                verUsuario(userId);
                cargarUsuarios();
              } catch (error) {
                brindis(error.message, 'error');
              }
            },
          },
          usuario.status === 'active' ? 'Suspender' : 'Reactivar',
        ),
    usuario.id === getUsuario().id
      ? null
      : el(
          'select',
          {
            class: 'selector-rol',
            onChange: async (evento) => {
              const nuevoRol = evento.target.value;
              if (nuevoRol === usuario.role) return;
              try {
                await api.patch(`/api/admin/users/${userId}`, { role: nuevoRol });
                brindis(`Rol cambiado a ${ROLES[nuevoRol]}.`, 'ok');
                verUsuario(userId);
                cargarUsuarios();
              } catch (error) {
                brindis(error.message, 'error');
                evento.target.value = usuario.role;
              }
            },
          },
          Object.entries(ROLES).map(([valor, texto]) =>
            el('option', { value: valor, selected: valor === usuario.role }, texto),
          ),
        ),
  );

  render(
    $('#detalle-cuerpo'),
    el('h2', {}, usuario.fullName),
    el('p', { class: 'tenue sin-margen' }, usuario.email),
    usuario.phone ? el('p', { class: 'tenue pequeno' }, usuario.phone) : null,
    el(
      'div',
      { class: 'rejilla rejilla--3 mt' },
      tarjetaMetrica(String(datos.summary.availableTickets), 'Disponibles', 'metrica--acento'),
      tarjetaMetrica(String(datos.summary.usedTickets), 'Usadas'),
      tarjetaMetrica(String(datos.summary.purchasedTickets), 'Compradas'),
    ),
    acciones,
    el('h3', { class: 'mt-2' }, 'Packs'),
    datos.packs.length === 0
      ? el('p', { class: 'tenue pequeno' }, 'Sin packs.')
      : el(
          'ul',
          { class: 'lista' },
          datos.packs.map((pack) => {
            const marca = estadoPack(pack);
            return el(
              'li',
              { class: 'lista__item' },
              el(
                'div',
                { class: 'crece' },
                el('div', { class: 'mono' }, pack.code),
                el('div', { class: 'tenue-2 pequeno' }, `${pack.remaining} de ${pack.size} · ${dinero(pack.priceCents)}`),
              ),
              el('span', { class: `etiqueta etiqueta--${marca.clase}` }, marca.texto),
              el('button', { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: alPulsar(() => verPack(pack.id)) }, 'Abrir'),
            );
          }),
        ),
    el('h3', { class: 'mt-2' }, 'Últimos consumos'),
    datos.redemptions.length === 0
      ? el('p', { class: 'tenue pequeno' }, 'Sin consumos.')
      : el(
          'ul',
          { class: 'lista' },
          datos.redemptions.slice(0, 10).map((item) =>
            el(
              'li',
              { class: 'lista__item' },
              el('div', { class: 'crece' }, el('div', { class: 'pequeno' }, fecha(item.createdAt)), el('div', { class: 'tenue-2 pequeno mono' }, item.packCode)),
              el('span', { class: 'etiqueta' }, item.status === 'voided' ? 'Anulado' : `Quedaban ${item.remainingAfter}`),
            ),
          ),
        ),
  );
  $('#dialogo-detalle').showModal();
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

async function cargarPacks() {
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
      tarjetaMetrica(String(pack.remaining), 'Restantes', 'metrica--acento'),
      tarjetaMetrica(String(pack.used), 'Usadas'),
      tarjetaMetrica(dinero(pack.priceCents, pack.currency), 'Precio'),
    ),
    el(
      'div',
      { class: 'fila mt' },
      el(
        'button',
        {
          class: 'boton boton--chico boton--fantasma',
          type: 'button',
          onClick: async () => {
            const motivo = await pedirTexto({
              titulo: 'Ajustar entradas',
              mensaje: 'Usa números positivos para acreditar y negativos para descontar. Todo ajuste queda registrado.',
              etiqueta: 'Cantidad (por ejemplo: 2 o -1)',
              textoAceptar: 'Siguiente',
              minimo: 1,
            });
            if (motivo === null) return;
            const delta = Number.parseInt(motivo, 10);
            if (!Number.isInteger(delta) || delta === 0) {
              brindis('Ingresa un número entero distinto de cero.', 'error');
              return;
            }
            const razon = await pedirTexto({
              titulo: 'Motivo del ajuste',
              mensaje: `Se ${delta > 0 ? 'acreditarán' : 'descontarán'} ${Math.abs(delta)} entrada(s).`,
              etiqueta: 'Motivo',
              textoAceptar: 'Aplicar ajuste',
            });
            if (!razon) return;
            try {
              await api.post(`/api/admin/packs/${packId}/adjust`, { delta, reason: razon });
              brindis('Ajuste aplicado.', 'ok');
              recargar();
            } catch (error) {
              brindis(error.message, 'error');
            }
          },
        },
        'Ajustar entradas',
      ),
      pack.status !== 'cancelled'
        ? el(
            'button',
            {
              class: `boton boton--chico ${pack.status === 'suspended' ? 'boton--ok' : 'boton--fantasma'}`,
              type: 'button',
              onClick: async () => {
                const suspender = pack.status !== 'suspended';
                try {
                  await api.patch(`/api/admin/packs/${packId}`, { status: suspender ? 'suspended' : 'active' });
                  brindis(suspender ? 'Pack suspendido.' : 'Pack reactivado.', 'ok');
                  recargar();
                } catch (error) {
                  brindis(error.message, 'error');
                }
              },
            },
            pack.status === 'suspended' ? 'Reactivar pack' : 'Suspender pack',
          )
        : null,
      pack.status !== 'cancelled'
        ? el(
            'button',
            {
              class: 'boton boton--chico boton--peligro',
              type: 'button',
              onClick: async () => {
                const seguro = await confirmar({
                  titulo: 'Anular pack',
                  mensaje: 'El pack quedará inutilizable de forma permanente. Esta acción no se puede revertir.',
                  textoAceptar: 'Anular pack',
                  peligro: true,
                });
                if (!seguro) return;
                try {
                  await api.patch(`/api/admin/packs/${packId}`, { status: 'cancelled' });
                  brindis('Pack anulado.', 'ok');
                  recargar();
                } catch (error) {
                  brindis(error.message, 'error');
                }
              },
            },
            'Anular pack',
          )
        : null,
      el(
        'button',
        {
          class: 'boton boton--chico boton--fantasma',
          type: 'button',
          onClick: async () => {
            try {
              await api.patch(`/api/admin/packs/${packId}`, { allowStaticQr: !pack.allowStaticQr });
              brindis(pack.allowStaticQr ? 'QR impreso desactivado.' : 'QR impreso activado.', 'ok');
              recargar();
            } catch (error) {
              brindis(error.message, 'error');
            }
          },
        },
        pack.allowStaticQr ? 'Desactivar QR impreso' : 'Activar QR impreso',
      ),
      pack.status !== 'cancelled'
        ? el(
            'button',
            {
              class: 'boton boton--chico boton--fantasma',
              type: 'button',
              onClick: alPulsar(async () => {
                const elegida = await pedirTexto({
                  titulo: 'Cambiar vencimiento',
                  mensaje: 'Déjalo vacío para que el pack no caduque.',
                  etiqueta: 'Vence el',
                  tipo: 'date',
                  valorInicial: pack.expiresAt ? pack.expiresAt.slice(0, 10) : '',
                  textoAceptar: 'Guardar fecha',
                  minimo: 0,
                });
                if (elegida === null) return;
                // La fecha elegida vale hasta el final de ese día.
                const expiresAt = elegida ? new Date(`${elegida}T23:59:59`).toISOString() : null;
                const cambios = { expiresAt };
                // Darle fecha nueva a un pack vencido es, en el mostrador,
                // devolverlo al servicio: se hace en un solo movimiento.
                const seguiraVigente = expiresAt === null || Date.parse(expiresAt) > Date.now();
                if (pack.status === 'expired' && seguiraVigente) cambios.status = 'active';
                await api.patch(`/api/admin/packs/${packId}`, cambios);
                brindis(
                  expiresAt ? `El pack vence el ${fecha(expiresAt, { conHora: false })}.` : 'El pack ya no caduca.',
                  'ok',
                );
                recargar();
              }),
            },
            pack.expiresAt ? 'Cambiar vencimiento' : 'Poner vencimiento',
          )
        : null,
      pack.allowStaticQr
        ? el(
            'button',
            {
              class: 'boton boton--chico boton--fantasma',
              type: 'button',
              onClick: alPulsar(() => imprimirPase(pack, datos.owner)),
            },
            'Imprimir pase',
          )
        : null,
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
        el('div', { class: 'pase__marca' }, estado.configuracion?.brandName || 'Racing Hobbies Ecuador'),
        el('div', { class: 'pase__titulo' }, `Pase de ${pack.size} entradas`),
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
    el('span', { class: 'icono-lista' }, item.status === 'voided' ? '↩️' : '✅'),
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
            onClick: async () => {
              const motivo = await pedirTexto({
                titulo: 'Anular consumo',
                mensaje: 'La entrada se devolverá al pack del cliente y quedará registrado quién lo hizo.',
                etiqueta: 'Motivo de la anulación',
                textoAceptar: 'Anular y devolver',
              });
              if (!motivo) return;
              try {
                await api.post(`/api/admin/redemptions/${item.id}/void`, { reason: motivo });
                brindis('Entrada devuelta al cliente.', 'ok');
                alCambiar?.();
              } catch (error) {
                brindis(error.message, 'error');
              }
            },
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
  const { items, total } = await api.get('/api/admin/redemptions?limit=100');
  render(
    $('#tabla-consumos'),
    items.length === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Sin consumos registrados.'))
      : el('ul', { class: 'lista' }, items.map((item) =>
          el(
            'li',
            { class: 'lista__item' },
            el('span', { class: 'icono-lista' }, item.status === 'voided' ? '↩️' : '✅'),
            el(
              'div',
              { class: 'crece' },
              el('div', {}, item.customerName),
              el(
                'div',
                { class: 'tenue-2 pequeno' },
                `${fecha(item.createdAt)} · ${item.packCode} · ${METODOS[item.method] || item.method} · ${item.scannerName || 'sistema'}`,
              ),
              item.voidReason ? el('div', { class: 'tenue-2 pequeno' }, `Anulado: ${item.voidReason}`) : null,
            ),
            el('span', { class: 'etiqueta' }, `Quedaban ${item.remainingAfter}`),
            item.status === 'confirmed'
              ? el(
                  'button',
                  {
                    class: 'boton boton--chico boton--peligro',
                    type: 'button',
                    onClick: async () => {
                      const motivo = await pedirTexto({
                        titulo: 'Anular consumo',
                        mensaje: `Se devolverá una entrada a ${item.customerName}.`,
                        etiqueta: 'Motivo de la anulación',
                        textoAceptar: 'Anular y devolver',
                      });
                      if (!motivo) return;
                      try {
                        await api.post(`/api/admin/redemptions/${item.id}/void`, { reason: motivo });
                        brindis('Entrada devuelta.', 'ok');
                        cargarConsumos();
                      } catch (error) {
                        brindis(error.message, 'error');
                      }
                    },
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

  $('#btn-nuevo-usuario').addEventListener('click', () => {
    formulario.reset();
    mostrarErroresCampo(formulario, {});
    mostrarAviso($('#aviso-usuario'), '');
    dialogo.showModal();
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErroresCampo(formulario, {});
    const datos = datosFormulario(formulario);
    if (!datos.phone) delete datos.phone;
    if (!datos.password) delete datos.password;

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
      cuerpo.expiresAt = new Date(`${vence}T23:59:59`).toISOString();
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

  for (const pestana of $$('.pestana')) {
    pestana.addEventListener('click', () => abrirPanel(pestana.dataset.panel));
  }
  for (const boton of $$('[data-cerrar]')) {
    boton.addEventListener('click', () => boton.closest('dialog')?.close());
  }

  montarDialogoUsuario();
  montarDialogoPack();

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

  abrirPanel('resumen');

  const refrescarPanelActual = temporizador(() => {
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

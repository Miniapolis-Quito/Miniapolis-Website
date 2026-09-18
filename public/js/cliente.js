/**
 * Portal del cliente: saldo en vivo, pase con QR rotativo e historial.
 */
import { $, el, render, icono, brindis, fecha, horaCorta, dinero, plural, estadoPack, METODOS,
         mostrarAviso, mostrarErroresCampo, datosFormulario, conCarga, confirmar, copiar, vibrar } from './ui.js';
import { api, iniciarPagina, getUsuario, cerrarSesion, redirigirAlPerderSesion, cambiarPassword, ErrorRed } from './api.js';
import { ConexionEnVivo } from './realtime.js';
import { montarCabecera, aplicarMarca, revelarAlEntrar } from './shell.js';

const estado = {
  resumen: null,
  fidelidad: null,
  packs: [],
  packSeleccionado: null,
  qrConfig: { ttlSeconds: 120, refreshSeconds: 30 },
  segundosParaRenovar: 0,
  cargandoQr: false,
  carteras: { apple: false, google: false },
  /** Si la pista manda recordatorios por correo; si no, no hay nada que elegir. */
  recordatorios: false,
};

let cabecera;
let temporizadorQr = null;

// ---------------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------------

function pintarSaldo(anterior) {
  const disponibles = estado.resumen?.availableTickets ?? 0;
  const numero = $('#saldo-numero');
  const seccion = $('#saldo');

  numero.textContent = String(disponibles);
  $('#saldo-texto').textContent =
    disponibles === 0
      ? 'No te quedan entradas — compra un pack en recepción'
      : `${disponibles === 1 ? 'entrada disponible' : 'entradas disponibles'}`;
  seccion.classList.toggle('saldo--vacio', disponibles === 0);

  // Animación solo cuando el número cambia de verdad.
  if (anterior !== undefined && anterior !== disponibles) {
    numero.classList.remove('pulso');
    void numero.offsetWidth; // reinicia la animación
    numero.classList.add('pulso');
  }

  const usadas = estado.resumen?.usedTickets ?? 0;
  const compradas = estado.resumen?.purchasedTickets ?? 0;
  const transferidas = estado.resumen?.transferredTickets ?? 0;
  const activos = estado.resumen?.activePacks ?? 0;
  const totalPacks = estado.resumen?.totalPacks ?? (estado.packs?.length ?? 0);

  if (compradas > 0 || disponibles > 0 || totalPacks > 0) {
    let detalle = `${usadas} de ${compradas} entradas usadas`;
    if (transferidas > 0) {
      detalle += ` · ${transferidas} ${transferidas === 1 ? 'transferida' : 'transferidas'}`;
    }
    detalle += ` · ${plural(activos, 'pack activo', 'packs activos')}`;
    $('#subtitulo').textContent = detalle;
  } else {
    $('#subtitulo').textContent = 'Todavía no tienes packs. Acércate a recepción para comprar uno.';
  }
}

// ---------------------------------------------------------------------------
// Programa de fidelidad
// ---------------------------------------------------------------------------

/** Con pocos sellos se dibuja la tarjeta; con muchos, una barra. */
const MAXIMO_DE_SELLOS = 12;

/**
 * «La casa invita»: cuántas entradas le faltan para la de regalo.
 *
 * La tarjeta solo existe si la pista tiene el programa encendido; si lo apagan,
 * desaparece sin dejar un hueco raro en la pantalla.
 */
function pintarFidelidad() {
  const seccion = $('#seccion-fidelidad');
  const f = estado.fidelidad;
  if (!f?.enabled) {
    seccion.hidden = true;
    return;
  }
  seccion.hidden = false;

  const umbral = f.entriesPerReward;
  const premio = f.rewardTickets;
  const faltan = f.remaining;
  const completa = faltan <= 1;
  seccion.classList.toggle('fidelidad--completa', completa);

  $('#fidelidad-etiqueta').textContent = f.rewardsCount
    ? `${plural(f.ticketsEarned, 'entrada regalada', 'entradas regaladas')}`
    : `${plural(premio, 'entrada gratis', 'entradas gratis')} cada ${umbral}`;

  $('#fidelidad-texto').textContent = completa
    ? `¡Te falta una entrada! La siguiente visita te regala ${plural(premio, 'entrada', 'entradas')}.`
    : `Te ${faltan === 1 ? 'falta' : 'faltan'} ${plural(faltan, 'entrada', 'entradas')} para que ` +
      `${premio === 1 ? 'la siguiente' : `las siguientes ${premio}`} ${premio === 1 ? 'la ponga' : 'las ponga'} la casa.`;

  // Tarjeta de sellos: uno por entrada del ciclo, y el último es el premio.
  const sellos = $('#fidelidad-sellos');
  const barra = $('#fidelidad-barra');
  if (umbral <= MAXIMO_DE_SELLOS) {
    sellos.hidden = false;
    barra.hidden = true;
    render(
      sellos,
      Array.from({ length: umbral }, (_, i) =>
        el('div', {
          class: `sello${i < f.progress ? ' sello--lleno' : ''}${i === umbral - 1 ? ' sello--premio' : ''}`,
        }),
      ),
    );
  } else {
    sellos.hidden = true;
    render(sellos);
    barra.hidden = false;
    $('#fidelidad-relleno').style.setProperty('width', `${Math.round((f.progress / umbral) * 100)}%`);
  }

  const detalle = [`${f.progress} de ${umbral} entradas de este ciclo`];
  if (f.rewardsCount) {
    detalle.push(`${plural(f.rewardsCount, 'premio ganado', 'premios ganados')}`);
    if (f.lastRewardAt) detalle.push(`el último el ${fecha(f.lastRewardAt, { conHora: false })}`);
  }
  detalle.push('las entradas de cortesía no cuentan para el siguiente');
  $('#fidelidad-detalle').textContent = detalle.join(' · ');
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

function tarjetaPack(pack) {
  const marca = estadoPack(pack);
  const porcentaje = pack.size > 0 ? (pack.remaining / pack.size) * 100 : 0;
  const activo = pack.usable;

  return el(
    'article',
    { class: `pack ${activo ? '' : 'pack--inactivo'}`, dataset: { packId: pack.id } },
    el(
      'div',
      { class: 'pack__cabecera' },
      el(
        'div',
        {},
        el('div', { class: 'pack__codigo' }, pack.code),
        el(
          'div',
          { class: 'tenue pequeno' },
          pack.origin === 'loyalty'
            ? `Pack de ${pack.size} · cortesía de la casa`
            : pack.origin === 'transfer'
              ? `Pack de ${pack.size} · recibido de otro piloto`
              : `Pack de ${pack.size} · ${dinero(pack.priceCents, pack.currency)}`,
        ),
      ),
      el('span', { class: `etiqueta etiqueta--${marca.clase}` }, marca.texto),
    ),
    el(
      'div',
      { class: 'fila fila--entre' },
      el('div', {}, el('span', { class: 'pack__restantes' }, String(pack.remaining)), el('span', { class: 'tenue' }, ` / ${pack.size}`)),
      el(
        'div',
        { class: 'fila' },
        activo && pack.remaining > 0
          ? el(
              'button',
              { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: () => abrirTransferencia(pack) },
              'Transferir',
            )
          : null,
        activo && estado.packSeleccionado?.id !== pack.id
          ? el(
              'button',
              { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: () => seleccionarPack(pack.id) },
              'Mostrar QR',
            )
          : activo
            ? el('span', { class: 'etiqueta etiqueta--info' }, 'QR en pantalla')
            : null,
      ),
    ),
    el('div', { class: 'barra-progreso' }, el('div', { class: 'barra-progreso__relleno', style: `width:${porcentaje}%` })),
    pack.expiresAt ? el('div', { class: 'tenue-2 pequeno' }, `Vence el ${fecha(pack.expiresAt, { conHora: false })}`) : null,
    pack.note ? el('div', { class: 'tenue-2 pequeno' }, pack.note) : null,
  );
}

function pintarPacks() {
  const contenedor = $('#lista-packs');
  if (estado.packs.length === 0) {
    render(
      contenedor,
      el(
        'div',
        { class: 'tarjeta vacio' },
        el('div', { class: 'vacio__icono' }, icono('entrada', { grande: true })),
        el('p', { class: 'sin-margen' }, 'Todavía no tienes packs de entradas.'),
        el('p', { class: 'pequeno sin-margen' }, 'Compra uno en recepción y aparecerá aquí al instante.'),
      ),
    );
    return;
  }
  render(contenedor, estado.packs.map(tarjetaPack));
}

/** El pase muestra el pack usable que vence antes; el cliente puede cambiarlo. */
function elegirPackPorDefecto() {
  const usables = estado.packs.filter((p) => p.usable);
  if (usables.length === 0) return null;
  if (estado.packSeleccionado) {
    const vigente = usables.find((p) => p.id === estado.packSeleccionado.id);
    if (vigente) return vigente;
  }
  return usables[0];
}

function pintarSelectorPacks() {
  const usables = estado.packs.filter((p) => p.usable);
  const selector = $('#selector-packs');
  if (usables.length <= 1) {
    selector.hidden = true;
    return;
  }
  selector.hidden = false;
  render(
    selector,
    el('span', { class: 'tenue pequeno' }, 'Usar el pack:'),
    usables.map((pack) =>
      el(
        'button',
        {
          class: `boton boton--chico ${estado.packSeleccionado?.id === pack.id ? 'boton--principal' : 'boton--fantasma'}`,
          type: 'button',
          onClick: () => seleccionarPack(pack.id),
        },
        `${pack.code} (${pack.remaining})`,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Cartera del teléfono
// ---------------------------------------------------------------------------

/**
 * Botones para guardar el pack en Apple Wallet o Google Wallet.
 *
 * Los dos casos acaban en una navegación a un enlace, no en una descarga: es
 * lo único que hace que el teléfono ofrezca añadir el pase a su cartera. Por
 * eso el servidor entrega primero una dirección y aquí solo se va a ella.
 */
function pintarCarteras() {
  const zona = $('#carteras');
  const pack = estado.packSeleccionado;
  const alguna = estado.carteras.apple || estado.carteras.google;
  if (!pack || !alguna) {
    zona.hidden = true;
    render(zona);
    return;
  }

  const abrir = async (boton, ruta, textoError) => {
    await conCarga(boton, async () => {
      try {
        const { url } = await api.get(`${ruta}/${pack.id}`);
        window.location.href = url;
      } catch (error) {
        brindis(error.message || textoError, 'error');
      }
    });
  };

  zona.hidden = false;
  render(
    zona,
    el('span', { class: 'tenue pequeno' }, 'Guardar en:'),
    estado.carteras.apple
      ? el(
          'button',
          {
            class: 'boton boton--chico boton--fantasma',
            type: 'button',
            onClick: (evento) => abrir(evento.currentTarget, '/api/wallet/apple/ticket', 'No se pudo preparar el pase.'),
          },
          'Apple Wallet',
        )
      : null,
    estado.carteras.google
      ? el(
          'button',
          {
            class: 'boton boton--chico boton--fantasma',
            type: 'button',
            onClick: (evento) => abrir(evento.currentTarget, '/api/wallet/google/pass', 'No se pudo preparar el pase.'),
          },
          'Google Wallet',
        )
      : null,
  );
}

async function seleccionarPack(packId) {
  const pack = estado.packs.find((p) => p.id === packId);
  if (!pack || !pack.usable) return;
  estado.packSeleccionado = pack;
  pintarPacks();
  pintarSelectorPacks();
  pintarCarteras();
  await refrescarQr({ inmediato: true });
}

// ---------------------------------------------------------------------------
// Código QR
// ---------------------------------------------------------------------------

async function refrescarQr({ inmediato = false } = {}) {
  const seccion = $('#seccion-qr');
  const pack = elegirPackPorDefecto();
  estado.packSeleccionado = pack;

  if (!pack) {
    seccion.hidden = true;
    clearInterval(temporizadorQr);
    temporizadorQr = null;
    return;
  }

  seccion.hidden = false;
  $('#qr-codigo').textContent = pack.code;
  $('#qr-etiqueta-pack').textContent = `${plural(pack.remaining, 'entrada', 'entradas')} en este pack`;

  if (estado.cargandoQr && !inmediato) {
    // Ya hay una petición en marcha. Se reinicia la cuenta atrás igualmente:
    // dejarla en cero haría que el temporizador volviera a entrar aquí cada
    // segundo mientras durase la petición lenta.
    estado.segundosParaRenovar = estado.qrConfig.refreshSeconds;
    return;
  }
  estado.cargandoQr = true;

  const caja = $('#qr-caja');
  try {
    // El servidor firma y dibuja el QR: el navegador nunca ve el secreto del pack.
    const svg = await api.get(`/api/packs/${pack.id}/qr.svg`);
    // Contenido generado por nuestro propio servidor; se inserta como marcado
    // para que el QR escale sin pérdida.
    caja.classList.remove('qr-caja--cargando');
    render(caja, el('div', { html: svg, class: 'contenido-qr' }));
    $('#qr-estado').hidden = false;
    mostrarAviso($('#aviso'), '');
  } catch (error) {
    caja.classList.add('qr-caja--cargando');
    render(
      caja,
      el(
        'div',
        { class: 'centrado' },
        el('div', { class: 'vacio__icono' }, icono('senal', { grande: true })),
        el('p', { class: 'tenue sin-margen' }, 'No pudimos generar el código.'),
        el('p', { class: 'pequeno tenue-2 sin-margen' }, `Muestra tu código ${pack.code} en recepción.`),
      ),
    );
    if (error instanceof ErrorRed) {
      mostrarAviso($('#aviso'), 'Sin conexión. Tu código de pack sigue sirviendo: el personal puede ingresarlo a mano.', 'alerta');
    } else {
      mostrarAviso($('#aviso'), error.message, 'alerta');
    }
  } finally {
    // Se reinicia siempre, también tras un fallo: si no, el contador seguiría
    // bajando y pediría un QR nuevo cada segundo mientras durase el problema.
    estado.segundosParaRenovar = estado.qrConfig.refreshSeconds;
    estado.cargandoQr = false;
  }

  if (!temporizadorQr) {
    temporizadorQr = setInterval(() => {
      estado.segundosParaRenovar -= 1;
      $('#qr-cuenta').textContent = String(Math.max(0, estado.segundosParaRenovar));
      if (estado.segundosParaRenovar <= 0) {
        // No tiene sentido pedir un QR nuevo si la pantalla no está a la vista.
        if (document.visibilityState === 'visible') refrescarQr();
        else estado.segundosParaRenovar = estado.qrConfig.refreshSeconds;
      }
    }, 1000);
  }
  $('#qr-cuenta').textContent = String(estado.segundosParaRenovar);
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

async function cargarHistorial() {
  const contenedor = $('#historial');
  try {
    const { items } = await api.get('/api/packs/mine/history?limit=25');
    if (items.length === 0) {
      render(
        contenedor,
        el(
          'div',
          { class: 'vacio' },
          el('div', { class: 'vacio__icono' }, icono('bandera', { grande: true })),
          el('p', { class: 'sin-margen' }, 'Todavía no has usado ninguna entrada.'),
        ),
      );
      return;
    }
    render(
      contenedor,
      el(
        'ul',
        { class: 'lista' },
        items.map((item) =>
          el(
            'li',
            { class: 'lista__item' },
            el('span', { class: 'icono-lista--grande' }, icono(item.status === 'voided' ? 'devolver' : 'bandera')),
            el(
              'div',
              { class: 'crece' },
              el(
                'div',
                {},
                item.status === 'voided'
                  ? (item.quantity > 1 ? `${item.quantity} entradas devueltas` : 'Entrada devuelta')
                  : (item.quantity > 1 ? `${item.quantity} entradas usadas (grupo)` : 'Entrada usada'),
              ),
              el(
                'div',
                { class: 'tenue-2 pequeno' },
                `${fecha(item.createdAt)} · ${item.packCode} · ${METODOS[item.method] || item.method}`,
              ),
              item.voidReason ? el('div', { class: 'tenue-2 pequeno' }, `Motivo: ${item.voidReason}`) : null,
            ),
            el('span', { class: 'etiqueta' }, `Quedaban ${item.remainingAfter}`),
          ),
        ),
      ),
    );
  } catch (error) {
    render(contenedor, el('div', { class: 'aviso aviso--alerta' }, error.message));
  }
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------

async function cargarTodo({ conHistorial = true } = {}) {
  const anterior = estado.resumen?.availableTickets;
  const datos = await api.get('/api/packs/mine');
  estado.resumen = datos.summary;
  estado.packs = datos.packs;
  estado.fidelidad = datos.loyalty ?? null;
  estado.qrConfig = datos.qrConfig || estado.qrConfig;

  pintarSaldo(anterior);
  pintarFidelidad();
  // El pack en pantalla se elige antes de pintar las tarjetas para que la que
  // está mostrando el QR aparezca marcada como tal.
  estado.packSeleccionado = elegirPackPorDefecto();
  pintarPacks();
  pintarSelectorPacks();
  pintarCarteras();
  await refrescarQr({ inmediato: true });
  if (conHistorial) await cargarHistorial();
}

// ---------------------------------------------------------------------------
// Tiempo real
// ---------------------------------------------------------------------------

function manejarEvento(tipo, datos) {
  if (tipo === 'conectado' && datos.summary) {
    const anterior = estado.resumen?.availableTickets;
    estado.resumen = datos.summary;
    pintarSaldo(anterior);
    return;
  }

  if (tipo === 'fidelidad.recompensa') {
    // Lo mejor que le puede pasar a alguien en esta pantalla: se celebra.
    vibrar([70, 50, 70, 50, 120]);
    const cuantas = datos.reward?.tickets ?? datos.pack?.size ?? 1;
    brindis(
      `¡La casa invita! Te regalamos ${plural(cuantas, 'entrada', 'entradas')} en el pack ${datos.pack.code}.`,
      'ok',
      8000,
    );
    cargarTodo({ conHistorial: false }).catch(() => {});
    return;
  }

  if (tipo === 'entrada.consumida') {
    vibrar([40, 60, 40]);
    const cant = datos.quantity || 1;
    let txt;
    if (datos.syncedAt) {
      txt = cant > 1
        ? `Se registraron tus ${cant} entradas de las ${horaCorta(datos.at)} en ${datos.pack.code}. Te quedan ${datos.remaining}.`
        : `Se registró tu entrada de las ${horaCorta(datos.at)} en ${datos.pack.code}. Te quedan ${datos.remaining}.`;
    } else {
      txt = cant > 1
        ? `${cant} entradas registradas en ${datos.pack.code}. Te quedan ${datos.remaining}.`
        : `Entrada registrada en ${datos.pack.code}. Te quedan ${datos.remaining}.`;
    }
    brindis(txt, 'ok');
    cargarTodo({ conHistorial: true }).catch(() => {});
    return;
  }

  if (tipo === 'entrada.anulada') {
    const cant = datos.quantity || 1;
    brindis(`Se te ${cant === 1 ? 'devolvió una entrada' : `devolvieron ${cant} entradas`}.`, 'ok');
    cargarTodo({ conHistorial: true }).catch(() => {});
    return;
  }

  if (tipo === 'pack.emitido') {
    // El pack de cortesía lo anuncia su propio evento, con su propia
    // celebración: dos avisos seguidos por lo mismo sobran.
    if (datos.pack?.origin === 'loyalty') {
      cargarTodo({ conHistorial: false }).catch(() => {});
      return;
    }
    brindis(`¡Nuevo pack ${datos.pack.code} con ${datos.pack.size} entradas!`, 'ok', 6000);
    cargarTodo({ conHistorial: false }).catch(() => {});
    return;
  }

  if (tipo === 'pack.recibido') {
    vibrar([60, 40, 60]);
    brindis(`¡${datos.from?.fullName || 'Un piloto'} te transfirió ${datos.quantity} ${datos.quantity === 1 ? 'entrada' : 'entradas'}!`, 'ok', 7000);
    cargarTodo({ conHistorial: false }).catch(() => {});
    return;
  }

  if (tipo === 'pack.actualizado') {
    cargarTodo({ conHistorial: false }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Diálogo de transferencia de entradas
// ---------------------------------------------------------------------------

let packATransferir = null;

function abrirTransferencia(pack) {
  packATransferir = pack;
  const dialogo = $('#dialogo-transferir');
  $('#transferir-subtitulo').textContent = `Pack ${pack.code} · ${pack.remaining} ${pack.remaining === 1 ? 'entrada disponible' : 'entradas disponibles'}.`;
  const inputCantidad = $('#transferir-cantidad');
  inputCantidad.value = '1';
  inputCantidad.max = String(pack.remaining);
  $('#transferir-destinatario').value = '';
  $('#transferir-nota').value = '';
  mostrarErroresCampo($('#form-transferir'), {});
  mostrarAviso($('#aviso-transferir'), '');
  dialogo.showModal();
}

function montarTransferencia() {
  const dialogo = $('#dialogo-transferir');
  $('#btn-cancelar-transferir').addEventListener('click', () => dialogo.close());

  $('#form-transferir').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!packATransferir) return;
    const formulario = evento.currentTarget;
    mostrarErroresCampo(formulario, {});
    mostrarAviso($('#aviso-transferir'), '');
    const datos = datosFormulario(formulario);

    await conCarga($('#btn-confirmar-transferir'), async () => {
      try {
        const respuesta = await api.post(`/api/packs/${packATransferir.id}/transfer`, {
          quantity: Number(datos.quantity) || 1,
          recipient: datos.recipient,
          note: datos.note || undefined,
        });
        dialogo.close();
        brindis(respuesta.message, 'ok', 6000);
        await cargarTodo();
      } catch (error) {
        if (error.detalles?.fields) {
          mostrarErroresCampo(formulario, error.detalles.fields);
        }
        mostrarAviso($('#aviso-transferir'), error.message, 'error');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Diálogo de cuenta
// ---------------------------------------------------------------------------

function montarCuenta() {
  const dialogo = $('#dialogo-cuenta');

  $('#btn-cuenta').addEventListener('click', () => {
    $('#perfil-nombre').value = getUsuario()?.fullName ?? '';
    $('#perfil-telefono').value = getUsuario()?.phone ?? '';
    $('#seccion-recordatorios').hidden = !estado.recordatorios;
    $('#perfil-recordatorios').checked = getUsuario()?.emailReminders !== false;
    mostrarAviso($('#aviso-perfil'), '');
    mostrarAviso($('#aviso-password'), '');
    mostrarAviso($('#aviso-recordatorios'), '');
    dialogo.showModal();
  });

  $('#perfil-recordatorios').addEventListener('change', async (evento) => {
    const casilla = evento.currentTarget;
    const activar = casilla.checked;
    casilla.disabled = true;
    mostrarAviso($('#aviso-recordatorios'), '');
    try {
      const datos = await api.patch('/api/auth/me', { emailReminders: activar });
      Object.assign(getUsuario() ?? {}, datos.user);
      mostrarAviso(
        $('#aviso-recordatorios'),
        activar ? 'Listo: te avisaremos por correo.' : 'Listo: ya no te enviaremos recordatorios.',
        'ok',
      );
    } catch (error) {
      casilla.checked = !activar;
      mostrarAviso($('#aviso-recordatorios'), error.message, 'error');
    } finally {
      casilla.disabled = false;
    }
  });
  $('#btn-cerrar-cuenta').addEventListener('click', () => dialogo.close());

  $('#form-perfil').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    mostrarErroresCampo(formulario, {});
    await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
      try {
        const datos = await api.patch('/api/auth/me', datosFormulario(formulario));
        // Sin esto, al volver a abrir «Mi cuenta» aparecían los datos de antes.
        Object.assign(getUsuario() ?? {}, datos.user);
        mostrarAviso($('#aviso-perfil'), 'Datos guardados.', 'ok');
        brindis('Datos actualizados.', 'ok');
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso($('#aviso-perfil'), error.message, 'error');
      }
    });
  });

  $('#form-password').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    mostrarErroresCampo(formulario, {});
    await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
      try {
        // Sin recortar espacios: la contraseña se manda tal cual se escribió.
        const valor = (nombre) => formulario.querySelector(`[name="${nombre}"]`).value;
        if (valor('newPassword') !== valor('confirmPassword')) {
          mostrarErroresCampo(formulario, { confirmPassword: 'Las dos contraseñas no coinciden.' });
          return;
        }
        await cambiarPassword(valor('currentPassword'), valor('newPassword'));
        formulario.reset();
        mostrarAviso($('#aviso-password'), 'Contraseña cambiada. Cerramos la sesión en tus demás dispositivos.', 'ok');
        brindis('Contraseña actualizada.', 'ok');
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso($('#aviso-password'), error.message, 'error');
      }
    });
  });

  $('#btn-cerrar-todo').addEventListener('click', async () => {
    const seguro = await confirmar({
      titulo: 'Cerrar todas las sesiones',
      mensaje: 'Se cerrará tu sesión en este y en cualquier otro dispositivo. Tendrás que volver a entrar.',
      textoAceptar: 'Cerrar todo',
      peligro: true,
    });
    if (!seguro) return;
    try {
      await api.post('/api/auth/logout-all');
    } finally {
      await cerrarSesion();
      window.location.replace('/');
    }
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

(async () => {
  const sesion = await iniciarPagina();
  if (!sesion) return;

  cabecera = montarCabecera($('#cabecera'));
  try {
    const configuracion = await fetch('/api/config').then((r) => r.json());
    aplicarMarca(configuracion);
    estado.carteras = configuracion.wallet ?? estado.carteras;
    estado.recordatorios = Boolean(configuracion.emailReminders);
  } catch {
    /* opcional */
  }

  montarCuenta();
  montarTransferencia();
  $('#btn-refrescar-qr').addEventListener('click', () => refrescarQr({ inmediato: true }));
  $('#btn-copiar-codigo').addEventListener('click', async () => {
    const codigo = estado.packSeleccionado?.code;
    if (!codigo) return;
    brindis((await copiar(codigo)) ? `Código ${codigo} copiado.` : `Tu código es ${codigo}.`, 'ok');
  });
  $('#btn-recargar-historial').addEventListener('click', () => cargarHistorial());

  try {
    await cargarTodo();
  } catch (error) {
    mostrarAviso($('#aviso'), error.message, 'error');
  }

  $('#cargando-inicial').hidden = true;
  $('#contenido').hidden = false;
  // El contenido no existía al cargar la página: ahora sí se puede revelar.
  revelarAlEntrar();

  redirigirAlPerderSesion();

  const conexion = new ConexionEnVivo({
    onEvento: manejarEvento,
    onEstado: (nuevo) => cabecera.actualizarEstado(nuevo),
  }).iniciar();

  // Red de seguridad: si el canal en vivo estuviera caído, se refresca igual.
  const respaldo = setInterval(() => {
    if (document.visibilityState === 'visible' && conexion.estado !== 'conectado') {
      cargarTodo({ conHistorial: false }).catch(() => {});
    }
  }, 30_000);

  window.addEventListener('pagehide', () => {
    conexion.detener();
    clearInterval(respaldo);
    clearInterval(temporizadorQr);
  });
})();

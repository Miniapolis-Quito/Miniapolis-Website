/**
 * Sección «Avisos» del panel: el estado y los ajustes de los avisos
 * automáticos, los clientes por recuperar y el historial de lo enviado.
 *
 * La lista de clientes por recuperar funciona aunque no haya correo: los
 * botones de WhatsApp y de llamada son la forma de hablar con los clientes que
 * tiene cualquier pista, y cada contacto queda registrado para que dos personas
 * del mostrador no le escriban lo mismo a alguien.
 */
import { $, el, render, brindis, fecha, relativo, plural, metrica, telefono, conCarga, mostrarAviso, mostrarErroresCampo, confirmar } from './ui.js';
import { api, peticion } from './api.js';

const TIPOS = ['purchase', 'loyalty_reward', 'low_balance', 'depleted', 'expiring', 'inactive'];

export const NOMBRES_DE_AVISO = {
  purchase: 'Comprobante de compra',
  loyalty_reward: 'Premio de fidelidad',
  low_balance: 'Quedan pocas entradas',
  depleted: 'Sin entradas',
  expiring: 'Entradas por vencer',
  inactive: 'Hace tiempo que no viene',
};

const DESCRIPCIONES = {
  purchase: 'Al vender un pack: código, entradas y valor. Llega aunque la persona ya no reciba recordatorios.',
  loyalty_reward: 'Cuando el programa «la casa invita» le regala entradas. Es una buena noticia de su saldo, así que llega aunque ya no reciba recordatorios.',
  low_balance: 'Después de usar una entrada, cuando le quedan pocas. Incluye los packs disponibles.',
  depleted: 'Cuando usa su última entrada, con los packs disponibles.',
  expiring: 'Unos días antes de que venza un pack de cortesía que todavía tiene entradas. Lo comprado no caduca.',
  inactive: 'Cuando tiene entradas, pero lleva tiempo sin venir.',
};

const CANALES = { email: 'Correo', whatsapp: 'WhatsApp', phone: 'Llamada' };

const ESTADOS = {
  pending: ['En cola', 'info'],
  sending: ['Enviando', 'info'],
  sent: ['Enviado', 'ok'],
  failed: ['Falló', 'error'],
  discarded: ['Descartado', ''],
  logged: ['Registrado', 'ok'],
};

export const MOTIVOS_DE_DESCARTE = {
  ya_no_aplica: 'La situación cambió antes de enviarlo',
  ya_recordado: 'Ya se le había recordado otra cosa',
  baja: 'Se dio de baja de los recordatorios',
  cuenta_suspendida: 'La cuenta está suspendida',
  tipo_apagado: 'Ese tipo de aviso se apagó',
  avisos_apagados: 'Los avisos se apagaron',
  sin_correo: 'No hay correo configurado',
  caducado: 'No se pudo enviar en una semana',
  pack_anulado: 'El pack se anuló',
  tipo_desconocido: 'Ese tipo de aviso ya no existe',
};

const GRUPOS = [
  {
    clave: 'expiring',
    titulo: 'Por vencer',
    ayuda: (u) => `Tienen entradas de cortesía que vencen en los próximos ${plural(u.daysBeforeExpiry, 'día', 'días')}. Es lo más urgente: después ya no sirven.`,
  },
  {
    clave: 'depleted',
    titulo: 'Sin entradas',
    ayuda: (u) => `Se les acabaron o vencieron en los últimos ${u.depletedDays} días y todavía no han vuelto a comprar.`,
  },
  {
    clave: 'inactive',
    titulo: 'No vienen',
    ayuda: (u) => `Tienen entradas, pero llevan ${u.inactiveDays} días o más sin venir.`,
  },
  {
    clave: 'lowBalance',
    titulo: 'Quedan pocas',
    ayuda: (u) => `Les quedan ${plural(u.lowBalanceThreshold, 'entrada', 'entradas')} o menos: ya casi toca volver a comprar.`,
  },
];

const POR_PAGINA = 50;

const estado = {
  datos: null,
  grupo: null,
  historial: { items: [], total: 0 },
};

const hora = (h) => `${String(h).padStart(2, '0')}:00`;

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

function rutaHistorial(offset) {
  const parametros = new URLSearchParams({ limit: String(POR_PAGINA), offset: String(offset) });
  const filtro = $('#filtro-avisos-estado').value;
  if (filtro) parametros.set('status', filtro);
  return `/api/admin/notifications?${parametros}`;
}

export async function cargarAvisos() {
  const [datos, historial] = await Promise.all([
    api.get('/api/admin/notifications/overview'),
    api.get(rutaHistorial(0)),
  ]);
  estado.datos = datos;
  estado.historial = historial;
  // La primera vez se abre el grupo más urgente que tenga a alguien; después
  // se respeta el que eligió quien está mirando.
  estado.grupo ??= GRUPOS.find((g) => datos.opportunities.groups[g.clave].count > 0)?.clave ?? GRUPOS[0].clave;

  pintarEstado();
  pintarMetricas();
  pintarGrupos();
  pintarHistorial();
}

// ---------------------------------------------------------------------------
// Estado y cifras
// ---------------------------------------------------------------------------

function pintarEstado() {
  const s = estado.datos.status;
  const activos = TIPOS.filter((tipo) => s.kinds[tipo]).map((tipo) => NOMBRES_DE_AVISO[tipo]);
  const enCola = estado.datos.metrics.pending;

  let principal;
  if (!s.emailConfigured) {
    principal = el(
      'div',
      { class: 'aviso aviso--alerta' },
      'No hay correo configurado en el servidor, así que los avisos automáticos no pueden salir. ' +
        'La lista de clientes para volver a contactar sí funciona: escríbeles por WhatsApp o llámalos desde aquí.',
    );
  } else if (!s.enabled) {
    principal = el(
      'div',
      { class: 'aviso aviso--alerta' },
      'Están apagados: ningún cliente recibe correos automáticos. Revisa qué se envía y actívalos en «Configurar».',
    );
  } else {
    principal = el(
      'div',
      { class: 'aviso aviso--ok' },
      el(
        'div',
        {},
        el('strong', {}, 'Activos'),
        ` desde el ${fecha(s.enabledAt, { conHora: false })}. Los recordatorios salen de ${hora(s.sendFromHour)} a ${hora(s.sendUntilHour)}` +
          `${enCola ? ` y hay ${plural(enCola, 'aviso', 'avisos')} en cola` : ''}.`,
        el('div', { class: 'pequeno' }, activos.length ? `Se envían: ${activos.join(', ')}.` : 'No hay ningún tipo de aviso seleccionado.'),
      ),
    );
  }

  render(
    $('#avisos-estado'),
    principal,
    s.emailConfigured && !s.publicUrlConfigured
      ? el(
          'div',
          { class: 'aviso aviso--alerta mt pequeno' },
          'Falta PUBLIC_URL en el servidor: los correos no llevarán el enlace a la app ni el enlace para dejar de recibir avisos con un clic.',
        )
      : null,
  );
  $('#btn-avisos-revisar').hidden = !(s.emailConfigured && s.enabled);
}

function pintarMetricas() {
  const m = estado.datos.metrics;
  render(
    $('#avisos-metricas'),
    metrica(String(m.sent), 'Correos enviados (30 días)', 'metrica--acento'),
    metrica(String(m.contacts), 'Contactos manuales (30 días)', 'metrica--ok'),
    metrica(String(m.failed), 'Correos fallidos (30 días)'),
    metrica(String(m.unsubscribed), 'Sin recordatorios'),
  );
}

// ---------------------------------------------------------------------------
// Clientes por recuperar
// ---------------------------------------------------------------------------

function pintarGrupos() {
  const { groups, totals, thresholds } = estado.datos.opportunities;

  $('#avisos-en-juego').textContent = totals.ticketsAtStake
    ? `${plural(totals.ticketsAtStake, 'entrada pagada', 'entradas pagadas')} en juego`
    : plural(totals.customers, 'cliente', 'clientes');

  render(
    $('#avisos-grupos'),
    GRUPOS.map((grupo) =>
      el(
        'button',
        {
          class: 'pestana',
          role: 'tab',
          type: 'button',
          'aria-selected': String(estado.grupo === grupo.clave),
          onClick: () => {
            estado.grupo = grupo.clave;
            pintarGrupos();
          },
        },
        // El espacio es texto y no solo margen: sin él, un lector de pantalla
        // leería «Por vencer1».
        `${grupo.titulo} `,
        el('span', { class: 'pestana__cuenta' }, String(groups[grupo.clave].count)),
      ),
    ),
  );

  const elegido = GRUPOS.find((g) => g.clave === estado.grupo);
  const { items, count } = groups[elegido.clave];
  render(
    $('#avisos-oportunidades'),
    el('p', { class: 'tenue pequeno' }, elegido.ayuda(thresholds)),
    count === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'No hay nadie en este grupo por ahora.'))
      : el('ul', { class: 'lista' }, items.map(filaCliente)),
    count > items.length ? el('p', { class: 'tenue-2 pequeno mt' }, `Se muestran ${items.length} de ${count}.`) : null,
  );
}

function detalleDeCliente(cliente) {
  const entradas = (n) => plural(n, 'entrada', 'entradas');
  switch (cliente.kind) {
    case 'expiring': {
      const { tickets, packs, expiresAt } = cliente.expiring;
      const cuando = fecha(expiresAt, { conHora: false });
      return packs > 1
        ? `${entradas(tickets)} por vencer en ${packs} packs; el primero vence el ${cuando}`
        : `${entradas(tickets)} ${tickets === 1 ? 'vence' : 'vencen'} el ${cuando}`;
    }
    case 'depleted':
      return cliente.visits ? `Sin entradas · ${plural(cliente.visits, 'visita', 'visitas')} en total` : 'Sin entradas · compró y nunca vino';
    case 'inactive':
      return `${entradas(cliente.availableTickets)} sin usar · ${cliente.daysSinceActivity} días sin venir`;
    default:
      return `Le ${cliente.availableTickets === 1 ? 'queda' : 'quedan'} ${entradas(cliente.availableTickets)}`;
  }
}

function textoDeContacto(contacto) {
  const quien = contacto.actorName ? ` · ${contacto.actorName}` : contacto.channel === 'email' ? ' · automático' : '';
  return `Último contacto: ${CANALES[contacto.channel] || contacto.channel} ${relativo(contacto.at)}${quien}`;
}

/**
 * Registra que alguien del mostrador contactó a este cliente. No espera la
 * respuesta: el enlace ya se está abriendo, y si el registro fallara no hay
 * que impedir la conversación, solo decirlo.
 */
function registrarContacto(cliente, channel) {
  api
    .post('/api/admin/notifications/contacts', { userId: cliente.userId, channel, kind: cliente.kind })
    .then(() => brindis(`Contacto con ${cliente.fullName} guardado.`, 'ok'))
    .catch((error) => brindis(`No pudimos guardar el contacto: ${error.message}`, 'error'));
}

function filaCliente(cliente) {
  const secundario = [
    cliente.lastVisitAt ? `Última visita ${relativo(cliente.lastVisitAt)}` : 'Sin visitas',
    cliente.phone ? telefono(cliente.phone) : 'Sin teléfono',
    cliente.emailReminders ? null : 'no recibe avisos por correo',
  ].filter(Boolean);

  return el(
    'li',
    { class: `lista__item recuperar${cliente.recentlyContacted ? ' recuperar--contactado' : ''}` },
    el(
      'div',
      { class: 'crece' },
      el('a', { class: 'recuperar__nombre', href: `#cliente/${cliente.userId}` }, cliente.fullName),
      el('div', { class: 'pequeno' }, detalleDeCliente(cliente)),
      el('div', { class: 'tenue-2 pequeno' }, secundario.join(' · ')),
      cliente.lastContact ? el('div', { class: 'recuperar__contacto pequeno' }, textoDeContacto(cliente.lastContact)) : null,
    ),
    el(
      'div',
      { class: 'fila recuperar__acciones' },
      cliente.whatsappUrl
        ? el(
            'a',
            {
              class: 'boton boton--chico boton--ok',
              href: cliente.whatsappUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              onClick: () => registrarContacto(cliente, 'whatsapp'),
            },
            'WhatsApp',
          )
        : null,
      cliente.phone
        ? el(
            'a',
            {
              class: 'boton boton--chico boton--fantasma',
              href: `tel:${cliente.phone}`,
              onClick: () => registrarContacto(cliente, 'phone'),
            },
            'Llamar',
          )
        : el('a', { class: 'boton boton--chico boton--fantasma', href: `#cliente/${cliente.userId}` }, 'Abrir ficha'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

function detalleDeEstado(aviso) {
  if (aviso.status === 'discarded') return MOTIVOS_DE_DESCARTE[aviso.reason] || aviso.reason;
  if (aviso.status === 'failed') return `${aviso.reason || 'Error desconocido'} · ${plural(aviso.attempts, 'intento', 'intentos')}`;
  if (aviso.status === 'pending' && aviso.nextAttemptAt && aviso.nextAttemptAt > new Date().toISOString()) {
    return aviso.attempts ? `Se reintenta el ${fecha(aviso.nextAttemptAt)}` : `Sale el ${fecha(aviso.nextAttemptAt)}`;
  }
  return null;
}

function filaHistorial(aviso) {
  const [texto, clase] = ESTADOS[aviso.status] || [aviso.status, ''];
  const cuando = aviso.sentAt ?? aviso.createdAt;
  const detalle = detalleDeEstado(aviso);
  return el(
    'tr',
    {},
    el('td', { class: 'pequeno', title: fecha(cuando) }, relativo(cuando)),
    el(
      'td',
      {},
      el('a', { href: `#cliente/${aviso.userId}` }, aviso.customerName),
      aviso.packCode ? el('div', { class: 'tenue-2 pequeno mono' }, aviso.packCode) : null,
    ),
    el('td', { class: 'pequeno' }, NOMBRES_DE_AVISO[aviso.kind] || aviso.kind),
    el(
      'td',
      { class: 'pequeno' },
      CANALES[aviso.channel] || aviso.channel,
      aviso.actorName ? el('div', { class: 'tenue-2 pequeno' }, aviso.actorName) : null,
    ),
    el(
      'td',
      {},
      el('span', { class: `etiqueta${clase ? ` etiqueta--${clase}` : ''}` }, texto),
      detalle ? el('div', { class: 'tenue-2 pequeno' }, detalle) : null,
    ),
    el(
      'td',
      {},
      aviso.status === 'failed'
        ? el(
            'button',
            { class: 'boton boton--chico boton--fantasma', type: 'button', onClick: (e) => reintentar(aviso, e.currentTarget) },
            'Reintentar',
          )
        : null,
    ),
  );
}

function pintarHistorial() {
  const { items, total } = estado.historial;
  render(
    $('#tabla-avisos'),
    items.length === 0
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Todavía no hay avisos con ese estado.'))
      : el(
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
                el('tr', {}, el('th', {}, 'Cuándo'), el('th', {}, 'Cliente'), el('th', {}, 'Aviso'), el('th', {}, 'Canal'), el('th', {}, 'Estado'), el('th', {}, '')),
              ),
              el('tbody', {}, items.map(filaHistorial)),
            ),
          ),
          items.length < total
            ? el(
                'button',
                { class: 'boton boton--fantasma boton--bloque mt', type: 'button', onClick: (e) => verMas(e.currentTarget) },
                `Ver más (${total - items.length} restantes)`,
              )
            : el('p', { class: 'tenue-2 pequeno mt sin-margen' }, plural(total, 'aviso', 'avisos')),
        ),
  );
}

async function verMas(boton) {
  await conCarga(boton, async () => {
    try {
      const pagina = await api.get(rutaHistorial(estado.historial.items.length));
      estado.historial = { items: estado.historial.items.concat(pagina.items), total: pagina.total };
      pintarHistorial();
    } catch (error) {
      brindis(error.message, 'error');
    }
  });
}

async function reintentar(aviso, boton) {
  await conCarga(boton, async () => {
    try {
      await api.post(`/api/admin/notifications/${encodeURIComponent(aviso.id)}/retry`, {});
      brindis('El aviso volvió a la cola y saldrá en el próximo ciclo.', 'ok');
      await cargarAvisos();
    } catch (error) {
      brindis(error.message, 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function campoNumero({ id, etiqueta, nombre, valor, minimo, maximo, ayuda }) {
  return el(
    'div',
    { class: 'campo' },
    el('label', { for: id }, etiqueta),
    el('input', { id, name: nombre, type: 'number', inputmode: 'numeric', min: String(minimo), max: String(maximo), step: '1', value: String(valor), required: true }),
    el('div', { class: 'campo__ayuda' }, ayuda),
    el('div', { class: 'campo__error' }),
  );
}

function campoHora({ id, etiqueta, nombre, valor, desde, hasta }) {
  const opciones = [];
  for (let h = desde; h <= hasta; h += 1) {
    opciones.push(el('option', { value: String(h), selected: h === valor }, h === 24 ? '24:00 (medianoche)' : hora(h)));
  }
  return el(
    'div',
    { class: 'campo' },
    el('label', { for: id }, etiqueta),
    el('select', { id, name: nombre }, opciones),
    el('div', { class: 'campo__error' }),
  );
}

function abrirAjustes() {
  const s = estado.datos.status;
  const aviso = el('div', { class: 'aviso', role: 'status', hidden: true });

  const formulario = el(
    'form',
    { novalidate: true },
    el(
      'div',
      { class: 'campo campo--linea' },
      el('input', { type: 'checkbox', id: 'ajuste-activos', name: 'enabled', checked: s.enabled, disabled: !s.emailConfigured && !s.enabled }),
      el('label', { for: 'ajuste-activos' }, el('strong', {}, 'Enviar avisos automáticos por correo')),
    ),
    s.emailConfigured
      ? null
      : el('div', { class: 'aviso aviso--alerta pequeno mb' }, 'Para activarlos hace falta configurar el correo en el servidor. Puedes dejar los ajustes listos.'),
    el(
      'fieldset',
      { class: 'ajustes-grupo' },
      el('legend', {}, 'Qué avisos enviar'),
      TIPOS.map((tipo) =>
        el(
          'div',
          { class: 'opcion-aviso' },
          el('input', { type: 'checkbox', id: `ajuste-${tipo}`, name: `kind-${tipo}`, checked: s.kinds[tipo] }),
          el(
            'label',
            { for: `ajuste-${tipo}` },
            el('span', { class: 'opcion-aviso__nombre' }, NOMBRES_DE_AVISO[tipo]),
            el('span', { class: 'tenue-2 pequeno' }, DESCRIPCIONES[tipo]),
          ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'rejilla rejilla--ajustes' },
      campoNumero({ id: 'ajuste-umbral', etiqueta: 'Quedan pocas', nombre: 'lowBalanceThreshold', valor: s.lowBalanceThreshold, minimo: 1, maximo: 10, ayuda: 'entradas o menos' }),
      campoNumero({ id: 'ajuste-vence', etiqueta: 'Avisar del vencimiento', nombre: 'daysBeforeExpiry', valor: s.daysBeforeExpiry, minimo: 1, maximo: 60, ayuda: 'días antes' }),
      campoNumero({ id: 'ajuste-inactivo', etiqueta: 'No viene desde hace', nombre: 'inactiveDays', valor: s.inactiveDays, minimo: 7, maximo: 365, ayuda: 'días o más' }),
    ),
    el(
      'div',
      { class: 'rejilla rejilla--ajustes' },
      campoHora({ id: 'ajuste-desde', etiqueta: 'Enviar desde las', nombre: 'sendFromHour', valor: s.sendFromHour, desde: 0, hasta: 23 }),
      campoHora({ id: 'ajuste-hasta', etiqueta: 'Hasta las', nombre: 'sendUntilHour', valor: s.sendUntilHour, desde: 1, hasta: 24 }),
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'ajuste-prefijo' }, 'Prefijo de WhatsApp'),
        el('input', { id: 'ajuste-prefijo', name: 'whatsappCountryCode', type: 'text', inputmode: 'numeric', maxlength: '4', value: s.whatsappCountryCode }),
        el('div', { class: 'campo__ayuda' }, 'Sin +. Ecuador: 593'),
        el('div', { class: 'campo__error' }),
      ),
    ),
    el(
      'p',
      { class: 'tenue-2 pequeno' },
      `Las horas son las de la pista (${s.timezone}). El comprobante de compra sale al instante, a cualquier hora. ` +
        'Nadie recibe más de un recordatorio cada 48 horas.',
    ),
    aviso,
  );

  const selectorPrueba = el(
    'select',
    { id: 'ajuste-prueba', class: 'ancho-auto', 'aria-label': 'Aviso de prueba' },
    TIPOS.map((tipo) => el('option', { value: tipo, selected: tipo === 'low_balance' }, NOMBRES_DE_AVISO[tipo])),
  );
  const botonPrueba = el(
    'button',
    { class: 'boton boton--fantasma boton--chico', type: 'button', disabled: !s.emailConfigured },
    'Enviarme una prueba',
  );
  botonPrueba.addEventListener('click', () =>
    conCarga(botonPrueba, async () => {
      try {
        const r = await api.post('/api/admin/notifications/test', { kind: selectorPrueba.value });
          mostrarAviso(aviso, `Prueba enviada a ${r.to}. Revisa también la carpeta de spam.`, 'ok');
      } catch (error) {
        mostrarAviso(aviso, error.message, 'error');
      }
    }),
  );

  const dialogo = el(
    'dialog',
    { 'aria-labelledby': 'ajustes-avisos-titulo', class: 'dialogo-ancho' },
    el(
      'div',
      { class: 'modal__cuerpo' },
      el('h2', { id: 'ajustes-avisos-titulo' }, 'Avisos automáticos'),
      formulario,
      el('div', { class: 'fila' }, el('span', { class: 'tenue pequeno' }, 'Ver cómo llega:'), selectorPrueba, botonPrueba),
    ),
    el(
      'div',
      { class: 'modal__pie' },
      el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => cerrar() }, 'Cancelar'),
      el('button', { class: 'boton boton--principal', type: 'button', onClick: (e) => guardar(e.currentTarget) }, 'Guardar'),
    ),
  );

  function cerrar() {
    dialogo.close();
    dialogo.remove();
  }
  dialogo.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    cerrar();
  });
  formulario.addEventListener('submit', (evento) => evento.preventDefault());

  async function guardar(boton) {
    mostrarAviso(aviso, '');
    mostrarErroresCampo(formulario, {});
    const campo = (nombre) => formulario.querySelector(`[name="${nombre}"]`);
    const cuerpo = {
      enabled: campo('enabled').checked,
      kinds: Object.fromEntries(TIPOS.map((tipo) => [tipo, campo(`kind-${tipo}`).checked])),
      lowBalanceThreshold: Number(campo('lowBalanceThreshold').value),
      daysBeforeExpiry: Number(campo('daysBeforeExpiry').value),
      inactiveDays: Number(campo('inactiveDays').value),
      sendFromHour: Number(campo('sendFromHour').value),
      sendUntilHour: Number(campo('sendUntilHour').value),
      whatsappCountryCode: campo('whatsappCountryCode').value.trim(),
    };

    // Encenderlos es escribir a clientes de verdad: se confirma, y se dice
    // exactamente qué va a pasar con lo que ya existe.
    if (cuerpo.enabled && !s.enabled) {
      const seguro = await confirmar({
        titulo: 'Encender los avisos',
        mensaje:
          'Desde ahora los clientes recibirán por correo los avisos marcados. Lo vendido y usado antes de encenderlos no ' +
          'genera correos, pero los packs que ya están por vencer y los clientes que ya llevan tiempo sin venir sí ' +
          'recibirán su recordatorio, dentro del horario de envío.',
        textoAceptar: 'Encender',
      });
      if (!seguro) return;
    }

    await conCarga(boton, async () => {
      try {
        await peticion('/api/admin/notifications/settings', { metodo: 'PUT', cuerpo });
        cerrar();
        brindis('Listo, guardamos los ajustes de avisos.', 'ok');
        await cargarAvisos();
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso(aviso, error.message, 'error');
      }
    });
  }

  document.body.append(dialogo);
  dialogo.showModal();
}

async function revisarAhora(boton) {
  await conCarga(boton, async () => {
    try {
      const r = await api.post('/api/admin/notifications/run', {});
      const partes = [];
      if (r.enviados) partes.push(plural(r.enviados, 'correo enviado', 'correos enviados'));
      if (r.aplazados) partes.push(`${plural(r.aplazados, 'aviso espera', 'avisos esperan')} al horario de envío`);
      if (r.fallidos) partes.push(plural(r.fallidos, 'fallido', 'fallidos'));
      brindis(partes.length ? `Listo: ${partes.join(', ')}.` : 'Listo: no hay nada que enviar por ahora.', 'ok');
      await cargarAvisos();
    } catch (error) {
      brindis(error.message, 'error');
    }
  });
}

/** Conecta los controles fijos de la sección. Se llama una vez al arrancar. */
export function montarAvisos() {
  $('#btn-avisos-ajustes').addEventListener('click', () => {
    if (estado.datos) abrirAjustes();
  });
  $('#btn-avisos-revisar').addEventListener('click', (e) => revisarAhora(e.currentTarget));
  $('#filtro-avisos-estado').addEventListener('change', async () => {
    try {
      estado.historial = await api.get(rutaHistorial(0));
      pintarHistorial();
    } catch (error) {
      brindis(error.message, 'error');
    }
  });
}

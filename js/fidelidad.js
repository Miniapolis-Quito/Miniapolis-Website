/**
 * Sección «Fidelidad» del panel: el programa «la casa invita».
 *
 * Aquí se decide cada cuántas entradas se regala una, se ve lo que la pista ha
 * invitado —en entradas y en dinero— y a quién le falta poco, que es lo que el
 * mostrador necesita para poder decírselo cuando pasa por recepción.
 */
import { $, el, render, brindis, fecha, relativo, plural, metrica, dinero, conCarga, mostrarAviso, mostrarErroresCampo, confirmar } from './ui.js';
import { api, peticion } from './api.js';

const estado = { datos: null };

/** Con más sellos que esto, la fila de puntos deja de leerse. */
const MAXIMO_DE_SELLOS = 12;

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

export async function cargarFidelidad() {
  estado.datos = await api.get('/api/admin/loyalty');
  pintarEstado();
  pintarMetricas();
  pintarPremios();
  pintarCerca();
}

// ---------------------------------------------------------------------------
// Estado y cifras
// ---------------------------------------------------------------------------

function pintarEstado() {
  const s = estado.datos.status;
  const m = estado.datos.metrics;

  const principal = s.enabled
    ? el(
        'div',
        { class: 'aviso aviso--ok' },
        el(
          'div',
          {},
          el('strong', {}, 'Encendido'),
          ` desde el ${fecha(s.enabledAt, { conHora: false })}: cada ${plural(s.entriesPerReward, 'entrada usada', 'entradas usadas')} ` +
            `se regala${s.rewardTickets === 1 ? '' : 'n'} ${plural(s.rewardTickets, 'entrada', 'entradas')}` +
            `${s.rewardExpiryDays > 0 ? `, con ${plural(s.rewardExpiryDays, 'día', 'días')} para usarlas` : ', sin vencimiento'}.`,
          el(
            'div',
            { class: 'pequeno' },
            s.emailEnabled
              ? 'El premio se le anuncia por correo al cliente.'
              : 'El premio no se anuncia por correo: enciende el aviso «Premio de fidelidad» en Avisos si quieres que se entere por ahí.',
          ),
        ),
      )
    : el(
        'div',
        { class: 'aviso aviso--alerta' },
        'Apagado: no se regala ninguna entrada. Al encenderlo, el contador arranca de cero para todo el mundo — ' +
          'lo que cada cliente usó antes no cuenta.',
      );

  render(
    $('#fidelidad-estado'),
    principal,
    m.pending
      ? el(
          'div',
          { class: 'aviso aviso--alerta mt pequeno' },
          `${plural(m.pending, 'premio ganado', 'premios ganados')} sin entregar todavía (la cuenta estaba suspendida o el ` +
            'servicio se reinició a mitad). Se entregan solos; «Otorgar ahora» lo intenta en el momento.',
        )
      : null,
  );
  $('#btn-fidelidad-revisar').hidden = !s.enabled;
}

function pintarMetricas() {
  const m = estado.datos.metrics;
  render(
    $('#fidelidad-metricas'),
    metrica(String(m.ticketsGiven), 'Entradas regaladas', 'metrica--acento'),
    metrica(String(m.rewardsLast30), 'Premios (30 días)'),
    metrica(dinero(m.costCents, m.currency), 'Valor de lo invitado'),
    metrica(String(m.customersInProgress), 'Clientes sumando entradas'),
  );
}

// ---------------------------------------------------------------------------
// Premios otorgados
// ---------------------------------------------------------------------------

function filaPremio(premio) {
  const detalle = [
    `${plural(premio.tickets, 'entrada', 'entradas')} por ${plural(premio.threshold, 'entrada usada', 'entradas usadas')}`,
    premio.packCode ? `pack ${premio.packCode}` : 'pack pendiente de emitir',
    premio.packRemaining !== null ? `${premio.packRemaining} sin usar` : null,
  ].filter(Boolean);

  return el(
    'li',
    { class: 'lista__item' },
    el(
      'div',
      { class: 'crece' },
      el('a', { class: 'recuperar__nombre', href: `#cliente/${premio.userId}` }, premio.customerName),
      el('div', { class: 'tenue-2 pequeno' }, detalle.join(' · ')),
    ),
    el('span', { class: 'etiqueta pequeno', title: fecha(premio.createdAt) }, relativo(premio.createdAt)),
    premio.pending
      ? el('span', { class: 'etiqueta etiqueta--alerta' }, 'Sin entregar')
      : el('span', { class: 'etiqueta etiqueta--info' }, `Premio ${premio.sequence}`),
  );
}

function pintarPremios() {
  const premios = estado.datos.rewards;
  render(
    $('#fidelidad-premios'),
    premios.length === 0
      ? el(
          'div',
          { class: 'vacio' },
          el('p', { class: 'sin-margen' }, 'Todavía no se ha regalado ninguna entrada.'),
          el('p', { class: 'pequeno sin-margen' }, 'Aparecerán aquí en cuanto alguien complete su tarjeta.'),
        )
      : el('ul', { class: 'lista' }, premios.map(filaPremio)),
  );
}

// ---------------------------------------------------------------------------
// Quién está más cerca
// ---------------------------------------------------------------------------

function sellos(progreso, umbral) {
  if (umbral > MAXIMO_DE_SELLOS) {
    const relleno = el('div', { class: 'barra-progreso__relleno' });
    relleno.style.setProperty('width', `${Math.round((progreso / umbral) * 100)}%`);
    return el('div', { class: 'barra-progreso' }, relleno);
  }
  return el(
    'div',
    { class: 'fidelidad__sellos', 'aria-hidden': 'true' },
    Array.from({ length: umbral }, (_, i) =>
      el('div', { class: `sello${i < progreso ? ' sello--lleno' : ''}${i === umbral - 1 ? ' sello--premio' : ''}` }),
    ),
  );
}

function pintarCerca() {
  const s = estado.datos.status;
  const items = estado.datos.closest;
  render(
    $('#fidelidad-cerca'),
    !s.enabled
      ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'El programa está apagado.'))
      : items.length === 0
        ? el('div', { class: 'vacio' }, el('p', { class: 'sin-margen' }, 'Nadie ha sumado entradas todavía.'))
        : el(
            'ul',
            { class: 'lista' },
            items.map((cliente) =>
              el(
                'li',
                { class: 'lista__item' },
                el(
                  'div',
                  { class: 'crece' },
                  el('a', { class: 'recuperar__nombre', href: `#cliente/${cliente.userId}` }, cliente.fullName),
                  sellos(cliente.progress, s.entriesPerReward),
                  el(
                    'div',
                    { class: 'tenue-2 pequeno' },
                    cliente.lastVisitAt ? `Última visita ${relativo(cliente.lastVisitAt)}` : 'Sin visitas',
                  ),
                ),
                el(
                  'span',
                  { class: `etiqueta ${cliente.remaining <= 1 ? 'etiqueta--ok' : 'etiqueta--info'}` },
                  cliente.remaining === 1 ? 'Le falta 1' : `Le faltan ${cliente.remaining}`,
                ),
              ),
            ),
          ),
  );
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function campoNumero({ id, etiqueta, nombre, valor, minimo, maximo, ayuda }) {
  return el(
    'div',
    { class: 'campo' },
    el('label', { for: id }, etiqueta),
    el('input', {
      id,
      name: nombre,
      type: 'number',
      inputmode: 'numeric',
      min: String(minimo),
      max: String(maximo),
      step: '1',
      value: String(valor),
      required: true,
    }),
    el('div', { class: 'campo__ayuda' }, ayuda),
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
      el('input', { type: 'checkbox', id: 'fid-activo', name: 'enabled', checked: s.enabled }),
      el('label', { for: 'fid-activo' }, el('strong', {}, 'Regalar entradas a los clientes que vuelven')),
    ),
    el(
      'div',
      { class: 'rejilla rejilla--ajustes' },
      campoNumero({
        id: 'fid-umbral',
        etiqueta: 'Cada',
        nombre: 'entriesPerReward',
        valor: s.entriesPerReward,
        minimo: 2,
        maximo: 100,
        ayuda: 'entradas usadas',
      }),
      campoNumero({
        id: 'fid-premio',
        etiqueta: 'Se regalan',
        nombre: 'rewardTickets',
        valor: s.rewardTickets,
        minimo: 1,
        maximo: 20,
        ayuda: 'entradas, menos que las de arriba',
      }),
      campoNumero({
        id: 'fid-vence',
        etiqueta: 'El regalo vence en',
        nombre: 'rewardExpiryDays',
        valor: s.rewardExpiryDays,
        minimo: 0,
        maximo: 365,
        ayuda: 'días; 0 = no vence',
      }),
    ),
    el(
      'p',
      { class: 'tenue-2 pequeno' },
      'Las entradas de cortesía no cuentan para ganar la siguiente, y un consumo anulado devuelve el avance. ' +
        'Bajar el número de arriba entrega en el acto los premios que queden ganados; subirlo no retira ninguno.',
    ),
    aviso,
  );

  const dialogo = el(
    'dialog',
    { 'aria-labelledby': 'ajustes-fidelidad-titulo' },
    el(
      'div',
      { class: 'modal__cuerpo' },
      el('h2', { id: 'ajustes-fidelidad-titulo' }, 'La casa invita'),
      el(
        'p',
        { class: 'tenue pequeno' },
        'El programa de fidelidad regala un pack de cortesía cuando un cliente acumula entradas usadas. ' +
          'Se hace solo: nadie del mostrador tiene que acordarse.',
      ),
      formulario,
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
      entriesPerReward: Number(campo('entriesPerReward').value),
      rewardTickets: Number(campo('rewardTickets').value),
      rewardExpiryDays: Number(campo('rewardExpiryDays').value),
    };

    // Encenderlo es empezar a regalar entradas de verdad: se confirma, y se
    // dice exactamente qué va a pasar con lo que ya está usado.
    if (cuerpo.enabled && !s.enabled) {
      const seguro = await confirmar({
        titulo: 'Encender el programa',
        mensaje:
          `Desde ahora, cada ${plural(cuerpo.entriesPerReward, 'entrada usada', 'entradas usadas')} el cliente recibirá ` +
          `${plural(cuerpo.rewardTickets, 'entrada', 'entradas')} de cortesía, sin que nadie tenga que hacer nada. ` +
          'Lo que cada cliente usó antes de este momento no cuenta: el contador arranca de cero.',
        textoAceptar: 'Encender',
      });
      if (!seguro) return;
    }
    if (!cuerpo.enabled && s.enabled) {
      const seguro = await confirmar({
        titulo: 'Apagar el programa',
        mensaje:
          'Dejará de regalarse nada. Los premios ya entregados se conservan, pero el avance que cada cliente lleva ' +
          'acumulado se pierde: si vuelves a encenderlo, el contador empieza de cero.',
        textoAceptar: 'Apagar',
        peligro: true,
      });
      if (!seguro) return;
    }

    await conCarga(boton, async () => {
      try {
        await peticion('/api/admin/loyalty/settings', { metodo: 'PUT', cuerpo });
        cerrar();
        brindis('Programa de fidelidad guardado.', 'ok');
        await cargarFidelidad();
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso(aviso, error.message, 'error');
      }
    });
  }

  document.body.append(dialogo);
  dialogo.showModal();
}

async function otorgarAhora(boton) {
  await conCarga(boton, async () => {
    try {
      const r = await api.post('/api/admin/loyalty/run', {});
      brindis(
        r.premios
          ? `${plural(r.premios, 'premio entregado', 'premios entregados')} a ${plural(r.clientes, 'cliente', 'clientes')}.`
          : 'Revisado: nadie tiene un premio pendiente ahora mismo.',
        'ok',
      );
      await cargarFidelidad();
    } catch (error) {
      brindis(error.message, 'error');
    }
  });
}

/** Conecta los controles fijos de la sección. Se llama una vez al arrancar. */
export function montarFidelidad() {
  $('#btn-fidelidad-ajustes').addEventListener('click', () => {
    if (estado.datos) abrirAjustes();
  });
  $('#btn-fidelidad-revisar').addEventListener('click', (e) => otorgarAhora(e.currentTarget));
}

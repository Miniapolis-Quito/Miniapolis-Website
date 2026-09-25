/**
 * Sección «Seguridad» del panel del máster.
 *
 * Responde a dos preguntas que hasta ahora no tenían dónde mirarse: quién del
 * equipo tiene puesta la verificación en dos pasos, y si la pista se la exige.
 * Y ofrece el único rescate posible cuando alguien pierde el teléfono y sus
 * códigos de respaldo: quitársela desde aquí, dejando constancia.
 */
import { $, el, render, brindis, fecha, metrica, confirmar, esqueleto } from './ui.js';
import { api, getUsuario } from './api.js';

const estado = { datos: null };

const ROLES = { staff: 'Personal', master: 'Máster' };

export async function cargarSeguridad() {
  render($('#seguridad-estado'), esqueleto(2));
  estado.datos = await api.get('/api/admin/security');
  pintarEstado();
  pintarMetricas();
  pintarEquipo();
}

function pintarEstado() {
  const datos = estado.datos;
  const yo = estado.datos.equipo.find((p) => p.id === getUsuario()?.id);

  const interruptor = el('input', {
    type: 'checkbox',
    id: 'seguridad-exigir',
    checked: datos.requireTwoFactorForStaff,
    // Exigirla sin tenerla puesta dejaría al propio máster fuera del panel; el
    // servidor lo rechaza igual, pero aquí se explica antes de intentarlo.
    disabled: !datos.requireTwoFactorForStaff && !yo?.twoFactorEnabled,
  });

  interruptor.addEventListener('change', async () => {
    const activar = interruptor.checked;
    if (activar) {
      const seguro = await confirmar({
        titulo: 'Exigir verificación en dos pasos',
        mensaje:
          `Quien trabaje en la pista y no la tenga puesta (${datos.sinSegundoFactor} cuenta(s) ahora mismo) ` +
          'no podrá escanear ni abrir la administración hasta activarla. Podrá entrar a su cuenta y configurarla.',
        textoAceptar: 'Exigirla',
      });
      if (!seguro) {
        interruptor.checked = false;
        return;
      }
    }
    interruptor.disabled = true;
    try {
      estado.datos = await api.patch('/api/admin/security', { requireTwoFactorForStaff: activar });
      brindis(activar ? 'El segundo paso es obligatorio para el equipo.' : 'El segundo paso vuelve a ser opcional.', 'ok');
      pintarEstado();
      pintarMetricas();
      pintarEquipo();
    } catch (error) {
      interruptor.checked = !activar;
      interruptor.disabled = false;
      brindis(error.message, 'error');
    }
  });

  render(
    $('#seguridad-estado'),
    el(
      'div',
      { class: datos.requireTwoFactorForStaff ? 'aviso aviso--ok' : 'aviso aviso--alerta' },
      datos.requireTwoFactorForStaff
        ? el(
            'div',
            {},
            el('strong', {}, 'Obligatoria'),
            datos.requiredAt ? ` desde el ${fecha(datos.requiredAt, { conHora: false })}.` : '.',
            datos.sinSegundoFactor > 0
              ? el(
                  'div',
                  { class: 'pequeno' },
                  `${datos.sinSegundoFactor} cuenta(s) del equipo siguen sin activarla: tienen los permisos en suspenso hasta que lo hagan.`,
                )
              : el('div', { class: 'pequeno' }, 'Todo el equipo la tiene puesta.'),
          )
        : el(
            'div',
            {},
            el('strong', {}, 'Opcional'),
            ': cada persona decide. La contraseña es lo único que protege el escáner y la administración.',
          ),
    ),
    el(
      'div',
      { class: 'campo campo--linea mt' },
      interruptor,
      el('label', { for: 'seguridad-exigir' }, 'Exigir verificación en dos pasos al personal y al máster'),
    ),
    !datos.requireTwoFactorForStaff && !yo?.twoFactorEnabled
      ? el(
          'p',
          { class: 'tenue pequeno sin-margen' },
          'Para poder exigirla, actívala primero en tu propia cuenta desde «Seguridad», arriba.',
        )
      : null,
  );
}

function pintarMetricas() {
  const datos = estado.datos;
  render(
    $('#seguridad-metricas'),
    metrica(String(datos.total), 'Cuentas con permisos'),
    metrica(String(datos.conSegundoFactor), 'Con segundo factor', 'metrica--acento'),
    metrica(String(datos.sinSegundoFactor), 'Sin segundo factor'),
  );
}

function pintarEquipo() {
  const filas = estado.datos.equipo.map((persona) =>
    el(
      'tr',
      {},
      el('td', {}, el('div', {}, persona.fullName), el('div', { class: 'tenue pequeno' }, persona.email)),
      el('td', {}, ROLES[persona.role] ?? persona.role),
      el(
        'td',
        {},
        persona.twoFactorEnabled
          ? el(
              'span',
              { class: 'etiqueta etiqueta--ok' },
              `Sí${persona.twoFactorSince ? ` · desde el ${fecha(persona.twoFactorSince, { conHora: false })}` : ''}`,
            )
          : el('span', { class: 'etiqueta etiqueta--alerta' }, 'No'),
      ),
      el('td', {}, persona.twoFactorEnabled ? `${persona.recoveryCodesLeft} de respaldo` : '—'),
      el(
        'td',
        { class: 'derecha' },
        persona.twoFactorEnabled
          ? el(
              'button',
              {
                class: 'boton boton--fantasma boton--chico',
                type: 'button',
                onClick: () => quitarSegundoFactor(persona),
              },
              'Quitar',
            )
          : null,
      ),
    ),
  );

  render(
    $('#seguridad-equipo'),
    el(
      'div',
      { class: 'tabla-envoltura' },
      el(
        'table',
        { class: 'tabla' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Persona'),
            el('th', {}, 'Rol'),
            el('th', {}, 'Dos pasos'),
            el('th', {}, 'Códigos'),
            el('th', { class: 'derecha' }, 'Acciones'),
          ),
        ),
        el('tbody', {}, filas),
      ),
    ),
  );
}

async function quitarSegundoFactor(persona) {
  const seguro = await confirmar({
    titulo: `Quitar el segundo paso a ${persona.fullName}`,
    mensaje:
      'Solo para cuando alguien perdió el teléfono y sus códigos de respaldo. Su cuenta volverá a entrar únicamente ' +
      'con la contraseña, se cerrarán sus sesiones abiertas, recibirá un correo y quedará constancia en la bitácora.',
    textoAceptar: 'Quitarlo',
    peligro: true,
  });
  if (!seguro) return;
  try {
    await api.post(`/api/admin/users/${persona.id}/2fa/disable`);
    brindis(`${persona.fullName} tendrá que volver a configurarla.`, 'ok');
    await cargarSeguridad();
  } catch (error) {
    brindis(error.message, 'error');
  }
}

export function montarSeguridadPanel() {
  $('#btn-seguridad-recargar')?.addEventListener('click', () => {
    cargarSeguridad().catch((error) => brindis(error.message, 'error'));
  });
}

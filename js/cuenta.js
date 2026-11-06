/**
 * Cambio de contraseña desde la cabecera.
 *
 * Los clientes lo tienen en «Mi cuenta»; el personal y el máster no tenían
 * dónde cambiar la suya, y son las cuentas que más importa proteger.
 */
import { el, mostrarAviso, mostrarErroresCampo, conCarga, brindis } from './ui.js';
import { cambiarPassword } from './api.js';

function campo(id, etiqueta, nombre, autocompletar) {
  return el(
    'div',
    { class: 'campo' },
    el('label', { for: id }, etiqueta),
    el('input', { id, name: nombre, type: 'password', autocomplete: autocompletar, required: true }),
    el('div', { class: 'campo__error' }),
  );
}

export function abrirCambioPassword() {
  const aviso = el('div', { class: 'aviso', role: 'status', hidden: true });
  const formulario = el(
    'form',
    { novalidate: true },
    campo('cambio-actual', 'Contraseña actual', 'currentPassword', 'current-password'),
    campo('cambio-nueva', 'Contraseña nueva', 'newPassword', 'new-password'),
    campo('cambio-confirmar', 'Repite la contraseña nueva', 'confirmPassword', 'new-password'),
    aviso,
    el('button', { class: 'boton boton--principal', type: 'submit' }, 'Cambiar contraseña'),
  );

  const dialogo = el(
    'dialog',
    { 'aria-labelledby': 'cambio-titulo' },
    el(
      'div',
      { class: 'modal__cuerpo' },
      el('h2', { id: 'cambio-titulo' }, 'Cambiar mi contraseña'),
      el('p', { class: 'tenue pequeno' }, 'Al cambiarla se cierra la sesión en tus demás dispositivos.'),
      formulario,
    ),
    el(
      'div',
      { class: 'modal__pie' },
      el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => cerrar() }, 'Cerrar'),
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

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso(aviso, '');
    mostrarErroresCampo(formulario, {});

    // Sin recortar espacios: la contraseña se manda tal cual se escribió.
    const valor = (nombre) => formulario.querySelector(`[name="${nombre}"]`).value;
    if (valor('newPassword') !== valor('confirmPassword')) {
      mostrarErroresCampo(formulario, { confirmPassword: 'Las dos contraseñas no coinciden.' });
      return;
    }

    await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
      try {
        await cambiarPassword(valor('currentPassword'), valor('newPassword'));
        formulario.reset();
        mostrarAviso(aviso, 'Contraseña cambiada. Cerramos la sesión en tus demás dispositivos.', 'ok');
        brindis('Contraseña actualizada.', 'ok');
      } catch (error) {
        mostrarErroresCampo(formulario, error.campos || {});
        mostrarAviso(aviso, error.message, 'error');
      }
    });
  });

  document.body.append(dialogo);
  dialogo.showModal();
  formulario.querySelector('input')?.focus();
}

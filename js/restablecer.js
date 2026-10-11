/** Página del enlace de recuperación: elegir una contraseña nueva. */
import { $, mostrarAviso, mostrarErroresCampo, conCarga } from './ui.js';
import { aplicarMarca } from './shell.js';

const aviso = $('#aviso');
const formulario = $('#form-restablecer');
const comprobando = $('#comprobando');
const accionesFinal = $('#acciones-final');

/**
 * Lee el token del fragmento de la dirección y lo borra de la barra en el acto:
 * así no queda en el historial, no se copia al compartir la pantalla y no
 * sobrevive a una recarga. El fragmento nunca llega al servidor.
 */
function tomarToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

const token = tomarToken();

/** POST sin sesión: esta página no usa el token de acceso aunque haya uno. */
async function enviar(ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: 'POST',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw Object.assign(new Error('No hay conexión con el servidor. Revisa tu Internet e intenta de nuevo.'), {
      codigo: 'sin_conexion',
    });
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw Object.assign(new Error(datos?.error?.message || 'No pudimos completar la operación.'), {
      codigo: datos?.error?.code,
      campos: datos?.error?.details?.fields || null,
    });
  }
  return datos;
}

function enlaceNoValido(mensaje) {
  comprobando.hidden = true;
  formulario.hidden = true;
  mostrarAviso(aviso, mensaje || 'Este enlace ya no sirve. Pide uno nuevo desde la página de acceso.', 'error');
  accionesFinal.hidden = false;
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formulario, {});

  // Sin recortar espacios: la contraseña se manda tal cual se escribió.
  const nueva = $('#nueva-password').value;
  if (nueva !== $('#confirmar-password').value) {
    mostrarErroresCampo(formulario, { confirmPassword: 'Las contraseñas no coinciden.' });
    return;
  }

  await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
    try {
      const datos = await enviar('/api/auth/password/reset', { token, newPassword: nueva });
      formulario.reset();
      formulario.hidden = true;
      mostrarAviso(aviso, datos.message, 'ok');
      accionesFinal.hidden = false;
    } catch (error) {
      if (error.codigo === 'enlace_invalido') {
        enlaceNoValido(error.message);
        return;
      }
      mostrarErroresCampo(formulario, error.campos || {});
      mostrarAviso(aviso, error.message, 'error');
    }
  });
});

(async () => {
  fetch('/api/config')
    .then((r) => r.json())
    .then((configuracion) => {
      aplicarMarca(configuracion);
      $('#ayuda-password').textContent =
        `Mínimo ${configuracion.minPasswordLength} caracteres. Distinta a la anterior.`;
    })
    .catch(() => {});

  if (!token) {
    enlaceNoValido();
    return;
  }
  try {
    await enviar('/api/auth/password/reset/check', { token });
  } catch (error) {
    enlaceNoValido(error.codigo === 'sin_conexion' ? error.message : undefined);
    return;
  }
  comprobando.hidden = true;
  formulario.hidden = false;
  $('#nueva-password').focus();
})();

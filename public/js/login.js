/** Página de acceso: iniciar sesión y crear cuenta. */
import { $, mostrarAviso, mostrarErroresCampo, datosFormulario, conCarga } from './ui.js';
import { iniciarSesion, registrarse, refrescarSesion, destinoPorRol, ErrorApi, ErrorRed } from './api.js';
import { aplicarMarca } from './shell.js';

const aviso = $('#aviso');
const formEntrar = $('#form-entrar');
const formRegistro = $('#form-registro');
const pestanaEntrar = $('#pestana-entrar');
const pestanaRegistro = $('#pestana-registro');

/** Vuelve a la página que el usuario intentaba abrir, si es una ruta interna. */
function destino(rol) {
  const volver = new URLSearchParams(window.location.search).get('volver');
  if (volver && /^\/(app|escanear|admin)$/.test(volver)) return volver;
  return destinoPorRol(rol);
}

function seleccionarPestana(cual) {
  const esEntrar = cual === 'entrar';
  pestanaEntrar.setAttribute('aria-selected', String(esEntrar));
  pestanaRegistro.setAttribute('aria-selected', String(!esEntrar));
  formEntrar.hidden = !esEntrar;
  formRegistro.hidden = esEntrar;
  mostrarAviso(aviso, '');
  (esEntrar ? formEntrar : formRegistro).querySelector('input')?.focus();
}

pestanaEntrar.addEventListener('click', () => seleccionarPestana('entrar'));
pestanaRegistro.addEventListener('click', () => seleccionarPestana('registro'));

function manejarError(error, formulario) {
  if (error instanceof ErrorRed) {
    mostrarAviso(aviso, error.message, 'alerta');
    return;
  }
  if (error instanceof ErrorApi) {
    mostrarErroresCampo(formulario, error.campos || {});
    mostrarAviso(aviso, error.message, error.status === 429 ? 'alerta' : 'error');
    return;
  }
  mostrarAviso(aviso, 'Ocurrió un error inesperado. Inténtalo de nuevo.', 'error');
  console.error(error);
}

formEntrar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formEntrar, {});
  const datos = datosFormulario(formEntrar);

  await conCarga(formEntrar.querySelector('button[type="submit"]'), async () => {
    try {
      const sesion = await iniciarSesion(datos.email, datos.password);
      window.location.replace(destino(sesion.user.role));
    } catch (error) {
      manejarError(error, formEntrar);
    }
  });
});

formRegistro.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formRegistro, {});
  const datos = datosFormulario(formRegistro);
  if (!datos.phone) delete datos.phone;

  await conCarga(formRegistro.querySelector('button[type="submit"]'), async () => {
    try {
      const sesion = await registrarse(datos);
      window.location.replace(destino(sesion.user.role));
    } catch (error) {
      manejarError(error, formRegistro);
    }
  });
});

// Configuración pública: marca, longitud mínima de contraseña y si el registro
// está abierto.
(async () => {
  try {
    const configuracion = await fetch('/api/config').then((r) => r.json());
    aplicarMarca(configuracion);
    $('#ayuda-password').textContent =
      `Mínimo ${configuracion.minPasswordLength} caracteres. Usa algo que solo tú recuerdes.`;
    if (!configuracion.allowSelfRegistration) {
      pestanaRegistro.hidden = true;
      formRegistro.hidden = true;
    }
  } catch {
    /* la página funciona igual con los textos por defecto */
  }

  // Si ya hay una sesión válida en la cookie, se entra directo.
  try {
    const sesion = await refrescarSesion();
    window.location.replace(destino(sesion.user.role));
  } catch {
    $('#entrar-email')?.focus();
  }
})();

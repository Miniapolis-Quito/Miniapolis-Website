/** Página de acceso: iniciar sesión y crear cuenta. */
import { $, mostrarAviso, mostrarErroresCampo, datosFormulario, conCarga } from './ui.js';
import {
  api,
  iniciarSesion,
  completarSegundoPaso,
  registrarse,
  refrescarSesion,
  destinoPorRol,
  ErrorApi,
  ErrorRed,
} from './api.js';
import { aplicarMarca } from './shell.js';

const aviso = $('#aviso');
const formEntrar = $('#form-entrar');
const formRegistro = $('#form-registro');
const pestanaEntrar = $('#pestana-entrar');
const pestanaRegistro = $('#pestana-registro');
const formRecuperar = $('#form-recuperar');
const formSegundoPaso = $('#form-segundo-paso');
const zonaOlvido = $('#zona-olvido');
const entrarPassword = $('#entrar-password');
const btnVerPassword = $('#btn-ver-password');

/**
 * Desafío en curso del segundo paso. Vive solo en memoria y solo mientras se
 * escribe el código: ni localStorage ni cookie, para que cerrar la pestaña a
 * medias no deje nada aprovechable.
 */
let desafioEnCurso = null;

/** Lo decide /api/config: sin correo configurado no se ofrece. */
let recuperacionDisponible = false;

/** Alterna la visibilidad sin cambiar el valor ni el flujo de acceso. */
btnVerPassword.addEventListener('click', () => {
  const mostrar = entrarPassword.type === 'password';
  entrarPassword.type = mostrar ? 'text' : 'password';
  btnVerPassword.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  btnVerPassword.setAttribute('aria-label', `${mostrar ? 'Ocultar' : 'Mostrar'} contraseña`);
  btnVerPassword.setAttribute('aria-pressed', String(mostrar));
});

/** Vuelve a la página que el usuario intentaba abrir, si es una ruta interna. */
function destino(usuario) {
  const volver = new URLSearchParams(window.location.search).get('volver');
  // No se devuelve a nadie al escáner si su cuenta no puede usarlo.
  const permitido = volver === '/escanear' ? usuario?.scanEnabled === true : true;
  if (volver && permitido && /^\/(app|escanear|admin)$/.test(volver)) return volver;
  return destinoPorRol(usuario);
}

function seleccionarPestana(cual) {
  const esEntrar = cual === 'entrar';
  pestanaEntrar.setAttribute('aria-selected', String(esEntrar));
  pestanaRegistro.setAttribute('aria-selected', String(!esEntrar));
  formEntrar.hidden = !esEntrar;
  formRegistro.hidden = esEntrar;
  formRecuperar.hidden = true;
  formSegundoPaso.hidden = true;
  desafioEnCurso = null;
  zonaOlvido.hidden = !esEntrar || !recuperacionDisponible;
  mostrarAviso(aviso, '');
  (esEntrar ? formEntrar : formRegistro).querySelector('input')?.focus({ preventScroll: true });
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
  mostrarAviso(aviso, 'Algo salió mal. Intenta de nuevo.', 'error');
  console.error(error);
}

$('#btn-olvido').addEventListener('click', () => {
  formEntrar.hidden = true;
  formRegistro.hidden = true;
  formRecuperar.hidden = false;
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formRecuperar, {});
  // Si ya escribió su correo para entrar, no hace falta repetirlo.
  const correo = $('#entrar-email').value.trim();
  if (correo) $('#recuperar-email').value = correo;
  $('#recuperar-email').focus();
});

$('#btn-volver-entrar').addEventListener('click', () => seleccionarPestana('entrar'));

formRecuperar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formRecuperar, {});
  const datos = datosFormulario(formRecuperar);

  await conCarga(formRecuperar.querySelector('button[type="submit"]'), async () => {
    try {
      const respuesta = await api.post('/api/auth/password/forgot', { email: datos.email });
      formRecuperar.reset();
      mostrarAviso(aviso, respuesta.message, 'ok');
    } catch (error) {
      manejarError(error, formRecuperar);
    }
  });
});

/** Muestra el segundo paso y deja el foco en el código. */
function pedirSegundoPaso(datos) {
  desafioEnCurso = datos.challengeToken;
  formEntrar.hidden = true;
  formRegistro.hidden = true;
  formRecuperar.hidden = true;
  zonaOlvido.hidden = true;
  formSegundoPaso.hidden = false;
  mostrarErroresCampo(formSegundoPaso, {});
  $('#segundo-paso-codigo').value = '';
  $('#segundo-paso-codigo').focus();
}

$('#btn-cancelar-segundo-paso').addEventListener('click', () => {
  // El desafío se abandona: si alguien vuelve, empieza por la contraseña.
  seleccionarPestana('entrar');
  $('#entrar-password').value = '';
});

formSegundoPaso.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formSegundoPaso, {});
  const codigo = $('#segundo-paso-codigo').value.trim();
  if (!codigo) {
    mostrarErroresCampo(formSegundoPaso, { code: 'Escribe el código.' });
    return;
  }

  await conCarga(formSegundoPaso.querySelector('button[type="submit"]'), async () => {
    try {
      const sesion = await completarSegundoPaso(desafioEnCurso, codigo);
      window.location.replace(destino(sesion.user));
    } catch (error) {
      // Si el desafío caducó o se agotaron los intentos, se vuelve al principio:
      // insistir con el código ya no lleva a ninguna parte.
      const caducado =
        error instanceof ErrorApi &&
        (error.codigo === 'dos_factores_desafio_invalido' || error.status === 429 || error.status === 403);
      manejarError(error, formSegundoPaso);
      if (caducado) {
        const mensaje = error.message;
        seleccionarPestana('entrar');
        mostrarAviso(aviso, mensaje, 'alerta');
      } else {
        $('#segundo-paso-codigo').select();
      }
    }
  });
});

formEntrar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarAviso(aviso, '');
  mostrarErroresCampo(formEntrar, {});
  const datos = datosFormulario(formEntrar);

  await conCarga(formEntrar.querySelector('button[type="submit"]'), async () => {
    try {
      const sesion = await iniciarSesion(datos.email, datos.password);
      if (sesion.twoFactorRequired) {
        pedirSegundoPaso(sesion);
        return;
      }
      window.location.replace(destino(sesion.user));
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
      window.location.replace(destino(sesion.user));
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
    recuperacionDisponible = Boolean(configuracion.passwordRecovery);
    zonaOlvido.hidden = formEntrar.hidden || !recuperacionDisponible;
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
    window.location.replace(destino(sesion.user));
  } catch {
    $('#entrar-email')?.focus({ preventScroll: true });
  }
})();

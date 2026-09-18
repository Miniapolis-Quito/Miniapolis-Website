/**
 * Cliente HTTP de la aplicación.
 *
 * El token de acceso vive solo en memoria: nunca se guarda en localStorage, así
 * que un script inyectado no puede robarlo ni sobrevive al cierre de la pestaña.
 * La sesión persiste gracias a la cookie httpOnly de refresco, que el navegador
 * envía únicamente a /api/auth y que JavaScript no puede leer.
 */

let accessToken = null;
let usuarioActual = null;
let refrescoEnCurso = null;
let cierreExplicito = false;
const oyentesSesion = new Set();

export function getUsuario() {
  return usuarioActual;
}

export function estaAutenticado() {
  return Boolean(accessToken && usuarioActual);
}

/** Avisa a la interfaz cuando la sesión cambia (entrar, salir, expirar). */
export function onSesion(callback) {
  oyentesSesion.add(callback);
  return () => oyentesSesion.delete(callback);
}

function emitirSesion() {
  for (const callback of oyentesSesion) {
    try {
      callback(usuarioActual);
    } catch (error) {
      console.error('Error en oyente de sesión', error);
    }
  }
}

function guardarSesion(datos) {
  accessToken = datos.accessToken ?? accessToken;
  if (datos.user) usuarioActual = datos.user;
  emitirSesion();
  return datos;
}

/**
 * Quién trabajaba en este teléfono, para que el escáner pueda abrir sin red
 * (ver escaner.js). Solo vale mientras esa sesión siga siendo la de este
 * navegador: se olvida al entrar con cualquier cuenta, al salir desde cualquier
 * página y cuando el servidor da la sesión por perdida. El escáner la vuelve a
 * guardar cada vez que abre con conexión.
 */
const CLAVE_OPERADOR_SIN_CONEXION = 'rh_escaner:operador';

function olvidarOperadorSinConexion() {
  try {
    localStorage.removeItem(CLAVE_OPERADOR_SIN_CONEXION);
  } catch {
    /* almacenamiento bloqueado: no hay nada guardado que olvidar */
  }
}

export function limpiarSesion() {
  accessToken = null;
  usuarioActual = null;
  olvidarOperadorSinConexion();
  emitirSesion();
}

/**
 * Deja la página funcionando con una identidad conocida pero sin token.
 *
 * Solo lo usa el escáner cuando arranca sin conexión: sabe quién trabajaba en
 * ese teléfono y lo muestra, pero nada autenticado sale de la página hasta que
 * vuelva la red y se renueve la sesión de verdad. Si para entonces la sesión ya
 * no vale, se limpia como cualquier otra.
 */
export function usarSesionSinConexion(usuario) {
  accessToken = null;
  usuarioActual = usuario;
  emitirSesion();
}

export class ErrorApi extends Error {
  constructor(status, cuerpo) {
    const mensaje = cuerpo?.error?.message || 'No pudimos completar la operación.';
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.codigo = cuerpo?.error?.code || 'error';
    this.detalles = cuerpo?.error?.details || null;
    this.campos = cuerpo?.error?.details?.fields || null;
  }
}

export class ErrorRed extends Error {
  constructor() {
    super('Sin conexión con el servidor. Revisa tu Internet e inténtalo de nuevo.');
    this.name = 'ErrorRed';
    this.status = 0;
    this.codigo = 'sin_conexion';
  }
}

async function leerCuerpo(respuesta) {
  const tipo = respuesta.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    try {
      return await respuesta.json();
    } catch {
      return null;
    }
  }
  return null;
}

/** Renueva el token de acceso usando la cookie de refresco. */
export async function refrescarSesion() {
  // Varias peticiones que caducan a la vez comparten un único refresco.
  if (refrescoEnCurso) return refrescoEnCurso;

  refrescoEnCurso = (async () => {
    let respuesta;
    try {
      respuesta = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'fetch' },
      });
    } catch {
      throw new ErrorRed();
    }
    if (!respuesta.ok) {
      limpiarSesion();
      throw new ErrorApi(respuesta.status, await leerCuerpo(respuesta));
    }
    return guardarSesion(await respuesta.json());
  })().finally(() => {
    refrescoEnCurso = null;
  });

  return refrescoEnCurso;
}

/**
 * Petición autenticada. Si el token caducó, lo renueva y reintenta una vez.
 */
export async function peticion(ruta, opciones = {}) {
  const { metodo = 'GET', cuerpo, idempotencyKey, cabeceras = {}, _reintento = false, señal, comoBlob = false } = opciones;

  const headers = { 'X-Requested-With': 'fetch', ...cabeceras };
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      credentials: 'same-origin',
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: señal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ErrorRed();
  }

  if (respuesta.status === 401 && !_reintento && !ruta.startsWith('/api/auth/refresh')) {
    try {
      await refrescarSesion();
    } catch {
      limpiarSesion();
      throw new ErrorApi(401, await leerCuerpo(respuesta));
    }
    return peticion(ruta, { ...opciones, _reintento: true });
  }

  if (respuesta.status === 204) return null;

  const tipo = respuesta.headers.get('content-type') || '';
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status, await leerCuerpo(respuesta));
  }
  // Un archivo se devuelve en crudo. Leerlo como texto no sirve: al decodificar
  // se descarta la marca de orden de bytes del principio, que es justo lo que
  // hace que Excel abra los acentos bien.
  if (comoBlob) return respuesta.blob();
  if (tipo.includes('application/json')) return respuesta.json();
  return respuesta.text();
}

export const api = {
  get: (ruta, opciones) => peticion(ruta, { ...opciones, metodo: 'GET' }),
  post: (ruta, cuerpo, opciones) => peticion(ruta, { ...opciones, metodo: 'POST', cuerpo }),
  patch: (ruta, cuerpo, opciones) => peticion(ruta, { ...opciones, metodo: 'PATCH', cuerpo }),
  del: (ruta, opciones) => peticion(ruta, { ...opciones, metodo: 'DELETE' }),
};

/** Token actual, para las conexiones SSE que se abren con fetch. */
export function tokenActual() {
  return accessToken;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

/**
 * Primer paso del acceso.
 *
 * Con verificación en dos pasos, el servidor no devuelve sesión sino un
 * desafío: `{ twoFactorRequired: true, challengeToken }`. Ese token no se
 * guarda en ninguna parte del navegador —vive en la variable de quien llama
 * mientras se escribe el código— y no sirve para nada más que para el segundo
 * paso.
 */
export async function iniciarSesion(email, password) {
  const datos = await peticion('/api/auth/login', { metodo: 'POST', cuerpo: { email, password } });
  olvidarOperadorSinConexion();
  if (datos?.twoFactorRequired) return datos;
  return guardarSesion(datos);
}

/** Segundo paso: el código de la aplicación o uno de respaldo. */
export async function completarSegundoPaso(challengeToken, code) {
  const datos = await peticion('/api/auth/login/2fa', {
    metodo: 'POST',
    cuerpo: { challengeToken, code },
  });
  olvidarOperadorSinConexion();
  return guardarSesion(datos);
}

export async function registrarse(datos) {
  const respuesta = await peticion('/api/auth/register', { metodo: 'POST', cuerpo: datos });
  olvidarOperadorSinConexion();
  return guardarSesion(respuesta);
}

/**
 * Cambio de contraseña hecho desde esta pestaña.
 *
 * Al cambiar la contraseña el servidor cierra todas las sesiones y avisa por el
 * canal en vivo para que las demás pantallas vuelvan a la de acceso. Ese aviso
 * también le llega a la pestaña que hizo el cambio —a veces antes que la
 * respuesta con su sesión nueva—, y la echaba a la página de acceso justo
 * después de decirle «contraseña cambiada». Por eso se deja constancia del
 * cambio en curso: el canal en vivo espera a que termine y, si salió bien,
 * sigue con la sesión nueva en vez de cerrar.
 */
const MARGEN_CAMBIO_PROPIO_MS = 30_000;
let cambioPropio = null;

export async function cambiarPassword(currentPassword, newPassword) {
  const peticionCambio = peticion('/api/auth/change-password', {
    metodo: 'POST',
    cuerpo: { currentPassword, newPassword },
  }).then(guardarSesion);
  const registro = { salioBien: peticionCambio.then(() => true, () => false), hasta: Infinity };
  cambioPropio = registro;
  try {
    const datos = await peticionCambio;
    registro.hasta = Date.now() + MARGEN_CAMBIO_PROPIO_MS;
    return datos;
  } catch (error) {
    if (cambioPropio === registro) cambioPropio = null;
    throw error;
  }
}

/**
 * Si esta pestaña está cambiando su contraseña o acaba de hacerlo, devuelve una
 * promesa que dice si salió bien. Si no, `null`: el aviso de sesión invalidada
 * vino de otro sitio y hay que hacerle caso.
 */
export function cambioDePasswordPropio() {
  if (!cambioPropio) return null;
  if (Date.now() > cambioPropio.hasta) {
    cambioPropio = null;
    return null;
  }
  return cambioPropio.salioBien;
}

export async function cerrarSesion() {
  // Marca la salida como voluntaria para que el vigilante de sesión no añada
  // un "volver a esta página" al enlace de acceso.
  cierreExplicito = true;
  // Antes de la petición: si no llega a responder, el escáner igual no debe
  // poder abrir sin red con la sesión que se acaba de cerrar.
  olvidarOperadorSinConexion();
  try {
    await peticion('/api/auth/logout', { metodo: 'POST' });
  } catch {
    // Aunque falle en el servidor, la sesión local se limpia igual.
  }
  limpiarSesion();
}

/**
 * Restaura la sesión al cargar una página. Devuelve el usuario o null.
 * Si `rolesPermitidos` se indica y el usuario no cumple, redirige.
 */
export async function iniciarPagina({ rolesPermitidos = null, exigirEscaner = false, redirigirSiAnonimo = '/' } = {}) {
  try {
    const datos = await refrescarSesion();
    if (rolesPermitidos && !rolesPermitidos.includes(datos.user.role)) {
      window.location.replace(destinoPorRol(datos.user));
      return null;
    }
    // El permiso de escaneo no redirige: la página lo explica en pantalla, que
    // es más útil que devolver a alguien a su inicio sin decirle por qué.
    if (exigirEscaner && !puedeEscanear(datos.user)) {
      return { ...datos, sinPermisoDeEscaneo: true };
    }
    return datos;
  } catch (error) {
    if (error instanceof ErrorRed) throw error;
    if (redirigirSiAnonimo) {
      const destino = new URL(redirigirSiAnonimo, window.location.origin);
      destino.searchParams.set('volver', window.location.pathname);
      window.location.replace(destino.pathname + destino.search);
    }
    return null;
  }
}

/**
 * Manda a la pantalla de acceso en cuanto la sesión deja de ser válida.
 *
 * Sin esto, si la sesión caduca o un administrador la revoca mientras alguien
 * está usando la página, esa persona se queda en una pantalla que ya no
 * responde y cada acción falla sin explicación.
 */
export function redirigirAlPerderSesion() {
  let redirigiendo = false;
  return onSesion((usuario) => {
    if (usuario || redirigiendo) return;
    redirigiendo = true;
    if (cierreExplicito) {
      window.location.replace('/');
      return;
    }
    const destino = new URL('/', window.location.origin);
    destino.searchParams.set('volver', window.location.pathname);
    window.location.replace(destino.pathname + destino.search);
  });
}

/**
 * Página de inicio de cada persona.
 *
 * El escáner solo es destino si la cuenta tiene permiso para usarlo: mandar
 * allí a alguien del personal sin autorizar lo dejaría mirando una pantalla
 * que no puede usar.
 */
export function destinoPorRol(usuario) {
  if (usuario?.role === 'master') return '/admin';
  if (usuario?.role === 'staff') return puedeEscanear(usuario) ? '/escanear' : '/app';
  return '/app';
}

/** ¿Esta cuenta puede usar el escáner de la puerta? */
export function puedeEscanear(usuario = getUsuario()) {
  return Boolean(usuario) && usuario.scanEnabled === true && (usuario.role === 'staff' || usuario.role === 'master');
}

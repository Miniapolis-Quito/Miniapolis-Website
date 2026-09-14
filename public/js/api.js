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

export function limpiarSesion() {
  accessToken = null;
  usuarioActual = null;
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

export async function iniciarSesion(email, password) {
  const datos = await peticion('/api/auth/login', { metodo: 'POST', cuerpo: { email, password } });
  return guardarSesion(datos);
}

export async function registrarse(datos) {
  const respuesta = await peticion('/api/auth/register', { metodo: 'POST', cuerpo: datos });
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
export async function iniciarPagina({ rolesPermitidos = null, redirigirSiAnonimo = '/' } = {}) {
  try {
    const datos = await refrescarSesion();
    if (rolesPermitidos && !rolesPermitidos.includes(datos.user.role)) {
      window.location.replace(destinoPorRol(datos.user.role));
      return null;
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

export function destinoPorRol(rol) {
  if (rol === 'master') return '/admin';
  if (rol === 'staff') return '/escanear';
  return '/app';
}

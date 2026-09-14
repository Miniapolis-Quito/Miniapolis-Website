/**
 * Recuperación de contraseña por correo y cambio de contraseña con sesión.
 *
 * El correo sale por el transporte `memoria`, así que se comprueba exactamente
 * lo que recibiría la persona: a quién va, qué enlace lleva y qué no lleva.
 */
import './env-recuperacion.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente, CLAVES } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { buzonDePrueba, vaciarBuzon } from '../src/lib/correo.js';
import * as recuperacion from '../src/services/recuperacion.js';

let baseUrl;
before(async () => {
  baseUrl = await levantarServidor();
});
after(bajarServidor);
beforeEach(() => {
  limpiarBase();
  vaciarBuzon();
});

const NUEVA = 'Curva-Peraltada-2026';

async function pedirEnlace(email, opciones) {
  const r = await crearCliente().post('/api/auth/password/forgot', { email }, opciones);
  await recuperacion.esperarTareas();
  return r;
}

function correosPara(direccion) {
  return buzonDePrueba().filter((c) => c.para === direccion);
}

function tokenDe(correo) {
  const encontrado = /\/restablecer#token=([A-Za-z0-9_-]{43})/.exec(correo.texto);
  assert.ok(encontrado, 'el correo debería traer el enlace');
  return encontrado[1];
}

/** Vacía las cuotas por dirección, para pedir varios enlaces seguidos en una prueba. */
function sinCuotasDeCorreo() {
  getDb().prepare("DELETE FROM rate_limits WHERE key LIKE 'recuperacion-%'").run();
}

const comprobar = (token) => crearCliente().post('/api/auth/password/reset/check', { token });
const restablecer = (token, newPassword = NUEVA) =>
  crearCliente().post('/api/auth/password/reset', { token, newPassword });

// ---------------------------------------------------------------------------
// Pedir el enlace
// ---------------------------------------------------------------------------

test('la configuración pública anuncia la recuperación', async () => {
  const r = await crearCliente().get('/api/config');
  assert.equal(r.datos.passwordRecovery, true);
});

test('pedir el enlace responde igual exista o no la cuenta, y solo escribe a quien la tiene', async () => {
  await sembrarUsuarios();
  const existe = await pedirEnlace('cliente@pista.ec');
  const noExiste = await pedirEnlace('nadie@pista.ec');

  assert.equal(existe.status, 202);
  assert.equal(noExiste.status, 202);
  assert.deepEqual(noExiste.datos, existe.datos);

  assert.equal(buzonDePrueba().length, 1);
  const [correo] = buzonDePrueba();
  assert.equal(correo.para, 'cliente@pista.ec');
  assert.match(correo.texto, /https:\/\/entradas\.example\/restablecer#token=[A-Za-z0-9_-]{43}/);
  // En la query el token acabaría en los logs del proxy y en la cabecera Referer.
  assert.ok(!/[?&]token=/.test(correo.texto + correo.html));
});

test('una cuenta suspendida no recibe enlace', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  assert.equal((await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' })).status, 200);

  const r = await pedirEnlace('cliente@pista.ec');
  assert.equal(r.status, 202);
  assert.equal(buzonDePrueba().length, 0);
});

test('en la base solo queda el hash del token', async () => {
  await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  const token = tokenDe(correosPara('cliente@pista.ec')[0]);

  const filas = getDb().prepare('SELECT * FROM password_resets').all();
  assert.equal(filas.length, 1);
  assert.ok(!JSON.stringify(filas).includes(token), 'el token en claro no puede estar en la base');
  assert.equal(filas[0].token_hash, recuperacion.hashToken(token));
});

test('el enlace apunta a PUBLIC_URL aunque la petición mienta sobre el dominio', async () => {
  await sembrarUsuarios();
  const cuerpo = JSON.stringify({ email: 'cliente@pista.ec' });
  const estado = await new Promise((listo, fallo) => {
    const peticion = http.request(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: {
        Host: 'malo.example',
        'X-Forwarded-Host': 'malo.example',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(cuerpo),
      },
    });
    peticion.on('response', (respuesta) => {
      respuesta.resume();
      listo(respuesta.statusCode);
    });
    peticion.on('error', fallo);
    peticion.end(cuerpo);
  });
  assert.equal(estado, 202);
  await recuperacion.esperarTareas();

  const [correo] = correosPara('cliente@pista.ec');
  assert.ok(correo.texto.includes('https://entradas.example/restablecer#token='));
  assert.ok(!(correo.texto + correo.html).includes('malo.example'));
});

test('el nombre de la persona va escapado en el correo HTML', async () => {
  const { cMaster } = await sembrarUsuarios();
  const alta = await cMaster.post('/api/admin/users', {
    email: 'raro@pista.ec',
    fullName: '<img src=x onerror=alert(1)> Pérez',
    password: 'Rueda-Delantera-4477',
  });
  assert.equal(alta.status, 201, JSON.stringify(alta.datos));

  await pedirEnlace('raro@pista.ec');
  const [correo] = correosPara('raro@pista.ec');
  assert.ok(!correo.html.includes('<img'), 'el marcado del nombre no puede llegar crudo al HTML');
  assert.ok(correo.html.includes('&lt;img'));
});

test('los límites por dirección frenan el bombardeo de correos sin delatar nada', async () => {
  await sembrarUsuarios();

  // Dos seguidas: la segunda no manda nada, pero responde igual.
  const primera = await pedirEnlace('cliente@pista.ec');
  const segunda = await pedirEnlace('cliente@pista.ec');
  assert.deepEqual([primera.status, segunda.status], [202, 202]);
  assert.deepEqual(segunda.datos, primera.datos);
  assert.equal(correosPara('cliente@pista.ec').length, 1);

  // Salvando la espera entre envíos, como mucho tres por hora.
  for (let i = 0; i < 4; i += 1) {
    getDb().prepare("DELETE FROM rate_limits WHERE key LIKE 'recuperacion-espera:%'").run();
    assert.equal((await pedirEnlace('cliente@pista.ec')).status, 202);
  }
  assert.equal(correosPara('cliente@pista.ec').length, 3);
});

test('el límite por conexión responde 429', async () => {
  let ultima;
  for (let i = 0; i < 11; i += 1) ultima = await pedirEnlace(`persona${i}@pista.ec`);
  assert.equal(ultima.status, 429);
});

// ---------------------------------------------------------------------------
// Usar el enlace
// ---------------------------------------------------------------------------

test('con el enlace se elige una contraseña nueva, se cierran las sesiones y se avisa', async () => {
  const { cCliente } = await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  const token = tokenDe(correosPara('cliente@pista.ec')[0]);

  // Comprobarlo no lo gasta.
  assert.equal((await comprobar(token)).status, 200);
  assert.equal((await comprobar(token)).status, 200);

  const r = await restablecer(token);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.accessToken, undefined, 'restablecer no abre sesión');

  // La sesión que estaba abierta queda fuera, también su renovación.
  assert.equal((await cCliente.get('/api/auth/me')).status, 401);
  assert.equal((await cCliente.post('/api/auth/refresh', {})).status, 401);

  // La contraseña vieja ya no entra; la nueva sí.
  assert.equal((await crearCliente().post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente })).status, 401);
  await crearCliente().entrar('cliente@pista.ec', NUEVA);

  // El enlace no sirve dos veces.
  const otra = await restablecer(token, 'Otra-Clave-Distinta-55');
  assert.equal(otra.status, 400);
  assert.equal(otra.datos.error.code, 'enlace_invalido');

  await recuperacion.esperarTareas();
  const aviso = correosPara('cliente@pista.ec').at(-1);
  assert.match(aviso.asunto, /cambió/);
  assert.match(aviso.texto, /enlace de recuperación/);
  assert.ok(!aviso.texto.includes(NUEVA) && !aviso.html.includes(NUEVA), 'el aviso nunca lleva la contraseña');

  const acciones = getDb().prepare('SELECT action FROM audit_log').all().map((f) => f.action);
  assert.ok(acciones.includes('password.recuperacion_solicitada'));
  assert.ok(acciones.includes('password.restablecida_por_correo'));
});

test('un enlace vencido no sirve', async () => {
  await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  const token = tokenDe(correosPara('cliente@pista.ec')[0]);
  getDb().prepare('UPDATE password_resets SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());

  assert.equal((await comprobar(token)).status, 400);
  assert.equal((await restablecer(token)).status, 400);
});

test('un token con forma extraña o inventado no sirve', async () => {
  await sembrarUsuarios();
  for (const token of ['', 'corto', 'a'.repeat(43), `${'a'.repeat(42)}!`, 'a'.repeat(500)]) {
    assert.equal((await comprobar(token)).status, 400, token);
    assert.equal((await restablecer(token)).status, 400, token);
  }
});

test('pedir otro enlace invalida el anterior', async () => {
  await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  sinCuotasDeCorreo();
  await pedirEnlace('cliente@pista.ec');
  const [primero, segundo] = correosPara('cliente@pista.ec').map(tokenDe);

  assert.equal((await comprobar(primero)).status, 400);
  assert.equal((await comprobar(segundo)).status, 200);
});

test('cambiar la contraseña, el correo o el estado invalida los enlaces pendientes', async () => {
  const { cCliente, cMaster, cliente } = await sembrarUsuarios();

  await pedirEnlace('cliente@pista.ec');
  const antesDelCambio = tokenDe(correosPara('cliente@pista.ec').at(-1));
  const cambio = await cCliente.post('/api/auth/change-password', { currentPassword: CLAVES.cliente, newPassword: NUEVA });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.datos));
  assert.equal((await comprobar(antesDelCambio)).status, 400);

  sinCuotasDeCorreo();
  await pedirEnlace('cliente@pista.ec');
  const antesDelCorreo = tokenDe(correosPara('cliente@pista.ec').filter((c) => c.texto.includes('#token=')).at(-1));
  assert.equal((await cMaster.patch(`/api/admin/users/${cliente.id}`, { email: 'nuevo-correo@pista.ec' })).status, 200);
  assert.equal((await comprobar(antesDelCorreo)).status, 400, 'el enlace iba a la dirección anterior');

  sinCuotasDeCorreo();
  await pedirEnlace('nuevo-correo@pista.ec');
  const antesDeSuspender = tokenDe(correosPara('nuevo-correo@pista.ec').at(-1));
  assert.equal((await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' })).status, 200);
  assert.equal((await comprobar(antesDeSuspender)).status, 400);
});

test('una contraseña débil o igual a la anterior no gasta el enlace', async () => {
  await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  const token = tokenDe(correosPara('cliente@pista.ec')[0]);

  assert.equal((await restablecer(token, 'corta')).status, 400);
  assert.equal((await restablecer(token, 'Carlos-Piloto-123456')).datos.error.code, 'password_debil');
  const repetida = await restablecer(token, CLAVES.cliente);
  assert.equal(repetida.status, 400);
  assert.equal(repetida.datos.error.code, 'password_repetida');

  assert.equal((await restablecer(token)).status, 200, 'después de los rechazos el enlace sigue sirviendo');
});

test('dos canjes simultáneos del mismo enlace: solo uno gana', async () => {
  await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  const token = tokenDe(correosPara('cliente@pista.ec')[0]);

  const claves = ['Primera-Clave-Rapida-11', 'Segunda-Clave-Rapida-22'];
  const respuestas = await Promise.all(claves.map((clave) => restablecer(token, clave)));
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 400]);

  const ganadora = claves[respuestas.findIndex((r) => r.status === 200)];
  const perdedora = claves.find((c) => c !== ganadora);
  await crearCliente().entrar('cliente@pista.ec', ganadora);
  assert.equal((await crearCliente().post('/api/auth/login', { email: 'cliente@pista.ec', password: perdedora })).status, 401);
});

test('recuperar la contraseña levanta el bloqueo por intentos fallidos', async () => {
  await sembrarUsuarios();
  for (let i = 0; i < 8; i += 1) {
    await crearCliente().post('/api/auth/login', { email: 'cliente@pista.ec', password: `mala-clave-${i}` });
  }
  const bloqueada = await crearCliente().post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente });
  assert.equal(bloqueada.status, 429);

  await pedirEnlace('cliente@pista.ec');
  assert.equal((await restablecer(tokenDe(correosPara('cliente@pista.ec')[0]))).status, 200);
  await crearCliente().entrar('cliente@pista.ec', NUEVA);
});

test('la limpieza borra los enlaces vencidos hace más de una semana', async () => {
  await sembrarUsuarios();
  await pedirEnlace('cliente@pista.ec');
  getDb().prepare('UPDATE password_resets SET expires_at = ?').run(new Date(Date.now() - 8 * 86_400_000).toISOString());
  assert.equal(recuperacion.purgar(), 1);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
});

test('la página del enlace se sirve sin Referer y fuera de los buscadores', async () => {
  const r = await crearCliente().get('/restablecer');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.match(r.datos, /<meta name="robots" content="noindex, nofollow">/);
});

// ---------------------------------------------------------------------------
// Cambio de contraseña con sesión
// ---------------------------------------------------------------------------

test('cinco fallos con la contraseña actual cierran la sesión', async () => {
  const { cCliente } = await sembrarUsuarios();
  const intentar = (i) =>
    cCliente.post('/api/auth/change-password', { currentPassword: `no-es-la-actual-${i}`, newPassword: NUEVA });

  for (let i = 0; i < 4; i += 1) assert.equal((await intentar(i)).status, 400);
  const quinto = await intentar(4);
  assert.equal(quinto.status, 401);
  assert.equal(quinto.datos.error.code, 'sesion_cerrada_por_intentos');

  // Quien robó la sesión se queda sin ella, también sin poder renovarla.
  assert.equal((await cCliente.get('/api/auth/me')).status, 401);
  assert.equal((await cCliente.post('/api/auth/refresh', {})).status, 401);
  const acciones = getDb().prepare('SELECT action FROM audit_log').all().map((f) => f.action);
  assert.ok(acciones.includes('password.cambio_bloqueado'));
});

test('acertar la contraseña actual reinicia la cuenta de fallos', async () => {
  const { cCliente } = await sembrarUsuarios();
  const intentar = (i) =>
    cCliente.post('/api/auth/change-password', { currentPassword: `no-es-la-actual-${i}`, newPassword: NUEVA });

  for (let i = 0; i < 4; i += 1) assert.equal((await intentar(i)).status, 400);
  const bien = await cCliente.post('/api/auth/change-password', { currentPassword: CLAVES.cliente, newPassword: NUEVA });
  assert.equal(bien.status, 200);
  cCliente.token = bien.datos.accessToken;

  for (let i = 0; i < 4; i += 1) {
    assert.equal((await intentar(10 + i)).status, 400, 'con la cuenta reiniciada, cuatro fallos no cierran la sesión');
  }
});

test('cada cambio de contraseña avisa por correo y el de administración no revela la temporal', async () => {
  const { cCliente, cMaster, cliente } = await sembrarUsuarios();

  assert.equal(
    (await cCliente.post('/api/auth/change-password', { currentPassword: CLAVES.cliente, newPassword: NUEVA })).status,
    200,
  );
  await recuperacion.esperarTareas();
  const propio = correosPara('cliente@pista.ec').at(-1);
  assert.match(propio.texto, /desde tu cuenta/);
  assert.ok(!propio.texto.includes(NUEVA));

  const r = await cMaster.post(`/api/admin/users/${cliente.id}/reset-password`, {});
  assert.equal(r.status, 200);
  await recuperacion.esperarTareas();
  const porAdministracion = correosPara('cliente@pista.ec').at(-1);
  assert.match(porAdministracion.texto, /administración/);
  assert.ok(!porAdministracion.texto.includes(r.datos.temporaryPassword));
  assert.ok(!porAdministracion.html.includes(r.datos.temporaryPassword));
});

test('un destinatario no puede convertirse en varios ni colar cabeceras', async () => {
  const { enviarCorreo } = await import('../src/lib/correo.js');
  const base = { asunto: 'Prueba', texto: 'Hola' };
  for (const para of ['a@pista.ec,otro@malo.example', 'a@pista.ec;otro@malo.example', 'Nombre <otro@malo.example>', 'a@pista.ec\nBcc: otro@malo.example']) {
    await assert.rejects(enviarCorreo({ ...base, para }), /destinatario/, para);
  }
  await assert.rejects(enviarCorreo({ ...base, para: 'a@pista.ec', asunto: 'Hola\r\nBcc: otro@malo.example' }), /asunto/);
  assert.equal(buzonDePrueba().length, 0);
});

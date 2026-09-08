import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, crearCliente, sembrarUsuarios, CLAVES } from './helpers.js';
import * as users from '../src/services/users.js';
import { HASH_FICTICIO, hashPassword, needsRehash, verifyPassword } from '../src/lib/passwords.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('un visitante puede registrarse y queda con sesión iniciada', async () => {
  const cliente = crearCliente();
  const r = await cliente.post('/api/auth/register', {
    email: 'Nuevo@Ejemplo.com',
    password: 'Chasis-Aluminio-2026',
    fullName: 'Nuevo Piloto',
    phone: '+593 99 123 4567',
  });

  assert.equal(r.status, 201);
  assert.ok(r.datos.accessToken);
  assert.equal(r.datos.user.role, 'customer');
  // El correo se normaliza a minúsculas y el teléfono pierde los separadores.
  assert.equal(r.datos.user.email, 'nuevo@ejemplo.com');
  assert.equal(r.datos.user.phone, '+593991234567');
  assert.equal(r.datos.summary.availableTickets, 0);
});

test('no se permiten dos cuentas con el mismo correo, ni variando mayúsculas', async () => {
  const cliente = crearCliente();
  const datos = { email: 'repetido@pista.ec', password: 'Chasis-Aluminio-2026', fullName: 'Piloto Uno' };
  assert.equal((await cliente.post('/api/auth/register', datos)).status, 201);

  const segundo = crearCliente();
  const r = await segundo.post('/api/auth/register', { ...datos, email: 'REPETIDO@pista.ec' });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'correo_en_uso');
});

test('se rechazan contraseñas débiles o que contienen el propio nombre', async () => {
  const cliente = crearCliente();

  const corta = await cliente.post('/api/auth/register', {
    email: 'debil@pista.ec', password: 'corta', fullName: 'Piloto Débil',
  });
  assert.equal(corta.status, 400);

  const comun = await cliente.post('/api/auth/register', {
    email: 'debil@pista.ec', password: 'password123', fullName: 'Piloto Débil',
  });
  assert.equal(comun.status, 400);
  assert.equal(comun.datos.error.code, 'password_debil');

  const conNombre = await cliente.post('/api/auth/register', {
    email: 'debil@pista.ec', password: 'piloto-de-pista', fullName: 'Piloto Débil',
  });
  assert.equal(conNombre.status, 400);
  assert.match(conNombre.datos.error.message, /nombre/);
});

test('el login rechaza credenciales incorrectas sin revelar si el correo existe', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();

  const inexistente = await cliente.post('/api/auth/login', { email: 'nadie@pista.ec', password: 'loquesea123' });
  const claveMala = await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: 'incorrecta123' });

  assert.equal(inexistente.status, 401);
  assert.equal(claveMala.status, 401);
  // El mismo mensaje en ambos casos: no se filtra qué correos están registrados.
  assert.equal(inexistente.datos.error.message, claveMala.datos.error.message);
});

test('el hash ficticio del login cuesta lo mismo que uno real', async () => {
  // Si sus parámetros o el largo de la clave quedaran por detrás de los de
  // verdad, verificar una cuenta inexistente sería más barato y el tiempo de
  // respuesta delataría qué correos están registrados.
  const real = await hashPassword('Chicane-Nocturna-77');
  const parametros = (hash) => hash.split('$').slice(0, 4).join('$');
  const largoClave = (hash) => Buffer.from(hash.split('$')[5], 'base64').length;

  assert.equal(parametros(HASH_FICTICIO), parametros(real));
  assert.equal(largoClave(HASH_FICTICIO), largoClave(real));
  assert.equal(needsRehash(HASH_FICTICIO), false);
  // Y, por supuesto, no vale como contraseña de nadie.
  assert.equal(await verifyPassword('cualquier-cosa', HASH_FICTICIO), false);
});

test('la sesión propia y la que ve el máster se describen igual', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  const propias = await cCliente.get('/api/auth/sessions');
  assert.equal(propias.status, 200);
  const propia = propias.datos.items.find((s) => s.current);
  assert.ok(propia, 'la sesión en uso debería venir marcada');

  const ficha = await cMaster.get(`/api/admin/users/${cliente.id}`);
  const vistaMaster = ficha.datos.sessions.find((s) => s.id === propia.id);
  assert.ok(vistaMaster, 'el máster debería ver la misma sesión');
  // Mismo formato en las dos rutas: nada de columnas crudas de la base.
  assert.deepEqual(Object.keys(vistaMaster).sort(), Object.keys(propia).sort());
  assert.equal(vistaMaster.createdAt, propia.createdAt);
  assert.equal(vistaMaster.current, false);
  assert.equal(vistaMaster.last_used_at, undefined);
});

test('la cuenta se bloquea temporalmente tras varios intentos fallidos', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();

  let ultima;
  for (let i = 0; i < 8; i += 1) {
    ultima = await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: `mala-clave-${i}` });
  }
  assert.equal(ultima.status, 429, 'el octavo intento debe bloquear la cuenta');

  // Ni siquiera la contraseña correcta entra mientras dura el bloqueo.
  const correcta = await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente });
  assert.equal(correcta.status, 429);
});

test('el máster desbloquea una cuenta y esa persona vuelve a entrar', async () => {
  const { cMaster, cliente: usuarioCliente } = await sembrarUsuarios();
  const cliente = crearCliente();

  for (let i = 0; i < 8; i += 1) {
    await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: `mala-clave-${i}` });
  }
  assert.equal(
    (await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente })).status,
    429,
    'la cuenta debería estar bloqueada',
  );

  // En la ficha se ve el bloqueo, que es lo que mira quien atiende el mostrador.
  const ficha = await cMaster.get(`/api/admin/users/${usuarioCliente.id}`);
  assert.equal(ficha.datos.user.locked, true);

  const desbloqueo = await cMaster.post(`/api/admin/users/${usuarioCliente.id}/unlock`);
  assert.equal(desbloqueo.status, 200);
  assert.equal(desbloqueo.datos.user.locked, false);

  const entrada = await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente });
  assert.equal(entrada.status, 200, JSON.stringify(entrada.datos));
});

test('restablecer la contraseña entrega una temporal y cierra las sesiones abiertas', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  // La sesión del cliente funciona antes de tocar nada.
  assert.equal((await cCliente.get('/api/auth/me')).status, 200);

  const reinicio = await cMaster.post(`/api/admin/users/${cliente.id}/reset-password`, {});
  assert.equal(reinicio.status, 200);
  const temporal = reinicio.datos.temporaryPassword;
  assert.equal(typeof temporal, 'string');
  assert.equal(temporal.length >= 10, true, 'la temporal debe cumplir la longitud mínima');

  // Su sesión anterior deja de valer en el acto, sin esperar a que caduque.
  const despues = await cCliente.get('/api/auth/me');
  assert.equal(despues.status, 401);

  // La contraseña vieja ya no sirve; la temporal sí.
  const nuevoCliente = crearCliente();
  assert.equal(
    (await nuevoCliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente })).status,
    401,
  );
  assert.equal(
    (await nuevoCliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: temporal })).status,
    200,
  );

  // Y si el máster indica una contraseña, se usa esa y no se devuelve ninguna.
  const elegida = await cMaster.post(`/api/admin/users/${cliente.id}/reset-password`, {
    password: 'Amortiguador-Delantero-31',
  });
  assert.equal(elegida.status, 200);
  assert.equal(elegida.datos.temporaryPassword, null);
  const conElegida = crearCliente();
  assert.equal(
    (await conElegida.post('/api/auth/login', { email: 'cliente@pista.ec', password: 'Amortiguador-Delantero-31' })).status,
    200,
  );
});

test('cerrar sesión en todos los dispositivos deja fuera a todos', async () => {
  const { cCliente } = await sembrarUsuarios();
  // Un segundo dispositivo de la misma persona.
  const otroDispositivo = crearCliente();
  await otroDispositivo.entrar('cliente@pista.ec', CLAVES.cliente);
  assert.equal((await otroDispositivo.get('/api/auth/me')).status, 200);

  const cierre = await cCliente.post('/api/auth/logout-all');
  assert.equal(cierre.status, 200);
  assert.equal(cierre.datos.sesionesCerradas >= 2, true, 'debería cerrar las dos sesiones');

  // Ni el que lo pidió ni el otro dispositivo siguen dentro, y la cookie del
  // otro tampoco sirve para renovar.
  assert.equal((await cCliente.get('/api/auth/me')).status, 401);
  assert.equal((await otroDispositivo.get('/api/auth/me')).status, 401);
  assert.equal((await otroDispositivo.post('/api/auth/refresh')).status, 401);

  // Volver a entrar funciona con normalidad.
  assert.equal((await otroDispositivo.post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente })).status, 200);
});

test('el refresh token rota en cada uso', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();
  await cliente.entrar('cliente@pista.ec', CLAVES.cliente);

  const primero = await cliente.post('/api/auth/refresh');
  assert.equal(primero.status, 200);
  const segundo = await cliente.post('/api/auth/refresh');
  assert.equal(segundo.status, 200);
  assert.notEqual(primero.datos.accessToken, segundo.datos.accessToken);
});

test('reutilizar un refresh token ya rotado revoca toda la familia de sesiones', async () => {
  await sembrarUsuarios();
  const legitimo = crearCliente();
  await legitimo.entrar('cliente@pista.ec', CLAVES.cliente);

  // Un atacante se queda con una copia del token de refresco.
  const tokenRobado = legitimo.leerCookie('rh_refresh');
  assert.ok(tokenRobado);

  // El usuario legítimo sigue navegando y su token rota con normalidad.
  assert.equal((await legitimo.post('/api/auth/refresh')).status, 200);

  // El atacante presenta el token viejo: ya fue rotado, así que se detecta.
  const atacante = crearCliente();
  const intento = await atacante.post('/api/auth/refresh', { refreshToken: tokenRobado });
  assert.equal(intento.status, 401);
  assert.equal(intento.datos.error.code, 'refresh_reutilizado');

  // Y la sesión entera queda revocada, también para el usuario legítimo:
  // más vale pedirle que vuelva a entrar que dejar viva una sesión robada.
  const despues = await legitimo.post('/api/auth/refresh');
  assert.equal(despues.status, 401);
});

test('cerrar sesión invalida la cookie de refresco', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();
  await cliente.entrar('cliente@pista.ec', CLAVES.cliente);

  assert.equal((await cliente.post('/api/auth/logout')).status, 200);
  assert.equal((await cliente.post('/api/auth/refresh')).status, 401);
});

test('cambiar la contraseña cierra las demás sesiones', async () => {
  await sembrarUsuarios();
  const telefono = crearCliente();
  const computadora = crearCliente();
  await telefono.entrar('cliente@pista.ec', CLAVES.cliente);
  await computadora.entrar('cliente@pista.ec', CLAVES.cliente);

  const cambio = await telefono.post('/api/auth/change-password', {
    currentPassword: CLAVES.cliente,
    newPassword: 'Amortiguador-Nuevo-2026',
  });
  assert.equal(cambio.status, 200);

  // La sesión del otro dispositivo deja de servir de inmediato.
  const otra = await computadora.get('/api/packs/mine');
  assert.equal(otra.status, 401);

  // Quien hizo el cambio sigue dentro con el token nuevo.
  telefono.token = cambio.datos.accessToken;
  assert.equal((await telefono.get('/api/packs/mine')).status, 200);
});

test('suspender una cuenta corta el acceso al instante, sin esperar a que caduque el token', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  assert.equal((await cCliente.get('/api/packs/mine')).status, 200);

  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

  const despues = await cCliente.get('/api/packs/mine');
  assert.equal(despues.status, 401);
});

test('un token manipulado se rechaza', async () => {
  const { cCliente } = await sembrarUsuarios();
  const partes = cCliente.token.split('.');
  const cargaFalsa = Buffer.from(JSON.stringify({ sub: 'otro', role: 'master' })).toString('base64url');

  cCliente.token = `${partes[0]}.${cargaFalsa}.${partes[2]}`;
  assert.equal((await cCliente.get('/api/packs/mine')).status, 401);

  cCliente.token = 'no-es-un-token';
  assert.equal((await cCliente.get('/api/packs/mine')).status, 401);
});

test('el perfil se puede actualizar y validar', async () => {
  const { cCliente } = await sembrarUsuarios();

  const ok = await cCliente.patch('/api/auth/me', { fullName: 'Carlos A. Piloto', phone: '+593 98 765 4321' });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.user.fullName, 'Carlos A. Piloto');
  assert.equal(ok.datos.user.phone, '+593987654321');

  const malo = await cCliente.patch('/api/auth/me', { fullName: 'X' });
  assert.equal(malo.status, 400);
  assert.ok(malo.datos.error.details.fields.fullName);
});

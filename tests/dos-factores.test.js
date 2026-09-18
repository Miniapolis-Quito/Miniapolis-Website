/**
 * Verificación en dos pasos: el algoritmo, el cifrado del secreto, el acceso
 * en dos tiempos y la política que obliga al personal a usarla.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, crearCliente, sembrarUsuarios, CLAVES } from './helpers.js';
import * as totp from '../src/lib/totp.js';
import { cifrar, descifrar } from '../src/lib/cifrado.js';
import * as dosFactores from '../src/services/dosFactores.js';
import * as users from '../src/services/users.js';
import { getDb } from '../src/db/index.js';
import { config } from '../src/config.js';
import { abrirCanal, fijarBase } from './canal.js';
import * as packsService from '../src/services/packs.js';
import { buildQrPayload } from '../src/lib/qr.js';

before(async () => fijarBase(await levantarServidor()));
after(bajarServidor);
beforeEach(limpiarBase);

/** Código válido de este instante (o del tramo que se pida). */
const codigoDe = (secreto, desplazamiento = 0) =>
  totp.codigoDelPaso(secreto, totp.pasoDe(Date.now(), config.twoFactor.periodoSegundos) + desplazamiento);

/** Deja una cuenta con el segundo factor puesto y devuelve su secreto y códigos. */
async function activarSegundoFactor(cliente) {
  const alta = await cliente.post('/api/auth/2fa/setup');
  assert.equal(alta.status, 200);
  const secreto = alta.datos.secret;
  const activacion = await cliente.post('/api/auth/2fa/activate', { code: codigoDe(secreto) });
  assert.equal(activacion.status, 200, JSON.stringify(activacion.datos));
  return { secreto, codigosDeRespaldo: activacion.datos.recoveryCodes };
}

// ---------------------------------------------------------------------------
// El algoritmo
// ---------------------------------------------------------------------------

test('los códigos coinciden con los vectores de prueba del RFC 6238', () => {
  // Secreto del RFC: la cadena ASCII "12345678901234567890".
  const secreto = totp.base32Encode(Buffer.from('12345678901234567890'));
  const vectores = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    // Este pasa de los 32 bits: comprueba que el contador de 64 se escribe bien.
    [20000000000, '65353130'],
  ];
  for (const [segundos, esperado] of vectores) {
    assert.equal(totp.codigoDelPaso(secreto, Math.floor(segundos / 30), { digitos: 8 }), esperado);
  }
});

test('base32 va y vuelve, y rechaza lo que no pertenece al alfabeto', () => {
  const bytes = Buffer.from('chicane nocturna');
  assert.equal(totp.base32Decode(totp.base32Encode(bytes)).toString(), 'chicane nocturna');
  // Tal como se teclea a mano: minúsculas, espacios y relleno.
  const secreto = totp.generarSecreto();
  assert.deepEqual(totp.base32Decode(totp.secretoLegible(secreto).toLowerCase()), totp.base32Decode(secreto));
  assert.equal(totp.base32Decode('AB!CD'), null);
  assert.equal(totp.base32Decode(''), null);
});

test('la ventana tolera el desfase del reloj pero no un código de hace un minuto', () => {
  const secreto = totp.generarSecreto();
  const ahora = Date.now();
  assert.equal(totp.verificar(secreto, codigoDe(secreto), { ahora }).ok, true);
  assert.equal(totp.verificar(secreto, totp.codigoDelPaso(secreto, totp.pasoDe(ahora) - 1), { ahora }).ok, true);
  assert.equal(totp.verificar(secreto, totp.codigoDelPaso(secreto, totp.pasoDe(ahora) - 3), { ahora }).ok, false);
  assert.equal(totp.verificar(secreto, '000000', { ahora }).motivo, 'invalido');
  assert.equal(totp.verificar(secreto, 'abcdef', { ahora }).motivo, 'formato');
});

test('un código ya usado no vuelve a valer aunque el tramo siga abierto', () => {
  const secreto = totp.generarSecreto();
  const paso = totp.pasoDe(Date.now());
  const resultado = totp.verificar(secreto, totp.codigoDelPaso(secreto, paso), { pasoMinimo: paso });
  assert.deepEqual(resultado, { ok: false, motivo: 'reutilizado' });
});

test('el secreto cifrado no se puede leer ni manipular sin la clave', () => {
  const secreto = totp.generarSecreto();
  const guardado = cifrar(secreto, 'totp-secret');
  assert.ok(!guardado.includes(secreto), 'el secreto no puede aparecer en claro');
  assert.equal(descifrar(guardado, 'totp-secret'), secreto);
  // Con otro propósito la clave es otra, y con un byte cambiado la etiqueta falla.
  assert.equal(descifrar(guardado, 'otra-cosa'), null);
  const partes = guardado.split('.');
  partes[3] = Buffer.from('manipulado').toString('base64url');
  assert.equal(descifrar(partes.join('.'), 'totp-secret'), null);
  assert.equal(descifrar('cualquier-cosa', 'totp-secret'), null);
});

// ---------------------------------------------------------------------------
// Alta y acceso
// ---------------------------------------------------------------------------

test('configurar el segundo factor entrega QR, secreto y códigos de respaldo', async () => {
  const { cStaff } = await sembrarUsuarios();

  const alta = await cStaff.post('/api/auth/2fa/setup');
  assert.equal(alta.status, 200);
  assert.match(alta.datos.secret, /^[A-Z2-7]{32}$/);
  assert.match(alta.datos.qrDataUrl, /^data:image\/png;base64,/);
  assert.ok(alta.datos.otpauthUri.startsWith('otpauth://totp/'));
  assert.ok(alta.datos.otpauthUri.includes(`secret=${alta.datos.secret}`));

  // Mientras no se confirme, la cuenta entra como siempre.
  assert.equal((await cStaff.get('/api/auth/2fa')).datos.enabled, false);
  const sinConfirmar = crearCliente();
  await sinConfirmar.entrar('staff@pista.ec', CLAVES.staff);

  const mal = await cStaff.post('/api/auth/2fa/activate', { code: '000000' });
  assert.equal(mal.status, 400);
  assert.equal(mal.datos.error.code, 'dos_factores_codigo_invalido');

  const bien = await cStaff.post('/api/auth/2fa/activate', { code: codigoDe(alta.datos.secret) });
  assert.equal(bien.status, 200);
  assert.equal(bien.datos.recoveryCodes.length, config.twoFactor.codigosDeRespaldo);
  for (const codigo of bien.datos.recoveryCodes) assert.match(codigo, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  assert.equal(new Set(bien.datos.recoveryCodes).size, bien.datos.recoveryCodes.length);

  const estado = await cStaff.get('/api/auth/2fa');
  assert.equal(estado.datos.enabled, true);
  assert.equal(estado.datos.recoveryCodesLeft, config.twoFactor.codigosDeRespaldo);

  // El secreto no se guarda en claro en ninguna parte de la base.
  const fila = getDb().prepare('SELECT totp_secret FROM users WHERE email = ?').get('staff@pista.ec');
  assert.ok(fila.totp_secret.startsWith('v1.'));
  assert.ok(!fila.totp_secret.includes(alta.datos.secret));
});

test('activar el segundo factor cierra las demás sesiones y deja viva la propia', async () => {
  const { cStaff } = await sembrarUsuarios();
  const otroDispositivo = crearCliente();
  await otroDispositivo.entrar('staff@pista.ec', CLAVES.staff);

  const respuesta = await cStaff.post('/api/auth/2fa/setup');
  await cStaff.post('/api/auth/2fa/activate', { code: codigoDe(respuesta.datos.secret) });

  assert.equal((await cStaff.get('/api/auth/me')).status, 200, 'quien la activa sigue dentro');
  assert.equal((await otroDispositivo.get('/api/auth/me')).status, 401, 'las sesiones viejas dejan de valer');
});

test('con segundo factor, la contraseña sola no abre sesión', async () => {
  const { cStaff } = await sembrarUsuarios();
  const { secreto } = await activarSegundoFactor(cStaff);

  const nuevo = crearCliente();
  const primerPaso = await nuevo.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  assert.equal(primerPaso.status, 200);
  assert.equal(primerPaso.datos.twoFactorRequired, true);
  assert.equal(primerPaso.datos.accessToken, undefined);
  assert.match(primerPaso.datos.challengeToken, /^[A-Za-z0-9_-]{43}$/);
  // Ni siquiera queda cookie de refresco con la que renovar.
  assert.equal((await nuevo.post('/api/auth/refresh')).status, 401);

  const malo = await nuevo.post('/api/auth/login/2fa', {
    challengeToken: primerPaso.datos.challengeToken,
    code: '123456',
  });
  assert.equal(malo.status, 400);

  // El tramo en que se activó ya se gastó al confirmarla: se usa el siguiente.
  const codigo = codigoDe(secreto, 1);
  const segundoPaso = await nuevo.post('/api/auth/login/2fa', {
    challengeToken: primerPaso.datos.challengeToken,
    code: codigo,
  });
  assert.equal(segundoPaso.status, 200, JSON.stringify(segundoPaso.datos));
  assert.ok(segundoPaso.datos.accessToken);
  nuevo.token = segundoPaso.datos.accessToken;
  assert.equal((await nuevo.get('/api/auth/me')).status, 200);

  // El mismo desafío no sirve dos veces.
  const repetido = await nuevo.post('/api/auth/login/2fa', {
    challengeToken: primerPaso.datos.challengeToken,
    code: codigoDe(secreto, 1),
  });
  assert.equal(repetido.status, 401);
  assert.equal(repetido.datos.error.code, 'dos_factores_desafio_invalido');

  // Y el mismo código tampoco, aunque el tramo de 30 segundos siga abierto.
  const otro = crearCliente();
  const desafio = await otro.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  const reusado = await otro.post('/api/auth/login/2fa', {
    challengeToken: desafio.datos.challengeToken,
    code: codigo,
  });
  assert.equal(reusado.status, 400);
  assert.equal(reusado.datos.error.code, 'dos_factores_codigo_usado');
});

test('un código de respaldo entra una vez y se gasta', async () => {
  const { cStaff } = await sembrarUsuarios();
  const { codigosDeRespaldo } = await activarSegundoFactor(cStaff);
  const [respaldo] = codigosDeRespaldo;

  const cliente = crearCliente();
  const desafio = await cliente.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  // Se teclea como venga: en minúsculas y sin el guion.
  const entrada = await cliente.post('/api/auth/login/2fa', {
    challengeToken: desafio.datos.challengeToken,
    code: respaldo.replace('-', '').toLowerCase(),
  });
  assert.equal(entrada.status, 200, JSON.stringify(entrada.datos));
  cliente.token = entrada.datos.accessToken;
  assert.equal((await cliente.get('/api/auth/2fa')).datos.recoveryCodesLeft, config.twoFactor.codigosDeRespaldo - 1);

  const segundoIntento = crearCliente();
  const otroDesafio = await segundoIntento.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  const repetido = await segundoIntento.post('/api/auth/login/2fa', {
    challengeToken: otroDesafio.datos.challengeToken,
    code: respaldo,
  });
  assert.equal(repetido.status, 400);
});

test('un desafío se anula tras demasiados códigos incorrectos', async () => {
  const { cStaff } = await sembrarUsuarios();
  const { secreto } = await activarSegundoFactor(cStaff);

  const cliente = crearCliente();
  const desafio = await cliente.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  const token = desafio.datos.challengeToken;

  let ultimo;
  for (let intento = 0; intento < config.twoFactor.maximoIntentos; intento += 1) {
    ultimo = await cliente.post('/api/auth/login/2fa', { challengeToken: token, code: '000000' });
  }
  assert.equal(ultimo.status, 429);

  // Ni con el código bueno: ese acceso ya no existe y hay que empezar de nuevo.
  const conElBueno = await cliente.post('/api/auth/login/2fa', { challengeToken: token, code: codigoDe(secreto) });
  assert.equal(conElBueno.status, 401);
});

test('renovar los códigos de respaldo exige un código y anula los anteriores', async () => {
  const { cStaff } = await sembrarUsuarios();
  const { secreto, codigosDeRespaldo } = await activarSegundoFactor(cStaff);

  const sinCodigo = await cStaff.post('/api/auth/2fa/recovery-codes', { code: '000000' });
  assert.equal(sinCodigo.status, 400);

  const renovados = await cStaff.post('/api/auth/2fa/recovery-codes', { code: codigoDe(secreto, 1) });
  assert.equal(renovados.status, 200);
  assert.equal(renovados.datos.recoveryCodes.length, config.twoFactor.codigosDeRespaldo);
  assert.equal(
    renovados.datos.recoveryCodes.some((c) => codigosDeRespaldo.includes(c)),
    false,
    'los códigos nuevos no repiten los viejos',
  );

  const cliente = crearCliente();
  const desafio = await cliente.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  const viejo = await cliente.post('/api/auth/login/2fa', {
    challengeToken: desafio.datos.challengeToken,
    code: codigosDeRespaldo[0],
  });
  assert.equal(viejo.status, 400, 'un código de la tanda anterior ya no vale');
});

test('desactivarla pide la contraseña y un código', async () => {
  const { cStaff } = await sembrarUsuarios();
  const { secreto } = await activarSegundoFactor(cStaff);

  const sinPassword = await cStaff.post('/api/auth/2fa/disable', { password: 'Otra-Cosa-123', code: codigoDe(secreto) });
  assert.equal(sinPassword.status, 400);
  assert.equal(sinPassword.datos.error.code, 'password_incorrecta');
  assert.equal((await cStaff.get('/api/auth/2fa')).datos.enabled, true);

  const sinCodigo = await cStaff.post('/api/auth/2fa/disable', { password: CLAVES.staff, code: '000000' });
  assert.equal(sinCodigo.status, 400);
  assert.equal((await cStaff.get('/api/auth/2fa')).datos.enabled, true);

  const bien = await cStaff.post('/api/auth/2fa/disable', { password: CLAVES.staff, code: codigoDe(secreto, 1) });
  assert.equal(bien.status, 200);
  assert.equal((await cStaff.get('/api/auth/2fa')).datos.enabled, false);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS n FROM two_factor_recovery_codes').get().n,
    0,
    'los códigos de respaldo se van con ella',
  );

  const cliente = crearCliente();
  await cliente.entrar('staff@pista.ec', CLAVES.staff);
});

test('si el secreto guardado no se puede descifrar, no se entra: se pide ayuda', async () => {
  const { cStaff, staff } = await sembrarUsuarios();
  await activarSegundoFactor(cStaff);

  // Simula una clave de entorno rotada sin fijar TWOFA_SECRET.
  getDb().prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(cifrar('ilegible', 'otro-proposito'), staff.id);

  const cliente = crearCliente();
  const desafio = await cliente.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  const intento = await cliente.post('/api/auth/login/2fa', {
    challengeToken: desafio.datos.challengeToken,
    code: '123456',
  });
  assert.equal(intento.status, 403);
  assert.equal(intento.datos.error.code, 'dos_factores_ilegible');
});

// ---------------------------------------------------------------------------
// Política del equipo
// ---------------------------------------------------------------------------

test('el máster no puede exigir el segundo factor sin tenerlo él mismo', async () => {
  const { cMaster } = await sembrarUsuarios();
  const intento = await cMaster.patch('/api/admin/security', { requireTwoFactorForStaff: true });
  assert.equal(intento.status, 400);
  assert.equal(intento.datos.error.code, 'dos_factores_master_sin_activar');
  assert.equal(dosFactores.leerAjustes().requireTwoFactorForStaff, false);
});

test('exigido el segundo factor, el personal sin él pierde sus permisos hasta activarlo', async () => {
  const { cMaster, cStaff } = await sembrarUsuarios();
  await activarSegundoFactor(cMaster);

  const encendido = await cMaster.patch('/api/admin/security', { requireTwoFactorForStaff: true });
  assert.equal(encendido.status, 200);
  assert.equal(encendido.datos.requireTwoFactorForStaff, true);
  assert.ok(encendido.datos.requiredAt);
  assert.equal(encendido.datos.sinSegundoFactor, 1);

  // El operador entra y ve su cuenta, pero no puede escanear.
  const escaneo = await cStaff.post('/api/scan/redeem', { payload: 'RHE1|X|0|0|x' });
  assert.equal(escaneo.status, 403);
  assert.equal(escaneo.datos.error.code, 'dos_factores_requerido');
  assert.equal((await cStaff.get('/api/auth/me')).status, 200, 'su cuenta sigue accesible');
  assert.equal((await cStaff.get('/api/auth/2fa')).datos.pendingRequired, true);

  // El máster, que sí la tiene, sigue trabajando.
  assert.equal((await cMaster.get('/api/admin/dashboard')).status, 200);

  // En cuanto el operador la activa, recupera sus permisos.
  await activarSegundoFactor(cStaff);
  const despues = await cStaff.post('/api/scan/redeem', { payload: 'RHE1|X|0|0|x' });
  assert.notEqual(despues.status, 403);

  // Y a los clientes no les afecta.
  const cliente = crearCliente();
  await cliente.entrar('cliente@pista.ec', CLAVES.cliente);
  assert.equal((await cliente.get('/api/auth/me')).status, 200);
});

test('exigido el segundo factor, la cuenta pendiente tampoco recibe el canal del equipo', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  await activarSegundoFactor(cMaster);
  await cMaster.patch('/api/admin/security', { requireTwoFactorForStaff: true });

  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  assert.equal(emitido.status, 201, JSON.stringify(emitido.datos));
  const pack = packsService.findById(emitido.datos.pack.id);

  // El operador, con los permisos en suspenso, solo debe recibir lo suyo: el
  // canal del personal lleva el nombre del cliente, el código del pack y el
  // saldo de cada consumo, justo lo que la API le acaba de negar.
  const canalPendiente = await abrirCanal(cStaff.token);
  try {
    await canalPendiente.esperar('conectado');
    // El máster, que sí lo tiene puesto, escanea.
    const escaneo = await cMaster.post('/api/scan', { payload: buildQrPayload(pack) });
    assert.equal(escaneo.status, 200, JSON.stringify(escaneo.datos));

    await new Promise((listo) => setTimeout(listo, 300));
    assert.equal(
      canalPendiente.recibidos.some((e) => e.tipo === 'entrada.consumida'),
      false,
      'la cuenta pendiente no debe ver pasar el movimiento de la pista',
    );
  } finally {
    canalPendiente.cerrar();
  }

  // En cuanto lo activa, vuelve a recibirlo.
  await activarSegundoFactor(cStaff);
  const canalAlDia = await abrirCanal(cStaff.token);
  try {
    await canalAlDia.esperar('conectado');
    assert.equal((await cMaster.post('/api/scan', { payload: buildQrPayload(pack) })).status, 200);
    const evento = await canalAlDia.esperar('entrada.consumida');
    assert.ok(evento.datos);
  } finally {
    canalAlDia.cerrar();
  }
});

test('exigido el segundo factor, el máster pendiente tampoco lee packs ni pases ajenos', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  assert.equal(emitido.status, 201);
  const packId = emitido.datos.pack.id;

  // Un segundo máster: el primero activa y exige; el segundo se queda pendiente.
  const otro = await users.createUser({
    email: 'segundo@pista.ec',
    password: 'Neumatico-Lluvia-55',
    fullName: 'Dora Segunda',
    role: 'master',
  });
  const cOtro = crearCliente();
  await cOtro.entrar('segundo@pista.ec', 'Neumatico-Lluvia-55');

  // Mientras no se exige, el máster puede mirar los movimientos del pack ajeno.
  assert.equal((await cOtro.get(`/api/packs/${packId}/movements`)).status, 200);

  await activarSegundoFactor(cMaster);
  await cMaster.patch('/api/admin/security', { requireTwoFactorForStaff: true });

  // Con la política encendida y sin segundo factor, esa puerta también se cierra:
  // no pasa por `requireRole`, así que sin esta comprobación seguiría abierta.
  const pack = await cOtro.get(`/api/packs/${packId}/movements`);
  assert.equal(pack.status, 403);
  const pase = await cOtro.get(`/api/wallet/google/${packId}`);
  assert.ok(pase.status === 403 || pase.status === 404, `estado inesperado: ${pase.status}`);

  // Sus propios datos los sigue viendo: tiene que poder entrar a configurarlo.
  assert.equal((await cOtro.get('/api/auth/me')).status, 200);
});

test('la administración puede quitar el segundo factor de quien perdió el teléfono', async () => {
  const { cMaster, cStaff, staff } = await sembrarUsuarios();
  await activarSegundoFactor(cStaff);

  const panel = await cMaster.get('/api/admin/security');
  assert.equal(panel.status, 200);
  assert.equal(panel.datos.equipo.find((p) => p.id === staff.id).twoFactorEnabled, true);

  const rescate = await cMaster.post(`/api/admin/users/${staff.id}/2fa/disable`);
  assert.equal(rescate.status, 200);
  assert.equal(rescate.datos.user.twoFactorEnabled, false);
  assert.ok(rescate.datos.sesionesCerradas >= 1, 'sus sesiones abiertas se cierran');
  assert.equal((await cStaff.get('/api/auth/me')).status, 401);

  // Vuelve a entrar solo con la contraseña, para reconfigurarla.
  const cliente = crearCliente();
  await cliente.entrar('staff@pista.ec', CLAVES.staff);

  const repetido = await cMaster.post(`/api/admin/users/${staff.id}/2fa/disable`);
  assert.equal(repetido.status, 409);

  const bitacora = await cMaster.get('/api/admin/audit?limit=50');
  assert.ok(
    bitacora.datos.items.some((e) => e.action === 'dos_factores.desactivada' && e.entityId === staff.id),
    'el rescate queda en la bitácora',
  );
});

test('el resumen del panel dice cuántas cuentas con permisos entran solo con la contraseña', async () => {
  const { cMaster, cStaff } = await sembrarUsuarios();

  const antes = await cMaster.get('/api/admin/dashboard');
  assert.deepEqual(antes.datos.security, {
    requireTwoFactorForStaff: false,
    team: 2,
    withTwoFactor: 0,
    withoutTwoFactor: 2,
  });

  await activarSegundoFactor(cStaff);
  const despues = await cMaster.get('/api/admin/dashboard');
  assert.equal(despues.datos.security.withTwoFactor, 1);
  assert.equal(despues.datos.security.withoutTwoFactor, 1);
});

test('un cliente no puede tocar la política de seguridad', async () => {
  const { cCliente } = await sembrarUsuarios();
  assert.equal((await cCliente.get('/api/admin/security')).status, 403);
  assert.equal((await cCliente.patch('/api/admin/security', { requireTwoFactorForStaff: true })).status, 403);
});

test('los desafíos vencidos se borran solos', async () => {
  const { cStaff, staff } = await sembrarUsuarios();
  await activarSegundoFactor(cStaff);

  const cliente = crearCliente();
  await cliente.post('/api/auth/login', { email: 'staff@pista.ec', password: CLAVES.staff });
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM two_factor_challenges').get().n, 1);

  getDb()
    .prepare('UPDATE two_factor_challenges SET expires_at = ? WHERE user_id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), staff.id);
  assert.equal(dosFactores.purgarDesafios(), 1);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM two_factor_challenges').get().n, 0);
});

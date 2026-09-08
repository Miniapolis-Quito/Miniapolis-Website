/** Control de acceso, cabeceras y validación de entrada. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, crearCliente, sembrarUsuarios } from './helpers.js';
import { buildQrPayload } from '../src/lib/qr.js';
import * as packsService from '../src/services/packs.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('sin sesión, ninguna ruta privada responde datos', async () => {
  const anonimo = crearCliente();
  for (const ruta of ['/api/packs/mine', '/api/admin/dashboard', '/api/admin/users', '/api/scan/history', '/api/events']) {
    const r = await anonimo.get(ruta);
    assert.equal(r.status, 401, `${ruta} debería exigir sesión`);
  }
  const escaneo = await anonimo.post('/api/scan', { payload: 'RHE1|RHE-AAAA-BBBB|0|0|xxxxxxxxxxxxxx' });
  assert.equal(escaneo.status, 401);
});

test('un cliente no puede usar las rutas del personal ni las del máster', async () => {
  const { cCliente } = await sembrarUsuarios();

  assert.equal((await cCliente.post('/api/scan/manual', { code: 'RHE-AAAA-BBBB' })).status, 403);
  assert.equal((await cCliente.get('/api/scan/history')).status, 403);
  assert.equal((await cCliente.get('/api/admin/dashboard')).status, 403);
  assert.equal((await cCliente.post('/api/admin/packs', { userId: 'x', size: 5 })).status, 403);
});

test('el personal puede escanear pero no administrar', async () => {
  const { cStaff, cliente } = await sembrarUsuarios();

  assert.equal((await cStaff.get('/api/scan/history')).status, 200);
  assert.equal((await cStaff.get('/api/admin/dashboard')).status, 403);
  assert.equal((await cStaff.post('/api/admin/packs', { userId: cliente.id, size: 5 })).status, 403);
  assert.equal((await cStaff.get('/api/admin/users')).status, 403);
});

test('el máster no puede degradarse ni suspenderse a sí mismo', async () => {
  const { cMaster, master } = await sembrarUsuarios();

  const degradar = await cMaster.patch(`/api/admin/users/${master.id}`, { role: 'customer' });
  assert.equal(degradar.status, 403);
  assert.equal(degradar.datos.error.code, 'auto_degradacion');

  const suspender = await cMaster.patch(`/api/admin/users/${master.id}`, { status: 'suspended' });
  assert.equal(suspender.status, 403);
});

test('siempre debe quedar al menos un usuario máster', async () => {
  const { cMaster } = await sembrarUsuarios();

  const segundo = await cMaster.post('/api/admin/users', {
    email: 'segundo@pista.ec', fullName: 'Dana Segunda', role: 'master', password: 'Palanca-Cambios-55',
  });
  assert.equal(segundo.status, 201);

  // Con dos másters sí se puede degradar a uno.
  const degradar = await cMaster.patch(`/api/admin/users/${segundo.datos.user.id}`, { role: 'staff' });
  assert.equal(degradar.status, 200);

  // Y con uno solo, ya no.
  const { getDb } = await import('../src/db/index.js');
  const soloUno = getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'master'").get().n;
  assert.equal(soloUno, 1);
});

test('las respuestas llevan las cabeceras de seguridad esperadas', async () => {
  const anonimo = crearCliente();
  const r = await anonimo.get('/api/health');

  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.equal(r.headers.get('x-powered-by'), null);

  const csp = r.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  // Sin 'unsafe-inline' ni 'unsafe-eval': la interfaz no los necesita.
  assert.ok(!csp.includes('unsafe-inline'));
  assert.ok(!csp.includes('unsafe-eval'));
});

test('la cookie de refresco es httpOnly, SameSite=Strict y de ámbito acotado', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();
  const r = await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: 'Diferencial-Rojo-91' });

  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('rh_refresh='));
  assert.ok(cookie, 'debe emitirse la cookie de refresco');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/auth/i);
});

test('se rechaza una petición con Origin de otro sitio', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();

  const r = await cliente.post(
    '/api/auth/login',
    { email: 'cliente@pista.ec', password: 'Diferencial-Rojo-91' },
    { cabeceras: { Origin: 'https://sitio-malicioso.example' } },
  );
  assert.equal(r.status, 403);
  assert.equal(r.datos.error.code, 'origen_no_permitido');
});

test('un cuerpo JSON inválido o demasiado grande devuelve un error claro', async () => {
  const anonimo = crearCliente();

  const roto = await fetch(`${await levantarServidor()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{esto no es json',
  });
  assert.equal(roto.status, 400);
  assert.equal((await roto.json()).error.code, 'json_invalido');

  const enorme = await anonimo.post('/api/auth/login', { email: 'a@b.co', password: 'x'.repeat(200_000) });
  assert.equal(enorme.status, 413);
});

test('las cadenas con intento de inyección se tratan como texto', async () => {
  const { cMaster } = await sembrarUsuarios();

  const nombreHostil = "Robert'); DROP TABLE users;--";
  const creado = await cMaster.post('/api/admin/users', {
    email: 'inyeccion@pista.ec', fullName: nombreHostil, role: 'customer', password: 'Palanca-Cambios-55',
  });
  assert.equal(creado.status, 201);
  assert.equal(creado.datos.user.fullName, nombreHostil);

  // La tabla sigue existiendo y el usuario se puede buscar por ese nombre.
  const busqueda = await cMaster.get('/api/admin/users?search=Robert');
  assert.equal(busqueda.status, 200);
  assert.equal(busqueda.datos.items.length, 1);
});

test('los parámetros de paginación fuera de rango se rechazan', async () => {
  const { cMaster } = await sembrarUsuarios();

  assert.equal((await cMaster.get('/api/admin/users?limit=0')).status, 400);
  assert.equal((await cMaster.get('/api/admin/users?limit=9999')).status, 400);
  assert.equal((await cMaster.get('/api/admin/users?offset=-1')).status, 400);
  assert.equal((await cMaster.get('/api/admin/users?limit=abc')).status, 400);
  assert.equal((await cMaster.get('/api/admin/users?limit=25&offset=0')).status, 200);
});

test('el límite de intentos frena una ráfaga de logins', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();

  let bloqueado = false;
  for (let i = 0; i < 30; i += 1) {
    const r = await cliente.post('/api/auth/login', { email: `inexistente${i}@pista.ec`, password: 'loquesea1234' });
    if (r.status === 429) {
      bloqueado = true;
      assert.ok(Number(r.headers.get('retry-after')) > 0);
      break;
    }
  }
  assert.ok(bloqueado, 'debe activarse el límite por dirección IP');
});

test('el QR de un pack no revela información de otros clientes', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'tercero@pista.ec', fullName: 'Tercer Piloto', role: 'customer', password: 'Palanca-Cambios-55',
  });
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packAjeno = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });

  // El personal sí puede consultar cualquier pack: lo necesita en la puerta.
  const consulta = await cStaff.get(`/api/scan/lookup/${packAjeno.datos.pack.code}`);
  assert.equal(consulta.status, 200);
  assert.equal(consulta.datos.customer.fullName, 'Tercer Piloto');
  // Pero nunca recibe el secreto de firma.
  assert.ok(!JSON.stringify(consulta.datos).includes('secret'));
});

test('un cliente no puede anular sus propios consumos', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);
  const consumo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

  const intento = await cCliente.post(`/api/admin/redemptions/${consumo.datos.redemptionId}/void`, { reason: 'me arrepentí' });
  assert.equal(intento.status, 403);
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('una ruta de API inexistente devuelve JSON, no HTML', async () => {
  const anonimo = crearCliente();
  const r = await anonimo.get('/api/no-existe');
  assert.equal(r.status, 404);
  assert.equal(r.datos.error.code, 'ruta_no_encontrada');
});

test('los mensajes de error no filtran detalles internos', async () => {
  const { cMaster } = await sembrarUsuarios();
  const r = await cMaster.get('/api/admin/packs/no-es-un-identificador');
  assert.equal(r.status, 404);
  assert.ok(!/SQLITE|at Object|\/src\//.test(JSON.stringify(r.datos)));
});

test('los mensajes de validación llegan en español, también cuando falta el cuerpo', async () => {
  const anonimo = crearCliente();

  // Petición sin cuerpo: el error debe señalar los campos que faltan.
  const sinCuerpo = await anonimo.post('/api/auth/login');
  assert.equal(sinCuerpo.status, 400);
  assert.deepEqual(Object.keys(sinCuerpo.datos.error.details.fields).sort(), ['email', 'password']);

  const { cMaster } = await sembrarUsuarios();
  const casos = [
    ['/api/auth/login', { email: 'sin-arroba', password: 'x' }],
    ['/api/auth/register', { email: 'a@b.ec', password: 'corta', fullName: 'A' }],
    ['/api/admin/packs', { userId: 'no-es-uuid', size: 5 }],
    ['/api/admin/users', { email: 'a@b.ec', fullName: 'Nombre', role: 'inventado' }],
  ];

  const mensajes = [];
  for (const [ruta, cuerpo] of casos) {
    const cliente = ruta.startsWith('/api/admin') ? cMaster : anonimo;
    const r = await cliente.post(ruta, cuerpo);
    assert.equal(r.status, 400, `${ruta} debería rechazarse`);
    mensajes.push(r.datos.error.message, ...Object.values(r.datos.error.details?.fields ?? {}));
  }

  // Ningún texto de la librería de validación debe colarse sin traducir.
  const enIngles = mensajes.filter((m) =>
    /\b(Required|Invalid|Expected|String must|Number must|Too small|Too big|received)\b/.test(m),
  );
  assert.deepEqual(enIngles, [], `mensajes sin traducir: ${enIngles.join(' | ')}`);
});

test('cada clase de error de validación tiene su frase en español', async () => {
  // Una por cada rama del traductor de mensajes: si la librería de validación
  // cambia de versión y renombra sus códigos, esto lo dice en vez de dejar que
  // el inglés aparezca en pantalla.
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();

  const campo = (respuesta, nombre) => respuesta.datos.error.details.fields[nombre];

  const tipoNumero = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 'cinco' });
  assert.equal(campo(tipoNumero, 'size'), 'Debe ser un número.');

  const tipoBooleano = await cMaster.post('/api/admin/packs', {
    userId: cliente.id,
    size: 5,
    allowStaticQr: 'sí',
  });
  assert.equal(campo(tipoBooleano, 'allowStaticQr'), 'Debe ser sí o no.');

  const obligatorio = await cCliente.post('/api/auth/change-password', {
    currentPassword: '',
    newPassword: 'Chasis-Aluminio-2026',
  });
  assert.equal(campo(obligatorio, 'currentPassword'), 'Este dato es obligatorio.');

  const textoLargo = await cStaff.post('/api/scan/manual', {
    code: 'RHE-ABCD-EFGH',
    deviceLabel: 'P'.repeat(61),
  });
  assert.equal(campo(textoLargo, 'deviceLabel'), 'No puede superar los 60 caracteres.');

  const numeroGrande = await cMaster.get('/api/admin/users?limit=500');
  assert.equal(campo(numeroGrande, 'limit'), 'Debe ser 200 o menos.');

  const numeroChico = await cMaster.get('/api/admin/users?limit=0');
  assert.equal(campo(numeroChico, 'limit'), 'Debe ser 1 o más.');

  const fecha = await cMaster.post('/api/admin/packs', {
    userId: cliente.id,
    size: 5,
    expiresAt: 'el sábado',
  });
  assert.equal(campo(fecha, 'expiresAt'), 'La fecha no tiene un formato válido.');

  const opcion = await cMaster.post('/api/admin/packs', {
    userId: cliente.id,
    size: 5,
    paymentMethod: 'criptomonedas',
  });
  assert.match(campo(opcion, 'paymentMethod'), /^Valor no permitido\. Opciones: efectivo, /);

  // Y los mensajes escritos a mano en cada esquema siguen mandando sobre los
  // genéricos, que es lo que hace que digan algo útil.
  const aMedida = await cMaster.post('/api/admin/packs', { userId: 'no-es-uuid', size: 5 });
  assert.equal(campo(aMedida, 'userId'), 'Selecciona un cliente válido.');
});

test('la política de seguridad de contenido cubre las rutas de página', async () => {
  const anonimo = crearCliente();
  for (const ruta of ['/', '/app', '/escanear', '/admin']) {
    const r = await anonimo.get(ruta);
    assert.equal(r.status, 200, `${ruta} debe servirse`);
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp?.includes("script-src 'self'"), `${ruta} sin política de scripts`);
    assert.ok(!csp.includes('unsafe-inline'), `${ruta} permite estilos o scripts en línea`);
  }
});

test('una página inexistente devuelve la página de error, no un fallo del servidor', async () => {
  const anonimo = crearCliente();
  const r = await anonimo.get('/ruta/que-no-existe');
  assert.equal(r.status, 404);
  assert.ok(String(r.datos).includes('Esa página no existe'));
});

test('la sesión sobrevive aunque el dominio arrastre muchas cookies', async () => {
  const { cCliente } = await sembrarUsuarios();
  const refresco = cCliente.leerCookie('rh_refresh');
  assert.ok(refresco, 'debería existir la cookie de refresco');

  // Otra cosa del mismo dominio deja cookies grandes: analítica, un chat, lo
  // que sea. La de refresco va la última, que es el caso incómodo.
  const relleno = Array.from({ length: 12 }, (_, i) => `relleno${i}=${'x'.repeat(700)}`).join('; ');
  const r = await cCliente.pedir('/api/auth/refresh', {
    metodo: 'POST',
    cabeceras: { Cookie: `${relleno}; rh_refresh=${refresco}` },
  });

  assert.equal(r.status, 200, 'la cookie de refresco tiene que seguir leyéndose');
  assert.ok(r.datos.accessToken);
});

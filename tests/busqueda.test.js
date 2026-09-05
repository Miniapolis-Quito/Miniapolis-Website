/**
 * Búsqueda y reportes.
 *
 * En Ecuador la mitad de los nombres llevan tilde o eñe, y en el mostrador
 * nadie las teclea. Buscar "maria" tiene que encontrar a María.
 */
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { plegar, patronLike, textoBusquedaUsuario } from '../src/lib/texto.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

const CLAVE = 'Palanca-Cambios-55';

async function crearClientes(cMaster) {
  const definiciones = [
    { email: 'maria@pista.ec', fullName: 'María Chasís', phone: '+593991112233' },
    { email: 'andres@pista.ec', fullName: 'Andrés Muñoz', phone: '+593992223344' },
    { email: 'lucia@pista.ec', fullName: 'Lucía Peña', phone: '+593993334455' },
  ];
  const creados = {};
  for (const definicion of definiciones) {
    const r = await cMaster.post('/api/admin/users', { ...definicion, role: 'customer', password: CLAVE });
    assert.equal(r.status, 201, JSON.stringify(r.datos));
    creados[definicion.email] = r.datos.user;
  }
  return creados;
}

test('plegar quita tildes, eñes y mayúsculas', () => {
  assert.equal(plegar('María Chasís'), 'maria chasis');
  assert.equal(plegar('Andrés MUÑOZ'), 'andres munoz');
  assert.equal(plegar('  Lucía   Peña  '), 'lucia pena');
  assert.equal(plegar(null), '');
  assert.equal(textoBusquedaUsuario({ fullName: 'María', email: 'M@P.ec', phone: '099' }), 'maria m@p.ec 099');
});

test('patronLike neutraliza los comodines de SQLite', () => {
  assert.equal(patronLike('50%'), '%50\\%%');
  assert.equal(patronLike('a_b'), '%a\\_b%');
  assert.equal(patronLike('C:\\ruta'), '%c:\\\\ruta%');
});

test('buscar clientes funciona con o sin tildes, en cualquier caso', async () => {
  const { cMaster } = await sembrarUsuarios();
  await crearClientes(cMaster);

  for (const termino of ['María', 'maria', 'MARIA', 'chasis', 'Chasís', 'maria chasis']) {
    const r = await cMaster.get(`/api/admin/users?search=${encodeURIComponent(termino)}`);
    assert.equal(r.datos.items.length, 1, `"${termino}" debería encontrar a María`);
    assert.equal(r.datos.items[0].fullName, 'María Chasís');
  }

  for (const termino of ['muñoz', 'munoz', 'MUNOZ', 'Andrés', 'andres']) {
    const r = await cMaster.get(`/api/admin/users?search=${encodeURIComponent(termino)}`);
    assert.equal(r.datos.items.length, 1, `"${termino}" debería encontrar a Andrés`);
  }
});

test('también se busca por correo y por teléfono', async () => {
  const { cMaster } = await sembrarUsuarios();
  await crearClientes(cMaster);

  const porCorreo = await cMaster.get('/api/admin/users?search=lucia@pista');
  assert.equal(porCorreo.datos.items.length, 1);

  const porTelefono = await cMaster.get('/api/admin/users?search=992223344');
  assert.equal(porTelefono.datos.items.length, 1);
  assert.equal(porTelefono.datos.items[0].fullName, 'Andrés Muñoz');
});

test('los comodines tecleados por el usuario no devuelven todo el padrón', async () => {
  const { cMaster } = await sembrarUsuarios();
  await crearClientes(cMaster);

  for (const termino of ['%', '_', '%%', 'a%b']) {
    const r = await cMaster.get(`/api/admin/users?search=${encodeURIComponent(termino)}`);
    assert.equal(r.datos.items.length, 0, `"${termino}" no debe comportarse como comodín`);
  }
});

test('los packs se buscan por código y por nombre del cliente con tildes', async () => {
  const { cMaster } = await sembrarUsuarios();
  const clientes = await crearClientes(cMaster);
  const emitido = await cMaster.post('/api/admin/packs', { userId: clientes['maria@pista.ec'].id, size: 5 });
  await cMaster.post('/api/admin/packs', { userId: clientes['andres@pista.ec'].id, size: 10 });

  for (const termino of ['María', 'maria', 'CHASIS', 'chasís']) {
    const r = await cMaster.get(`/api/admin/packs?search=${encodeURIComponent(termino)}`);
    assert.equal(r.datos.items.length, 1, `"${termino}" debería encontrar el pack de María`);
    assert.equal(r.datos.items[0].code, emitido.datos.pack.code);
  }

  // Por código, escrito como sea.
  const codigo = emitido.datos.pack.code;
  for (const termino of [codigo, codigo.toLowerCase(), codigo.slice(4)]) {
    const r = await cMaster.get(`/api/admin/packs?search=${encodeURIComponent(termino)}`);
    assert.equal(r.datos.items.length, 1, `"${termino}" debería encontrar el pack por código`);
  }

  const nada = await cMaster.get('/api/admin/packs?search=%25');
  assert.equal(nada.datos.items.length, 0);
});

test('cambiar el nombre de un cliente actualiza su búsqueda', async () => {
  const { cMaster } = await sembrarUsuarios();
  const clientes = await crearClientes(cMaster);

  await cMaster.patch(`/api/admin/users/${clientes['maria@pista.ec'].id}`, { fullName: 'María Sofía Chasís' });

  const nuevo = await cMaster.get('/api/admin/users?search=sofia');
  assert.equal(nuevo.datos.items.length, 1);

  // Y cambiar solo el teléfono no debe borrar el nombre del índice.
  await cMaster.patch(`/api/admin/users/${clientes['maria@pista.ec'].id}`, { phone: '+593900000000' });
  const sigue = await cMaster.get('/api/admin/users?search=sofia');
  assert.equal(sigue.datos.items.length, 1);
  const porNuevoTelefono = await cMaster.get('/api/admin/users?search=900000000');
  assert.equal(porNuevoTelefono.datos.items.length, 1);
});

test('la exportación a CSV no deja que un nombre se ejecute como fórmula', async () => {
  const { cMaster } = await sembrarUsuarios();
  await cMaster.post('/api/admin/users', {
    email: 'formula@pista.ec',
    fullName: '=1+1+cmd|calc',
    role: 'customer',
    password: CLAVE,
  });

  const csv = await cMaster.get('/api/admin/export/clientes.csv');
  const linea = csv.datos.split('\r\n').find((l) => l.includes('formula@pista.ec'));
  assert.ok(linea, 'el usuario debe aparecer en el reporte');
  assert.ok(!linea.startsWith('='), 'la celda no puede empezar por = o la hoja de cálculo la evaluaría');
  assert.ok(linea.startsWith("'=1+1"), 'debe quedar marcada como texto');
});

test('un pack vencido deja de sumar en el listado de clientes', async () => {
  const { cMaster } = await sembrarUsuarios();
  const clientes = await crearClientes(cMaster);
  const cliente = clientes['lucia@pista.ec'];
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const antes = await cMaster.get('/api/admin/users?search=lucia');
  assert.equal(antes.datos.items[0].availableTickets, 5);

  const { getDb } = await import('../src/db/index.js');
  getDb()
    .prepare('UPDATE packs SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), emitido.datos.pack.id);

  const despues = await cMaster.get('/api/admin/users?search=lucia');
  assert.equal(despues.datos.items[0].availableTickets, 0, 'un pack vencido no debe contar como disponible');
  assert.equal(despues.datos.items[0].activePacks, 0);
});

/**
 * Camino de actualización del esquema.
 *
 * Una base ya en producción tiene que poder subir de versión sin perder datos
 * y con las columnas nuevas rellenas. Aquí se simula ese salto en lugar de
 * comprobar solo que una base nueva quede bien.
 */
import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrations } from '../src/db/migrations.js';
import { textoBusquedaUsuario } from '../src/lib/texto.js';

/** Aplica las primeras `hasta` migraciones sobre una base en memoria. */
function baseEn(hasta) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (let i = 0; i < hasta; i += 1) {
    migrations[i].up(db);
    db.pragma(`user_version = ${i + 1}`);
  }
  return db;
}

test('las migraciones están numeradas y son únicas', () => {
  const nombres = migrations.map((m) => m.name);
  assert.equal(new Set(nombres).size, nombres.length, 'no puede haber dos migraciones con el mismo nombre');
  for (const [indice, nombre] of nombres.entries()) {
    assert.match(nombre, /^\d{3}-/, `"${nombre}" debe empezar por su número de orden`);
    assert.equal(nombre.slice(0, 3), String(indice + 1).padStart(3, '0'), `"${nombre}" está fuera de orden`);
  }
});

test('actualizar una base con datos rellena el texto de búsqueda', () => {
  const db = baseEn(1);
  const ahora = new Date().toISOString();

  // Usuarios creados con el esquema antiguo, antes de que existiera la columna.
  const insertar = db.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, phone, role, password_hash,
                        password_changed_at, created_at, updated_at)
     VALUES (@id, @email, @email_normalized, @full_name, @phone, @role, 'x', @ahora, @ahora, @ahora)`,
  );
  insertar.run({ id: 'u1', email: 'Maria@Pista.ec', email_normalized: 'maria@pista.ec', full_name: 'María Chasís', phone: '+593991112233', role: 'customer', ahora });
  insertar.run({ id: 'u2', email: 'beto@pista.ec', email_normalized: 'beto@pista.ec', full_name: 'Beto Muñoz', phone: null, role: 'staff', ahora });

  // Se aplica la migración pendiente.
  migrations[1].up(db);
  db.pragma('user_version = 2');

  const filas = db.prepare('SELECT id, search_text FROM users ORDER BY id').all();
  assert.equal(filas.length, 2, 'no se debe perder ningún usuario');
  assert.equal(
    filas[0].search_text,
    textoBusquedaUsuario({ fullName: 'María Chasís', email: 'Maria@Pista.ec', phone: '+593991112233' }),
  );
  assert.ok(filas[0].search_text.includes('maria chasis'), 'el texto debe quedar sin tildes');
  assert.ok(filas[1].search_text.includes('beto munoz'), 'la eñe también se pliega');

  db.close();
});

test('actualizar conserva las respuestas idempotentes y las asocia a su operador', () => {
  const db = baseEn(2);
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO idempotency_keys
      (key, user_id, endpoint, request_hash, status_code, response, created_at, expires_at)
     VALUES ('reintento-0001', 'operador-1', 'scan', 'hash', 200, '{}', ?, ?)`,
  ).run(ahora, new Date(Date.now() + 60_000).toISOString());

  migrations[2].up(db);
  const fila = db.prepare('SELECT user_id, key FROM idempotency_keys').get();
  assert.deepEqual(fila, { user_id: 'operador-1', key: 'reintento-0001' });

  const columnasPk = db
    .prepare('PRAGMA table_info(idempotency_keys)')
    .all()
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  assert.deepEqual(columnasPk, ['user_id', 'key']);
  db.close();
});

test('actualizar a migración 009 añade quantity a consumos, tabla transfers y amplía movimientos', () => {
  const indice = migrations.findIndex((m) => m.name === '009-admision-y-transferencia');
  assert.ok(indice > 0, 'falta la migración 009-admision-y-transferencia');
  const db = baseEn(indice);
  const ahora = new Date().toISOString();

  // Insertar datos previos en version previa
  db.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, role, password_hash, password_changed_at, created_at, updated_at)
     VALUES ('u1', 'test@test.ec', 'test@test.ec', 'Test User', 'customer', 'x', ?, ?, ?)`
  ).run(ahora, ahora, ahora);

  db.prepare(
    `INSERT INTO packs (id, code, user_id, size, remaining, secret, created_at, updated_at)
     VALUES ('p1', 'RHE-0001-0001', 'u1', 5, 5, 'sec', ?, ?)`
  ).run(ahora, ahora);

  db.prepare(
    `INSERT INTO redemptions (id, pack_id, user_id, method, remaining_before, remaining_after, status, created_at)
     VALUES ('r1', 'p1', 'u1', 'qr_dynamic', 5, 4, 'confirmed', ?)`
  ).run(ahora);

  db.prepare(
    `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, created_at)
     VALUES ('m1', 'p1', -1, 4, 'redeem', ?)`
  ).run(ahora);

  // Aplicar migración 009
  migrations[indice].up(db);
  db.pragma(`user_version = ${indice + 1}`);

  // Verificar que redemptions tiene quantity = 1 por defecto
  const r = db.prepare('SELECT id, quantity FROM redemptions WHERE id = ?').get('r1');
  assert.equal(r.quantity, 1);

  // Verificar que pack_movements permite transfer_out y transfer_in
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, created_at)
       VALUES ('m2', 'p1', -2, 2, 'transfer_out', ?)`
    ).run(ahora);

    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, created_at)
       VALUES ('m3', 'p1', 2, 4, 'transfer_in', ?)`
    ).run(ahora);

    db.prepare(
      `INSERT INTO transfers (id, sender_id, recipient_id, source_pack_id, destination_pack_id, quantity, note, created_at)
       VALUES ('t1', 'u1', 'u1', 'p1', 'p1', 2, 'prueba', ?)`
    ).run(ahora);
  });

  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get('t1');
  assert.equal(t.quantity, 2);
  assert.equal(t.note, 'prueba');

  db.close();
});

test('al actualizar, el personal que ya trabajaba conserva el escáner y los clientes no lo reciben', () => {
  // Una pista en marcha no puede quedarse sin operadores a mitad de jornada
  // porque se actualizó el sistema; pero el permiso tampoco puede aparecer de
  // la nada en las cuentas de los clientes.
  const indice = migrations.findIndex((m) => m.name === '010-permiso-de-escaneo');
  assert.ok(indice > 0, 'falta la migración 010-permiso-de-escaneo');
  const db = baseEn(indice);
  const ahora = new Date().toISOString();
  const insertar = db.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, role, password_hash,
                        password_changed_at, created_at, updated_at, search_text)
     VALUES (@id, @email, @email, @full_name, @role, 'x', @ahora, @ahora, @ahora, '')`,
  );
  insertar.run({ id: 'm1', email: 'jefa@pista.ec', full_name: 'Jefa', role: 'master', ahora });
  insertar.run({ id: 's1', email: 'puerta@pista.ec', full_name: 'Puerta', role: 'staff', ahora });
  insertar.run({ id: 'c1', email: 'piloto@pista.ec', full_name: 'Piloto', role: 'customer', ahora });

  migrations[indice].up(db);

  const permisos = Object.fromEntries(
    db.prepare('SELECT id, scan_enabled FROM users ORDER BY id').all().map((f) => [f.id, f.scan_enabled]),
  );
  assert.deepEqual(permisos, { c1: 0, m1: 1, s1: 1 });

  db.close();
});

test('aplicar todas las migraciones deja el esquema esperado', () => {
  const db = baseEn(migrations.length);

  const tablas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(tablas, [
    'audit_log', 'idempotency_keys', 'loyalty_rewards', 'notifications', 'pack_movements', 'pack_requests',
    'packs', 'password_resets', 'rate_limits', 'redemptions', 'sessions', 'settings', 'transfers',
    'used_nonces', 'users', 'wallet_devices', 'wallet_passes',
  ]);

  assert.equal(db.pragma('user_version', { simple: true }), migrations.length);

  // Índices que sostienen las garantías del sistema.
  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  for (const necesario of [
    'idx_redemptions_idem', 'idx_users_search', 'idx_movements_pack', 'idx_wallet_devices_serial',
    'idx_password_resets_expiry', 'idx_notifications_queue', 'idx_transfers_sender',
    'idx_users_scan_enabled', 'idx_pack_requests_status', 'idx_loyalty_user', 'idx_packs_origin',
  ]) {
    assert.ok(indices.includes(necesario), `falta el índice ${necesario}`);
  }

  db.close();
});

test('actualizar conserva los consumos y los marca como cobrados en línea', () => {
  const indice = migrations.findIndex((m) => m.name === '007-lecturas-sin-conexion');
  assert.ok(indice > 0, 'falta la migración de lecturas sin conexión');
  const db = baseEn(indice);
  const ahora = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, role, password_hash, password_changed_at, created_at, updated_at)
     VALUES ('u1', 'c@pista.ec', 'c@pista.ec', 'Cliente', 'customer', 'x', @ahora, @ahora, @ahora)`,
  ).run({ ahora });
  db.prepare(
    `INSERT INTO packs (id, code, user_id, size, remaining, secret, created_at, updated_at)
     VALUES ('p1', 'RHE-AAAA-BBBB', 'u1', 5, 4, 's', @ahora, @ahora)`,
  ).run({ ahora });
  db.prepare(
    `INSERT INTO redemptions (id, pack_id, user_id, method, remaining_before, remaining_after, created_at)
     VALUES ('r1', 'p1', 'u1', 'qr_dynamic', 5, 4, @ahora)`,
  ).run({ ahora });

  migrations[indice].up(db);

  const consumo = db.prepare('SELECT * FROM redemptions WHERE id = ?').get('r1');
  assert.equal(consumo.created_at, ahora);
  assert.equal(consumo.synced_at, null, 'un consumo anterior se cobró en línea');
  db.close();
});

test('una base de una versión más nueva se rechaza en vez de tocarla', async () => {
  // Si alguien vuelve a una versión anterior del código, lo peligroso no es que
  // falle: es que arranque y escriba sobre un esquema que no conoce.
  const archivo = path.join(mkdtempSync(path.join(tmpdir(), 'rhe-esquema-')), 'futura.db');
  const futura = new Database(archivo);
  for (const migracion of migrations) migracion.up(futura);
  futura.pragma(`user_version = ${migrations.length + 1}`);
  futura.close();

  const anterior = process.env.DATABASE_FILE;
  process.env.DATABASE_FILE = archivo;
  const { getDb, closeDb } = await import(`../src/db/index.js?esquema-futuro`);
  try {
    assert.throws(() => getDb(), /versión más nueva/i);
  } finally {
    closeDb();
    process.env.DATABASE_FILE = anterior;
    rmSync(path.dirname(archivo), { recursive: true, force: true });
  }
});

test('si la base no se puede abrir, el error dice dónde mirar', () => {
  // La configuración se lee una sola vez al arrancar, así que esto se comprueba
  // como pasa de verdad: levantando el proceso con una ruta imposible. Es el
  // tropiezo más común al instalar —la carpeta no existe o el usuario del
  // servicio no puede escribir en ella— y el mensaje tiene que decirlo.
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resultado = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "const { getDb } = await import('./src/db/index.js'); getDb();"],
    {
      cwd: raiz,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ENV_FILE: '/dev/null',
        LOG_LEVEL: 'silent',
        DATABASE_FILE: '/dev/null/imposible/tickets.db',
      },
    },
  );

  assert.notEqual(resultado.status, 0, 'el proceso no debería arrancar');
  assert.match(resultado.stderr, /No se pudo abrir la base de datos/);
  assert.match(resultado.stderr, /DATABASE_FILE/, 'debería nombrar la variable que hay que revisar');
  assert.match(resultado.stderr, /escribir/, 'y apuntar a los permisos');
});

test('el esquema impide guardar un pack con saldo imposible', () => {
  const db = baseEn(migrations.length);
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, role, password_hash, password_changed_at, created_at, updated_at)
     VALUES ('u1', 'a@b.ec', 'a@b.ec', 'Cliente', 'customer', 'x', ?, ?, ?)`,
  ).run(ahora, ahora, ahora);

  const insertarPack = (remaining, size) =>
    db.prepare(
      `INSERT INTO packs (id, code, user_id, size, remaining, secret, created_at, updated_at)
       VALUES (?, ?, 'u1', ?, ?, 's', ?, ?)`,
    ).run(`p${remaining}${size}`, `RHE-AAAA-${remaining}${size}${size}${size}`, size, remaining, ahora, ahora);

  assert.throws(() => insertarPack(-1, 5), /CHECK/, 'un saldo negativo debe rechazarse');
  assert.throws(() => insertarPack(6, 5), /CHECK/, 'no puede quedar más saldo que el tamaño del pack');
  assert.doesNotThrow(() => insertarPack(5, 5));

  db.close();
});

test('los avisos llegan a una base con clientes, que quedan con los recordatorios activados', () => {
  const indice = migrations.findIndex((m) => m.name === '008-avisos-a-clientes');
  const db = baseEn(indice);
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, role, password_hash, password_changed_at, created_at, updated_at)
     VALUES ('u1', 'a@b.ec', 'a@b.ec', 'Cliente de antes', 'customer', 'x', ?, ?, ?)`,
  ).run(ahora, ahora, ahora);

  migrations[indice].up(db);

  const usuario = db.prepare('SELECT full_name, email_reminders, email_reminders_changed_at FROM users').get();
  assert.deepEqual({ ...usuario }, { full_name: 'Cliente de antes', email_reminders: 1, email_reminders_changed_at: null });

  const insertarAviso = (id, clave) =>
    db.prepare(
      `INSERT INTO notifications (id, user_id, kind, channel, dedupe_key, status, created_at, updated_at)
       VALUES (?, 'u1', 'inactive', 'email', ?, 'pending', ?, ?)`,
    ).run(id, clave, ahora, ahora);
  insertarAviso('n1', 'inactive:u1:x');
  assert.throws(() => insertarAviso('n2', 'inactive:u1:x'), /UNIQUE/, 'la clave impide duplicar un aviso');
  assert.doesNotThrow(() => insertarAviso('n3', null), 'los contactos a mano no llevan clave');
  assert.throws(() => db.prepare("UPDATE users SET email_reminders = 2").run(), /CHECK/);

  db.close();
});

test('la migración 012 crea los índices de cobertura y aceleración de consultas', () => {
  const indice = migrations.findIndex((m) => m.name === '012-optimizacion-rendimiento-indices');
  const db = baseEn(indice);

  migrations[indice].up(db);

  const indices = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((r) => r.name);

  assert.ok(indices.includes('idx_redemptions_pack_status_qty'), 'debe crear idx_redemptions_pack_status_qty');
  assert.ok(indices.includes('idx_movements_reason_pack'), 'debe crear idx_movements_reason_pack');
  assert.ok(indices.includes('idx_sessions_user_active'), 'debe crear idx_sessions_user_active');
  assert.ok(indices.includes('idx_users_role_status'), 'debe crear idx_users_role_status');

  db.close();
});

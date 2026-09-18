/**
 * Capa de acceso a SQLite.
 *
 * Se usa better-sqlite3 en modo síncrono: para una carga de este tamaño es más
 * rápido y, sobre todo, hace que las transacciones sean triviales de razonar
 * (no hay await en medio de un BEGIN...COMMIT, así que no puede colarse otra
 * operación dentro de la transacción).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { migrations } from './migrations.js';
import { logger } from '../lib/logger.js';

let db = null;
const statementCache = new Map();

function applyPragmas(handle, { memory }) {
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');
  handle.pragma('temp_store = MEMORY');
  handle.pragma('cache_size = -16000');
  if (!memory) {
    // WAL permite lecturas concurrentes mientras se escribe y sobrevive mejor
    // a cortes de energía; NORMAL es el punto correcto de durabilidad con WAL.
    handle.pragma('journal_mode = WAL');
    handle.pragma('synchronous = NORMAL');
    handle.pragma('wal_autocheckpoint = 512');
    // Mapeo en memoria (mmap) de 256MB para lecturas directas ultra-rápidas sin copias de buffer.
    handle.pragma('mmap_size = 268435456');
  }
  handle.pragma('trusted_schema = OFF');
}

/**
 * La base guarda hashes de contraseñas, sesiones y el secreto que firma los QR
 * de cada pack: nadie más en la máquina debe poder leerla. SQLite crea los
 * archivos `-wal` y `-shm` con los mismos permisos que la base, así que basta
 * con fijarlos al abrirla.
 */
function restringirPermisos(file) {
  for (const archivo of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      fs.chmodSync(archivo, 0o600);
    } catch {
      /* todavía no existe, o el sistema de archivos no admite permisos */
    }
  }
}

function runMigrations(handle) {
  const applied = handle.pragma('user_version', { simple: true });
  if (applied > migrations.length) {
    throw new Error(
      `La base de datos fue creada por una versión más nueva de la aplicación ` +
        `(esquema ${applied}, esta versión conoce ${migrations.length}). Actualiza el código antes de continuar.`,
    );
  }
  for (let i = applied; i < migrations.length; i += 1) {
    const migration = migrations[i];
    const tx = handle.transaction(() => {
      migration.up(handle);
      handle.pragma(`user_version = ${i + 1}`);
    });
    tx();
    logger.info(`Migración aplicada: ${migration.name}`);
  }
}

/**
 * Prepara o reutiliza una sentencia SQLite compilada en memoria.
 * Evita la recompilación redundante de SQL en rutas y operaciones frecuentes.
 */
export function prepareCached(sql) {
  const handle = getDb();
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = handle.prepare(sql);
    statementCache.set(sql, stmt);
  }
  return stmt;
}

/** Abre (o reutiliza) la conexión a la base de datos y aplica migraciones. */
export function getDb() {
  if (db) return db;

  const file = config.databaseFile;
  const memory = file === ':memory:';

  try {
    // La carpeta nueva nace cerrada; una que ya existía no se toca, porque
    // podría ser compartida (por ejemplo, /var/lib).
    if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    db = new Database(file);
    db.cachedPrepare = prepareCached;
  } catch (error) {
    // El tropiezo más común al instalar: la carpeta no existe o el usuario del
    // servicio no puede escribir en ella. Sin este mensaje, lo que aparece es
    // un error de la librería nativa que no dice dónde mirar.
    throw new Error(
      `No se pudo abrir la base de datos en "${file}": ${error.message}. ` +
        `Comprueba que la ruta de DATABASE_FILE existe y que el usuario que ejecuta el servicio puede escribir en ella.`,
      { cause: error },
    );
  }

  applyPragmas(db, { memory });
  if (!memory) restringirPermisos(file);
  runMigrations(db);
  return db;
}

/** Reintentos ante contención de escritura entre procesos. */
const REINTENTOS_POR_CONTENCION = 3;

/**
 * Espera `ms` sin devolver el control al bucle de eventos.
 *
 * Una transacción de better-sqlite3 es síncrona: entre el fallo y el reintento
 * no hay forma de ceder el turno. Lo que sí se puede es esperar durmiendo de
 * verdad en vez de girando en un bucle. Girar mantenía un núcleo al cien por
 * cien sin avanzar nada: el proceso que tiene el bloqueo está en otra parte, y
 * mientras tanto este no atiende ni el latido del canal en vivo ni la lectura
 * de la puerta. Justo cuando hay más carga es cuando más daño hacía.
 */
function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Ejecuta `fn` dentro de una transacción exclusiva de escritura.
 * BEGIN IMMEDIATE toma el lock de escritura desde el inicio, lo que evita
 * errores SQLITE_BUSY a mitad de la transacción cuando hay varios procesos.
 * Incluye reintentos con retroceso aleatorio ante picos de contención.
 */
export function transaction(fn) {
  const handle = getDb();
  const wrapped = handle.transaction(fn);
  return (...args) => {
    let reintentos = REINTENTOS_POR_CONTENCION;
    while (true) {
      try {
        return wrapped.immediate(...args);
      } catch (error) {
        if (reintentos > 0 && (error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED')) {
          reintentos -= 1;
          dormir(20 + Math.floor(Math.random() * 40));
          continue;
        }
        throw error;
      }
    }
  };
}

/** Azúcar: ejecuta una función dentro de una transacción inmediata, ya invocada. */
export function inTransaction(fn) {
  return transaction(fn)();
}

/** Ejecuta un punto de control pasivo y optimización de estadísticas en SQLite. */
export function checkpointDb() {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    db.pragma('optimize');
  } catch {
    /* no crítico */
  }
}

export function closeDb() {
  if (db) {
    statementCache.clear();
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
      db.pragma('optimize');
    } catch {
      /* no crítico */
    }
    db.close();
    db = null;
  }
}


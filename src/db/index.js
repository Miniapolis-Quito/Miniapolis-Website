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

function applyPragmas(handle, { memory }) {
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');
  if (!memory) {
    // WAL permite lecturas concurrentes mientras se escribe y sobrevive mejor
    // a cortes de energía; NORMAL es el punto correcto de durabilidad con WAL.
    handle.pragma('journal_mode = WAL');
    handle.pragma('synchronous = NORMAL');
    handle.pragma('wal_autocheckpoint = 512');
  }
  handle.pragma('trusted_schema = OFF');
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

/** Abre (o reutiliza) la conexión a la base de datos y aplica migraciones. */
export function getDb() {
  if (db) return db;

  const file = config.databaseFile;
  const memory = file === ':memory:';

  try {
    if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
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
  runMigrations(db);
  return db;
}

/**
 * Ejecuta `fn` dentro de una transacción exclusiva de escritura.
 * BEGIN IMMEDIATE toma el lock de escritura desde el inicio, lo que evita
 * errores SQLITE_BUSY a mitad de la transacción cuando hay varios procesos.
 */
export function transaction(fn) {
  const handle = getDb();
  const wrapped = handle.transaction(fn);
  return (...args) => wrapped.immediate(...args);
}

/** Azúcar: ejecuta una función dentro de una transacción inmediata, ya invocada. */
export function inTransaction(fn) {
  return transaction(fn)();
}

export function closeDb() {
  if (db) {
    try {
      db.pragma('optimize');
    } catch {
      /* no crítico */
    }
    db.close();
    db = null;
  }
}

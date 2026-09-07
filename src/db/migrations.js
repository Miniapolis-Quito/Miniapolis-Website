/**
 * Migraciones incrementales del esquema.
 *
 * Cada entrada del arreglo se aplica una sola vez y en orden, dentro de una
 * transacción. `user_version` de SQLite guarda cuántas se han aplicado, así que
 * nunca se debe reordenar ni eliminar una migración ya publicada: para cambiar
 * algo se agrega una migración nueva al final.
 */
import { textoBusquedaUsuario } from '../lib/texto.js';

export const migrations = [
  {
    name: '001-esquema-inicial',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Usuarios
        -- ---------------------------------------------------------------
        CREATE TABLE users (
          id                TEXT PRIMARY KEY,
          email             TEXT NOT NULL,
          email_normalized  TEXT NOT NULL UNIQUE,
          full_name         TEXT NOT NULL,
          phone             TEXT,
          role              TEXT NOT NULL CHECK (role IN ('master','staff','customer')),
          status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
          password_hash     TEXT NOT NULL,
          password_changed_at TEXT NOT NULL,
          failed_logins     INTEGER NOT NULL DEFAULT 0,
          locked_until      TEXT,
          last_login_at     TEXT,
          token_version     INTEGER NOT NULL DEFAULT 1,
          created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL
        );
        CREATE INDEX idx_users_role   ON users(role);
        CREATE INDEX idx_users_phone  ON users(phone);
        CREATE INDEX idx_users_created ON users(created_at DESC);

        -- ---------------------------------------------------------------
        -- Sesiones (refresh tokens rotativos con detección de reutilización)
        -- ---------------------------------------------------------------
        CREATE TABLE sessions (
          id            TEXT PRIMARY KEY,
          family_id     TEXT NOT NULL,
          user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash    TEXT NOT NULL UNIQUE,
          created_at    TEXT NOT NULL,
          expires_at    TEXT NOT NULL,
          last_used_at  TEXT,
          rotated_to    TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          revoked_at    TEXT,
          revoke_reason TEXT,
          ip            TEXT,
          user_agent    TEXT
        );
        CREATE INDEX idx_sessions_user   ON sessions(user_id);
        CREATE INDEX idx_sessions_family ON sessions(family_id);
        CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

        -- ---------------------------------------------------------------
        -- Packs de entradas
        -- ---------------------------------------------------------------
        CREATE TABLE packs (
          id                TEXT PRIMARY KEY,
          code              TEXT NOT NULL UNIQUE,
          user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          size              INTEGER NOT NULL CHECK (size > 0),
          remaining         INTEGER NOT NULL CHECK (remaining >= 0),
          price_cents       INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
          currency          TEXT NOT NULL DEFAULT 'USD',
          secret            TEXT NOT NULL,
          status            TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','depleted','cancelled','suspended','expired')),
          allow_static_qr   INTEGER NOT NULL DEFAULT 0 CHECK (allow_static_qr IN (0,1)),
          expires_at        TEXT,
          note              TEXT,
          payment_method    TEXT,
          payment_reference TEXT,
          created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          CHECK (remaining <= size)
        );
        CREATE INDEX idx_packs_user    ON packs(user_id, status);
        CREATE INDEX idx_packs_status  ON packs(status);
        CREATE INDEX idx_packs_created ON packs(created_at DESC);
        CREATE INDEX idx_packs_expires ON packs(expires_at);

        -- ---------------------------------------------------------------
        -- Consumos (cada escaneo válido descuenta una entrada)
        -- ---------------------------------------------------------------
        CREATE TABLE redemptions (
          id              TEXT PRIMARY KEY,
          pack_id         TEXT NOT NULL REFERENCES packs(id) ON DELETE RESTRICT,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          scanned_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
          device_label    TEXT,
          method          TEXT NOT NULL CHECK (method IN ('qr_dynamic','qr_static','manual_code','admin')),
          remaining_before INTEGER NOT NULL,
          remaining_after  INTEGER NOT NULL,
          status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','voided')),
          voided_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
          voided_at       TEXT,
          void_reason     TEXT,
          idempotency_key TEXT,
          nonce           TEXT,
          ip              TEXT,
          created_at      TEXT NOT NULL
        );
        CREATE INDEX idx_redemptions_pack    ON redemptions(pack_id, created_at DESC);
        CREATE INDEX idx_redemptions_user    ON redemptions(user_id, created_at DESC);
        CREATE INDEX idx_redemptions_scanner ON redemptions(scanned_by, created_at DESC);
        CREATE INDEX idx_redemptions_created ON redemptions(created_at DESC);
        CREATE UNIQUE INDEX idx_redemptions_idem ON redemptions(idempotency_key)
          WHERE idempotency_key IS NOT NULL;

        -- ---------------------------------------------------------------
        -- Libro mayor: fuente de verdad de todo movimiento de entradas.
        -- packs.remaining es una proyección de la suma de estos deltas.
        -- ---------------------------------------------------------------
        CREATE TABLE pack_movements (
          id            TEXT PRIMARY KEY,
          pack_id       TEXT NOT NULL REFERENCES packs(id) ON DELETE RESTRICT,
          delta         INTEGER NOT NULL,
          balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
          reason        TEXT NOT NULL
                          CHECK (reason IN ('issue','redeem','void','adjust','cancel','restore')),
          redemption_id TEXT REFERENCES redemptions(id) ON DELETE SET NULL,
          actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
          note          TEXT,
          created_at    TEXT NOT NULL
        );
        CREATE INDEX idx_movements_pack    ON pack_movements(pack_id, created_at DESC);
        CREATE INDEX idx_movements_created ON pack_movements(created_at DESC);

        -- ---------------------------------------------------------------
        -- Anti-replay de códigos QR dinámicos
        -- ---------------------------------------------------------------
        CREATE TABLE used_nonces (
          nonce      TEXT PRIMARY KEY,
          pack_id    TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_nonces_expiry ON used_nonces(expires_at);

        -- ---------------------------------------------------------------
        -- Bitácora de auditoría
        -- ---------------------------------------------------------------
        CREATE TABLE audit_log (
          id          TEXT PRIMARY KEY,
          actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
          actor_email TEXT,
          action      TEXT NOT NULL,
          entity_type TEXT,
          entity_id   TEXT,
          metadata    TEXT,
          ip          TEXT,
          user_agent  TEXT,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
        CREATE INDEX idx_audit_actor   ON audit_log(actor_id, created_at DESC);
        CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id);
        CREATE INDEX idx_audit_action  ON audit_log(action, created_at DESC);

        -- ---------------------------------------------------------------
        -- Limitación de tasa persistente (sobrevive a reinicios)
        -- ---------------------------------------------------------------
        CREATE TABLE rate_limits (
          key          TEXT PRIMARY KEY,
          count        INTEGER NOT NULL,
          window_start TEXT NOT NULL,
          expires_at   TEXT NOT NULL
        );
        CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);

        -- ---------------------------------------------------------------
        -- Respuestas idempotentes (reintentos de red no duplican consumos)
        -- ---------------------------------------------------------------
        CREATE TABLE idempotency_keys (
          key          TEXT PRIMARY KEY,
          user_id      TEXT,
          endpoint     TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status_code  INTEGER NOT NULL,
          response     TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          expires_at   TEXT NOT NULL
        );
        CREATE INDEX idx_idem_expiry ON idempotency_keys(expires_at);
      `);
    },
  },
  {
    name: '002-busqueda-sin-tildes',
    up: (db) => {
      // El LIKE de SQLite solo ignora mayúsculas en ASCII: sin una columna
      // normalizada, buscar "maria" nunca encontraría a "María".
      db.exec(`
        ALTER TABLE users ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
        CREATE INDEX idx_users_search ON users(search_text);
      `);

      // Relleno de las filas existentes: el plegado se hace en JavaScript
      // porque SQLite no sabe quitar tildes por sí solo.
      const filas = db.prepare('SELECT id, full_name, email, phone FROM users').all();
      const actualizar = db.prepare('UPDATE users SET search_text = ? WHERE id = ?');
      for (const fila of filas) {
        actualizar.run(
          textoBusquedaUsuario({ fullName: fila.full_name, email: fila.email, phone: fila.phone }),
          fila.id,
        );
      }
    },
  },
  {
    name: '003-indices-de-informes',
    up: (db) => {
      db.exec(`
        -- El panel cuenta consumos confirmados por fecha en cada carga; sin
        -- este índice la consulta recorre toda la tabla de consumos.
        CREATE INDEX IF NOT EXISTS idx_redemptions_status_created
          ON redemptions(status, created_at DESC);

        -- El teléfono se busca por la columna normalizada (search_text), así
        -- que su índice propio solo encarecía cada alta y cada actualización.
        DROP INDEX IF EXISTS idx_users_phone;
      `);
    },
  },
];

export default migrations;

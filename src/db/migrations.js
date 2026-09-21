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
    name: '003-idempotencia-por-operador',
    up: (db) => {
      // Una clave pertenece al cliente que la creó, no a toda la instalación.
      // El esquema inicial la hacía global: dos puestos con una clave simple
      // podían interferirse y, peor, recibir la respuesta del otro puesto.
      db.exec(`
        CREATE TABLE idempotency_keys_new (
          user_id      TEXT NOT NULL,
          key          TEXT NOT NULL,
          endpoint     TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status_code  INTEGER NOT NULL,
          response     TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          expires_at   TEXT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
        INSERT INTO idempotency_keys_new
          (user_id, key, endpoint, request_hash, status_code, response, created_at, expires_at)
          SELECT COALESCE(user_id, ''), key, endpoint, request_hash, status_code, response, created_at, expires_at
            FROM idempotency_keys;
        DROP TABLE idempotency_keys;
        ALTER TABLE idempotency_keys_new RENAME TO idempotency_keys;
        CREATE INDEX idx_idem_expiry ON idempotency_keys(expires_at);

        DROP INDEX idx_redemptions_idem;
        CREATE UNIQUE INDEX idx_redemptions_idem ON redemptions(scanned_by, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `);
    },
  },
  {
    name: '004-indices-de-informes',
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
  {
    name: '005-pases-en-la-cartera',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Pases en la cartera del teléfono (Apple Wallet / Google Wallet)
        --
        -- El número de serie es opaco a propósito: viaja en la URL que el
        -- teléfono consulta y en los registros del proxy, mientras que el
        -- código del pack sirve para consumir entradas en el mostrador.
        -- ---------------------------------------------------------------
        CREATE TABLE wallet_passes (
          pack_id          TEXT PRIMARY KEY REFERENCES packs(id) ON DELETE CASCADE,
          serial           TEXT NOT NULL UNIQUE,
          auth_token       TEXT NOT NULL,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          google_synced_at TEXT
        );

        -- Cada teléfono que guardó el pase de Apple y espera avisos de cambio.
        CREATE TABLE wallet_devices (
          device_id  TEXT NOT NULL,
          serial     TEXT NOT NULL REFERENCES wallet_passes(serial) ON DELETE CASCADE,
          push_token TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (device_id, serial)
        );
        CREATE INDEX idx_wallet_devices_serial ON wallet_devices(serial);
      `);
    },
  },
  {
    name: '006-recuperacion-de-contrasena',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Enlaces de recuperación de contraseña
        --
        -- Del token solo se guarda su HMAC: quien lea la base no puede usar
        -- los enlaces pendientes. Un enlace sirve mientras no esté usado,
        -- invalidado ni vencido.
        -- ---------------------------------------------------------------
        CREATE TABLE password_resets (
          id                   TEXT PRIMARY KEY,
          user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash           TEXT NOT NULL UNIQUE,
          created_at           TEXT NOT NULL,
          expires_at           TEXT NOT NULL,
          used_at              TEXT,
          used_ip              TEXT,
          invalidated_at       TEXT,
          invalidated_reason   TEXT,
          requested_ip         TEXT,
          requested_user_agent TEXT
        );
        CREATE INDEX idx_password_resets_user   ON password_resets(user_id, created_at DESC);
        CREATE INDEX idx_password_resets_expiry ON password_resets(expires_at);
      `);
    },
  },
  {
    name: '007-lecturas-sin-conexion',
    up: (db) => {
      db.exec(`
        -- Cuándo llegó al servidor un consumo que el escáner leyó sin
        -- conexión. created_at es la hora de la lectura (cuándo entró la
        -- persona); esta columna queda nula en los consumos hechos en línea.
        ALTER TABLE redemptions ADD COLUMN synced_at TEXT;
      `);
    },
  },
  {
    name: '008-avisos-a-clientes',
    up: (db) => {
      db.exec(`
        -- Si la persona quiere recordatorios por correo. Nace activado y se
        -- quita con un clic; el comprobante de compra no es un recordatorio y
        -- llega igual.
        ALTER TABLE users ADD COLUMN email_reminders INTEGER NOT NULL DEFAULT 1
          CHECK (email_reminders IN (0,1));
        ALTER TABLE users ADD COLUMN email_reminders_changed_at TEXT;

        -- ---------------------------------------------------------------
        -- Ajustes que se cambian desde el panel, sin tocar el entorno.
        -- ---------------------------------------------------------------
        CREATE TABLE settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          updated_at TEXT NOT NULL
        );

        -- ---------------------------------------------------------------
        -- Avisos a clientes: la cola de los correos automáticos y el
        -- registro de los contactos hechos a mano.
        --
        -- dedupe_key es única: un aviso automático no puede crearse dos
        -- veces, ni con dos ciclos simultáneos ni tras un reinicio. Los
        -- contactos a mano no llevan clave.
        -- ---------------------------------------------------------------
        CREATE TABLE notifications (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pack_id         TEXT REFERENCES packs(id) ON DELETE SET NULL,
          kind            TEXT NOT NULL
                            CHECK (kind IN ('purchase','low_balance','depleted','expiring','inactive')),
          channel         TEXT NOT NULL CHECK (channel IN ('email','whatsapp','phone')),
          dedupe_key      TEXT UNIQUE,
          status          TEXT NOT NULL
                            CHECK (status IN ('pending','sending','sent','failed','discarded','logged')),
          reason          TEXT,
          attempts        INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          sent_at         TEXT,
          data            TEXT,
          actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );
        CREATE INDEX idx_notifications_queue   ON notifications(status, next_attempt_at);
        CREATE INDEX idx_notifications_user    ON notifications(user_id, sent_at DESC);
        CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
      `);
    },
  },
  {
    name: '009-admision-y-transferencia',
    up: (db) => {
      db.exec(`
        ALTER TABLE redemptions ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;

        CREATE TABLE pack_movements_new (
          id            TEXT PRIMARY KEY,
          pack_id       TEXT NOT NULL REFERENCES packs(id) ON DELETE RESTRICT,
          delta         INTEGER NOT NULL,
          balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
          reason        TEXT NOT NULL
                          CHECK (reason IN ('issue','redeem','void','adjust','cancel','restore','transfer_out','transfer_in')),
          redemption_id TEXT REFERENCES redemptions(id) ON DELETE SET NULL,
          actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
          note          TEXT,
          created_at    TEXT NOT NULL
        );
        INSERT INTO pack_movements_new
          (id, pack_id, delta, balance_after, reason, redemption_id, actor_id, note, created_at)
          SELECT id, pack_id, delta, balance_after, reason, redemption_id, actor_id, note, created_at
            FROM pack_movements;
        DROP TABLE pack_movements;
        ALTER TABLE pack_movements_new RENAME TO pack_movements;
        CREATE INDEX idx_movements_pack    ON pack_movements(pack_id, created_at DESC);
        CREATE INDEX idx_movements_created ON pack_movements(created_at DESC);

        CREATE TABLE transfers (
          id                  TEXT PRIMARY KEY,
          sender_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          recipient_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          source_pack_id      TEXT NOT NULL REFERENCES packs(id) ON DELETE RESTRICT,
          destination_pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE RESTRICT,
          quantity            INTEGER NOT NULL CHECK (quantity > 0),
          note                TEXT,
          created_at          TEXT NOT NULL
        );
        CREATE INDEX idx_transfers_sender    ON transfers(sender_id, created_at DESC);
        CREATE INDEX idx_transfers_recipient ON transfers(recipient_id, created_at DESC);
      `);
    },
  },
  {
    name: '010-permiso-de-escaneo',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Permiso explícito para usar el escáner de la puerta
        --
        -- Tener el rol de personal ya no basta: el máster autoriza cuenta
        -- por cuenta quién puede descontar entradas. Así, si a alguien se le
        -- presta un teléfono o se le crea un usuario para otra tarea, no
        -- puede tocar el saldo de nadie.
        --
        -- Las cuentas que ya existían se dan por autorizadas: quitarles el
        -- permiso al actualizar dejaría la puerta sin operadores a mitad de
        -- una jornada. De aquí en adelante, toda cuenta nueva nace sin él.
        -- ---------------------------------------------------------------
        ALTER TABLE users ADD COLUMN scan_enabled INTEGER NOT NULL DEFAULT 0;

        UPDATE users
           SET scan_enabled = 1
         WHERE role IN ('master','staff');

        -- La lista de "quién puede escanear" se consulta en la pantalla de
        -- personal cada vez que se abre la administración.
        CREATE INDEX idx_users_scan_enabled ON users(scan_enabled) WHERE scan_enabled = 1;
      `);
    },
  },
  {
    name: '011-solicitudes-de-recarga',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Solicitudes de compra y recarga de packs desde la app del cliente
        --
        -- Permite al piloto solicitar un pack pagado por transferencia bancaria,
        -- DeUna o efectivo, enviando su comprobante de pago para que la
        -- administración lo apruebe o rechace con un solo clic.
        -- ---------------------------------------------------------------
        CREATE TABLE pack_requests (
          id                TEXT PRIMARY KEY,
          user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          size              INTEGER NOT NULL CHECK (size > 0),
          price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
          currency          TEXT NOT NULL DEFAULT 'USD',
          payment_method    TEXT NOT NULL CHECK (payment_method IN ('transferencia','deuna','efectivo','tarjeta','otro')),
          payment_reference TEXT NOT NULL,
          note              TEXT,
          status            TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected','cancelled')),
          pack_id           TEXT REFERENCES packs(id) ON DELETE SET NULL,
          reviewed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at       TEXT,
          rejection_reason  TEXT,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL
        );
        CREATE INDEX idx_pack_requests_user   ON pack_requests(user_id, created_at DESC);
        CREATE INDEX idx_pack_requests_status ON pack_requests(status, created_at DESC);
      `);
    },
  },
  {
    name: '012-optimizacion-rendimiento-indices',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Índices de cobertura y aceleración de consultas
        -- ---------------------------------------------------------------
        -- Índice de cobertura para el recuento de consumos confirmados por pack:
        -- permite calcular used_tickets en listados de packs sin tocar la tabla.
        CREATE INDEX IF NOT EXISTS idx_redemptions_pack_status_qty
          ON redemptions(pack_id, status, quantity);

        -- Índice para acelerar la suma de entradas emitidas y arqueo del libro mayor.
        CREATE INDEX IF NOT EXISTS idx_movements_reason_pack
          ON pack_movements(reason, pack_id, delta);

        -- Índice compuesto para búsqueda y rotación de sesiones vigentes por usuario.
        CREATE INDEX IF NOT EXISTS idx_sessions_user_active
          ON sessions(user_id, revoked_at, expires_at);

        -- Índice compuesto para conteos rápidos por rol y estado en el panel.
        CREATE INDEX IF NOT EXISTS idx_users_role_status
          ON users(role, status);
      `);
    },
  },
  {
    name: '013-programa-de-fidelidad',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Programa de fidelidad: "la casa invita"
        --
        -- Cada tantas entradas usadas, el sistema regala un pack de
        -- cortesía. Para que eso funcione hacen falta dos cosas:
        --
        --  1. Saber de dónde salió cada pack. Un pack regalado no genera
        --     comprobante de compra, no suma a los ingresos y sus entradas
        --     no cuentan para ganar el siguiente premio: si contaran, la
        --     casa se estaría invitando a sí misma.
        --  2. Un registro de los premios dados, que es lo que hace el
        --     cálculo idempotente: el progreso de una persona son sus
        --     entradas contadas menos las que ya se le acreditaron, así
        --     que volver a evaluar lo mismo no regala nada dos veces.
        -- ---------------------------------------------------------------
        ALTER TABLE packs ADD COLUMN origin TEXT NOT NULL DEFAULT 'sale'
          CHECK (origin IN ('sale','transfer','loyalty'));

        -- Los packs que ya existían y nacieron de una transferencia se
        -- reconocen por cómo los crea el propio sistema; el resto son ventas.
        UPDATE packs SET origin = 'transfer'
         WHERE payment_method = 'transferencia' AND price_cents = 0
           AND payment_reference LIKE 'from:%';

        -- Los informes y el conteo de fidelidad preguntan siempre por lo que
        -- no es una venta, que es la minoría: un índice parcial basta.
        CREATE INDEX idx_packs_origin ON packs(origin) WHERE origin <> 'sale';

        CREATE TABLE loyalty_rewards (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          -- El pack de cortesía que se le emitió. Si algún día se borrara,
          -- el premio sigue constando: es lo que impide volver a darlo.
          pack_id    TEXT REFERENCES packs(id) ON DELETE SET NULL,
          -- Cuántos premios lleva esa persona (1, 2, 3…). Es único por
          -- cliente, así que dos evaluaciones simultáneas no pueden crear
          -- el mismo premio ni siquiera si ganaran la carrera las dos.
          sequence   INTEGER NOT NULL,
          tickets    INTEGER NOT NULL CHECK (tickets > 0),
          -- Entradas que hicieron falta para este premio. Se guarda aquí y
          -- no se lee de los ajustes porque el umbral puede cambiar, y el
          -- progreso de quien ya ganó tiene que seguir cuadrando.
          threshold  INTEGER NOT NULL CHECK (threshold > 0),
          -- Entradas contadas de esa persona en el momento de otorgarlo.
          counted    INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (user_id, sequence)
        );
        CREATE INDEX idx_loyalty_user    ON loyalty_rewards(user_id, created_at DESC);
        CREATE INDEX idx_loyalty_created ON loyalty_rewards(created_at DESC);
      `);

      // El aviso del premio es un tipo más de la cola de correos, y la
      // columna `kind` lo limita con un CHECK. SQLite no sabe cambiar un
      // CHECK, así que la tabla se rehace con la lista nueva y se copia lo
      // que hubiera pendiente o enviado.
      db.exec(`
        CREATE TABLE notifications_new (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pack_id         TEXT REFERENCES packs(id) ON DELETE SET NULL,
          kind            TEXT NOT NULL
                            CHECK (kind IN ('purchase','low_balance','depleted','expiring','inactive','loyalty_reward')),
          channel         TEXT NOT NULL CHECK (channel IN ('email','whatsapp','phone')),
          dedupe_key      TEXT UNIQUE,
          status          TEXT NOT NULL
                            CHECK (status IN ('pending','sending','sent','failed','discarded','logged')),
          reason          TEXT,
          attempts        INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          sent_at         TEXT,
          data            TEXT,
          actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );
        INSERT INTO notifications_new
          (id, user_id, pack_id, kind, channel, dedupe_key, status, reason, attempts,
           next_attempt_at, sent_at, data, actor_id, created_at, updated_at)
          SELECT id, user_id, pack_id, kind, channel, dedupe_key, status, reason, attempts,
                 next_attempt_at, sent_at, data, actor_id, created_at, updated_at
            FROM notifications;
        DROP TABLE notifications;
        ALTER TABLE notifications_new RENAME TO notifications;
        CREATE INDEX idx_notifications_queue   ON notifications(status, next_attempt_at);
        CREATE INDEX idx_notifications_user    ON notifications(user_id, sent_at DESC);
        CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
      `);
    },
  },
  {
    name: '014-verificacion-en-dos-pasos',
    up: (db) => {
      db.exec(`
        -- ---------------------------------------------------------------
        -- Verificación en dos pasos (TOTP)
        --
        -- El secreto se guarda cifrado con la clave del entorno, no en
        -- claro: una copia de la base que acabe donde no debe no entrega
        -- los segundos factores. \`totp_last_step\` es el último tramo de
        -- treinta segundos que se aceptó para esa cuenta, y es lo que
        -- impide reutilizar un código que alguien haya visto de reojo.
        -- ---------------------------------------------------------------
        ALTER TABLE users ADD COLUMN totp_secret TEXT;
        ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0
          CHECK (totp_enabled IN (0,1));
        ALTER TABLE users ADD COLUMN totp_confirmed_at TEXT;
        ALTER TABLE users ADD COLUMN totp_last_step INTEGER;

        -- Índice parcial: las consultas del panel preguntan siempre por
        -- quién la tiene puesta, que es la minoría.
        CREATE INDEX idx_users_totp ON users(totp_enabled) WHERE totp_enabled = 1;

        -- ---------------------------------------------------------------
        -- Códigos de respaldo: la salida cuando el teléfono se pierde.
        --
        -- Se guardan por su HMAC, como los refresh tokens: el que los
        -- genera los ve una vez y nadie más, ni con la base delante.
        -- ---------------------------------------------------------------
        CREATE TABLE two_factor_recovery_codes (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash  TEXT NOT NULL UNIQUE,
          used_at    TEXT,
          used_ip    TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_2fa_codigos_usuario ON two_factor_recovery_codes(user_id, used_at);

        -- ---------------------------------------------------------------
        -- Desafíos: el paso intermedio del acceso.
        --
        -- Acertar la contraseña ya no abre sesión; abre un desafío que vive
        -- unos minutos y del que solo se guarda el HMAC de su token. Sin
        -- esta tabla, el segundo paso tendría que confiar en algo que el
        -- navegador guarda, y los intentos fallidos no se podrían contar
        -- contra el desafío concreto.
        -- ---------------------------------------------------------------
        CREATE TABLE two_factor_challenges (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash  TEXT NOT NULL UNIQUE,
          attempts    INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          expires_at  TEXT NOT NULL,
          consumed_at TEXT,
          ip          TEXT,
          user_agent  TEXT
        );
        CREATE INDEX idx_2fa_desafios_expira  ON two_factor_challenges(expires_at);
        CREATE INDEX idx_2fa_desafios_usuario ON two_factor_challenges(user_id, created_at DESC);
      `);
    },
  },
];

export default migrations;

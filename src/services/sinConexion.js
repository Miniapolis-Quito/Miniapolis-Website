/**
 * Lecturas sin conexión que no se pudieron cobrar.
 *
 * Cuando el escáner trabaja sin red deja pasar a la persona y guarda la lectura
 * para cobrarla después. Si al llegar el servidor la rechaza (el pack ya no
 * tenía saldo, el QR había caducado, la cuenta estaba suspendida…), esa persona
 * ya entró sin que se le descontara nada. Este módulo se ocupa de que eso no
 * se pierda: lo registra, lo muestra a administración y deja constancia de cómo
 * se resolvió.
 *
 * Todo vive en la bitácora de auditoría, que ya es de solo añadir y ya aparece
 * en la ficha del cliente: un registro por lectura rechazada y otro por
 * resolución, enlazado al primero.
 */
import { getDb } from '../db/index.js';
import { normalizePackCode } from '../lib/ids.js';
import { conflict, notFound } from '../lib/errors.js';
import { hub, channels } from '../lib/events.js';
import * as packsService from './packs.js';
import * as audit from './audit.js';

export const NO_COBRADA = 'escaneo_sin_conexion.rechazado';
export const RESUELTA = 'escaneo_sin_conexion.resuelto';

/** Cuántas se detallan en el resumen; el recuento siempre es el total. */
const DETALLE_MAXIMO = 20;

/**
 * Deja constancia de una lectura sin conexión que el servidor rechazó.
 *
 * Un teléfono que se cierra antes de apuntar el rechazo vuelve a enviar la
 * misma lectura: se registra una sola vez por lectura y operador.
 */
export function registrarNoCobrada({ error, codigo, via, scanner, lecturaId, capturedAt, deviceLabel, ip, userAgent }) {
  const db = getDb();

  if (lecturaId && scanner?.id) {
    const yaRegistrada = db
      .prepare(
        `SELECT 1 FROM audit_log
          WHERE action = ? AND actor_id = ? AND json_extract(metadata, '$.lecturaId') = ?
          LIMIT 1`,
      )
      .get(NO_COBRADA, scanner.id, lecturaId);
    if (yaRegistrada) return null;
  }

  const pack = codigo ? packsService.findByLooseCode(codigo, db) : null;
  const cliente = pack ? db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(pack.user_id) : null;

  const registro = audit.record({
    actor: scanner ? { id: scanner.id, email: scanner.email } : null,
    action: NO_COBRADA,
    // Lo que queda por resolver es con una persona: el registro va a su ficha.
    entityType: cliente ? 'user' : null,
    entityId: cliente?.id ?? null,
    metadata: {
      lecturaId: lecturaId ?? null,
      via,
      packId: pack?.id ?? null,
      packCode: pack?.code ?? (codigo ? normalizePackCode(codigo) || String(codigo).trim().toUpperCase().slice(0, 40) : null),
      customerId: cliente?.id ?? null,
      customerName: cliente?.full_name ?? null,
      reason: error.code,
      message: error.message,
      capturedAt,
      deviceLabel: deviceLabel ?? null,
    },
    ip,
    userAgent,
    db,
  });

  // El panel del máster lo muestra en cuanto ocurre, sin esperar a recargar.
  hub.publish([channels.admin], 'lectura.no_cobrada', { id: registro.id });
  return registro;
}

function mapear(fila) {
  const datos = fila.metadata ? JSON.parse(fila.metadata) : {};
  return {
    id: fila.id,
    recordedAt: fila.created_at,
    capturedAt: datos.capturedAt ?? fila.created_at,
    via: datos.via ?? null,
    packId: datos.packId ?? null,
    packCode: datos.packCode ?? null,
    customerId: datos.customerId ?? null,
    customerName: datos.customerName ?? null,
    reason: datos.reason ?? null,
    message: datos.message ?? null,
    deviceLabel: datos.deviceLabel ?? null,
    scannerId: fila.actor_id,
    scannerName: fila.scanner_name ?? fila.actor_email ?? null,
  };
}

const SIN_RESOLVER = `
  a.action = @noCobrada
  AND NOT EXISTS (
    SELECT 1 FROM audit_log r
     WHERE r.action = @resuelta AND json_extract(r.metadata, '$.rejectionId') = a.id
  )`;

/** Lecturas no cobradas que nadie ha resuelto todavía, las más recientes primero. */
export function pendientes({ limit = DETALLE_MAXIMO } = {}) {
  const db = getDb();
  const parametros = { noCobrada: NO_COBRADA, resuelta: RESUELTA };
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${SIN_RESOLVER}`).get(parametros).n;
  const filas = db
    .prepare(
      `SELECT a.*, u.full_name AS scanner_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${SIN_RESOLVER}
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT @limit`,
    )
    .all({ ...parametros, limit });
  return { count: total, items: filas.map(mapear) };
}

/**
 * Marca una lectura no cobrada como resuelta, con la explicación de cómo
 * (se cobró en caja, se le vendió un pack, fue un error del puesto…).
 */
export function resolver(id, { note, actor, ip, userAgent }) {
  const db = getDb();
  const fila = db.prepare('SELECT * FROM audit_log WHERE id = ? AND action = ?').get(id, NO_COBRADA);
  if (!fila) throw notFound('No existe esa lectura sin cobrar.', 'lectura_no_encontrada');

  const yaResuelta = db
    .prepare(`SELECT 1 FROM audit_log WHERE action = ? AND json_extract(metadata, '$.rejectionId') = ? LIMIT 1`)
    .get(RESUELTA, id);
  if (yaResuelta) throw conflict('Esa lectura ya se marcó como resuelta.', 'lectura_ya_resuelta');

  const lectura = mapear(fila);
  audit.record({
    actor,
    action: RESUELTA,
    entityType: lectura.customerId ? 'user' : null,
    entityId: lectura.customerId,
    metadata: { rejectionId: id, packCode: lectura.packCode, capturedAt: lectura.capturedAt, note },
    ip,
    userAgent,
    db,
  });

  hub.publish([channels.admin], 'lectura.resuelta', { id });
  return { ...lectura, resolvedNote: note };
}

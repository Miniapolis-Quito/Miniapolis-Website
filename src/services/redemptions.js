/**
 * Consumo de entradas.
 *
 * Todo el descuento ocurre dentro de una única transacción `BEGIN IMMEDIATE`,
 * con tres barreras independientes contra el doble consumo:
 *
 *  1. `idempotencyKey`  — un reintento de red devuelve la misma respuesta y no
 *                          descuenta otra vez.
 *  2. nonce del QR      — un mismo código dinámico no se puede usar dos veces,
 *                          ni siquiera dentro de su ventana de validez.
 *  3. tiempo de espera  — dos escaneos del mismo pack muy seguidos se rechazan
 *                          (evita el doble disparo de la cámara).
 *
 * Además, el UPDATE del saldo lleva la condición `remaining = <valor leído>`,
 * así que si dos procesos compitieran, solo uno puede ganar.
 *
 * Lecturas sin conexión: cuando se cae la red en la pista, el escáner guarda
 * cada lectura con su hora y la envía al volver la señal. Esa lectura se juzga
 * a la hora en que se hizo —vigencia del QR, vencimiento del pack y tiempo de
 * espera—, con las mismas barreras; y si no se puede cobrar, queda registrada
 * para que administración sepa quién entró sin que se le descontara la entrada.
 */
import crypto from 'node:crypto';
import { getDb, inTransaction } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { AppError, conflict, notFound, badRequest } from '../lib/errors.js';
import { parseQrPayload, verifyQrPayload } from '../lib/qr.js';
import { config } from '../config.js';
import { hub, channels } from '../lib/events.js';
import * as packsService from './packs.js';
import * as audit from './audit.js';
import * as sinConexion from './sinConexion.js';

/**
 * Cuánto se recuerda la respuesta de un consumo. Al menos un día, y siempre más
 * que la ventana en que puede llegar una lectura guardada sin conexión: esa
 * lectura reutiliza la clave del intento en línea, y si la respuesta ya se
 * hubiera olvidado, un código tecleado —que no tiene nonce— se cobraría dos veces.
 */
const IDEMPOTENCY_TTL_SECONDS = Math.max(24 * 3600, config.offlineScan.maxAgeSeconds + 3600);

/**
 * Margen para una lectura que parece enviada antes de hacerse: los dos
 * instantes salen del mismo reloj, así que unos segundos son redondeos y más
 * que eso es un dato inventado.
 */
const MARGEN_RELOJ_MS = 5000;

/** Lo que tarda un reintento de red, que se admite aunque el modo esté apagado. */
const REINTENTO_DE_RED_SECONDS = 60;

/**
 * Cuánto hace que se hizo la lectura, según el reloj del teléfono.
 *
 * Solo se usa la diferencia entre la hora de lectura y la de envío: un teléfono
 * con la hora mal puesta arrastra el mismo error en las dos marcas, así que la
 * diferencia es correcta aunque ninguna de ellas lo sea.
 */
function transcurridoDesdeLaLectura({ capturedAt, sentAt }) {
  return Date.parse(sentAt) - Date.parse(capturedAt);
}

/**
 * Instante en que se hizo la lectura, en el reloj del servidor.
 * @returns {{diferida:boolean, at:number}}
 */
function horaDeLectura({ capturedAt, sentAt, now }) {
  if (capturedAt === undefined || capturedAt === null) return { diferida: false, at: now };

  const transcurrido = transcurridoDesdeLaLectura({ capturedAt, sentAt });
  if (!Number.isFinite(transcurrido) || transcurrido < -MARGEN_RELOJ_MS) {
    throw badRequest(
      'La hora de la lectura es posterior a la de su envío. Revisa la fecha y hora del teléfono.',
      null,
      'lectura_hora_invalida',
    );
  }

  const ventanaSegundos = config.offlineScan.enabled ? config.offlineScan.maxAgeSeconds : REINTENTO_DE_RED_SECONDS;
  if (transcurrido > ventanaSegundos * 1000) {
    const ventana = config.offlineScan.enabled
      ? `${Math.round((ventanaSegundos / 3600) * 10) / 10} horas`
      : `${ventanaSegundos} segundos`;
    throw conflict(
      `La lectura se hizo hace más de ${ventana} y ya no se puede cobrar desde el escáner. ` +
        'Si la persona entró, regístralo desde administración.',
      'lectura_vencida',
    );
  }

  return { diferida: true, at: now - Math.max(0, transcurrido) };
}

/**
 * ¿Es un rechazo que no se arregla reintentando? Un conflicto de concurrencia,
 * un límite de peticiones o un fallo del servidor pueden salir bien a la
 * siguiente; que el pack no tenga saldo, no.
 */
function esRechazoDefinitivo(error) {
  return (
    error instanceof AppError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429 &&
    error.code !== 'conflicto_concurrencia'
  );
}

/**
 * Ejecuta un cobro. Si la lectura llega diferida, la hora que cuenta es la de
 * la lectura, y un rechazo definitivo queda registrado antes de devolverse.
 */
function cobrarLectura(datos, { codigo, via }, cobrar) {
  const now = datos.now ?? Date.now();
  if (datos.capturedAt === undefined || datos.capturedAt === null) return cobrar({ diferida: false, at: now }, now);

  try {
    return cobrar(horaDeLectura({ capturedAt: datos.capturedAt, sentAt: datos.sentAt, now }), now);
  } catch (error) {
    if (esRechazoDefinitivo(error)) {
      try {
        const transcurrido = transcurridoDesdeLaLectura(datos);
        sinConexion.registrarNoCobrada({
          error,
          codigo: codigo(),
          via,
          scanner: datos.scanner,
          lecturaId: datos.idempotencyKey,
          capturedAt: new Date(now - (Number.isFinite(transcurrido) ? Math.max(0, transcurrido) : 0)).toISOString(),
          deviceLabel: datos.deviceLabel,
          ip: datos.ip,
          userAgent: datos.userAgent,
        });
      } catch {
        /* la auditoría nunca debe tapar el motivo real del rechazo */
      }
    }
    throw error;
  }
}

function hashRequest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Deja un código tecleado en su forma canónica, para comparar reintentos. */
function normalizarCodigo(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Busca una respuesta ya emitida para la misma clave de idempotencia.
 *
 * La clave pertenece a un operador y debe identificar un único intento. Si ese
 * mismo operador la reutiliza para otra operación o con otros datos, se
 * responde con un conflicto claro. Operadores distintos pueden usar la misma
 * clave sin interferirse entre sí.
 */
/**
 * Un consumo puede venir de una tarea interna sin operador (una carga de datos
 * de ejemplo, por ejemplo). La clave se guarda entonces bajo el mismo dueño
 * vacío con el que luego se busca: la columna no admite nulos, y guardar y
 * consultar con criterios distintos dejaría el reintento sin efecto.
 */
const SIN_OPERADOR = '';

function lookupIdempotent(db, key, userId, endpoint, requestHash) {
  if (!key) return null;
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?').get(userId, key);
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?').run(userId, key);
    return null;
  }
  if (row.endpoint !== endpoint || row.request_hash !== requestHash) {
    throw conflict(
      'Esa clave de idempotencia ya se usó para otra operación. Genera una nueva.',
      'idempotencia_conflicto',
    );
  }
  return { statusCode: row.status_code, body: JSON.parse(row.response) };
}

function saveIdempotent(db, { key, userId, endpoint, requestHash, statusCode, body }) {
  if (!key) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO NOTHING`,
  ).run(
    key,
    userId ?? SIN_OPERADOR,
    endpoint,
    requestHash,
    statusCode,
    JSON.stringify(body),
    new Date(now).toISOString(),
    new Date(now + IDEMPOTENCY_TTL_SECONDS * 1000).toISOString(),
  );
}

/**
 * Consumo confirmado del pack más cercano a `at`, dentro del tiempo de espera
 * hacia cualquiera de los dos lados.
 *
 * En línea `at` es ahora y solo puede haber consumos anteriores. Una lectura
 * diferida, en cambio, puede llegar después de otra que se hizo más tarde: el
 * orden de llegada no decide si hubo un doble disparo, la hora de lectura sí.
 */
function consumoDentroDeLaEspera(db, packId, at, cooldownSeconds) {
  return db
    .prepare(
      `SELECT created_at FROM redemptions
        WHERE pack_id = @packId AND status = 'confirmed'
          AND created_at > @desde AND created_at < @hasta
        ORDER BY ABS(julianday(created_at) - julianday(@at)) ASC, rowid DESC
        LIMIT 1`,
    )
    .get({
      packId,
      at: new Date(at).toISOString(),
      desde: new Date(at - cooldownSeconds * 1000).toISOString(),
      hasta: new Date(at + cooldownSeconds * 1000).toISOString(),
    });
}

/**
 * Un pack que venció después de la lectura seguía vigente cuando la persona
 * entró. Se valida como estaba entonces; lo demás (anulado, suspendido, sin
 * saldo) son decisiones o hechos que el sistema no puede fechar, y cuentan
 * como están ahora.
 */
function comoEstabaAlLeer(pack, at) {
  if (pack?.status === 'expired' && pack.expires_at && Date.parse(pack.expires_at) > at) {
    return { ...pack, status: 'active' };
  }
  return pack;
}

/**
 * Núcleo del consumo: descuenta una entrada del pack indicado.
 * Debe llamarse ya dentro de una transacción.
 *
 * `at` es el instante de la lectura y `now` el de llegada; coinciden salvo en
 * una lectura diferida.
 */
function redeemOne(db, { pack, method, scannedBy, deviceLabel, idempotencyKey, nonce, ip, now, lectura, quantity = 1 }) {
  const { at, diferida } = lectura || { at: now, diferida: false };
  const nowIso = new Date(now).toISOString();
  const atIso = new Date(at).toISOString();

  // Relectura dentro de la transacción: el estado que se valida es el que se escribe.
  const fresh = packsService.findById(pack.id, db);
  // Si el pack desapareciera a mitad, `isUsable` ya lo cuenta como no encontrado:
  // preguntar por el dueño de la nada solo cambiaría ese error por otro peor.
  const dueno = fresh ? db.prepare('SELECT id, status FROM users WHERE id = ?').get(fresh.user_id) : null;
  const usable = packsService.isUsable(comoEstabaAlLeer(fresh, at), { now: at, owner: dueno });
  if (!usable.ok) {
    // El motivo del rechazo no siempre es del pack: si la cuenta del cliente
    // está suspendida, el código lo dice tal cual en vez de disfrazarlo.
    const codigo = usable.reason === 'cliente_suspendido' ? usable.reason : `pack_${usable.reason}`;
    throw conflict(usable.message, codigo, {
      pack: packsService.toPublicPack(fresh),
    });
  }

  // Verificación de saldo suficiente para la cantidad solicitada.
  if (fresh.remaining < quantity) {
    throw conflict(
      `Al pack solo le quedan ${fresh.remaining} ${fresh.remaining === 1 ? 'entrada' : 'entradas'}, pero se solicitaron ${quantity}.`,
      'saldo_insuficiente',
      {
        requested: quantity,
        remaining: fresh.remaining,
        pack: packsService.toPublicPack(fresh),
      },
    );
  }

  // Barrera 3: dos escaneos muy seguidos del mismo pack.
  const cooldown = config.redemption.cooldownSeconds;
  if (cooldown > 0) {
    const vecino = consumoDentroDeLaEspera(db, fresh.id, at, cooldown);
    if (vecino) {
      const separacion = (at - Date.parse(vecino.created_at)) / 1000;
      if (diferida) {
        const segundos = Math.max(1, Math.round(Math.abs(separacion)));
        throw conflict(
          `Este pack ya tenía una entrada registrada ${segundos} segundos ${separacion >= 0 ? 'antes' : 'después'} ` +
            'de esta lectura: parece la misma persona leída dos veces.',
          'espera_activa',
          { lastRedemptionAt: vecino.created_at, pack: packsService.toPublicPack(fresh) },
        );
      }
      const transcurrido = Math.max(0, separacion);
      throw conflict(
        `Este pack ya registró una entrada hace ${Math.max(1, Math.round(transcurrido))} segundos. ` +
          `Espera ${Math.ceil(cooldown - transcurrido)} segundos si de verdad quieres descontar otra.`,
        'espera_activa',
        {
          waitSeconds: Math.ceil(cooldown - transcurrido),
          lastRedemptionAt: vecino.created_at,
          pack: packsService.toPublicPack(fresh),
        },
      );
    }
  }

  const remainingBefore = fresh.remaining;
  const remainingAfter = remainingBefore - quantity;
  // Un pack vencido que cobra una lectura anterior a su vencimiento sigue
  // vencido: cobrarla no puede devolverlo al servicio.
  const newStatus = remainingAfter === 0 && fresh.status === 'active' ? 'depleted' : fresh.status;

  // Guarda optimista: solo descuenta si el saldo sigue siendo el que se leyó.
  const updated = db
    .prepare('UPDATE packs SET remaining = ?, status = ?, updated_at = ? WHERE id = ? AND remaining = ?')
    .run(remainingAfter, newStatus, nowIso, fresh.id, remainingBefore);
  if (updated.changes !== 1) {
    throw conflict('El saldo del pack cambió mientras se procesaba. Vuelve a escanear.', 'conflicto_concurrencia');
  }

  const redemptionId = newId();
  const syncedAt = diferida ? nowIso : null;
  db.prepare(
    `INSERT INTO redemptions (id, pack_id, user_id, scanned_by, device_label, method,
                              remaining_before, remaining_after, quantity, status, idempotency_key, nonce, ip,
                              created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`,
  ).run(
    redemptionId,
    fresh.id,
    fresh.user_id,
    scannedBy ?? null,
    deviceLabel ?? null,
    method,
    remainingBefore,
    remainingAfter,
    quantity,
    idempotencyKey ?? null,
    nonce ?? null,
    ip ?? null,
    // El consumo lleva la hora en que entró la persona; el movimiento del
    // libro mayor, la hora en que cambió el saldo. Así el historial del cliente
    // y las cifras del día cuentan la visita cuando ocurrió, y el libro sigue
    // en orden.
    atIso,
    syncedAt,
  );

  const note = quantity > 1 ? `Entrada grupal (${quantity} entradas)` : null;
  db.prepare(
    `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, redemption_id, actor_id, note, created_at)
     VALUES (?, ?, ?, ?, 'redeem', ?, ?, ?, ?)`,
  ).run(newId(), fresh.id, -quantity, remainingAfter, redemptionId, scannedBy ?? null, note, nowIso);

  return {
    redemptionId,
    remainingBefore,
    remainingAfter,
    quantity,
    method,
    deviceLabel: deviceLabel ?? null,
    pack: packsService.findById(fresh.id, db),
    createdAt: atIso,
    syncedAt,
  };
}

function publishRedemption(result, owner, scanner) {
  const payload = {
    redemptionId: result.redemptionId,
    pack: packsService.toPublicPack(result.pack),
    remaining: result.remainingAfter,
    quantity: result.quantity ?? 1,
    owner: { id: owner.id, fullName: owner.full_name },
    scannedBy: scanner ? { id: scanner.id, fullName: scanner.fullName } : null,
    // El método y el puesto viajan en el evento para que la actividad en vivo
    // del escáner muestre lo mismo que el historial: sin ellos, un consumo
    // manual aparecía en pantalla como si hubiera entrado por QR.
    method: result.method,
    deviceLabel: result.deviceLabel,
    at: result.createdAt,
    syncedAt: result.syncedAt,
  };
  hub.publish(
    [channels.user(result.pack.user_id), channels.staff, channels.admin],
    'entrada.consumida',
    payload,
  );
}

/**
 * Hasta cuándo hay que recordar el nonce de un QR dinámico: mientras pueda
 * llegar una lectura de ese QR. En línea, eso es su vigencia; con el modo sin
 * conexión, además, la ventana en que un escáner puede enviar lo que leyó.
 * Sin esto, un QR cobrado en un puesto con señal se podía volver a cobrar con
 * la lectura que otro puesto hizo sin conexión, en cuanto se limpiara el nonce.
 */
function retencionDelNonce(parsed, now) {
  const ttl = config.qr.ttlSeconds;
  const ventana = config.offlineScan.enabled ? config.offlineScan.maxAgeSeconds : REINTENTO_DE_RED_SECONDS;
  return new Date(Math.max(now + (ttl + 300) * 1000, (parsed.timestamp + ttl + ventana + 300) * 1000)).toISOString();
}

/**
 * Canjea una entrada a partir del contenido de un QR.
 *
 * `capturedAt` y `sentAt` solo llegan con una lectura que el escáner guardó
 * sin conexión: ver `horaDeLectura`.
 * @returns {{statusCode:number, body:object}}
 */
export function redeemByQr(datos) {
  return cobrarLectura(
    datos,
    {
      via: 'qr',
      codigo: () => {
        const parsed = parseQrPayload(datos.payload);
        return parsed.ok ? parsed.code : null;
      },
    },
    (lectura, now) => canjearQr({ ...datos, now, lectura }),
  );
}

function canjearQr({ payload, quantity = 1, scanner, deviceLabel, idempotencyKey, ip, userAgent, now, lectura }) {
  const db = getDb();
  const endpoint = 'scan';
  // La hora de lectura no forma parte de la huella de la petición: una lectura
  // que se intentó en línea y se guardó al fallar la red se reenvía con la
  // misma clave, y tiene que reconocerse como el mismo intento.
  const requestHash = hashRequest({ payload, deviceLabel, quantity });

  const parsed = parseQrPayload(payload);
  if (!parsed.ok) {
    throw badRequest(
      'El código escaneado no corresponde a una entrada de ' + config.brandShort + '.',
      { reason: parsed.reason },
      'qr_invalido',
    );
  }

  const pack = packsService.findByCode(parsed.code, db);
  if (!pack) throw notFound('No existe ningún pack con ese código.', 'pack_no_encontrado');

  const verification = verifyQrPayload(parsed, pack, { now: lectura.at });
  if (!verification.ok) {
    const messages = {
      firma: 'El código no es auténtico. Pide al cliente que actualice su pantalla.',
      expirado: lectura.diferida
        ? 'El QR ya había vencido cuando se leyó: el cliente mostraba una pantalla sin actualizar.'
        : 'El código ya venció. Pide al cliente que muestre el QR actualizado.',
      futuro: 'El reloj del dispositivo del cliente está desfasado. Que actualice su pantalla.',
      estatico_no_permitido: 'Este pack no admite códigos impresos. Usa el QR de la app.',
    };
    // Una lectura diferida que se rechaza deja su propio registro, más
    // completo; registrar también este sería contar dos veces el mismo hecho.
    if (!lectura.diferida) {
      audit.record({
        actor: scanner ? { id: scanner.id, email: scanner.email } : null,
        action: 'escaneo.rechazado',
        entityType: 'pack',
        entityId: pack.id,
        metadata: { code: pack.code, reason: verification.reason, quantity },
        ip,
        userAgent,
        db,
      });
    }
    throw badRequest(messages[verification.reason] || 'El código no es válido.', { reason: verification.reason }, `qr_${verification.reason}`);
  }

  const owner = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(pack.user_id);

  const result = inTransaction(() => {
    // La consulta se hace dentro de la misma transacción que el descuento.
    // Dos reintentos simultáneos ven así la respuesta del primero, en vez de
    // competir por el nonce o devolver un error interno por la clave única.
    const cached = lookupIdempotent(db, idempotencyKey, scanner?.id ?? SIN_OPERADOR, endpoint, requestHash);
    if (cached) return { cached };

    // Barrera 2: el nonce de un QR dinámico solo se acepta una vez.
    if (verification.method === 'qr_dynamic') {
      const nonceKey = `${pack.id}:${parsed.nonce}`;
      const inserted = db
        .prepare(
          `INSERT INTO used_nonces (nonce, pack_id, expires_at, created_at)
           VALUES (?, ?, ?, ?) ON CONFLICT(nonce) DO NOTHING`,
        )
        .run(nonceKey, pack.id, retencionDelNonce(parsed, now), new Date(now).toISOString());
      if (inserted.changes !== 1) {
        throw conflict(
          'Ese código QR ya fue utilizado. Pide al cliente que actualice su pantalla.',
          'qr_ya_usado',
        );
      }
    }

    const consumo = redeemOne(db, {
      pack,
      method: verification.method,
      scannedBy: scanner?.id ?? null,
      deviceLabel,
      idempotencyKey,
      nonce: parsed.nonce,
      ip,
      now,
      lectura,
      quantity,
    });

    const mensaje = quantity > 1
      ? `${quantity} entradas registradas. Quedan ${consumo.remainingAfter} entrada(s).`
      : `Entrada registrada. Quedan ${consumo.remainingAfter} entrada(s).`;

    const respuesta = {
      ok: true,
      message: mensaje,
      redemptionId: consumo.redemptionId,
      quantity: consumo.quantity,
      method: verification.method,
      remaining: consumo.remainingAfter,
      remainingBefore: consumo.remainingBefore,
      pack: packsService.toPublicPack(consumo.pack),
      customer: { id: owner.id, fullName: owner.full_name },
      at: consumo.createdAt,
      syncedAt: consumo.syncedAt,
    };

    saveIdempotent(db, {
      key: idempotencyKey,
      userId: scanner?.id,
      endpoint,
      requestHash,
      statusCode: 200,
      body: respuesta,
    });

    return { ...consumo, body: respuesta };
  });

  if (result.cached) return { ...result.cached, idempotentReplay: true };

  const body = result.body;

  audit.record({
    actor: scanner ? { id: scanner.id, email: scanner.email } : null,
    action: 'entrada.consumida',
    entityType: 'pack',
    entityId: pack.id,
    metadata: {
      code: pack.code,
      method: verification.method,
      remaining: result.remainingAfter,
      quantity: result.quantity,
      redemptionId: result.redemptionId,
      deviceLabel,
      ...(lectura.diferida ? { capturedAt: result.createdAt } : {}),
    },
    ip,
    userAgent,
    db,
  });

  publishRedemption(result, owner, scanner);
  return { statusCode: 200, body };
}

/**
 * Canje manual por código de pack, para cuando la cámara falla o el cliente no
 * trae el teléfono. Requiere personal autenticado y queda marcado como manual.
 */
export function redeemByCode(datos) {
  return cobrarLectura(
    datos,
    { via: 'codigo', codigo: () => datos.code },
    (lectura, now) => canjearCodigo({ ...datos, now, lectura }),
  );
}

function canjearCodigo({ code, quantity = 1, scanner, deviceLabel, idempotencyKey, ip, userAgent, now, lectura }) {
  const db = getDb();
  const endpoint = 'manual';
  const requestHash = hashRequest({ code: normalizarCodigo(code), deviceLabel, quantity });

  const pack = packsService.findByLooseCode(code, db);
  if (!pack) throw notFound('No existe ningún pack con ese código.', 'pack_no_encontrado');

  const owner = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(pack.user_id);

  const result = inTransaction(() => {
    const cached = lookupIdempotent(db, idempotencyKey, scanner?.id ?? SIN_OPERADOR, endpoint, requestHash);
    if (cached) return { cached };

    const consumo = redeemOne(db, {
      pack,
      method: 'manual_code',
      scannedBy: scanner?.id ?? null,
      deviceLabel,
      idempotencyKey,
      nonce: null,
      ip,
      now,
      lectura,
      quantity,
    });

    const mensaje = quantity > 1
      ? `${quantity} entradas registradas manualmente. Quedan ${consumo.remainingAfter} entrada(s).`
      : `Entrada registrada manualmente. Quedan ${consumo.remainingAfter} entrada(s).`;

    const respuesta = {
      ok: true,
      message: mensaje,
      redemptionId: consumo.redemptionId,
      quantity: consumo.quantity,
      method: 'manual_code',
      remaining: consumo.remainingAfter,
      remainingBefore: consumo.remainingBefore,
      pack: packsService.toPublicPack(consumo.pack),
      customer: { id: owner.id, fullName: owner.full_name },
      at: consumo.createdAt,
      syncedAt: consumo.syncedAt,
    };

    saveIdempotent(db, { key: idempotencyKey, userId: scanner?.id, endpoint, requestHash, statusCode: 200, body: respuesta });

    return { ...consumo, body: respuesta };
  });

  if (result.cached) return { ...result.cached, idempotentReplay: true };

  const body = result.body;

  audit.record({
    actor: scanner ? { id: scanner.id, email: scanner.email } : null,
    action: 'entrada.consumida_manual',
    entityType: 'pack',
    entityId: pack.id,
    metadata: {
      code: pack.code,
      remaining: result.remainingAfter,
      quantity: result.quantity,
      redemptionId: result.redemptionId,
      deviceLabel,
      ...(lectura.diferida ? { capturedAt: result.createdAt } : {}),
    },
    ip,
    userAgent,
    db,
  });

  publishRedemption(result, owner, scanner);
  return { statusCode: 200, body };
}

/** Anula un consumo y devuelve la entrada (o entradas) al pack. Solo el usuario máster. */
export function voidRedemption(redemptionId, { reason, actor, ip, userAgent }) {
  const db = getDb();

  const outcome = inTransaction(() => {
    const redemption = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(redemptionId);
    if (!redemption) throw notFound('No existe ese consumo.');
    if (redemption.status === 'voided') throw conflict('Ese consumo ya fue anulado.', 'ya_anulado');

    const pack = packsService.findById(redemption.pack_id, db);
    if (!pack) throw notFound('El pack asociado ya no existe.');

    const now = new Date().toISOString();
    db.prepare('UPDATE redemptions SET status = ?, voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?').run(
      'voided',
      actor?.id ?? null,
      now,
      reason,
      redemptionId,
    );

    const quantityRestored = redemption.quantity || 1;
    const remainingAfter = pack.remaining + quantityRestored;
    const newStatus = pack.status === 'depleted' ? 'active' : pack.status;
    // Si al pack se le acreditaron entradas hasta llenarlo, devolver una lo
    // haría crecer. Se agranda igual que en un ajuste manual: negarse dejaría
    // sin salida a una corrección legítima.
    const newSize = Math.max(pack.size, remainingAfter);
    db.prepare('UPDATE packs SET remaining = ?, size = ?, status = ?, updated_at = ? WHERE id = ?').run(
      remainingAfter,
      newSize,
      newStatus,
      now,
      pack.id,
    );
    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, redemption_id, actor_id, note, created_at)
       VALUES (?, ?, ?, ?, 'void', ?, ?, ?, ?)`,
    ).run(newId(), pack.id, quantityRestored, remainingAfter, redemptionId, actor?.id ?? null, reason, now);

    audit.record({
      actor,
      action: 'entrada.anulada',
      entityType: 'redemption',
      entityId: redemptionId,
      metadata: { packCode: pack.code, reason, remaining: remainingAfter, restored: quantityRestored },
      ip,
      userAgent,
      db,
    });

    return { pack: packsService.findById(pack.id, db), remainingAfter, quantityRestored };
  });

  const publicPack = packsService.toPublicPack(outcome.pack);
  hub.publish([channels.user(outcome.pack.user_id), channels.staff, channels.admin], 'entrada.anulada', {
    redemptionId,
    pack: publicPack,
    remaining: outcome.remainingAfter,
    quantity: outcome.quantityRestored,
    reason,
  });
  return { pack: publicPack, remaining: outcome.remainingAfter, quantityRestored: outcome.quantityRestored };
}

function mapRedemption(r) {
  return {
    id: r.id,
    packId: r.pack_id,
    packCode: r.pack_code,
    userId: r.user_id,
    customerName: r.customer_name,
    scannedBy: r.scanned_by,
    scannerName: r.scanner_name,
    deviceLabel: r.device_label,
    method: r.method,
    quantity: r.quantity ?? 1,
    remainingBefore: r.remaining_before,
    remainingAfter: r.remaining_after,
    status: r.status,
    voidReason: r.void_reason,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
    /** Cuándo llegó un consumo leído sin conexión; nulo si se cobró en línea. */
    syncedAt: r.synced_at ?? null,
  };
}

/** Historial de consumos con filtros. */
export function listRedemptions({ limit = 50, offset = 0, userId = null, packId = null, scannerId = null, since = null, status = null } = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };
  if (userId) {
    where.push('r.user_id = @userId');
    params.userId = userId;
  }
  if (packId) {
    where.push('r.pack_id = @packId');
    params.packId = packId;
  }
  if (scannerId) {
    where.push('r.scanned_by = @scannerId');
    params.scannerId = scannerId;
  }
  if (since) {
    where.push('r.created_at >= @since');
    params.since = since;
  }
  if (status) {
    where.push('r.status = @status');
    params.status = status;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT r.*, p.code AS pack_code, c.full_name AS customer_name, s.full_name AS scanner_name
         FROM redemptions r
         JOIN packs p ON p.id = r.pack_id
         JOIN users c ON c.id = r.user_id
         LEFT JOIN users s ON s.id = r.scanned_by
         ${clause}
         ORDER BY r.created_at DESC, r.rowid DESC
         LIMIT @limit OFFSET @offset`,
    )
    .all(params);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM redemptions r ${clause}`).get(params).n;
  return { total, items: rows.map(mapRedemption) };
}

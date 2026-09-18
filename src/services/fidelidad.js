/**
 * Programa de fidelidad: «la casa invita».
 *
 * Cada tantas entradas usadas, el cliente recibe un pack de cortesía sin que
 * nadie tenga que acordarse de dárselo. El diseño completo, con el porqué de
 * cada decisión, está en
 * docs/superpowers/specs/2026-09-17-programa-de-fidelidad-design.md.
 * Lo esencial:
 *
 *  - Viene apagado. Una instalación que se actualiza no empieza a regalar
 *    entradas por sorpresa, y encenderlo no premia por el pasado: el contador
 *    arranca en el momento en que se enciende.
 *  - El progreso de una persona se calcula, no se guarda: son sus entradas
 *    contadas menos las que ya se le acreditaron en premios anteriores. Así
 *    volver a evaluar lo mismo no regala nada dos veces, y anular un consumo
 *    resta solo.
 *  - Las entradas de cortesía no cuentan para ganar la siguiente: la casa no
 *    se invita a sí misma.
 *  - Otorgar un premio son dos pasos: primero se reserva (y es la reserva, con
 *    su número único por cliente, la que impide duplicarlo aunque dos lecturas
 *    entren a la vez), y después se emite el pack. Si el proceso se cae en
 *    medio, la reserva queda pendiente y el barrido la completa.
 */
import { getDb, inTransaction } from '../db/index.js';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { hub, channels } from '../lib/events.js';
import * as packsService from './packs.js';
import * as avisos from './avisos.js';
import * as audit from './audit.js';

const CLAVE_AJUSTES = 'loyalty';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Cuántos premios puede otorgar una sola evaluación. */
const MAXIMO_POR_EVALUACION = 5;
/** Cuántos clientes revisa un barrido, para que nunca se alargue sin techo. */
const MAXIMO_POR_BARRIDO = 200;
/** Cuántos premios y clientes devuelve el panel. */
const MAXIMO_EN_PANEL = 20;

const iso = (instante) => new Date(instante).toISOString();

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

export const AJUSTES_PREDETERMINADOS = Object.freeze({
  enabled: false,
  /** Desde cuándo está encendido, para decirlo en el panel. */
  enabledAt: null,
  /**
   * Desde cuándo se cuentan entradas. Se fija al encender el programa: lo que
   * se usó antes no cuenta, ni al estrenarlo ni al volver a encenderlo tras
   * una pausa, porque si contara, encenderlo regalaría packs de golpe.
   */
  countingSince: null,
  /** Entradas que hay que usar para ganar el premio. */
  entriesPerReward: 10,
  /** Entradas que regala el premio. */
  rewardTickets: 1,
  /** Días que vive el pack de cortesía. 0 = no vence. */
  rewardExpiryDays: 60,
});

export function leerAjustes(db = getDb()) {
  const fila = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLAVE_AJUSTES);
  let guardados = {};
  if (fila) {
    try {
      guardados = JSON.parse(fila.value) ?? {};
    } catch (error) {
      logger.error('Los ajustes de fidelidad guardados no se pueden leer; se usan los predeterminados', {
        message: error.message,
      });
    }
  }
  // Solo las claves conocidas: un valor viejo o ajeno no debe llegar a la interfaz.
  const ajustes = {};
  for (const [clave, valor] of Object.entries(AJUSTES_PREDETERMINADOS)) {
    ajustes[clave] = guardados[clave] ?? valor;
  }
  return ajustes;
}

/** ¿Está el programa funcionando ahora mismo? */
export function activo(db = getDb()) {
  const ajustes = leerAjustes(db);
  return Boolean(ajustes.enabled && ajustes.countingSince);
}

/** Ajustes más lo que el panel necesita saber de la instalación. */
export function estado(db = getDb()) {
  const ajustes = leerAjustes(db);
  return {
    ...ajustes,
    /** Si el premio se anuncia por correo, que se configura en Avisos. */
    emailEnabled: avisos.avisoDeRecompensaActivo(db),
  };
}

export function guardarAjustes(cambios, { actor = null, ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);

  inTransaction(() => {
    const antes = leerAjustes(db);
    const despues = { ...antes, ...cambios };

    if (despues.rewardTickets >= despues.entriesPerReward) {
      throw badRequest(
        'El premio tiene que ser menor que las entradas que hay que usar para ganarlo; si no, la pista regalaría más de lo que vende.',
        { fields: { rewardTickets: 'Tiene que ser menor que las entradas por premio.' } },
        'fidelidad_premio_invalido',
      );
    }

    if (despues.enabled && !antes.enabled) {
      despues.enabledAt = ahoraIso;
      // El contador arranca aquí: lo usado mientras estaba apagado no cuenta.
      despues.countingSince = ahoraIso;
    }

    db.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(CLAVE_AJUSTES, JSON.stringify(despues), actor?.id ?? null, ahoraIso);

    audit.record({
      actor,
      action: 'fidelidad.ajustes_cambiados',
      entityType: 'settings',
      entityId: CLAVE_AJUSTES,
      metadata: { cambios },
      ip,
      userAgent,
      db,
    });
  });

  hub.publish([channels.admin], 'fidelidad.actualizada', { motivo: 'ajustes' });

  // Bajar el umbral puede dejar a alguien con el premio ya ganado. Se resuelve
  // ahora, no en el próximo barrido, para que el panel no muestre a clientes
  // «con premio pendiente» que nadie ha otorgado.
  //
  // El premio se fecha en este instante y no en `now`: ese parámetro sirve para
  // fechar el cambio de ajustes (las pruebas y los datos de demostración
  // encienden el programa «desde hace un mes»), pero una entrada se regala
  // cuando se regala.
  if (activo(db)) {
    try {
      evaluarPendientes({ now: Date.now() });
    } catch (error) {
      logger.error('No se pudieron otorgar los premios pendientes tras cambiar los ajustes', { message: error.message });
    }
  }

  return estado(db);
}

// ---------------------------------------------------------------------------
// Conteo
// ---------------------------------------------------------------------------

/**
 * Entradas que cuentan para el premio: consumos confirmados de esta persona
 * desde que se encendió el programa, sin contar los de packs de cortesía.
 *
 * El límite incluye el propio instante del encendido. Las marcas tienen
 * milisegundos, así que una entrada puede caer justo en él; cuando eso pasa, se
 * resuelve a favor del cliente, que es como se resuelve cualquier duda sobre su
 * saldo.
 */
const SQL_CONTADAS = `
  SELECT IFNULL(SUM(r.quantity), 0) AS n
    FROM redemptions r JOIN packs p ON p.id = r.pack_id
   WHERE r.user_id = @userId AND r.status = 'confirmed'
     AND p.origin <> 'loyalty' AND r.created_at >= @desde`;

/** Entradas ya acreditadas: la suma de los umbrales de los premios dados. */
const SQL_ACREDITADAS = `
  SELECT IFNULL(SUM(threshold), 0) AS n
    FROM loyalty_rewards WHERE user_id = @userId AND created_at >= @desde`;

function contadas(db, userId, desde) {
  return db.prepare(SQL_CONTADAS).get({ userId, desde }).n;
}

function acreditadas(db, userId, desde) {
  return db.prepare(SQL_ACREDITADAS).get({ userId, desde }).n;
}

function premiosDe(db, userId, limite = 50) {
  return db
    .prepare(
      `SELECT lr.*, p.code AS pack_code, p.status AS pack_status, p.remaining AS pack_remaining
         FROM loyalty_rewards lr LEFT JOIN packs p ON p.id = lr.pack_id
        WHERE lr.user_id = ?
        ORDER BY lr.sequence DESC
        LIMIT ?`,
    )
    .all(userId, limite)
    .map(mapearPremio);
}

function mapearPremio(fila) {
  return {
    id: fila.id,
    userId: fila.user_id,
    customerName: fila.customer_name ?? undefined,
    sequence: fila.sequence,
    tickets: fila.tickets,
    threshold: fila.threshold,
    counted: fila.counted,
    packId: fila.pack_id,
    packCode: fila.pack_code ?? null,
    packStatus: fila.pack_status ?? null,
    packRemaining: fila.pack_remaining ?? null,
    /** Reserva sin pack: el barrido la completará. */
    pending: fila.pack_id === null,
    createdAt: fila.created_at,
  };
}

/**
 * Cómo va una persona con el programa. Se puede pedir con el programa apagado:
 * entonces el progreso es cero, pero los premios ya ganados siguen ahí.
 */
export function progreso(userId, { db = getDb(), incluirPremios = true } = {}) {
  const ajustes = leerAjustes(db);
  const encendido = Boolean(ajustes.enabled && ajustes.countingSince);
  const desde = ajustes.countingSince ?? iso(0);
  const contadasAhora = encendido ? contadas(db, userId, desde) : 0;
  const acreditadasAhora = encendido ? acreditadas(db, userId, desde) : 0;
  // Anular un consumo puede dejar el progreso en negativo: se muestra en cero,
  // y el siguiente premio espera a que se recupere lo devuelto.
  const avance = Math.max(0, contadasAhora - acreditadasAhora);
  const umbral = ajustes.entriesPerReward;
  const premios = incluirPremios ? premiosDe(db, userId) : [];
  const totales = db
    .prepare('SELECT COUNT(*) AS premios, IFNULL(SUM(tickets), 0) AS entradas FROM loyalty_rewards WHERE user_id = ?')
    .get(userId);

  return {
    enabled: encendido,
    entriesPerReward: umbral,
    rewardTickets: ajustes.rewardTickets,
    rewardExpiryDays: ajustes.rewardExpiryDays,
    countingSince: ajustes.countingSince,
    counted: contadasAhora,
    credited: acreditadasAhora,
    /** Entradas usadas que ya cuentan para el premio en curso. */
    progress: avance % umbral,
    /** Entradas que faltan para el próximo premio. */
    remaining: encendido ? umbral - (avance % umbral) : umbral,
    /** Premios ganados y todavía sin otorgar (los otorga el barrido). */
    due: Math.floor(avance / umbral),
    rewardsCount: totales.premios,
    ticketsEarned: totales.entradas,
    rewards: premios,
    lastRewardAt: premios[0]?.createdAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Otorgar
// ---------------------------------------------------------------------------

/**
 * Reserva el siguiente premio si ya está ganado. Devuelve la reserva o `null`.
 *
 * La reserva es lo que hace idempotente todo el proceso: lleva un número de
 * orden único por cliente, así que dos evaluaciones simultáneas no pueden
 * crear el mismo premio, y la suma de umbrales reservados es justo lo que se
 * descuenta del progreso.
 */
function reservar(db, usuario, ajustes, now) {
  return inTransaction(() => {
    const desde = ajustes.countingSince;
    const usadas = contadas(db, usuario.id, desde);
    const yaAcreditadas = acreditadas(db, usuario.id, desde);
    if (usadas - yaAcreditadas < ajustes.entriesPerReward) return null;

    const sequence =
      db.prepare('SELECT IFNULL(MAX(sequence), 0) + 1 AS siguiente FROM loyalty_rewards WHERE user_id = ?').get(usuario.id)
        .siguiente;
    const reserva = {
      id: newId(),
      user_id: usuario.id,
      pack_id: null,
      sequence,
      tickets: ajustes.rewardTickets,
      threshold: ajustes.entriesPerReward,
      counted: usadas,
      created_at: iso(now),
    };
    // `DO NOTHING` sobre la clave única: si otro proceso reservó ese mismo
    // número mientras tanto, aquí no hay premio que dar, no un error.
    const creada = db
      .prepare(
        `INSERT INTO loyalty_rewards (id, user_id, pack_id, sequence, tickets, threshold, counted, created_at)
         VALUES (@id, @user_id, @pack_id, @sequence, @tickets, @threshold, @counted, @created_at)
         ON CONFLICT(user_id, sequence) DO NOTHING`,
      )
      .run(reserva).changes;
    return creada === 1 ? reserva : null;
  });
}

/**
 * Emite el pack de cortesía de una reserva y lo anuncia. Si algo falla (la
 * cuenta se suspendió entre medias, por ejemplo), la reserva queda pendiente y
 * el barrido lo vuelve a intentar: el premio está ganado, no se pierde.
 */
function completar(db, reserva, ajustes, now, { ip = null, userAgent = null } = {}) {
  const usuario = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(reserva.user_id);
  if (!usuario || usuario.status !== 'active') return null;

  // El pack, su anotación en la reserva y la bitácora van juntos: si esto se
  // partiera a la mitad, el barrido vería la reserva todavía sin pack y
  // emitiría un segundo regalo por el mismo premio.
  const pack = inTransaction(() => {
    const emitido = packsService.issuePack({
      userId: reserva.user_id,
      size: reserva.tickets,
      priceCents: 0,
      paymentMethod: 'cortesia',
      paymentReference: `fidelidad:${reserva.sequence}`,
      note: `Cortesía por fidelidad: premio n.º ${reserva.sequence} tras ${reserva.threshold} entradas usadas.`,
      expiresAt: ajustes.rewardExpiryDays > 0 ? iso(now + ajustes.rewardExpiryDays * DIA_MS) : null,
      origin: 'loyalty',
      ip,
      userAgent,
    });

    db.prepare('UPDATE loyalty_rewards SET pack_id = ? WHERE id = ?').run(emitido.id, reserva.id);

    audit.record({
      actor: null,
      action: 'fidelidad.recompensa_otorgada',
      entityType: 'user',
      entityId: usuario.id,
      metadata: {
        rewardId: reserva.id,
        sequence: reserva.sequence,
        tickets: reserva.tickets,
        threshold: reserva.threshold,
        packCode: emitido.code,
      },
      ip,
      userAgent,
      db,
    });
    return emitido;
  });

  const premio = {
    id: reserva.id,
    userId: usuario.id,
    sequence: reserva.sequence,
    tickets: reserva.tickets,
    threshold: reserva.threshold,
    pack,
    createdAt: reserva.created_at,
  };

  // También al canal de la puerta: quien acaba de escanear ve en su pantalla
  // que esa persona se ganó la cortesía y puede decírselo en el momento.
  hub.publish([channels.user(usuario.id), channels.staff, channels.admin], 'fidelidad.recompensa', {
    reward: {
      id: premio.id,
      sequence: premio.sequence,
      tickets: premio.tickets,
      threshold: premio.threshold,
      createdAt: premio.createdAt,
    },
    pack,
    customer: { id: usuario.id, fullName: usuario.full_name },
  });

  // El correo es opcional y lo gobierna la sección de Avisos: si está apagada,
  // esto no hace nada y el premio se entrega igual.
  try {
    avisos.encolarRecompensa({
      userId: usuario.id,
      packId: pack.id,
      rewardId: premio.id,
      tickets: premio.tickets,
      threshold: premio.threshold,
      sequence: premio.sequence,
      now,
    });
  } catch (error) {
    logger.warn('No se pudo encolar el aviso del premio de fidelidad', { message: error.message });
  }

  logger.info('Premio de fidelidad otorgado', {
    userId: usuario.id,
    sequence: premio.sequence,
    tickets: premio.tickets,
    pack: pack.code,
  });
  return premio;
}

/** Completa las reservas que se quedaron sin pack, si hay alguna. */
function completarReservas(db, userId, ajustes, now, contexto) {
  const pendientes = db
    .prepare('SELECT * FROM loyalty_rewards WHERE user_id = ? AND pack_id IS NULL ORDER BY sequence ASC')
    .all(userId);
  const otorgados = [];
  for (const reserva of pendientes) {
    const premio = completar(db, reserva, ajustes, now, contexto);
    if (premio) otorgados.push(premio);
  }
  return otorgados;
}

/**
 * Otorga a esta persona los premios que ya tenga ganados. Es idempotente y no
 * lanza: se llama justo después de cobrar una entrada, y un problema con el
 * regalo nunca puede tumbar el cobro que lo generó.
 *
 * @returns {Array<object>} premios otorgados en esta llamada
 */
export function evaluar(userId, { now = Date.now(), ip = null, userAgent = null } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  if (!ajustes.enabled || !ajustes.countingSince) return [];

  const usuario = db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId);
  if (!usuario || usuario.status !== 'active') return [];

  const contexto = { ip, userAgent };
  const otorgados = completarReservas(db, userId, ajustes, now, contexto);

  for (let vuelta = 0; vuelta < MAXIMO_POR_EVALUACION; vuelta += 1) {
    const reserva = reservar(db, usuario, ajustes, now);
    if (!reserva) break;
    const premio = completar(db, reserva, ajustes, now, contexto);
    if (!premio) break; // queda reservado; lo completará el barrido
    otorgados.push(premio);
  }
  return otorgados;
}

/** Como `evaluar`, pero sin dejar que un fallo suba: para el camino del cobro. */
export function evaluarEnSilencio(userId, opciones = {}) {
  try {
    return evaluar(userId, opciones);
  } catch (error) {
    logger.error('No se pudo evaluar el programa de fidelidad', { userId, message: error.message });
    return [];
  }
}

/**
 * Barrido de reconciliación: otorga lo que esté ganado y complete lo que quedó
 * a medias. Cubre lo que un proceso caído, una cuenta suspendida o una
 * corrección manual del saldo puedan haber dejado pendiente.
 */
export function evaluarPendientes({ now = Date.now(), limite = MAXIMO_POR_BARRIDO } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  if (!ajustes.enabled || !ajustes.countingSince) return { clientes: 0, premios: 0 };

  const candidatos = db
    .prepare(
      `SELECT u.id AS userId FROM users u
        WHERE u.status = 'active'
          AND (EXISTS (SELECT 1 FROM loyalty_rewards lr WHERE lr.user_id = u.id AND lr.pack_id IS NULL)
               OR (SELECT IFNULL(SUM(r.quantity), 0) FROM redemptions r JOIN packs p ON p.id = r.pack_id
                    WHERE r.user_id = u.id AND r.status = 'confirmed'
                      AND p.origin <> 'loyalty' AND r.created_at >= @desde)
                  - (SELECT IFNULL(SUM(lr.threshold), 0) FROM loyalty_rewards lr
                      WHERE lr.user_id = u.id AND lr.created_at >= @desde) >= @umbral)
        LIMIT @limite`,
    )
    .all({ desde: ajustes.countingSince, umbral: ajustes.entriesPerReward, limite });

  let premios = 0;
  let clientes = 0;
  for (const { userId } of candidatos) {
    const otorgados = evaluarEnSilencio(userId, { now });
    if (otorgados.length) {
      clientes += 1;
      premios += otorgados.length;
    }
  }
  if (premios) hub.publish([channels.admin], 'fidelidad.actualizada', { motivo: 'barrido', premios });
  return { clientes, premios };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** Últimos premios otorgados, con el nombre del cliente. */
export function listar({ limit = MAXIMO_EN_PANEL, userId = null } = {}) {
  const db = getDb();
  const filas = db
    .prepare(
      `SELECT lr.*, u.full_name AS customer_name, p.code AS pack_code, p.status AS pack_status,
              p.remaining AS pack_remaining
         FROM loyalty_rewards lr
         JOIN users u      ON u.id = lr.user_id
         LEFT JOIN packs p ON p.id = lr.pack_id
        ${userId ? 'WHERE lr.user_id = @userId' : ''}
        ORDER BY lr.created_at DESC, lr.rowid DESC
        LIMIT @limit`,
    )
    .all({ limit, userId });
  return { items: filas.map(mapearPremio) };
}

/** Cifras del programa: lo dado y lo que está por darse. */
export function metricas({ now = Date.now() } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  const desde30 = iso(now - 30 * DIA_MS);
  const totales = db
    .prepare(
      `SELECT COUNT(*) AS premios,
              IFNULL(SUM(tickets), 0) AS entradas,
              IFNULL(SUM(CASE WHEN created_at >= @desde30 THEN 1 ELSE 0 END), 0) AS premios_mes,
              IFNULL(SUM(CASE WHEN created_at >= @desde30 THEN tickets ELSE 0 END), 0) AS entradas_mes,
              IFNULL(SUM(CASE WHEN pack_id IS NULL THEN 1 ELSE 0 END), 0) AS pendientes
         FROM loyalty_rewards`,
    )
    .get({ desde30 });

  // Entradas de cortesía ya usadas: cuánto del regalo volvió a la pista.
  const usadas = db
    .prepare(
      `SELECT IFNULL(SUM(r.quantity), 0) AS n FROM redemptions r JOIN packs p ON p.id = r.pack_id
        WHERE r.status = 'confirmed' AND p.origin = 'loyalty'`,
    )
    .get().n;

  const enCurso = ajustes.countingSince
    ? db
        .prepare(
          `SELECT COUNT(*) AS n FROM (
             SELECT (SELECT IFNULL(SUM(r.quantity), 0) FROM redemptions r JOIN packs p ON p.id = r.pack_id
                      WHERE r.user_id = u.id AND r.status = 'confirmed'
                        AND p.origin <> 'loyalty' AND r.created_at >= @desde)
                  - (SELECT IFNULL(SUM(lr.threshold), 0) FROM loyalty_rewards lr
                      WHERE lr.user_id = u.id AND lr.created_at >= @desde) AS avance
               FROM users u WHERE u.status = 'active'
           ) WHERE avance > 0`,
        )
        .get({ desde: ajustes.countingSince }).n
    : 0;

  return {
    rewards: totales.premios,
    ticketsGiven: totales.entradas,
    rewardsLast30: totales.premios_mes,
    ticketsLast30: totales.entradas_mes,
    pending: totales.pendientes,
    ticketsRedeemed: usadas,
    customersInProgress: enCurso,
    costCents: totales.entradas * precioMedioPorEntrada(db),
    currency: config.currency,
  };
}

/**
 * Lo que cuesta una entrada regalada, en dinero: el precio medio de lo vendido
 * en la instalación. Es la cifra que convierte «12 entradas regaladas» en algo
 * que se puede comparar con los ingresos del panel.
 */
function precioMedioPorEntrada(db) {
  const fila = db
    .prepare(
      `SELECT IFNULL(SUM(price_cents), 0) AS importe, IFNULL(SUM(size), 0) AS entradas
         FROM packs WHERE origin = 'sale' AND status <> 'cancelled' AND price_cents > 0`,
    )
    .get();
  if (!fila.entradas) {
    const catalogo = config.packCatalog[0];
    return catalogo ? Math.round(catalogo.priceCents / catalogo.size) : 0;
  }
  return Math.round(fila.importe / fila.entradas);
}

/** Quién está más cerca del premio, para que el mostrador pueda decírselo. */
export function masCerca({ limit = MAXIMO_EN_PANEL } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  if (!ajustes.enabled || !ajustes.countingSince) return { items: [] };

  const filas = db
    .prepare(
      `SELECT id, full_name, email, phone, avance, visita FROM (
         SELECT u.id, u.full_name, u.email, u.phone,
                (SELECT IFNULL(SUM(r.quantity), 0) FROM redemptions r JOIN packs p ON p.id = r.pack_id
                  WHERE r.user_id = u.id AND r.status = 'confirmed'
                    AND p.origin <> 'loyalty' AND r.created_at >= @desde)
              - (SELECT IFNULL(SUM(lr.threshold), 0) FROM loyalty_rewards lr
                  WHERE lr.user_id = u.id AND lr.created_at >= @desde) AS avance,
                (SELECT MAX(r.created_at) FROM redemptions r
                  WHERE r.user_id = u.id AND r.status = 'confirmed') AS visita
           FROM users u WHERE u.status = 'active'
       ) WHERE avance > 0
       ORDER BY (avance % @umbral) DESC, visita DESC
       LIMIT @limit`,
    )
    .all({ desde: ajustes.countingSince, umbral: ajustes.entriesPerReward, limit });

  return {
    items: filas.map((f) => ({
      userId: f.id,
      fullName: f.full_name,
      email: f.email,
      phone: f.phone,
      progress: f.avance % ajustes.entriesPerReward,
      remaining: ajustes.entriesPerReward - (f.avance % ajustes.entriesPerReward),
      lastVisitAt: f.visita,
    })),
  };
}

/** Todo lo que pinta la sección de fidelidad, en una sola respuesta. */
export function resumen({ now = Date.now() } = {}) {
  return {
    status: estado(),
    metrics: metricas({ now }),
    rewards: listar().items,
    closest: masCerca().items,
  };
}

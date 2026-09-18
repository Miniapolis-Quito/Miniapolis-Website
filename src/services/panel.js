/**
 * Cifras del panel del máster.
 *
 * Vive aquí y no en la ruta porque es una regla de negocio con criterio propio:
 * qué cuenta como «hoy», qué packs suman al dinero cobrado, y qué entra en el
 * gráfico de la quincena. La ruta se limita a servirlo.
 *
 * Los días son los de la pista, no los del reloj del servidor: un servidor
 * alquilado suele correr en UTC, y sin eso la tarde del viernes en Ecuador se
 * contaría como actividad del sábado.
 */
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import * as fechas from '../lib/fechas.js';
import * as packsService from './packs.js';
import * as redemptions from './redemptions.js';
import * as sinConexion from './sinConexion.js';
import * as packRequests from './packRequests.js';
import { hub } from '../lib/events.js';

const DIAS_DEL_GRAFICO = 14;
const DIAS_DE_LA_SEMANA = 7;

/** Totales de packs, sin contar los anulados: ni se pueden usar ni se cobraron. */
function totalesDePacks(db) {
  return db
    .prepare(
      `SELECT
         COUNT(*)                                                                   AS packs_totales,
         IFNULL(SUM(CASE WHEN status='active' AND remaining>0 THEN 1 ELSE 0 END),0) AS packs_activos,
         IFNULL(SUM(CASE WHEN status='active' THEN remaining ELSE 0 END),0)         AS entradas_pendientes,
         IFNULL((SELECT SUM(m.delta) FROM pack_movements m JOIN packs p2 ON p2.id = m.pack_id
                  WHERE m.reason = 'issue' AND p2.status <> 'cancelled'), 0) AS entradas_emitidas,
         IFNULL((SELECT SUM(r.quantity) FROM redemptions r JOIN packs p2 ON p2.id = r.pack_id
                  WHERE r.status = 'confirmed' AND p2.status <> 'cancelled'), 0) AS entradas_usadas,
         IFNULL(SUM(price_cents),0)                                                 AS ingresos_cents
       FROM packs WHERE status <> 'cancelled'`,
    )
    .get();
}

function totalesDeUsuarios(db) {
  return db
    .prepare(
      `SELECT
         COUNT(*)                                                      AS total,
         IFNULL(SUM(CASE WHEN role='customer' THEN 1 ELSE 0 END),0)    AS clientes,
         IFNULL(SUM(CASE WHEN role='staff' THEN 1 ELSE 0 END),0)       AS personal,
         IFNULL(SUM(CASE WHEN role='master' THEN 1 ELSE 0 END),0)      AS masters,
         IFNULL(SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END),0) AS suspendidos
       FROM users`,
    )
    .get();
}

/**
 * Actividad de los últimos días, un recuento por cada día del calendario de la
 * pista. Se cuenta entre los instantes en que empieza y acaba cada día en su
 * zona horaria: agrupar por el texto de la fecha guardada agruparía por días
 * UTC, que no son los días de nadie.
 */
function actividadPorDia(db, dias, zona) {
  const contar = db.prepare(
    `SELECT IFNULL(SUM(quantity), 0) AS n FROM redemptions
      WHERE status = 'confirmed' AND created_at >= ? AND created_at < ?`,
  );
  const inicios = dias.map((dia) => fechas.inicioDelDia(dia, zona).toISOString());
  const finDeLaSerie = fechas.inicioDelDia(fechas.siguienteDia(dias[dias.length - 1]), zona).toISOString();

  return {
    inicios,
    serie: dias.map((dia, i) => ({
      date: dia,
      count: contar.get(inicios[i], inicios[i + 1] ?? finDeLaSerie).n,
    })),
  };
}

/** Todo lo que pinta el panel de resumen, en una sola lectura de la base. */
export function resumen({ ahora = new Date() } = {}) {
  const db = getDb();
  packsService.expireDuePacks(db);

  const zona = config.timezone;
  const dias = fechas.ultimosDias(DIAS_DEL_GRAFICO, zona, ahora);
  const { inicios, serie } = actividadPorDia(db, dias, zona);
  const inicioDeHoy = inicios[inicios.length - 1];
  const inicioDeLaSemana = inicios[inicios.length - DIAS_DE_LA_SEMANA];

  const packs = totalesDePacks(db);
  const usuarios = totalesDeUsuarios(db);
  const consumos = db
    .prepare(
      `SELECT
         IFNULL(SUM(CASE WHEN created_at >= ? THEN quantity ELSE 0 END), 0) AS hoy,
         IFNULL(SUM(CASE WHEN created_at >= ? THEN quantity ELSE 0 END), 0) AS semana,
         IFNULL(SUM(quantity), 0)                                            AS total
       FROM redemptions WHERE status = 'confirmed'`,
    )
    .get(inicioDeHoy, inicioDeLaSemana);

  return {
    totals: {
      totalPacks: packs.packs_totales,
      activePacks: packs.packs_activos,
      pendingTickets: packs.entradas_pendientes,
      issuedTickets: packs.entradas_emitidas,
      usedTickets: packs.entradas_usadas,
      revenueCents: packs.ingresos_cents,
      currency: config.currency,
    },
    redemptions: { today: consumos.hoy, week: consumos.semana, total: consumos.total },
    users: {
      total: usuarios.total,
      customers: usuarios.clientes,
      staff: usuarios.personal,
      masters: usuarios.masters,
      suspended: usuarios.suspendidos,
    },
    // La serie va completa —los catorce días, con sus ceros— para que la
    // interfaz no tenga que rehacer el calendario por su cuenta.
    dailySeries: serie,
    recent: redemptions.listRedemptions({ limit: 10 }).items,
    liveConnections: hub.connectionCount,
    integrity: packsService.checkIntegrity(),
    // Personas que entraron con el escáner sin conexión y cuya entrada no se
    // pudo cobrar después. Siguen aquí hasta que alguien las resuelva.
    offlineRejections: sinConexion.pendientes(),
    // Solicitudes de compra/recarga pendientes enviadas por clientes.
    pendingPackRequests: packRequests.listPendingRequests(30, db),
    serverTime: ahora.toISOString(),
  };
}

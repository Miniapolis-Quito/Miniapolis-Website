#!/usr/bin/env node
/**
 * Carga datos de demostración para probar el sistema sin escribirlo todo a mano.
 *
 *   npm run seed
 *
 * Crea un máster, un operador de pista y varios clientes con packs y consumos
 * repartidos en las últimas dos semanas. Se niega a ejecutarse en producción.
 */
import { config } from '../src/config.js';
import { getDb, closeDb } from '../src/db/index.js';
import * as users from '../src/services/users.js';
import * as packsService from '../src/services/packs.js';
import * as redemptions from '../src/services/redemptions.js';

if (config.isProduction) {
  process.stderr.write('\nLos datos de demostración no se cargan en producción.\n\n');
  process.exit(1);
}

const CLAVE_DEMO = 'Pista-Demo-2026';

const CLIENTES = [
  { nombre: 'Carlos Piloto', correo: 'carlos@ejemplo.com', telefono: '+593991112233', packs: [10] },
  { nombre: 'María Chasis', correo: 'maria@ejemplo.com', telefono: '+593992223344', packs: [5, 5] },
  { nombre: 'Andrés Motor', correo: 'andres@ejemplo.com', telefono: '+593993334455', packs: [10, 5] },
  { nombre: 'Lucía Neumático', correo: 'lucia@ejemplo.com', telefono: '+593994445566', packs: [5] },
  { nombre: 'Diego Amortiguador', correo: 'diego@ejemplo.com', telefono: '+593995556677', packs: [] },
];

const db = getDb();

async function asegurarUsuario({ correo, nombre, telefono, rol }) {
  const existente = users.findByEmail(correo);
  if (existente) return existente;
  return users.createUser({ email: correo, password: CLAVE_DEMO, fullName: nombre, phone: telefono, role: rol });
}

const antedatarUsuario = db.prepare('UPDATE users SET created_at = ?, updated_at = ? WHERE id = ?');

const master = await asegurarUsuario({
  correo: 'admin@racinghobbies.ec', nombre: 'Administración Miniápolis', rol: 'master',
});
const operador = await asegurarUsuario({
  correo: 'operador@racinghobbies.ec', nombre: 'Operador de Pista', rol: 'staff',
});

const antedatarConsumo = db.prepare('UPDATE redemptions SET created_at = ? WHERE id = ?');
// El asiento del libro mayor lleva la misma fecha que el consumo: en la
// operación real se escriben juntos, y la ficha del cliente los muestra en el
// mismo hilo.
const antedatarMovimiento = db.prepare('UPDATE pack_movements SET created_at = ? WHERE redemption_id = ?');
const antedatarPack = db.prepare('UPDATE packs SET created_at = ?, updated_at = ? WHERE id = ?');
const antedatarEmision = db.prepare(
  "UPDATE pack_movements SET created_at = ? WHERE pack_id = ? AND reason = 'issue'",
);

/** Un instante al azar dentro del día indicado, contando hacia atrás desde hoy. */
function haceDias(dias) {
  return new Date(Date.now() - dias * 86400000 - Math.random() * 8 * 3600000);
}

let packsCreados = 0;
let consumosCreados = 0;

for (const definicion of CLIENTES) {
  const cliente = await asegurarUsuario({
    correo: definicion.correo, nombre: definicion.nombre, telefono: definicion.telefono, rol: 'customer',
  });

  // El alta va antes que su primera compra, o la ficha diría que el cliente
  // compró un pack antes de existir.
  const alta = haceDias(20 + Math.floor(Math.random() * 40));
  antedatarUsuario.run(alta.toISOString(), alta.toISOString(), cliente.id);

  for (const tamano of definicion.packs) {
    const pack = packsService.issuePack({
      userId: cliente.id,
      size: tamano,
      paymentMethod: 'efectivo',
      actor: { id: master.id, email: master.email },
      note: 'Pack de demostración',
    });
    packsCreados += 1;

    // La compra se sitúa en el pasado para que la ficha del cliente cuente una
    // historia coherente: primero se vende el pack y después se usa.
    const diaCompra = 8 + Math.floor(Math.random() * 12); // entre 8 y 19 días atrás
    const fechaCompra = haceDias(diaCompra);
    antedatarPack.run(fechaCompra.toISOString(), fechaCompra.toISOString(), pack.id);
    antedatarEmision.run(fechaCompra.toISOString(), pack.id);

    // Consume algunas entradas para que el historial y los gráficos tengan datos.
    // Al menos una: si el reparto al azar dejaba a un cliente sin ningún consumo
    // (una vez de cada dieciséis para el de dos packs), su ficha no tenía nada
    // que anular y la prueba de la ficha fallaba por pura mala suerte.
    const aConsumir = Math.max(1, Math.floor(Math.random() * Math.min(tamano - 1, 4)));
    for (let i = 0; i < aConsumir; i += 1) {
      const resultado = redemptions.redeemByCode({
        code: pack.code,
        scanner: { id: operador.id, email: operador.email },
        deviceLabel: 'Puerta principal',
      });
      consumosCreados += 1;

      // Cada visita cae después de la compra. Antedatarla en el momento, además
      // de repartir la actividad por el calendario, evita que la espera entre
      // consumos del mismo pack bloquee al siguiente de este bucle.
      const fechaVisita = haceDias(Math.floor(Math.random() * (diaCompra - 1)));
      antedatarConsumo.run(fechaVisita.toISOString(), resultado.body.redemptionId);
      antedatarMovimiento.run(fechaVisita.toISOString(), resultado.body.redemptionId);
    }
  }
}

process.stdout.write(
  `\n  Datos de demostración cargados.\n\n` +
    `    Máster    : admin@racinghobbies.ec\n` +
    `    Operador  : operador@racinghobbies.ec\n` +
    `    Clientes  : ${CLIENTES.map((c) => c.correo).join(', ')}\n` +
    `    Contraseña: ${CLAVE_DEMO}\n\n` +
    `    ${packsCreados} packs y ${consumosCreados} consumos creados.\n\n` +
    `  Cambia estas contraseñas antes de usar el sistema de verdad.\n\n`,
);

closeDb();

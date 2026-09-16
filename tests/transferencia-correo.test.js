/**
 * Notificación por correo al transferir entradas entre clientes.
 */
import './env.js';
import './env-recuperacion.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { buzonDePrueba, vaciarBuzon } from '../src/lib/correo.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(() => {
  limpiarBase();
  vaciarBuzon();
});

test('transferir entradas envía un correo al destinatario cuando el correo está configurado', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'destinatario.correo@pista.ec',
    fullName: 'Destinatario Piloto',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 2,
    recipient: 'destinatario.correo@pista.ec',
    note: 'Disfruta la carrera este sábado',
  });

  assert.equal(r.status, 200);

  // Breve espera para la promesa asíncrona de envío
  await new Promise((resolve) => setTimeout(resolve, 80));

  const buzon = buzonDePrueba();
  const correo = buzon.find((m) => m.para === 'destinatario.correo@pista.ec');
  assert.ok(correo, 'el destinatario debe recibir el correo de aviso de transferencia');
  assert.match(correo.asunto, /2 entradas/);
  assert.ok(correo.texto.includes('Disfruta la carrera este sábado'), 'el texto incluye la nota');
  assert.ok(correo.html.includes(r.datos.destinationPack.code), 'el HTML incluye el código del nuevo pack');
});

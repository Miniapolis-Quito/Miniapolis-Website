/**
 * Catálogo de packs configurable.
 *
 * Cada archivo de prueba corre en su propio proceso, así que `./env-catalogo.js`
 * puede fijar `PACK_CATALOG` sin molestar al resto de la suite. Va primero: la
 * configuración se lee una sola vez, al evaluarse la aplicación, y en ESM las
 * importaciones se ejecutan antes que cualquier línea del archivo.
 */
import './env-catalogo.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
import { config } from '../src/config.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('el catálogo sale de la configuración, ordenado y con su etiqueta', () => {
  assert.deepEqual(
    config.packCatalog.map((p) => [p.size, p.priceCents, p.label]),
    [
      [3, 1500, 'Pack 3 entradas'],
      [10, 4500, 'Pack 10 entradas'],
      [20, 8000, 'Pack 20 entradas'],
    ],
  );
});

test('la app y la caja ven el mismo catálogo', async () => {
  const publico = await crearCliente().get('/api/config');
  assert.deepEqual(publico.datos.packCatalog.map((p) => p.size), [3, 10, 20]);

  const { cCliente } = await sembrarUsuarios();
  const catalogo = await cCliente.get('/api/packs/catalog');
  assert.deepEqual(catalogo.datos.items.map((p) => p.size), [3, 10, 20]);
  assert.equal(catalogo.datos.items[2].priceCents, 8000);
});

test('un pack del catálogo se vende con su precio de lista', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const r = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 20 });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.pack.size, 20);
  assert.equal(r.datos.pack.priceCents, 8000, 'toma el precio del catálogo nuevo');

  // Un tamaño fuera del catálogo se sigue admitiendo (una cortesía, un pack a
  // medida), solo que sin precio de lista que aplicar.
  const aMedida = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 7 });
  assert.equal(aMedida.status, 201);
  assert.equal(aMedida.datos.pack.priceCents, 0);
});

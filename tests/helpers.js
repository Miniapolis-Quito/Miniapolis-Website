/**
 * Utilidades compartidas por las pruebas: levanta la aplicación sobre una base
 * de datos en memoria y ofrece un cliente HTTP mínimo.
 *
 * `./env.js` va primero a propósito: fija las variables de entorno antes de que
 * se evalúe la configuración de la aplicación.
 */
import './env.js';

import http from 'node:http';
import { createApp } from '../src/app.js';
import { closeDb, getDb } from '../src/db/index.js';
import { config } from '../src/config.js';
import * as users from '../src/services/users.js';

let servidor = null;
let baseUrl = null;

export async function levantarServidor() {
  if (config.databaseFile !== ':memory:') {
    throw new Error('Las pruebas solo deben ejecutarse contra una base en memoria.');
  }
  if (servidor) return baseUrl;
  const app = createApp();
  servidor = http.createServer(app);
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  return baseUrl;
}

export async function bajarServidor() {
  if (servidor) {
    await new Promise((resolver) => servidor.close(resolver));
    servidor = null;
  }
  closeDb();
}

/** Vacía todas las tablas entre pruebas, conservando el esquema. */
export function limpiarBase() {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const tabla of [
    'notifications', 'settings', 'password_resets', 'wallet_devices', 'wallet_passes', 'loyalty_rewards',
    'pack_movements', 'redemptions', 'packs', 'sessions', 'audit_log',
    'used_nonces', 'rate_limits', 'idempotency_keys', 'users',
  ]) {
    db.prepare(`DELETE FROM ${tabla}`).run();
  }
  db.pragma('foreign_keys = ON');
}

/** Cliente HTTP con manejo de cookies y token, por usuario. */
export function crearCliente() {
  const cookies = new Map();
  let token = null;

  async function pedir(ruta, { metodo = 'GET', cuerpo, cabeceras = {}, binario = false } = {}) {
    const headers = { ...cabeceras };
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookies.size) {
      headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const respuesta = await fetch(`${baseUrl}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

    for (const cookie of respuesta.headers.getSetCookie?.() ?? []) {
      const [par] = cookie.split(';');
      const idx = par.indexOf('=');
      const nombre = par.slice(0, idx).trim();
      const valor = par.slice(idx + 1).trim();
      if (valor === '') cookies.delete(nombre);
      else cookies.set(nombre, valor);
    }

    const tipo = respuesta.headers.get('content-type') || '';
    // Un pase de cartera o cualquier otro archivo llega en binario: leerlo como
    // texto lo destrozaría al decodificarlo.
    const datos = binario
      ? Buffer.from(await respuesta.arrayBuffer())
      : tipo.includes('application/json')
        ? await respuesta.json()
        : await respuesta.text();

    return { status: respuesta.status, datos, headers: respuesta.headers };
  }

  return {
    pedir,
    get: (ruta, opciones) => pedir(ruta, { ...opciones, metodo: 'GET' }),
    post: (ruta, cuerpo, opciones) => pedir(ruta, { ...opciones, metodo: 'POST', cuerpo }),
    patch: (ruta, cuerpo, opciones) => pedir(ruta, { ...opciones, metodo: 'PATCH', cuerpo }),
    get token() { return token; },
    set token(valor) { token = valor; },
    async entrar(email, password) {
      const r = await pedir('/api/auth/login', { metodo: 'POST', cuerpo: { email, password } });
      if (r.status !== 200) throw new Error(`Login fallido (${r.status}): ${JSON.stringify(r.datos)}`);
      token = r.datos.accessToken;
      return r.datos;
    },
    limpiarCookies: () => cookies.clear(),
    leerCookie: (nombre) => cookies.get(nombre) ?? null,
  };
}

export const CLAVES = {
  // Contraseñas que no contienen el nombre ni el correo del usuario: si lo
  // hicieran, la validación de robustez las rechazaría (y con razón).
  master: 'Chicane-Nocturna-77',
  staff: 'Horquilla-Trasera-84',
  cliente: 'Diferencial-Rojo-91',
};

/**
 * Crea el trío de usuarios habitual y devuelve clientes ya autenticados.
 *
 * El máster y el operador llegan con el permiso de escaneo puesto, que es la
 * configuración normal de una pista en marcha. Las pruebas del permiso lo
 * quitan o crean cuentas sin él a propósito.
 */
export async function sembrarUsuarios() {
  const master = await users.createUser({
    email: 'master@pista.ec', password: CLAVES.master, fullName: 'Ana Máster', role: 'master', scanEnabled: true,
  });
  const staff = await users.createUser({
    email: 'staff@pista.ec', password: CLAVES.staff, fullName: 'Beto Pista', role: 'staff', scanEnabled: true,
  });
  const cliente = await users.createUser({
    email: 'cliente@pista.ec', password: CLAVES.cliente, fullName: 'Carlos Piloto', role: 'customer',
  });

  const cMaster = crearCliente();
  const cStaff = crearCliente();
  const cCliente = crearCliente();
  await cMaster.entrar('master@pista.ec', CLAVES.master);
  await cStaff.entrar('staff@pista.ec', CLAVES.staff);
  await cCliente.entrar('cliente@pista.ec', CLAVES.cliente);

  return { master, staff, cliente, cMaster, cStaff, cCliente };
}

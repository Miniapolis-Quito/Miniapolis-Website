/**
 * Pases en la cartera del teléfono.
 *
 * El cliente guarda su pack en Apple Wallet o en Google Wallet y ve ahí cuántas
 * entradas le quedan, sin abrir nada. Cuando el personal descuenta una, el
 * número cambia solo: a Apple se le avisa por push y el teléfono viene a pedir
 * el pase nuevo; a Google se le manda el saldo directamente.
 *
 * Sobre el código del pase: un pase de cartera no puede rotar su QR cada treinta
 * segundos —vive en el teléfono, muchas veces sin conexión—, así que lleva
 * código solo cuando el pack tiene habilitado el QR impreso. Es la misma regla
 * que el pase de cartón: lo que no rota, se puede copiar, y por eso lo habilita
 * el máster pack por pack. Sin esa opción el pase igual sirve para lo que
 * pidió el cliente: ver el saldo. Para entrar, se muestra el QR de la app.
 */
import crypto from 'node:crypto';
import { getDb, inTransaction } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { buildQrPayload } from '../lib/qr.js';
import { hub, channels } from '../lib/events.js';
import { construirPase } from '../lib/pkpass.js';
import * as apns from '../lib/apns.js';
import * as google from '../lib/googleWallet.js';
import * as packsService from './packs.js';
import * as users from './users.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';

/**
 * Teléfonos que pueden recibir avisos de un mismo pase. Da de sobra para quien
 * cambia de teléfono o tiene también un reloj, y evita que quien tiene el pase
 * registre identificadores sin fin: cada uno es una fila más y un aviso más a
 * Apple en cada escaneo.
 */
export const MAXIMO_TELEFONOS_POR_PASE = 10;

/** Espera antes de avisar de un cambio, para no mandar un aviso por escaneo. */
const ESPERA_DE_AVISO_MS = 1500;

const CARPETA_IMAGENES = path.join(ROOT_DIR, 'assets', 'wallet');
const IMAGENES = [
  'icon.png',
  'icon@2x.png',
  'icon@3x.png',
  'logo.png',
  'logo@2x.png',
  'strip.png',
  'strip@2x.png',
  'strip@3x.png',
];

let imagenesEnMemoria = null;
function imagenesDelPase() {
  if (!imagenesEnMemoria) {
    imagenesEnMemoria = IMAGENES.map((nombre) => ({
      nombre,
      datos: fs.readFileSync(path.join(CARPETA_IMAGENES, nombre)),
    }));
  }
  return imagenesEnMemoria;
}

// ---------------------------------------------------------------------------
// Estado del pase de cada pack
// ---------------------------------------------------------------------------

/** ¿Está configurada alguna cartera? */
export function disponible() {
  return {
    apple: config.wallet.apple.enabled && Boolean(config.publicUrl),
    google: config.wallet.google.enabled,
  };
}

/**
 * Devuelve (creándolo la primera vez) el pase asociado a un pack.
 * El número de serie y la contraseña se generan una sola vez y no cambian: son
 * lo que identifica al pase en el teléfono durante toda su vida.
 */
export function asegurarPase(packId, db = getDb()) {
  const existente = db.prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(packId);
  if (existente) return existente;

  const ahora = new Date().toISOString();
  const fila = {
    pack_id: packId,
    serial: randomToken(16),
    auth_token: randomToken(24),
    created_at: ahora,
    updated_at: ahora,
    google_synced_at: null,
  };
  db.prepare(
    `INSERT INTO wallet_passes (pack_id, serial, auth_token, created_at, updated_at)
     VALUES (@pack_id, @serial, @auth_token, @created_at, @updated_at)
     ON CONFLICT(pack_id) DO NOTHING`,
  ).run(fila);
  return db.prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(packId);
}

export function paseDeSerie(serial, db = getDb()) {
  return db.prepare('SELECT * FROM wallet_passes WHERE serial = ?').get(serial) ?? null;
}

/** Marca el pase como cambiado; es lo que el teléfono compara para saber si hay novedad. */
function marcarCambio(packId, db = getDb()) {
  db.prepare('UPDATE wallet_passes SET updated_at = ? WHERE pack_id = ?').run(new Date().toISOString(), packId);
}

// ---------------------------------------------------------------------------
// Contenido del pase
// ---------------------------------------------------------------------------

function estadoLegible(pack) {
  const usable = packsService.isUsable(pack);
  if (usable.ok) return 'Activo';
  return { sin_entradas: 'Sin entradas', expirado: 'Vencido', cancelado: 'Anulado', suspendido: 'Suspendido' }[
    usable.reason
  ] || 'No disponible';
}

/** El código del pase, solo si el pack admite uno que no rota. */
function codigoDelPase(pack) {
  if (!pack.allow_static_qr) return null;
  return buildQrPayload(pack, { static: true });
}

/** Contenido de `pass.json` para Apple Wallet. */
export function contenidoApple(pack, dueno, pase) {
  const codigo = codigoDelPase(pack);
  const vence = pack.expires_at
    ? new Date(pack.expires_at).toLocaleDateString('es-EC', { timeZone: config.timezone })
    : 'Sin vencimiento';

  return {
    formatVersion: 1,
    passTypeIdentifier: config.wallet.apple.passTypeId,
    teamIdentifier: config.wallet.apple.teamId,
    serialNumber: pase.serial,
    organizationName: config.brandName,
    description: `Entradas de ${config.brandShort}`,
    logoText: config.brandShort,
    backgroundColor: 'rgb(0, 0, 0)',
    foregroundColor: 'rgb(246, 246, 242)',
    labelColor: 'rgb(60, 254, 63)',
    // El arte de la franja ya contiene el acabado Racing; Wallet no debe
    // superponerle el brillo genérico de una tarjeta de tienda.
    suppressStripShine: true,
    webServiceURL: `${config.publicUrl}/api/wallet/apple`,
    authenticationToken: pase.auth_token,
    ...(config.wallet.apple.associatedAppIdentifier
      ? { associatedStoreIdentifiers: [config.wallet.apple.associatedAppIdentifier] }
      : {}),
    storeCard: {
      headerFields: [
        {
          key: 'restantes',
          label: 'QUEDAN',
          value: pack.remaining,
          // Es lo que el teléfono enseña en el aviso cuando el número baja.
          changeMessage: 'Te quedan %@ entradas.',
        },
      ],
      primaryFields: [{ key: 'pack', label: 'PACK', value: pack.code }],
      secondaryFields: [
        { key: 'titular', label: 'CLIENTE', value: dueno?.full_name ?? '' },
        { key: 'estado', label: 'ESTADO', value: estadoLegible(pack) },
      ],
      auxiliaryFields: [
        { key: 'compradas', label: 'PACK DE', value: `${pack.size} entradas` },
        { key: 'vence', label: 'VENCE', value: vence },
      ],
      backFields: [
        {
          key: 'como',
          label: 'Cómo entrar a la pista',
          value: codigo
            ? 'Muestra este pase al personal. El número de arriba se actualiza solo cada vez que usas una entrada.'
            : 'Este pase es para consultar tu saldo: se actualiza solo cada vez que usas una entrada. Para entrar, abre la app y muestra el QR, que cambia cada pocos segundos por seguridad.',
        },
        { key: 'codigo', label: 'Código del pack', value: pack.code },
        {
          key: 'sinSenal',
          label: 'Si te quedas sin señal',
          value: `Dile al personal tu código ${pack.code} y lo ingresan a mano.`,
        },
      ],
    },
    ...(codigo
      ? {
          barcodes: [
            {
              format: 'PKBarcodeFormatQR',
              message: codigo,
              messageEncoding: 'iso-8859-1',
              altText: pack.code,
            },
          ],
        }
      : {}),
  };
}

/** Plantilla común de Google Wallet: se crea una vez y vale para todos los pases. */
export function claseGoogle() {
  return {
    id: config.wallet.google.classId,
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['restantes']" }] } },
              endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['pack']" }] } },
            },
          },
        ],
      },
    },
    enableSmartTap: false,
    hexBackgroundColor: '#000000',
  };
}

/** Objeto del pase en Google Wallet. */
export function objetoGoogle(pack, dueno, pase) {
  const codigo = codigoDelPase(pack);
  const usable = packsService.isUsable(pack).ok;

  return {
    id: `${config.wallet.google.issuerId}.${pase.serial}`,
    classId: config.wallet.google.classId,
    state: usable ? 'ACTIVE' : 'INACTIVE',
    hexBackgroundColor: '#000000',
    ...(config.publicUrl
      ? {
          // Google recorta el logo normal en círculo, por eso usa el sello
          // cuadrado de la bandera. El logotipo panorámico queda para la
          // cabecera, donde se lee entero y sin perder el nombre.
          logo: { sourceUri: { uri: `${config.publicUrl}/images/miniapolis-wallet-icon.png` } },
          wideLogo: { sourceUri: { uri: `${config.publicUrl}/images/miniapolis-wallet-wide-logo.png` } },
        }
      : {}),
    cardTitle: { defaultValue: { language: 'es-EC', value: config.brandName } },
    subheader: { defaultValue: { language: 'es-EC', value: 'Entradas disponibles' } },
    header: { defaultValue: { language: 'es-EC', value: String(pack.remaining) } },
    textModulesData: [
      { id: 'restantes', header: 'Quedan', body: `${pack.remaining} de ${pack.size}` },
      { id: 'pack', header: 'Pack', body: pack.code },
      { id: 'titular', header: 'Cliente', body: dueno?.full_name ?? '' },
      { id: 'estado', header: 'Estado', body: estadoLegible(pack) },
    ],
    ...(codigo ? { barcode: { type: 'QR_CODE', value: codigo, alternateText: pack.code } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

/**
 * Permiso de corta vida para descargar el pase de Apple.
 *
 * El teléfono tiene que llegar al archivo navegando —solo así iOS ofrece
 * añadirlo a la cartera—, y una navegación no lleva la cabecera de sesión. En
 * vez de abrir la descarga a cualquiera, se firma un permiso que vale
 * `streamTicketTtlSeconds` y solo para ese pack. No es de un solo uso a
 * propósito: Safari puede pedir la misma dirección más de una vez.
 */
export function firmarTicket(packId, { ahora = Date.now() } = {}) {
  const expira = Math.floor(ahora / 1000) + config.tokens.streamTicketTtlSeconds;
  const cuerpo = `${packId}.${expira}`;
  const firma = crypto.createHmac('sha256', config.secrets.accessToken).update(`wallet:${cuerpo}`).digest('base64url');
  return `${expira}.${firma}`;
}

export function ticketValido(packId, ticket, { ahora = Date.now() } = {}) {
  if (typeof ticket !== 'string' || ticket.length > 200) return false;
  const corte = ticket.indexOf('.');
  if (corte === -1) return false;

  const expira = Number(ticket.slice(0, corte));
  if (!Number.isFinite(expira) || expira * 1000 < ahora) return false;
  // Defensa en profundidad: un ticket no puede tener una vigencia futura desmedida.
  const ventanaMaximaSegundos = config.tokens.streamTicketTtlSeconds + 300;
  if (expira * 1000 > ahora + ventanaMaximaSegundos * 1000) return false;

  const esperada = crypto
    .createHmac('sha256', config.secrets.accessToken)
    .update(`wallet:${packId}.${expira}`)
    .digest('base64url');
  const a = Buffer.from(ticket.slice(corte + 1));
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Arma el archivo .pkpass listo para descargar. */
export function construirPaseApple(packId) {
  const pack = packsService.findById(packId);
  if (!pack) return null;
  const dueno = users.findById(pack.user_id);
  const pase = asegurarPase(packId);
  return {
    serial: pase.serial,
    archivo: construirPase(contenidoApple(pack, dueno, pase), imagenesDelPase(), {
      certificate: config.wallet.apple.certificate,
      key: config.wallet.apple.key,
      keyPassword: config.wallet.apple.keyPassword,
      wwdrCertificate: config.wallet.apple.wwdrCertificate,
    }),
  };
}

/** Enlace de "Guardar en Google Wallet" para un pack. */
export async function enlaceGoogle(packId) {
  const pack = packsService.findById(packId);
  if (!pack) return null;
  const dueno = users.findById(pack.user_id);
  const pase = asegurarPase(packId);

  await google.asegurarClase(claseGoogle(), config.wallet.google);
  const objeto = objetoGoogle(pack, dueno, pase);
  // Se deja creado antes de entregar el enlace: así el saldo ya está al día
  // aunque la persona tarde en abrirlo.
  await google.guardarObjeto(objeto, config.wallet.google);
  getDb()
    .prepare('UPDATE wallet_passes SET google_synced_at = ? WHERE pack_id = ?')
    .run(new Date().toISOString(), packId);

  return google.enlaceParaGuardar({ id: objeto.id, classId: objeto.classId }, config.wallet.google);
}

// ---------------------------------------------------------------------------
// Registro de teléfonos (servicio web de Apple)
// ---------------------------------------------------------------------------

export function registrarDispositivo({ deviceId, serial, pushToken }) {
  const db = getDb();
  const pase = paseDeSerie(serial, db);
  if (!pase) return { ok: false, motivo: 'desconocido' };

  return inTransaction(() => {
    const ya = db
      .prepare('SELECT push_token FROM wallet_devices WHERE device_id = ? AND serial = ?')
      .get(deviceId, serial);

    if (!ya) {
      // Al llegar al tope se olvida el registro más antiguo: lo normal es que
      // sea un teléfono que la persona ya no usa.
      db.prepare(
        `DELETE FROM wallet_devices
          WHERE rowid IN (SELECT rowid FROM wallet_devices WHERE serial = ?
                          ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
      ).run(serial, MAXIMO_TELEFONOS_POR_PASE - 1);
    }

    db.prepare(
      `INSERT INTO wallet_devices (device_id, serial, push_token, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id, serial) DO UPDATE SET push_token = excluded.push_token`,
    ).run(deviceId, serial, pushToken, new Date().toISOString());

    return { ok: true, yaEstaba: Boolean(ya) };
  });
}

export function olvidarDispositivo({ deviceId, serial }) {
  return (
    getDb().prepare('DELETE FROM wallet_devices WHERE device_id = ? AND serial = ?').run(deviceId, serial).changes > 0
  );
}

/** Series con cambios desde `desde` que ese teléfono tenga guardadas. */
export function seriesActualizadas(deviceId, desde) {
  const db = getDb();
  const filas = db
    .prepare(
      `SELECT p.serial, p.updated_at
         FROM wallet_devices d JOIN wallet_passes p ON p.serial = d.serial
        WHERE d.device_id = ?`,
    )
    .all(deviceId);

  const nuevas = desde ? filas.filter((f) => f.updated_at > desde) : filas;
  if (nuevas.length === 0) return null;
  return {
    serialNumbers: nuevas.map((f) => f.serial),
    lastUpdated: nuevas.reduce((maximo, f) => (f.updated_at > maximo ? f.updated_at : maximo), ''),
  };
}

// ---------------------------------------------------------------------------
// Avisos de cambio
// ---------------------------------------------------------------------------

const pendientes = new Set();
let temporizador = null;

/** Deja constancia del cambio y programa el aviso a las carteras. */
export function anotarCambio(packId) {
  if (!packId) return;
  const db = getDb();
  const pase = db.prepare('SELECT pack_id FROM wallet_passes WHERE pack_id = ?').get(packId);
  // Si nadie guardó este pack en su cartera, no hay nada que avisar.
  if (!pase) return;

  marcarCambio(packId, db);
  pendientes.add(packId);
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    const lote = [...pendientes];
    pendientes.clear();
    for (const id of lote) avisarDeCambio(id).catch(() => {});
  }, ESPERA_DE_AVISO_MS);
  temporizador.unref?.();
}

/** Avisa a las dos carteras del saldo nuevo de un pack. */
export async function avisarDeCambio(packId) {
  const db = getDb();
  const pase = db.prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(packId);
  if (!pase) return { apple: 0, google: false };

  const resultado = { apple: 0, google: false };

  if (config.wallet.apple.pushEnabled) {
    const tokens = db.prepare('SELECT push_token FROM wallet_devices WHERE serial = ?').all(pase.serial);
    if (tokens.length > 0) {
      const { enviados, caducados } = await apns.avisarATodos(
        tokens.map((t) => t.push_token),
        {
          apnsKeyId: config.wallet.apple.apnsKeyId,
          apnsKey: config.wallet.apple.apnsKey,
          teamId: config.wallet.apple.teamId,
          passTypeId: config.wallet.apple.passTypeId,
          apnsHost: config.wallet.apple.apnsHost,
        },
      );
      resultado.apple = enviados;
      // Un teléfono que ya no tiene el pase deja de estar en la lista: si no,
      // se le avisaría para siempre.
      for (const token of caducados) {
        db.prepare('DELETE FROM wallet_devices WHERE push_token = ?').run(token);
      }
    }
  }

  if (config.wallet.google.enabled && pase.google_synced_at) {
    try {
      const pack = packsService.findById(packId);
      const dueno = pack ? users.findById(pack.user_id) : null;
      if (pack) {
        await google.guardarObjeto(objetoGoogle(pack, dueno, pase), config.wallet.google);
        db.prepare('UPDATE wallet_passes SET google_synced_at = ? WHERE pack_id = ?').run(
          new Date().toISOString(),
          packId,
        );
        resultado.google = true;
      }
    } catch (error) {
      logger.warn('No se pudo actualizar el pase en Google Wallet', { message: error.message });
    }
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Enganche con el resto del sistema
// ---------------------------------------------------------------------------

let suscripcion = null;

/**
 * Escucha los cambios que ya publica el sistema en vivo, en vez de meter mano
 * en el camino del consumo: cuando una entrada se descuenta, el pase de la
 * cartera se entera por el mismo aviso que la pantalla del cliente.
 */
export function escucharCambios() {
  const carteras = disponible();
  if (suscripcion || (!carteras.apple && !carteras.google)) return;
  const interesantes = new Set(['entrada.consumida', 'entrada.anulada', 'pack.actualizado']);
  suscripcion = hub.subscribe([channels.admin], (evento) => {
    if (!interesantes.has(evento.type)) return;
    anotarCambio(evento.data?.pack?.id);
  });
}

export function dejarDeEscuchar() {
  suscripcion?.();
  suscripcion = null;
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  pendientes.clear();
}

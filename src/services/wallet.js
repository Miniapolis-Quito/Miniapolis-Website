/**
 * Pases en la cartera del teléfono.
 *
 * El cliente guarda su pack en Apple Wallet o en Google Wallet y ve ahí cuántas
 * entradas le quedan, sin abrir nada. Cuando el personal descuenta una, el
 * número cambia solo: a Apple se le avisa por push y el teléfono viene a pedir
 * el pase nuevo; a Google se le manda el saldo directamente.
 *
 * Avisar puede fallar —un corte de red, un permiso caducado, Google de
 * mantenimiento— y un aviso perdido deja el pase mintiendo sobre el saldo. Por
 * eso el cambio queda anotado en la base hasta que se comunica de verdad, y un
 * barrido lo reintenta con esperas cada vez más largas. Eso cubre también el
 * caso feo: que el servidor se reinicie entre el consumo y el aviso.
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

/** Cada cuánto se revisa si quedó algún pase sin comunicar. */
const BARRIDO_MS = 60_000;

/** Espera del primer reintento y tope al que llega duplicándose. */
const REINTENTO_BASE_MS = 30_000;
const REINTENTO_MAXIMO_MS = 60 * 60 * 1000;
/** A partir de aquí la espera ya está en el tope; no hace falta seguir contando. */
const INTENTOS_HASTA_EL_TOPE = 8;

/** Cuántos pases atrasados se atienden en cada barrido. */
const PASES_POR_BARRIDO = 50;

/** Cuánto vale la invitación que el mostrador le entrega al cliente. */
export const MINUTOS_DE_INVITACION = 10;

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

const ahoraIso = (ms = Date.now()) => new Date(ms).toISOString();

/**
 * Fecha en el formato que aceptan las dos carteras.
 *
 * Apple rechaza el pase entero si la fecha trae milisegundos, y Google guarda
 * la fecha tal cual se le manda. Se normaliza en un solo sitio para no tener
 * que acordarse en cada campo.
 */
function fechaDeCartera(valor) {
  if (!valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
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

/** ¿Hay alguna cartera con la que el cliente pueda guardar su pase? */
export function algunaDisponible() {
  const carteras = disponible();
  return carteras.apple || carteras.google;
}

/**
 * Devuelve (creándolo la primera vez) el pase asociado a un pack.
 * El número de serie y la contraseña se generan una sola vez y no cambian: son
 * lo que identifica al pase en el teléfono durante toda su vida.
 */
export function asegurarPase(packId, db = getDb()) {
  const existente = db.prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(packId);
  if (existente) return existente;

  const ahora = ahoraIso();
  const fila = {
    pack_id: packId,
    serial: randomToken(16),
    auth_token: randomToken(24),
    created_at: ahora,
    updated_at: ahora,
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

/** El dueño del pack, para que el pase sepa si la cuenta está suspendida. */
function duenoDelPack(pack) {
  return pack?.user_id ? users.findById(pack.user_id) : null;
}

// ---------------------------------------------------------------------------
// Contenido del pase
// ---------------------------------------------------------------------------

const MOTIVOS_LEGIBLES = {
  sin_entradas: 'Sin entradas',
  expirado: 'Vencido',
  cancelado: 'Anulado',
  suspendido: 'Suspendido',
  cliente_suspendido: 'Cuenta suspendida',
  inactivo: 'No disponible',
};

/**
 * Por qué se puede o no usar el pack, con el dueño incluido.
 *
 * El dueño importa: si la cuenta del cliente está suspendida, el escáner
 * rechaza sus entradas, y el pase de la cartera tiene que decir lo mismo. Sin
 * esto el teléfono mostraba "Activo" para un pack que en la puerta no abría.
 */
function situacion(pack, dueno) {
  // Solo cuenta como dueño lo que traiga su estado. A quien llama con un objeto
  // a medias —un nombre para pintar, sin más— se le responde por el pack, no se
  // le tacha el pase por un campo que nadie le pidió.
  const owner = typeof dueno?.status === 'string' ? dueno : null;
  return packsService.isUsable(pack, { owner });
}

function estadoLegible(pack, dueno) {
  const usable = situacion(pack, dueno);
  if (usable.ok) return 'Activo';
  return MOTIVOS_LEGIBLES[usable.reason] || 'No disponible';
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
  const venceEn = fechaDeCartera(pack.expires_at);
  const anulado = pack.status === 'cancelled';

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
    labelColor: 'rgb(147, 210, 65)',
    // El arte de la franja ya contiene el acabado Racing; Wallet no debe
    // superponerle el brillo genérico de una tarjeta de tienda.
    suppressStripShine: true,
    webServiceURL: `${config.publicUrl}/api/wallet/apple`,
    authenticationToken: pase.auth_token,
    // Con esto el teléfono apaga solo el pase el día que el pack vence, aunque
    // en ese momento esté sin conexión y no pueda venir a preguntar.
    ...(venceEn ? { expirationDate: venceEn } : {}),
    // Un pack anulado no es un pack viejo: el teléfono lo tacha para que nadie
    // lo enseñe en la puerta creyendo que sirve.
    ...(anulado ? { voided: true } : {}),
    // Un pase con código sí es una entrada: compartirlo es regalar entradas,
    // así que el teléfono no ofrece mandárselo a nadie.
    ...(codigo ? { sharingProhibited: true } : {}),
    storeCard: {
      headerFields: [
        {
          key: 'restantes',
          label: 'QUEDAN',
          value: pack.remaining,
          // Es lo que el teléfono enseña en el aviso cuando el número baja.
          // Sin plural en el texto: vale igual para una entrada que para diez.
          changeMessage: 'Entradas disponibles: %@',
        },
      ],
      primaryFields: [{ key: 'pack', label: 'PACK', value: pack.code }],
      secondaryFields: [
        { key: 'titular', label: 'CLIENTE', value: dueno?.full_name ?? '' },
        { key: 'estado', label: 'ESTADO', value: estadoLegible(pack, dueno) },
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
        // La hora del último cambio es la prueba de que el pase está vivo: sin
        // ella, quien ve un número que no cambió no sabe si es que no ha usado
        // entradas o es que el pase se quedó colgado.
        {
          key: 'actualizado',
          label: 'Saldo actualizado',
          value: new Date(pase.updated_at).toLocaleString('es-EC', { timeZone: config.timezone }),
        },
        ...(config.publicUrl
          ? [{ key: 'app', label: 'Tu cuenta', value: `${config.publicUrl}/app` }]
          : []),
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

/**
 * Plantilla común de Google Wallet: se crea una vez y vale para todos los pases.
 *
 * Aquí va solo lo que el esquema de `genericClass` admite. El color de fondo,
 * por ejemplo, es del objeto y no de la clase: mandarlo aquí hacía que Google
 * rechazara la plantilla entera con un 400, y sin plantilla no se podía generar
 * ningún enlace de "Guardar en Google Wallet".
 */
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
  };
}

/** En qué estado ve Google el pase. Cada motivo tiene el suyo. */
function estadoGoogle(pack, dueno) {
  const usable = situacion(pack, dueno);
  if (usable.ok) return 'ACTIVE';
  if (usable.reason === 'expirado') return 'EXPIRED';
  if (usable.reason === 'sin_entradas') return 'COMPLETED';
  return 'INACTIVE';
}

/** Objeto del pase en Google Wallet. */
export function objetoGoogle(pack, dueno, pase) {
  const codigo = codigoDelPase(pack);
  const venceEn = fechaDeCartera(pack.expires_at);

  return {
    id: `${config.wallet.google.issuerId}.${pase.serial}`,
    classId: config.wallet.google.classId,
    genericType: 'GENERIC_ENTRY_TICKET',
    state: estadoGoogle(pack, dueno),
    hexBackgroundColor: '#000000',
    // Igual que en Apple: el pase se apaga solo el día que el pack vence, sin
    // depender de que nadie le avise.
    ...(venceEn ? { validTimeInterval: { end: { date: venceEn } } } : {}),
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
      { id: 'estado', header: 'Estado', body: estadoLegible(pack, dueno) },
      {
        id: 'actualizado',
        header: 'Saldo actualizado',
        body: new Date(pase.updated_at).toLocaleString('es-EC', { timeZone: config.timezone }),
      },
    ],
    ...(config.publicUrl
      ? {
          linksModuleData: {
            uris: [{ id: 'app', uri: `${config.publicUrl}/app`, description: 'Ver mis entradas' }],
          },
        }
      : {}),
    ...(codigo ? { barcode: { type: 'QR_CODE', value: codigo, alternateText: pack.code } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Permisos de corta vida
// ---------------------------------------------------------------------------

function firmar(proposito, packId, expira) {
  return crypto
    .createHmac('sha256', config.secrets.accessToken)
    .update(`${proposito}:${packId}.${expira}`)
    .digest('base64url');
}

function firmarPermiso(proposito, packId, segundos, ahora) {
  const expira = Math.floor(ahora / 1000) + segundos;
  return `${expira}.${firmar(proposito, packId, expira)}`;
}

function permisoValido(proposito, packId, permiso, segundos, ahora) {
  if (typeof permiso !== 'string' || permiso.length > 200) return false;
  const corte = permiso.indexOf('.');
  if (corte === -1) return false;

  const expira = Number(permiso.slice(0, corte));
  if (!Number.isFinite(expira) || expira * 1000 < ahora) return false;
  // Defensa en profundidad: un permiso no puede tener una vigencia futura
  // desmedida, ni siquiera si alguien lograra firmarlo.
  const ventanaMaximaSegundos = segundos + 300;
  if (expira * 1000 > ahora + ventanaMaximaSegundos * 1000) return false;

  const a = Buffer.from(permiso.slice(corte + 1));
  const b = Buffer.from(firmar(proposito, packId, expira));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
  return firmarPermiso('wallet', packId, config.tokens.streamTicketTtlSeconds, ahora);
}

export function ticketValido(packId, ticket, { ahora = Date.now() } = {}) {
  return permisoValido('wallet', packId, ticket, config.tokens.streamTicketTtlSeconds, ahora);
}

/**
 * Invitación que el mostrador le entrega al cliente para que guarde el pase en
 * su teléfono ahí mismo, sin tener que iniciar sesión delante de la cola.
 *
 * Es un permiso aparte del de descarga y con otra firma: dura más (los minutos
 * que tarda alguien en sacar el teléfono y escanear un QR) y por eso no puede
 * confundirse con el otro ni servir para lo mismo. Quien la tenga puede guardar
 * el pase de ese pack durante esos minutos, así que la crea solo el máster y se
 * muestra en pantalla, no se manda por ahí.
 */
export function firmarInvitacion(packId, { ahora = Date.now() } = {}) {
  return firmarPermiso('wallet-invitacion', packId, MINUTOS_DE_INVITACION * 60, ahora);
}

export function invitacionValida(packId, permiso, { ahora = Date.now() } = {}) {
  return permisoValido('wallet-invitacion', packId, permiso, MINUTOS_DE_INVITACION * 60, ahora);
}

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

/** Arma el archivo .pkpass listo para descargar. */
export function construirPaseApple(packId) {
  const pack = packsService.findById(packId);
  if (!pack) return null;
  const dueno = duenoDelPack(pack);
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
  const dueno = duenoDelPack(pack);
  const pase = asegurarPase(packId);

  await google.asegurarClase(claseGoogle(), config.wallet.google);
  const objeto = objetoGoogle(pack, dueno, pase);
  // Se deja creado antes de entregar el enlace: así el saldo ya está al día
  // aunque la persona tarde en abrirlo.
  await google.guardarObjeto(objeto, config.wallet.google);
  getDb()
    .prepare('UPDATE wallet_passes SET google_synced_at = ? WHERE pack_id = ?')
    .run(ahoraIso(), packId);

  return google.enlaceParaGuardar({ id: objeto.id, classId: objeto.classId }, config.wallet.google);
}

/**
 * Cómo está el pase de un pack: si alguien lo guardó, dónde, y si el saldo que
 * se ve en el teléfono es el de ahora. Es lo que mira el mostrador cuando un
 * cliente dice que su pase no se actualiza.
 */
export function estadoDelPase(packId, db = getDb()) {
  const carteras = disponible();
  const pase = db.prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(packId);
  if (!pase) {
    return { carteras, guardado: false, telefonos: 0, google: false, alDia: true, pendienteDesde: null };
  }
  const telefonos = db.prepare('SELECT COUNT(*) AS n FROM wallet_devices WHERE serial = ?').get(pase.serial).n;
  return {
    carteras,
    guardado: telefonos > 0 || Boolean(pase.google_synced_at),
    telefonos,
    google: Boolean(pase.google_synced_at),
    alDia: !pase.sync_pending_at,
    pendienteDesde: pase.sync_pending_at,
    actualizadoEn: pase.updated_at,
    sincronizadoEn: pase.synced_at,
  };
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
    ).run(deviceId, serial, pushToken, ahoraIso());

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

let temporizador = null;

/** Programa el barrido dentro de `espera` ms, si no hay ya uno más cercano. */
function programarBarrido(espera) {
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    reconciliar().catch((error) => logger.error('Falló el barrido de pases de cartera', { message: error.message }));
  }, espera);
  temporizador.unref?.();
}

/**
 * Deja constancia del cambio y programa el aviso a las carteras.
 *
 * Lo primero es anotarlo en la base y lo segundo avisar, en ese orden: si el
 * servidor se cae justo aquí, al volver encuentra la anotación y avisa. Al
 * revés se habría perdido el cambio sin que nadie se enterara.
 */
export function anotarCambio(packId) {
  if (!packId) return false;
  const ahora = ahoraIso();
  const cambios = getDb()
    .prepare(
      `UPDATE wallet_passes
          SET updated_at = ?,
              sync_pending_at = COALESCE(sync_pending_at, ?),
              -- Si ya venía fallando, se respeta su espera: un pack muy
              -- escaneado no debe reiniciar el reintento en cada lectura y
              -- convertir un fallo en una ráfaga contra Apple o Google.
              sync_next_at = CASE WHEN sync_attempts = 0 THEN NULL ELSE sync_next_at END
        WHERE pack_id = ?`,
    )
    .run(ahora, ahora, packId).changes;

  // Si nadie guardó este pack en su cartera, no hay nada que avisar.
  if (!cambios) return false;
  programarBarrido(ESPERA_DE_AVISO_MS);
  return true;
}

/**
 * Marca como cambiados todos los pases de un cliente.
 *
 * Suspender una cuenta no toca ningún pack, pero deja sin valer todas sus
 * entradas: el pase tiene que decir lo mismo que el escáner. Lo mismo al
 * reactivarla, para que vuelva a verse como activo.
 */
export function anotarCambioDeCliente(userId) {
  if (!userId) return 0;
  const filas = getDb()
    .prepare(
      `SELECT w.pack_id FROM wallet_passes w
         JOIN packs p ON p.id = w.pack_id
        WHERE p.user_id = ?`,
    )
    .all(userId);
  let tocados = 0;
  for (const fila of filas) if (anotarCambio(fila.pack_id)) tocados += 1;
  return tocados;
}

/** Cuánto esperar antes del siguiente intento, duplicando hasta el tope. */
function esperaDeReintento(intentos) {
  const paso = Math.min(Math.max(intentos, 1), INTENTOS_HASTA_EL_TOPE) - 1;
  return Math.min(REINTENTO_BASE_MS * 2 ** paso, REINTENTO_MAXIMO_MS);
}

/**
 * Anota cómo fue el aviso.
 *
 * Al darlo por bueno se exige que la versión comunicada siga siendo la última
 * (`updated_at = marca`): si mientras se avisaba llegó otro consumo, el pase
 * sigue pendiente y el barrido volverá por él. Sin esa condición, ese segundo
 * consumo se habría dado por avisado sin haberlo sido.
 */
function anotarResultado(packId, marca, ok, db) {
  const ahora = ahoraIso();
  if (ok) {
    const aplicado = db
      .prepare(
        `UPDATE wallet_passes
            SET sync_pending_at = NULL, sync_attempts = 0, sync_next_at = NULL, synced_at = ?
          WHERE pack_id = ? AND updated_at = ?`,
      )
      .run(ahora, packId, marca).changes;
    if (aplicado === 0) programarBarrido(ESPERA_DE_AVISO_MS);
    return;
  }

  const fila = db.prepare('SELECT sync_attempts FROM wallet_passes WHERE pack_id = ?').get(packId);
  const intentos = Math.min((fila?.sync_attempts ?? 0) + 1, INTENTOS_HASTA_EL_TOPE);
  db.prepare(
    `UPDATE wallet_passes
        SET sync_pending_at = COALESCE(sync_pending_at, ?), sync_attempts = ?, sync_next_at = ?
      WHERE pack_id = ?`,
  ).run(ahora, intentos, ahoraIso(Date.now() + esperaDeReintento(intentos)), packId);
}

/** Avisa a las dos carteras del saldo nuevo de un pack. */
export async function avisarDeCambio(packId) {
  const db = getDb();
  const pase = db.prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(packId);
  if (!pase) return { apple: 0, google: false, ok: true };

  const marca = pase.updated_at;
  const resultado = { apple: 0, google: false, ok: true };

  if (config.wallet.apple.pushEnabled) {
    const tokens = db.prepare('SELECT push_token FROM wallet_devices WHERE serial = ?').all(pase.serial);
    if (tokens.length > 0) {
      try {
        const { enviados, caducados, fallidos } = await apns.avisarATodos(
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
        // se le avisaría para siempre. Se borra solo su registro de este pase;
        // el mismo aparato puede tener guardado el pase de otro pack.
        for (const token of caducados) {
          db.prepare('DELETE FROM wallet_devices WHERE serial = ? AND push_token = ?').run(pase.serial, token);
        }
        // Un fallo pasajero (Apple ocupado, la red del local) deja el pase
        // pendiente para reintentarlo; un token caducado, no: ese ya se
        // resolvió dándolo de baja.
        if (fallidos > 0) resultado.ok = false;
      } catch (error) {
        logger.warn('No se pudo avisar a los teléfonos del cambio en su pase', { message: error.message });
        resultado.ok = false;
      }
    }
  }

  if (config.wallet.google.enabled && pase.google_synced_at) {
    try {
      const pack = packsService.findById(packId);
      if (pack) {
        await google.guardarObjeto(objetoGoogle(pack, duenoDelPack(pack), pase), config.wallet.google);
        db.prepare('UPDATE wallet_passes SET google_synced_at = ? WHERE pack_id = ?').run(ahoraIso(), packId);
        resultado.google = true;
      }
    } catch (error) {
      logger.warn('No se pudo actualizar el pase en Google Wallet', { message: error.message });
      resultado.ok = false;
    }
  }

  anotarResultado(packId, marca, resultado.ok, db);
  return resultado;
}

// ---------------------------------------------------------------------------
// Barrido: nada se queda sin comunicar
// ---------------------------------------------------------------------------

let barridoEnCurso = null;
let barridoSiguiente = null;

/**
 * Atiende los pases con cambios sin comunicar a los que ya les toca.
 *
 * Nunca corren dos barridos a la vez. Si se pide otro mientras uno trabaja, se
 * hace uno más al terminar —y uno solo, por muchas veces que se pida—: un
 * consumo que llegue justo mientras se avisaba ya no estaba en la lista que el
 * barrido leyó, y sin esa segunda vuelta se quedaría esperando al siguiente.
 */
export function reconciliar({ ahora = Date.now(), limite = PASES_POR_BARRIDO } = {}) {
  if (barridoEnCurso) {
    barridoSiguiente ??= barridoEnCurso
      .catch(() => {})
      .then(() => {
        barridoSiguiente = null;
        return reconciliar({ limite });
      });
    return barridoSiguiente;
  }
  barridoEnCurso = (async () => {
    const db = getDb();
    const filas = db
      .prepare(
        `SELECT pack_id FROM wallet_passes
          WHERE sync_pending_at IS NOT NULL AND (sync_next_at IS NULL OR sync_next_at <= ?)
          ORDER BY sync_pending_at ASC
          LIMIT ?`,
      )
      .all(ahoraIso(ahora), limite);

    let atendidos = 0;
    let atrasados = 0;
    for (const fila of filas) {
      const resultado = await avisarDeCambio(fila.pack_id);
      atendidos += 1;
      if (!resultado.ok) atrasados += 1;
    }
    // Un aviso suelto que falla y se reintenta no merece una línea de registro;
    // que fallen todos, sí: es una credencial caducada o un servicio caído.
    if (atrasados > 0 && atrasados === atendidos) {
      logger.warn('Ningún pase de cartera se pudo poner al día en este barrido', { pases: atrasados });
    }
    return { atendidos, atrasados };
  })().finally(() => {
    barridoEnCurso = null;
  });
  return barridoEnCurso;
}

// ---------------------------------------------------------------------------
// Enganche con el resto del sistema
// ---------------------------------------------------------------------------

let suscripcion = null;
let barrido = null;

/**
 * Escucha los cambios que ya publica el sistema en vivo, en vez de meter mano
 * en el camino del consumo: cuando una entrada se descuenta, el pase de la
 * cartera se entera por el mismo aviso que la pantalla del cliente.
 *
 * Además deja puesto el barrido periódico, que es lo que recoge lo que quedó a
 * medias: un aviso que falló, o los cambios anotados justo antes de un
 * reinicio del servidor.
 */
export function escucharCambios({ barridoMs = BARRIDO_MS } = {}) {
  if (suscripcion || !algunaDisponible()) return;
  const interesantes = new Set(['entrada.consumida', 'entrada.anulada', 'pack.actualizado']);
  suscripcion = hub.subscribe([channels.admin], (evento) => {
    // Suspender, reactivar o cambiarle el nombre a un cliente cambia todos sus
    // pases a la vez, no uno.
    if (evento.type === 'cliente.actualizado') {
      anotarCambioDeCliente(evento.data?.userId);
      return;
    }
    if (!interesantes.has(evento.type)) return;
    anotarCambio(evento.data?.pack?.id);
  });

  barrido = setInterval(() => {
    reconciliar().catch((error) => logger.error('Falló el barrido de pases de cartera', { message: error.message }));
  }, barridoMs);
  barrido.unref?.();
}

/**
 * Comprueba al arrancar que Google acepta la plantilla de los pases.
 *
 * Si algo no cuadra —una credencial mal copiada, un campo que su API no
 * conoce—, el botón "Guardar en Google Wallet" deja de funcionar para todo el
 * mundo a la vez, y sin esta comprobación eso se descubre cuando un cliente lo
 * pulsa. No detiene el arranque: el resto del sistema no depende de ello.
 */
export async function comprobarConfiguracion() {
  if (!config.wallet.google.enabled) return { google: null };
  return { google: await google.comprobarConfiguracion(claseGoogle(), config.wallet.google) };
}

export function dejarDeEscuchar() {
  suscripcion?.();
  suscripcion = null;
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  if (barrido) {
    clearInterval(barrido);
    barrido = null;
  }
}

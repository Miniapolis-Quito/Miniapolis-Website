/**
 * Verificación en dos pasos (TOTP) y su política.
 *
 * Por qué existe: la contraseña del personal es lo único que hoy separa a
 * cualquiera de descontar entradas ajenas, emitir packs o cambiar cuentas. Una
 * contraseña se reutiliza, se apunta en un papel del mostrador y se teclea
 * delante de la fila. El segundo factor añade algo que no se puede copiar de
 * lejos: un código que cambia cada treinta segundos y que solo sale del
 * teléfono de esa persona.
 *
 * Decisiones que conviene conocer antes de tocar este archivo:
 *
 *  - El secreto se guarda cifrado (AES-256-GCM con la clave del entorno). Una
 *    copia de seguridad robada no entrega segundos factores. Si la clave
 *    cambia y el secreto ya no se puede descifrar, el acceso se niega y hace
 *    falta que la administración lo quite: nunca se degrada a «entra solo con
 *    la contraseña», porque eso convertiría un fallo de configuración en una
 *    puerta abierta.
 *  - Acertar la contraseña no abre sesión: abre un «desafío» que vive unos
 *    minutos, aguanta unos pocos intentos y se gasta al usarse. Así los
 *    intentos se cuentan contra ese acceso concreto y no contra la cuenta
 *    entera, y el token intermedio no sirve para nada más.
 *  - Un código TOTP vale una sola vez: se guarda el último tramo aceptado.
 *    Quien lo lea por encima del hombro no llega a tiempo de usarlo.
 *  - Los códigos de respaldo se guardan por su HMAC y se gastan uno a uno,
 *    igual que los refresh tokens.
 *  - La política («el personal tiene que usarla») se enciende desde el panel,
 *    no desde el entorno, y solo puede encenderla alguien que ya la tenga
 *    puesta: si no, el propio máster se dejaría fuera del panel.
 */
import crypto from 'node:crypto';
import { getDb, inTransaction, prepareCached } from '../db/index.js';
import { config } from '../config.js';
import { newId, randomToken } from '../lib/ids.js';
import { badRequest, forbidden, tooManyRequests, unauthorized } from '../lib/errors.js';
import { cifrar, descifrar } from '../lib/cifrado.js';
import { despuesDeResponder } from '../lib/tareasDiferidas.js';
import { enviarCorreo } from '../lib/correo.js';
import { escaparHtml, momento, saludo, envolverHtml } from '../lib/plantillaCorreo.js';
import * as totp from '../lib/totp.js';
import * as audit from './audit.js';

const CLAVE_AJUSTES = 'seguridad';
const PROPOSITO_CIFRADO = 'totp-secret';

/** Alfabeto de los códigos de respaldo: sin letras ni dígitos confundibles. */
const ALFABETO_RESPALDO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO_RESPALDO = 10; // 30^10 ≈ 5,9·10^14 combinaciones

const iso = (instante = Date.now()) => new Date(instante).toISOString();

export const AJUSTES_PREDETERMINADOS = Object.freeze({
  /** Si el personal y el máster están obligados a usar el segundo paso. */
  requireTwoFactorForStaff: false,
  /** Desde cuándo, para poder contarlo en el panel. */
  requiredAt: null,
});

// ---------------------------------------------------------------------------
// Política
// ---------------------------------------------------------------------------

export function leerAjustes() {
  // Con la política encendida esto se consulta en cada petición con permisos,
  // así que la sentencia se compila una sola vez. La aplicación tiene una
  // única conexión, también dentro de una transacción.
  const fila = prepareCached('SELECT value FROM settings WHERE key = ?').get(CLAVE_AJUSTES);
  let guardados = {};
  if (fila) {
    try {
      guardados = JSON.parse(fila.value) ?? {};
    } catch {
      guardados = {};
    }
  }
  const ajustes = {};
  for (const [clave, valor] of Object.entries(AJUSTES_PREDETERMINADOS)) {
    ajustes[clave] = guardados[clave] ?? valor;
  }
  return ajustes;
}

/** Roles a los que alcanza la política. */
export function rolPrivilegiado(role) {
  return role === 'master' || role === 'staff';
}

/**
 * ¿Esta cuenta tiene que llevar segundo factor y no lo lleva? Es lo que
 * consultan las rutas con permisos para responder «primero regístralo».
 */
export function pendienteDeActivar(usuario) {
  if (!usuario || !rolPrivilegiado(usuario.role)) return false;
  if (usuario.twoFactorEnabled ?? usuario.totp_enabled) return false;
  return leerAjustes().requireTwoFactorForStaff === true;
}

export function guardarAjustes(cambios, { actor = null, ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);

  return inTransaction(() => {
    const antes = leerAjustes();
    const despues = { ...antes, ...cambios };

    if (despues.requireTwoFactorForStaff && !antes.requireTwoFactorForStaff) {
      // Quien la exige tiene que haberla puesto ya. Sin esta comprobación, el
      // máster se cerraría el panel a sí mismo con un clic y la única salida
      // sería entrar a la base a mano.
      const actual = actor?.id ? db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(actor.id) : null;
      if (!actual?.totp_enabled) {
        throw badRequest(
          'Primero activa la verificación en dos pasos en tu propia cuenta: si no, al exigirla te quedarías fuera del panel.',
          { fields: { requireTwoFactorForStaff: 'Actívala en tu cuenta antes de exigirla.' } },
          'dos_factores_master_sin_activar',
        );
      }
      despues.requiredAt = ahoraIso;
    }
    if (!despues.requireTwoFactorForStaff) despues.requiredAt = null;

    db.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(CLAVE_AJUSTES, JSON.stringify(despues), actor?.id ?? null, ahoraIso);

    audit.record({
      actor,
      action: 'seguridad.ajustes_cambiados',
      entityType: 'settings',
      entityId: CLAVE_AJUSTES,
      metadata: { cambios },
      ip,
      userAgent,
      db,
    });

    return despues;
  });
}

/** Lo que ve el panel: la política y cómo va el personal con ella. */
export function panelDeSeguridad(db = getDb()) {
  const ajustes = leerAjustes();
  const filas = db
    .prepare(
      `SELECT id, full_name, email, role, status, totp_enabled, totp_confirmed_at
         FROM users WHERE role IN ('master','staff') ORDER BY role DESC, full_name`,
    )
    .all();
  const conSegundoFactor = filas.filter((f) => f.totp_enabled).length;

  return {
    ...ajustes,
    equipo: filas.map((f) => ({
      id: f.id,
      fullName: f.full_name,
      email: f.email,
      role: f.role,
      status: f.status,
      twoFactorEnabled: Boolean(f.totp_enabled),
      twoFactorSince: f.totp_confirmed_at,
      recoveryCodesLeft: codigosDisponibles(f.id, db),
    })),
    total: filas.length,
    conSegundoFactor,
    sinSegundoFactor: filas.length - conSegundoFactor,
  };
}

// ---------------------------------------------------------------------------
// Códigos de respaldo
// ---------------------------------------------------------------------------

function hashCodigo(codigo) {
  return crypto
    .createHmac('sha256', config.secrets.twoFactor)
    .update(`respaldo:${normalizarRespaldo(codigo)}`)
    .digest('hex');
}

/** Se teclean sin guiones ni mayúsculas y se comparan siempre igual. */
export function normalizarRespaldo(codigo) {
  return String(codigo ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // Confusiones típicas al copiar de un papel, igual que en los códigos de pack.
    .replace(/[O0]/g, 'Q')
    .replace(/[IL1]/g, '7')
    .replace(/U/g, 'V');
}

function generarCodigo() {
  let salida = '';
  while (salida.length < LARGO_RESPALDO) {
    for (const byte of crypto.randomBytes(LARGO_RESPALDO)) {
      // Rechazo de sesgo: se descartan los bytes que no caen en un múltiplo exacto.
      if (byte >= 256 - (256 % ALFABETO_RESPALDO.length)) continue;
      salida += ALFABETO_RESPALDO[byte % ALFABETO_RESPALDO.length];
      if (salida.length === LARGO_RESPALDO) break;
    }
  }
  return `${salida.slice(0, 5)}-${salida.slice(5)}`;
}

export function codigosDisponibles(userId, db = getDb()) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM two_factor_recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .get(userId).n;
}

/**
 * Renueva la tanda entera. Los anteriores dejan de valer: si alguien pide
 * códigos nuevos es porque duda de los viejos.
 */
function emitirCodigos(db, userId, ahoraIso) {
  db.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(userId);
  const codigos = [];
  const insertar = db.prepare(
    'INSERT INTO two_factor_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
  );
  while (codigos.length < config.twoFactor.codigosDeRespaldo) {
    const codigo = generarCodigo();
    try {
      insertar.run(newId(), userId, hashCodigo(codigo), ahoraIso);
    } catch (error) {
      // code_hash es único en toda la tabla: repetirlo es tan improbable que
      // basta con volver a sortear, pero no se puede ignorar en silencio.
      if (String(error.message).includes('UNIQUE')) continue;
      throw error;
    }
    codigos.push(codigo);
  }
  return codigos;
}

// ---------------------------------------------------------------------------
// Estado y alta
// ---------------------------------------------------------------------------

export function estado(usuario, db = getDb()) {
  const fila = db
    .prepare('SELECT role, totp_enabled, totp_secret, totp_confirmed_at FROM users WHERE id = ?')
    .get(usuario.id);
  if (!fila) return null;
  const ajustes = leerAjustes();
  return {
    enabled: Boolean(fila.totp_enabled),
    since: fila.totp_confirmed_at,
    /** Si hay un alta empezada y sin confirmar. */
    pendingSetup: Boolean(fila.totp_secret && !fila.totp_enabled),
    recoveryCodesLeft: fila.totp_enabled ? codigosDisponibles(usuario.id, db) : 0,
    /** Si esta cuenta está obligada a llevarla. */
    required: rolPrivilegiado(fila.role) && ajustes.requireTwoFactorForStaff === true,
    /** Si lo está y aún no la tiene: la interfaz lo dice sin rodeos. */
    pendingRequired: rolPrivilegiado(fila.role) && ajustes.requireTwoFactorForStaff === true && !fila.totp_enabled,
    digits: config.twoFactor.digitos,
    periodSeconds: config.twoFactor.periodoSegundos,
  };
}

/**
 * Empieza el alta: genera un secreto y lo deja guardado sin activar. Mientras
 * no se confirme con un código, la cuenta sigue entrando como siempre.
 */
export function iniciarAlta(usuario, { now = Date.now() } = {}) {
  const db = getDb();
  const fila = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(usuario.id);
  if (!fila) throw unauthorized('Tu sesión ya no es válida. Vuelve a entrar.');
  if (fila.totp_enabled) {
    throw badRequest(
      'Ya tienes la verificación en dos pasos activa. Desactívala antes de volver a configurarla.',
      null,
      'dos_factores_ya_activa',
    );
  }

  const secreto = totp.generarSecreto();
  db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = NULL, updated_at = ? WHERE id = ?').run(
    cifrar(secreto, PROPOSITO_CIFRADO),
    iso(now),
    usuario.id,
  );

  return {
    secret: secreto,
    secretoLegible: totp.secretoLegible(secreto),
    otpauthUri: totp.uriOtpauth({
      secreto,
      cuenta: usuario.email,
      emisor: config.brandName,
      digitos: config.twoFactor.digitos,
      periodoSegundos: config.twoFactor.periodoSegundos,
    }),
    digits: config.twoFactor.digitos,
    periodSeconds: config.twoFactor.periodoSegundos,
  };
}

/**
 * Confirma el alta con el primer código. Devuelve los códigos de respaldo, que
 * se enseñan una única vez.
 */
export function activar(usuario, codigo, { ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);

  const codigos = inTransaction(() => {
    const fila = db.prepare('SELECT totp_enabled, totp_secret FROM users WHERE id = ?').get(usuario.id);
    if (!fila) throw unauthorized('Tu sesión ya no es válida. Vuelve a entrar.');
    if (fila.totp_enabled) throw badRequest('Ya tienes la verificación en dos pasos activa.', null, 'dos_factores_ya_activa');
    if (!fila.totp_secret) {
      throw badRequest(
        'No hay ninguna configuración empezada. Vuelve a escanear el código QR.',
        null,
        'dos_factores_sin_configurar',
      );
    }

    const secreto = descifrar(fila.totp_secret, PROPOSITO_CIFRADO);
    if (!secreto) throw errorSecretoIlegible();

    const resultado = totp.verificar(secreto, codigo, {
      ahora: now,
      periodoSegundos: config.twoFactor.periodoSegundos,
      digitos: config.twoFactor.digitos,
      ventana: config.twoFactor.ventana,
    });
    if (!resultado.ok) throw errorCodigoInvalido(resultado.motivo);

    db.prepare(
      `UPDATE users SET totp_enabled = 1, totp_confirmed_at = ?, totp_last_step = ?, updated_at = ?
        WHERE id = ? AND totp_enabled = 0`,
    ).run(ahoraIso, resultado.paso, ahoraIso, usuario.id);

    const emitidos = emitirCodigos(db, usuario.id, ahoraIso);

    audit.record({
      actor: usuario,
      action: 'dos_factores.activada',
      entityType: 'user',
      entityId: usuario.id,
      ip,
      userAgent,
      db,
    });

    return emitidos;
  });

  avisarPorCorreo(usuario, 'activada', { ip, now });
  return codigos;
}

/**
 * Quita el segundo factor. Lo pide la propia persona (con su contraseña ya
 * comprobada por la ruta y un código válido) o la administración cuando
 * alguien pierde el teléfono.
 */
export function desactivar(usuario, { motivo = 'usuario', actor = null, ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);

  const cambios = inTransaction(() => {
    const hechos = db
      .prepare(
        `UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_confirmed_at = NULL,
                          totp_last_step = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(ahoraIso, usuario.id).changes;
    db.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(usuario.id);
    db.prepare('UPDATE two_factor_challenges SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL').run(
      ahoraIso,
      usuario.id,
    );

    audit.record({
      actor: actor ?? usuario,
      action: 'dos_factores.desactivada',
      entityType: 'user',
      entityId: usuario.id,
      metadata: { motivo },
      ip,
      userAgent,
      db,
    });
    return hechos;
  });

  if (cambios > 0) avisarPorCorreo(usuario, motivo === 'administracion' ? 'desactivada_admin' : 'desactivada', { ip, now });
  return cambios > 0;
}

/** Renueva los códigos de respaldo. Exige un código válido del teléfono. */
export function renovarCodigos(usuario, { ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  return inTransaction(() => {
    const codigos = emitirCodigos(db, usuario.id, iso(now));
    audit.record({
      actor: usuario,
      action: 'dos_factores.codigos_renovados',
      entityType: 'user',
      entityId: usuario.id,
      ip,
      userAgent,
      db,
    });
    return codigos;
  });
}

// ---------------------------------------------------------------------------
// Comprobación del código
// ---------------------------------------------------------------------------

const errorSecretoIlegible = () =>
  forbidden(
    'No podemos leer tu verificación en dos pasos en este servidor. Pide en recepción que la quiten para volver a configurarla.',
    'dos_factores_ilegible',
  );

function errorCodigoInvalido(motivo) {
  if (motivo === 'reutilizado') {
    return badRequest(
      'Ese código ya se usó. Espera a que tu aplicación muestre el siguiente.',
      { fields: { code: 'Código ya usado.' } },
      'dos_factores_codigo_usado',
    );
  }
  return badRequest(
    'El código no es correcto. Comprueba que la hora del teléfono esté en automático e inténtalo con el siguiente.',
    { fields: { code: 'Código incorrecto.' } },
    'dos_factores_codigo_invalido',
  );
}

/**
 * Comprueba un código contra la cuenta, dentro de la transacción de quien
 * llama. Acepta tanto el código del teléfono como uno de respaldo, y consume
 * lo que haya usado: el tramo de treinta segundos o el código de papel.
 *
 * @returns {{ok:true, via:'totp'|'respaldo', codigosRestantes?:number}|{ok:false, motivo:string}}
 */
export function comprobarCodigo(db, userId, codigo, { ip = null, now = Date.now() } = {}) {
  const fila = db.prepare('SELECT totp_enabled, totp_secret, totp_last_step FROM users WHERE id = ?').get(userId);
  if (!fila || !fila.totp_enabled) return { ok: false, motivo: 'no_activa' };

  const limpio = totp.normalizarCodigo(codigo);
  const esNumerico = new RegExp(`^\\d{${config.twoFactor.digitos}}$`).test(limpio);

  if (esNumerico) {
    const secreto = descifrar(fila.totp_secret, PROPOSITO_CIFRADO);
    if (!secreto) return { ok: false, motivo: 'ilegible' };
    const resultado = totp.verificar(secreto, limpio, {
      ahora: now,
      periodoSegundos: config.twoFactor.periodoSegundos,
      digitos: config.twoFactor.digitos,
      ventana: config.twoFactor.ventana,
      pasoMinimo: fila.totp_last_step,
    });
    if (!resultado.ok) return { ok: false, motivo: resultado.motivo };

    // La condición del UPDATE es la que hace único el uso de un código aunque
    // dos peticiones lleguen a la vez con el mismo número.
    const consumido = db
      .prepare(
        `UPDATE users SET totp_last_step = ?
          WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
      )
      .run(resultado.paso, userId, resultado.paso).changes;
    if (consumido !== 1) return { ok: false, motivo: 'reutilizado' };
    return { ok: true, via: 'totp' };
  }

  // Si no son dígitos, se prueba como código de respaldo.
  const normalizado = normalizarRespaldo(codigo);
  if (normalizado.length !== LARGO_RESPALDO) return { ok: false, motivo: 'invalido' };
  const gastado = db
    .prepare(
      `UPDATE two_factor_recovery_codes SET used_at = ?, used_ip = ?
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    )
    .run(iso(now), ip, userId, hashCodigo(normalizado)).changes;
  if (gastado !== 1) return { ok: false, motivo: 'invalido' };
  return { ok: true, via: 'respaldo', codigosRestantes: codigosDisponibles(userId, db) };
}

/** Comprobación suelta (fuera de una transacción mayor), para las rutas. */
export function exigirCodigo(usuario, codigo, { ip = null, now = Date.now() } = {}) {
  const db = getDb();
  const resultado = inTransaction(() => comprobarCodigo(db, usuario.id, codigo, { ip, now }));
  if (resultado.ok) return resultado;
  if (resultado.motivo === 'ilegible') throw errorSecretoIlegible();
  if (resultado.motivo === 'no_activa') {
    throw badRequest('Esta cuenta no tiene la verificación en dos pasos activa.', null, 'dos_factores_no_activa');
  }
  throw errorCodigoInvalido(resultado.motivo);
}

// ---------------------------------------------------------------------------
// Desafíos de acceso
// ---------------------------------------------------------------------------

function hashDesafio(token) {
  return crypto.createHmac('sha256', config.secrets.twoFactor).update(`desafio:${token}`).digest('hex');
}

export function crearDesafio(usuario, { ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  const token = randomToken(32);
  const ahoraIso = iso(now);

  inTransaction(() => {
    // Solo vale el último: pedir el acceso otra vez invalida el anterior, así
    // que una pantalla olvidada a medias no deja un desafío vivo por ahí.
    db.prepare('UPDATE two_factor_challenges SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL').run(
      ahoraIso,
      usuario.id,
    );
    db.prepare(
      `INSERT INTO two_factor_challenges (id, user_id, token_hash, created_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      usuario.id,
      hashDesafio(token),
      ahoraIso,
      iso(now + config.twoFactor.desafioTtlSeconds * 1000),
      ip,
      userAgent ? String(userAgent).slice(0, 300) : null,
    );
  });

  return { token, expiresInSeconds: config.twoFactor.desafioTtlSeconds };
}

const desafioInvalido = () =>
  unauthorized(
    'Este acceso caducó o ya se usó. Vuelve a escribir tu correo y tu contraseña.',
    'dos_factores_desafio_invalido',
  );

/**
 * Resuelve el segundo paso.
 * @returns {{ok:true, userId:string, via:string, codigosRestantes?:number}}
 */
export function resolverDesafio(token, codigo, { ip = null, now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);

  // La transacción decide qué pasó y lo escribe; el error se lanza después, ya
  // fuera. Lanzarlo dentro deshacía la transacción entera y con ella el
  // contador de intentos: el desafío admitía códigos incorrectos sin fin.
  const resultado = inTransaction(() => {
    const desafio = db.prepare('SELECT * FROM two_factor_challenges WHERE token_hash = ?').get(hashDesafio(token || ''));
    if (!desafio || desafio.consumed_at || desafio.expires_at <= ahoraIso) return { estado: 'desafio_invalido' };
    if (desafio.attempts >= config.twoFactor.maximoIntentos) {
      db.prepare('UPDATE two_factor_challenges SET consumed_at = ? WHERE id = ?').run(ahoraIso, desafio.id);
      return { estado: 'desafio_invalido' };
    }

    const comprobacion = comprobarCodigo(db, desafio.user_id, codigo, { ip, now });
    if (comprobacion.ok) {
      db.prepare('UPDATE two_factor_challenges SET consumed_at = ? WHERE id = ?').run(ahoraIso, desafio.id);
      return {
        estado: 'ok',
        userId: desafio.user_id,
        via: comprobacion.via,
        codigosRestantes: comprobacion.codigosRestantes,
      };
    }

    const intentos = db
      .prepare('UPDATE two_factor_challenges SET attempts = attempts + 1 WHERE id = ? RETURNING attempts')
      .get(desafio.id).attempts;
    const agotado = intentos >= config.twoFactor.maximoIntentos;
    if (agotado) {
      db.prepare('UPDATE two_factor_challenges SET consumed_at = ? WHERE id = ?').run(ahoraIso, desafio.id);
    }
    audit.record({
      actor: { id: desafio.user_id },
      action: 'dos_factores.codigo_fallido',
      entityType: 'user',
      entityId: desafio.user_id,
      metadata: { motivo: comprobacion.motivo, intentos, agotado },
      ip,
      db,
    });
    return { estado: 'fallo', motivo: comprobacion.motivo, agotado };
  });

  if (resultado.estado === 'ok') {
    return { ok: true, userId: resultado.userId, via: resultado.via, codigosRestantes: resultado.codigosRestantes };
  }
  if (resultado.estado === 'desafio_invalido') throw desafioInvalido();
  if (resultado.motivo === 'ilegible') throw errorSecretoIlegible();
  if (resultado.agotado) {
    throw tooManyRequests(
      'Demasiados códigos incorrectos. Vuelve a escribir tu correo y tu contraseña para empezar de nuevo.',
      { retryAfterSeconds: 0 },
    );
  }
  throw errorCodigoInvalido(resultado.motivo);
}

/** Borra los desafíos vencidos. La limpieza periódica la llama. */
export function purgarDesafios(now = Date.now()) {
  return getDb()
    .prepare('DELETE FROM two_factor_challenges WHERE expires_at <= ?')
    .run(iso(now)).changes;
}

// ---------------------------------------------------------------------------
// Aviso por correo
// ---------------------------------------------------------------------------

const TEXTOS_DE_AVISO = {
  activada: {
    asunto: 'Activaste la verificación en dos pasos',
    lineas: [
      'Desde ahora, entrar a tu cuenta pide también el código de tu aplicación de autenticación.',
      'Guarda tus códigos de respaldo en un lugar seguro: son la única forma de entrar si pierdes el teléfono.',
    ],
  },
  desactivada: {
    asunto: 'Desactivaste la verificación en dos pasos',
    lineas: [
      'Tu cuenta vuelve a entrar solo con la contraseña.',
      'Si no fuiste tú, cambia tu contraseña ahora mismo y avisa en recepción.',
    ],
  },
  desactivada_admin: {
    asunto: 'La administración quitó tu verificación en dos pasos',
    lineas: [
      'Tu cuenta vuelve a entrar solo con la contraseña. Normalmente esto se hace cuando alguien pierde el teléfono.',
      'Vuelve a activarla en cuanto puedas desde «Seguridad» en tu cuenta.',
      'Si no lo pediste, avisa en recepción.',
    ],
  },
};

function avisarPorCorreo(usuario, tipo, { ip = null, now = Date.now() } = {}) {
  if (!config.correo.enabled || !usuario?.email) return;
  const textos = TEXTOS_DE_AVISO[tipo];
  if (!textos) return;

  const cuando = `Ocurrió el ${momento(now)}${ip ? ` desde la dirección ${ip}` : ''}.`;
  const lineas = [...textos.lineas, cuando];

  despuesDeResponder(
    () =>
      enviarCorreo({
        para: usuario.email,
        asunto: `${textos.asunto} · ${config.brandShort}`,
        texto: [saludo(usuario), '', ...lineas.flatMap((l) => [l, ''])].join('\n').trimEnd(),
        html: envolverHtml([escaparHtml(saludo(usuario)), ...lineas.map(escaparHtml)]),
      }),
    'No se pudo enviar el aviso de verificación en dos pasos',
  );
}

export { esperarTareas } from '../lib/tareasDiferidas.js';

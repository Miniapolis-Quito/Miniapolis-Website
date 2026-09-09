/**
 * Construcción del archivo `.pkpass` que entiende Apple Wallet.
 *
 * Un pase es un ZIP con tres cosas dentro: el contenido (`pass.json` y las
 * imágenes), un `manifest.json` con el SHA-1 de cada archivo, y la firma
 * PKCS#7 de ese manifiesto. Si algo no cuadra, el teléfono se niega a abrirlo
 * sin decir por qué, así que aquí todo se hace explícito.
 *
 * No hay dependencias: el ZIP se escribe a mano —son cabeceras sencillas y sin
 * comprimir, que es lo que Apple acepta— y la firma la hace `openssl`, que es
 * la única pieza de criptografía que Node no trae (no sabe firmar en PKCS#7).
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Tabla del CRC-32, que es lo que el formato ZIP usa para comprobar cada archivo. */
const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[i] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos) {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Arma un ZIP sin comprimir con los archivos dados.
 * @param {Array<{nombre: string, datos: Buffer}>} archivos
 */
export function crearZip(archivos) {
  const locales = [];
  const central = [];
  let desplazamiento = 0;

  for (const { nombre, datos } of archivos) {
    const nombreBytes = Buffer.from(nombre, 'utf8');
    const suma = crc32(datos);

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0); // firma de cabecera local
    cabecera.writeUInt16LE(20, 4); // versión necesaria
    cabecera.writeUInt16LE(0, 6); // sin banderas
    cabecera.writeUInt16LE(0, 8); // método 0: guardado tal cual
    cabecera.writeUInt16LE(0, 10); // hora
    cabecera.writeUInt16LE(0x21, 12); // fecha (1980-01-01: un pase no tiene fecha propia)
    cabecera.writeUInt32LE(suma, 14);
    cabecera.writeUInt32LE(datos.length, 18);
    cabecera.writeUInt32LE(datos.length, 22);
    cabecera.writeUInt16LE(nombreBytes.length, 26);
    cabecera.writeUInt16LE(0, 28);
    locales.push(cabecera, nombreBytes, datos);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0); // firma de entrada del índice
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0, 8);
    entrada.writeUInt16LE(0, 10);
    entrada.writeUInt16LE(0, 12);
    entrada.writeUInt16LE(0x21, 14);
    entrada.writeUInt32LE(suma, 16);
    entrada.writeUInt32LE(datos.length, 20);
    entrada.writeUInt32LE(datos.length, 24);
    entrada.writeUInt16LE(nombreBytes.length, 28);
    entrada.writeUInt32LE(desplazamiento, 42);
    central.push(entrada, nombreBytes);

    desplazamiento += cabecera.length + nombreBytes.length + datos.length;
  }

  const indice = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); // firma del final del índice
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(indice.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([...locales, indice, fin]);
}

/** El manifiesto es el SHA-1 de cada archivo del pase; es lo que se firma. */
export function crearManifiesto(archivos) {
  const manifiesto = {};
  for (const { nombre, datos } of archivos) {
    manifiesto[nombre] = crypto.createHash('sha1').update(datos).digest('hex');
  }
  return manifiesto;
}

/**
 * Firma el manifiesto en PKCS#7 separado, que es lo que Apple espera.
 *
 * Node no sabe hacer PKCS#7, así que se delega en `openssl`. Los materiales
 * pasan por archivos temporales con permisos de solo-dueño y se borran al
 * terminar, pase lo que pase.
 */
export function firmarManifiesto(manifiesto, { certificate, key, keyPassword, wwdrCertificate }) {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'rhe-pase-'));
  const ruta = (nombre) => path.join(carpeta, nombre);
  try {
    writeFileSync(ruta('manifest.json'), manifiesto, { mode: 0o600 });
    writeFileSync(ruta('cert.pem'), certificate, { mode: 0o600 });
    writeFileSync(ruta('key.pem'), key, { mode: 0o600 });
    writeFileSync(ruta('wwdr.pem'), wwdrCertificate, { mode: 0o600 });

    const argumentos = [
      'smime', '-binary', '-sign',
      '-certfile', ruta('wwdr.pem'),
      '-signer', ruta('cert.pem'),
      '-inkey', ruta('key.pem'),
      '-in', ruta('manifest.json'),
      '-out', ruta('signature'),
      '-outform', 'DER',
      '-passin', keyPassword ? `pass:${keyPassword}` : 'pass:',
    ];

    try {
      execFileSync('openssl', argumentos, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      const detalle = (error.stderr?.toString() || error.message).trim().split('\n').slice(-2).join(' ');
      throw new Error(
        `No se pudo firmar el pase de Apple: ${detalle}. ` +
          'Revisa el certificado del Pass Type ID, su clave y el certificado intermedio de Apple (WWDR).',
      );
    }

    return readFileSync(ruta('signature'));
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

/**
 * Empaqueta un pase completo.
 * @param {object} pase contenido de `pass.json`
 * @param {Array<{nombre: string, datos: Buffer}>} imagenes iconos y logotipos
 * @param {object} credenciales certificado, clave y certificado de Apple
 */
export function construirPase(pase, imagenes, credenciales) {
  const contenido = [
    { nombre: 'pass.json', datos: Buffer.from(JSON.stringify(pase, null, 2), 'utf8') },
    ...imagenes,
  ];

  const manifiesto = Buffer.from(JSON.stringify(crearManifiesto(contenido), null, 2), 'utf8');
  const firma = firmarManifiesto(manifiesto, credenciales);

  return crearZip([
    ...contenido,
    { nombre: 'manifest.json', datos: manifiesto },
    { nombre: 'signature', datos: firma },
  ]);
}

export default construirPase;

/**
 * Entorno para las pruebas de los pases de cartera.
 *
 * Las credenciales de verdad las emiten Apple y Google, así que aquí se generan
 * unas equivalentes: un certificado autofirmado para firmar el pase y dos
 * claves para los tokens. La mecánica que se ejercita es exactamente la misma;
 * lo único que cambia es quién firma.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const carpeta = mkdtempSync(path.join(tmpdir(), 'rhe-cartera-'));
const ruta = (nombre) => path.join(carpeta, nombre);

function certificadoAutofirmado(nombre, comun) {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', ruta(`${nombre}-key.pem`), '-out', ruta(`${nombre}.pem`),
    '-days', '2', '-nodes', '-subj', `/CN=${comun}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

certificadoAutofirmado('pase', 'Pase de prueba');
certificadoAutofirmado('wwdr', 'Intermedio de prueba');

const apns = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const googleKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** La clave pública de Google se exporta para poder verificar el JWT firmado. */
export const CLAVE_PUBLICA_GOOGLE = googleKeys.publicKey;
export const CARPETA_CREDENCIALES = carpeta;

process.env.PUBLIC_URL = 'https://entradas.example';
process.env.APPLE_PASS_TYPE_ID = 'pass.ec.prueba.entradas';
process.env.APPLE_TEAM_ID = 'EQUIPO1234';
process.env.APPLE_PASS_CERTIFICATE = ruta('pase.pem');
process.env.APPLE_PASS_KEY = ruta('pase-key.pem');
process.env.APPLE_WWDR_CERTIFICATE = ruta('wwdr.pem');
process.env.APPLE_APNS_KEY_ID = 'CLAVEAPNS1';
process.env.APPLE_APNS_KEY = apns.privateKey;
// Los avisos van a un APNs de mentira que la prueba levanta en esta dirección.
process.env.APPLE_APNS_HOST = '127.0.0.1:38443';
export const PUERTO_APNS = 38443;
export const CERTIFICADO_APNS = { cert: ruta('pase.pem'), key: ruta('pase-key.pem') };
process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000000000000';
process.env.GOOGLE_WALLET_SERVICE_ACCOUNT = 'pases@proyecto.iam.gserviceaccount.com';
process.env.GOOGLE_WALLET_PRIVATE_KEY = googleKeys.privateKey;

// El APNs de mentira se levanta con un certificado autofirmado; sin esto el
// cliente HTTP/2 lo rechazaría. Vale solo dentro de este proceso de prueba.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

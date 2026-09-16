/** Capturas de pantalla para revisar la identidad. No entra en ninguna suite. */
import '../env-espera.js';
import { chromium } from 'playwright';
import { levantarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';

const DESTINO = process.env.CAPTURAS_DIR || '/tmp/capturas';
const B = await levantarServidor();
await sembrarUsuarios();
const navegador = await chromium.launch({ args: ['--no-sandbox'] });

async function pestana(w, h) {
  const c = await navegador.newContext({ viewport: { width: w, height: h } });
  return c.newPage();
}
async function entrar(p, email, clave, destino) {
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.fill('#entrar-email', email);
  await p.fill('#entrar-password', clave);
  await p.click('#form-entrar button[type=submit]');
  await p.waitForURL(`**${destino}`, { timeout: 15000 });
}

const anon = await pestana(1280, 900);
await anon.goto(B, { waitUntil: 'networkidle' });
await anon.waitForTimeout(900);
await anon.screenshot({ path: `${DESTINO}/01-entrar.png` });

const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await movil.newPage();
await mp.goto(B, { waitUntil: 'networkidle' });
await mp.waitForTimeout(900);
await mp.screenshot({ path: `${DESTINO}/02-entrar-movil.png` });

await anon.goto(`${B}/no-existe`, { waitUntil: 'networkidle' });
await anon.waitForTimeout(600);
await anon.screenshot({ path: `${DESTINO}/03-404.png` });

const admin = await pestana(1280, 900);
await entrar(admin, 'master@pista.ec', CLAVES.master, '/admin');
await admin.waitForSelector('#metricas .tarjeta', { timeout: 15000 });
await admin.waitForTimeout(900);
await admin.screenshot({ path: `${DESTINO}/04-admin.png` });

const staff = await pestana(1280, 900);
await entrar(staff, 'staff@pista.ec', CLAVES.staff, '/escanear');
await staff.waitForTimeout(900);
await staff.screenshot({ path: `${DESTINO}/05-escaner.png` });

const cli = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const cp = await cli.newPage();
await entrar(cp, 'cliente@pista.ec', CLAVES.cliente, '/app');
await cp.waitForTimeout(1200);
await cp.screenshot({ path: `${DESTINO}/06-cliente-movil.png` });

await navegador.close();
process.exit(0);

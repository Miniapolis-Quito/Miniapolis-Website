/**
 * Piezas compartidas por las pruebas en navegador que no son dependencia del
 * proyecto: cargar Playwright y fabricar una cámara que enseña un QR.
 */
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

/** Playwright no es dependencia del proyecto: si falta, se dice cómo instalarlo. */
export async function cargarNavegador() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    process.stderr.write(
      '\nEsta prueba necesita Playwright, que no es dependencia del proyecto:\n\n' +
        '  npm install --no-save playwright\n' +
        '  npx playwright install chromium\n\n',
    );
    process.exit(1);
  }
}

/**
 * Escribe un vídeo Y4M (I420 sin comprimir, que es lo que acepta la cámara
 * falsa de Chromium) con el QR centrado sobre fondo blanco.
 */
export function grabarQr(texto, ruta, { ancho = 640, alto = 480, cuadros = 10 } = {}) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const modulos = qr.modules.size;
  const margen = 4;
  const escala = Math.floor(Math.min(ancho, alto) / (modulos + margen * 2));
  const lado = escala * (modulos + margen * 2);
  const x0 = Math.floor((ancho - lado) / 2);
  const y0 = Math.floor((alto - lado) / 2);

  const luma = Buffer.alloc(ancho * alto, 255);
  for (let fila = 0; fila < modulos; fila += 1) {
    for (let col = 0; col < modulos; col += 1) {
      if (!qr.modules.data[fila * modulos + col]) continue;
      const px = x0 + (col + margen) * escala;
      const py = y0 + (fila + margen) * escala;
      for (let dy = 0; dy < escala; dy += 1) {
        luma.fill(0, (py + dy) * ancho + px, (py + dy) * ancho + px + escala);
      }
    }
  }
  // Croma neutro: la imagen es en blanco y negro.
  const croma = Buffer.alloc((ancho / 2) * (alto / 2), 128);

  const partes = [Buffer.from(`YUV4MPEG2 W${ancho} H${alto} F30:1 Ip A1:1 C420mpeg2\n`)];
  for (let i = 0; i < cuadros; i += 1) partes.push(Buffer.from('FRAME\n'), luma, croma, croma);
  writeFileSync(ruta, Buffer.concat(partes));
}

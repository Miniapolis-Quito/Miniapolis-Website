# Pruebas de extremo a extremo

Dos recorridos en un navegador real. Ninguno forma parte de `npm test`, porque
necesitan un navegador y eso no es una dependencia del proyecto.

- **`flujo-completo.mjs`** — un cliente se registra, el máster le vende un pack,
  el personal escanea, y se comprueba que el saldo del cliente cambia **en vivo,
  sin recargar la página**.
- **`ficha-cliente.mjs`** — la ficha del panel máster: abrirla desde el listado,
  corregir un dato, acreditar entradas de cortesía, anular un consumo cobrado
  por error, y verificar que todo queda en la actividad, que la contabilidad
  cuadra y que se lee bien en un teléfono. Necesita los datos de demostración
  (`npm run seed`).

```bash
npm install --no-save playwright
npx playwright install chromium

# En otra terminal, con la base recién creada:
rm -f data/tickets.db* && npm start

npm run test:e2e          # flujo completo
npm run test:e2e:ficha    # ficha del cliente (requiere npm run seed)
```

Variables opcionales:

- `BASE_URL` — dirección del servidor (por defecto `http://localhost:3000`).
- `MASTER_EMAIL` / `MASTER_PASSWORD` — credenciales del máster inicial.
- `CHROMIUM_PATH` — ruta a un Chromium concreto, si Playwright no lo encuentra.
- `CAPTURAS` — carpeta donde guardar capturas de pantalla de cada paso.
- `CLIENTE_DEMO` — correo del cliente sobre el que trabaja `ficha-cliente.mjs`.

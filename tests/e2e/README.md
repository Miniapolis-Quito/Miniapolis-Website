# Prueba de extremo a extremo

`flujo-completo.mjs` recorre el sistema en un navegador real: un cliente se
registra, el máster le vende un pack, el personal escanea, y se comprueba que
el saldo del cliente cambia **en vivo, sin recargar la página**.

No forma parte de `npm test` porque necesita un navegador, que no es una
dependencia del proyecto.

```bash
npm install --no-save playwright
npx playwright install chromium

# En otra terminal, con la base recién creada:
rm -f data/tickets.db* && npm start

npm run test:e2e
```

Variables opcionales:

- `BASE_URL` — dirección del servidor (por defecto `http://localhost:3000`).
- `MASTER_EMAIL` / `MASTER_PASSWORD` — credenciales del máster inicial.
- `CHROMIUM_PATH` — ruta a un Chromium concreto, si Playwright no lo encuentra.
- `CAPTURAS` — carpeta donde guardar capturas de pantalla de cada paso.

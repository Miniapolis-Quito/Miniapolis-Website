/**
 * Configuración de entorno para las pruebas.
 *
 * Vive en su propio módulo y se importa antes que cualquier otro: en ESM todas
 * las importaciones de un archivo se evalúan antes que su código, así que
 * asignar `process.env` en el cuerpo de un módulo que ya importó la aplicación
 * llega tarde — la configuración se leyó antes.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_FILE = ':memory:';
process.env.ACCESS_TOKEN_SECRET = 'prueba-access-secret-suficientemente-largo-1';
process.env.REFRESH_TOKEN_SECRET = 'prueba-refresh-secret-suficientemente-largo-1';
process.env.QR_SECRET = 'prueba-qr-secret-suficientemente-largo-000001';
process.env.LOG_LEVEL = 'silent';
process.env.MASTER_EMAIL = '';
process.env.MASTER_PASSWORD = '';
// Sin archivo .env: las pruebas no deben depender de la configuración local.
process.env.ENV_FILE = '/dev/null';
// Cada archivo de prueba fija lo que necesita; por defecto no hay espera entre
// consumos, para no depender del reloj.
process.env.REDEEM_COOLDOWN_SECONDS ??= '0';

/**
 * Variante de entorno que simula el caso normal en un servidor: el proceso
 * corre en UTC mientras la pista vive en otra zona horaria.
 */
process.env.TZ = 'UTC';

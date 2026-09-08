/**
 * Variante de entorno que simula la instalación real: la aplicación detrás de
 * un proxy inverso que termina el TLS y vive en la misma máquina.
 */
process.env.TRUST_PROXY = 'true';
process.env.TRUSTED_PROXY_IPS = '127.0.0.1,::1';

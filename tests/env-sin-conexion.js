/**
 * Variante de entorno para las lecturas hechas sin conexión: con tiempo de
 * espera entre consumos, porque es la barrera que más cambia cuando la hora
 * que cuenta es la de la lectura y no la de llegada.
 */
process.env.REDEEM_COOLDOWN_SECONDS = '30';
process.env.OFFLINE_SCAN_MAX_HOURS = '24';

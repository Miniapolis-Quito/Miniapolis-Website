/** Normalización de texto para buscar sin depender de tildes ni mayúsculas. */

/**
 * Pasa un texto a su forma comparable: minúsculas, sin tildes y con los
 * espacios colapsados. "María Chasís" y "maria chasis" acaban siendo iguales.
 *
 * El LIKE de SQLite solo ignora mayúsculas en ASCII, así que sin esto buscar
 * "maria" no encontraría a "María" — que en Ecuador es la mitad del padrón.
 */
export function plegar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    // Se escriben como escapes: los caracteres combinantes literales son
    // invisibles y cualquier editor podría destrozarlos sin que se note.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de búsqueda de un usuario: nombre, correo y teléfono en un solo campo. */
export function textoBusquedaUsuario({ fullName, email, phone }) {
  return plegar([fullName, email, phone].filter(Boolean).join(' '));
}

/**
 * Prepara un término para un LIKE, escapando los comodines de SQLite.
 * Sin esto, buscar "%" devolvería todas las filas.
 */
export function patronLike(termino) {
  const plegado = plegar(termino).replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${plegado}%`;
}

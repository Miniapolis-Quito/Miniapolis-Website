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

/** Un término formado solo por dígitos y separadores de teléfono. */
const SOLO_TELEFONO = /^[+()\s.\d-]+$/;

/**
 * Prepara un término para un LIKE, escapando los comodines de SQLite.
 * Sin esto, buscar "%" devolvería todas las filas.
 *
 * Los teléfonos se guardan sin separadores, pero en el mostrador se teclean
 * como cada quien los tiene anotados ("099 111 2233", "+593-99-111-2233"), así
 * que en un término que solo trae dígitos y separadores estos se descartan.
 */
export function patronLike(termino) {
  let plegado = plegar(termino);
  if (SOLO_TELEFONO.test(plegado)) plegado = plegado.replace(/[()\s.-]/g, '');
  return `%${plegado.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

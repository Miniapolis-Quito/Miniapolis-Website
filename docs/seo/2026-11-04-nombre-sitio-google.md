# Corrección del Site Name en Google Search — Miniapolis #3 Ecuador

Fecha: 4 de noviembre de 2026.
Dominio: <https://racinghobbiesec.com/>
Repositorio: <https://github.com/Miniapolis-Quito/Miniapolis-Website>

## Contexto y diagnóstico del problema

En los resultados de búsqueda de Google, sobre la URL `https://racinghobbiesec.com`, aparecía el nombre de sitio genérico del dominio (`racinghobbiesec.com`) en lugar del nombre de marca preferido: **Miniapolis #3 Ecuador**.

### Causa raíz
1. **Fallback por falta de confianza algorítmica**: Según la [documentación oficial de Google Search Central sobre Nombres de Sitio](https://developers.google.com/search/docs/appearance/site-names), cuando los sistemas automatizados de Google no logran determinar con suficiente certeza el nombre de sitio a partir del marcado y las señales en la página, recurren como valor predeterminado al nombre del dominio (`racinghobbiesec.com`).
2. **Discrepancia geográfica y de sufijo**: El dominio `racinghobbiesec.com` contiene el sufijo `ec` (Ecuador). El marcado anterior declaraba únicamente `name: "Miniápolis #3"` y un único nombre alternativo `"Miniápolis"`. Al no incluir `Ecuador` ni la variante sin tilde `Miniapolis #3 Ecuador`, el algoritmo no asociaba inequívocamente la entidad con el dominio geográfico ecuatoriano.
3. **Ausencia de variantes en `alternateName`**: Google Search admite y recomienda una matriz de nombres alternativos (`alternateName: string[]`) en el objeto `WebSite` para facilitar la resolución de entidades (incluyendo variantes con y sin tilde, nombres cortos y el propio nombre de dominio).
4. **Coherencia en la portada**: Google exige que el nombre de sitio coincida de forma destacada y visible con los elementos visibles de la portada (etiquetas `alt` de logos en cabecera/pie, texto explicativo y pie de página).

## Cambios implementados

1. **`site.config.js`**:
   - `name`: actualizado a `'Miniapolis #3 Ecuador'`.
   - `alternateName`: configurado como un arreglo exhaustivo con variantes con y sin tilde y el dominio de respaldo:
     ```javascript
     alternateName: Object.freeze([
       'Miniápolis #3 Ecuador',
       'Miniápolis #3',
       'Miniapolis #3',
       'Miniápolis',
       'Miniapolis',
       'racinghobbiesec.com',
     ]);
     ```
   - Títulos de páginas públicas actualizados con el prefijo consistente `Miniapolis #3 Ecuador`.
2. **`scripts/generar-seo.js`**:
   - Inclusión de `alternateName` en la entidad `Organization` y en el objeto `WebSite`.
   - Etiqueta `og:image:alt` adaptada dinámicamente con `site.name`.
3. **`public/manifest.webmanifest`**:
   - Nombre de la aplicación actualizado a `Miniapolis #3 Ecuador — Entradas`.
4. **`public/index.html`, `posiciones.html`, `privacidad.html`**:
   - Generados mediante `scripts/generar-seo.js` con el nuevo bloque Schema.org (JSON-LD), `og:site_name`, `<title>` y metadatos sociales.
   - Textos visibles y atributos `alt`/`aria-label` de la marca actualizados a `Miniapolis #3 Ecuador`.
5. **`tests/seo.test.js`**:
   - Nueva prueba unitaria añadida para asegurar la presencia y exactitud del objeto `WebSite` en JSON-LD, la matriz de alternativas y las etiquetas Open Graph.

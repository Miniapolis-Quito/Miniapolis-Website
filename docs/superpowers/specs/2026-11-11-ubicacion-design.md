# Ubicación de Miniápolis #3

## Intento y alcance
Añadir una sección «Ubicación» después de Horarios para que quien prepara su visita encuentre el complejo y abra la ubicación exacta proporcionada por el usuario: https://maps.app.goo.gl/Wi4JeSLzAYugZQts9.

Dirección: Avenida de los Granados y calle De los Colimes, frente a la Universidad de Las Américas (UDLA), Quito, Ecuador. Lugar: Complejo de Radiocontrol Miniápolis #3, sector norte de Quito. El enlace resuelve al punto -0.1694464, -78.47347, CID 5824095976523233285.

## Diseño y restricciones
Reutilizar encabezados, numeración correlativa, tokens, tipografías, botones y animaciones GSAP de la portada. Panel de mapa junto a la dirección en escritorio; una columna en móvil. Enlaces en cabecera y pie. La dirección y el enlace externo siguen disponibles sin JavaScript, GSAP o mapa. No añadir dependencias, estilos HTML en línea ni cambiar horarios o contenido ajeno.

## Enfoques
Un enlace aislado no muestra el lugar dentro de la página. Un plano dibujado añade mantenimiento y puede representar mal las calles. Se implementa un mapa Google integrado con el CID exacto y carga diferida, acompañado de la dirección y el enlace original. Esta es una decisión de implementación dentro del alcance solicitado. La CSP permite únicamente el origen necesario para el marco; scripts y conexiones del documento conservan sus restricciones. Actualizar la información de privacidad para mencionar el mapa.

## Verificación
Comprobar el marco real, destino externo, teclado, navegación, animaciones, ausencia de desbordamiento en 320–375 px, movimiento reducido y fallo de GSAP. Ejecutar npm test, preparación de Pages y auditoría SEO antes de crear y fusionar el PR autorizado.

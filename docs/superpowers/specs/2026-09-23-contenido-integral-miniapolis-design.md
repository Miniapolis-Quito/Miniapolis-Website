# Contenido integral de Miniápolis — Diseño

## Objetivo

Integrar en la portada del repositorio toda la información pública de la página fuente de Miniápolis, conservando la identidad visual, las imágenes oficiales, la navegación de acceso y el motor de animaciones por scroll que ya existen en `Miniapolis-Website`.

## Alcance validado

- La portada conservará sus cuatro escenas actuales: salida, tablero, recta y boxes.
- El contenido nuevo aparecerá después de la sección visual de la pista y antes del acceso, para que la historia pase de experiencia de conducción a información práctica y finalmente a conversión.
- Se trasladarán los datos de la fuente: complejo indoor, disciplinas, características de pista, horarios, mejores tiempos, próximos eventos, bloque “Muy pronto”, promociones de Racing Hobbies y cierre “Más que una pista, una comunidad”.
- Se añadirá una pantalla pública `/posiciones` con tabla de campeonato, próxima carrera y galería, porque la fuente la ofrece como una experiencia independiente.
- Se usarán las imágenes oficiales ya presentes en `public/images`; no se copiarán referencias de la fuente que apuntan a archivos inexistentes ni se introducirán CDNs.

## Arquitectura

La portada seguirá siendo HTML estático servido desde `public/`, con reglas específicas en `public/css/portada.css`. Los bloques informativos tendrán nombres de escena propios (`detalle`, `horario`, `records`, `eventos`) y se registrarán en `public/js/portada.js` para reutilizar el mismo sistema de progreso, revelado y respeto a `prefers-reduced-motion`. La pantalla de posiciones reutilizará `styles.css` y una hoja `posiciones.css` pequeña, sin alterar el flujo autenticado.

## Experiencia y contenido

1. El hero mantiene “Ven a rodar” y el CTA de acceso, con una acción secundaria hacia `#pista`.
2. La pista incorpora una ficha rápida del complejo: 44 × 22,5 m, 1.000 m², siete trazados, aproximadamente 172 m, contador compatible con AMB/MyLaps, boxes para 60 pilotos, compresor, tarima para 17 pilotos, parqueadero cubierto para 200 vehículos, snack bar y baños.
3. Las disciplinas se presentan como cinco tarjetas breves: asfalto, crawler, rally, drones y simuladores/FPV.
4. Horarios, récords y eventos se muestran en paneles escaneables con CTA de posiciones y enlaces accionables.
5. Las promociones preservan la copy de la fuente y enlazan a `https://racinghobbiesec.com` sin inventar inventario ni precios.
6. La tabla pública conserva los datos de temporada julio-agosto 2026, líderes, clasificación, próxima carrera y una galería construida con imágenes oficiales disponibles.

## Accesibilidad y rendimiento

- Cada imagen declara `width`, `height` y `alt`.
- Toda animación decorativa se desactiva o queda estática con `prefers-reduced-motion: reduce`.
- Los enlaces externos llevan `target="_blank"` y `rel="noreferrer"`.
- No se añaden estilos inline, dependencias externas ni fuentes remotas.
- El contenido completo se mantiene en el DOM aunque el motor de movimiento no esté disponible.

## Criterios de aceptación

- La portada contiene cada bloque de contenido listado en “Experiencia y contenido”.
- `/posiciones` responde con la tabla y enlaza de vuelta a la portada.
- Todas las rutas de imágenes usadas existen.
- El motor conserva el comportamiento de las escenas existentes y revela los nuevos bloques sin ocultarlos en modo estático.
- Las pruebas estáticas de contenido, rutas, accesibilidad y navegación pasan.
- La suite del proyecto se ejecuta; cualquier limitación de entorno queda separada de la validación de la UI.

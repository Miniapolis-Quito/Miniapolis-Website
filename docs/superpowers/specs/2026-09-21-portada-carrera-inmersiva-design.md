# Portada inmersiva: el scroll es una vuelta al circuito

## Objetivo

Reconstruir la portada (`public/index.html`) para que recorrerla se sienta como dar una vuelta al circuito: cada gesto de scroll mueve fotos, textos y capas con una coreografía tomada de las carreras reales (semáforo de salida, luces de cambio, cuentakilómetros, recta lateral, bandera a cuadros, boxes). Visualmente minimalista, sin decoración genérica ni texto de relleno. Las fotografías se ven a máxima calidad y con sus colores reales.

## Restricciones acordadas

- Se conserva la paleta: negro de marca, verde `#3dfe40` y el rojo/blanco de los bordillos de las fotos.
- **La mira del puntero conserva su apariencia** (`.entrada__mira`). Cambia solo a qué reacciona: únicamente a elementos clicables, no a fotos.
- **Solo lo clicable tiene hover**: `a`, `button`, pestañas (`[role="tab"]`), campos de formulario. Fotos, cifras y bloques no reaccionan al puntero.
- Alcance: solo `public/index.html`. `app.html`, `admin.html`, `scan.html` y el resto de la app no se tocan.
- No se inventa geometría del circuito ni escenas que no existan (regla heredada de `2026-09-21-mejora-visual-assets-pista-design.md`). Los indicadores de progreso son abstractos y lineales.
- El copy actual ya es breve y sin relleno: se conserva y solo se corrige el espaciado entre palabras (hoy «Ven a» se lee «Vena»). No se añaden frases nuevas.
- Los `id` de los formularios que usa `public/js/login.js` no cambian.
- La política de seguridad de contenido exige `script-src 'self'`: sin CDN ni scripts en línea.
- La ruta a Pages (`scripts/preparar-pages.js`) reescribe rutas absolutas del HTML; las `url()` de CSS y los `import` de JS usan rutas relativas.
- Quien pide menos movimiento recibe una página estática con todo visible.

## Decisiones cerradas con el usuario

1. El panorama del hero vuelve a la versión commiteada 3840×2160 (974 KB). La versión sin commit de 432 KB se descarta; queda copia en la carpeta temporal de la sesión.
2. La mira solo reacciona a elementos clicables.
3. Alcance limitado a la portada.
4. Se sigue de spec a plan e implementación sin revisión intermedia; el merge a `main` solo ocurre cuando el resultado, verificado con capturas, no deja nada por mejorar.

## Motor de movimiento (enfoque A: JS propio)

`public/js/portada-motor.js`. Sin dependencias. No secuestra el scroll: la página se desplaza de forma nativa y solo se suaviza lo que se pinta.

- Un único bucle `requestAnimationFrame`. Lee `window.scrollY`, lo suaviza (lerp) para dar inercia y calcula la **velocidad** normalizada (−1…1).
- Publica en `:root` las variables `--scroll` (0…1 de la página) y `--vel`.
- Cada escena se registra con su elemento y recibe su progreso local `--p` (0…1). Las escenas fijas (`position: sticky` dentro de un contenedor alto) calculan `p` sobre su recorrido; las demás, sobre su paso por la pantalla.
- Las posiciones de las escenas se miden una vez y al cambiar el tamaño, no en cada frame, para no forzar recálculos de layout.
- Solo se actualizan las escenas cercanas a la pantalla (`IntersectionObserver` con margen). El bucle se duerme cuando el scroll se ha asentado.
- `prefers-reduced-motion` (y `sinMovimiento()` de `movimiento.js`) desactiva el motor: no se registra nada, no se fija nada.
- Solo se animan `transform`, `opacity` y `clip-path`; `will-change` solo en la escena activa.

Se descartan CSS `animation-timeline` (soporte desigual entre navegadores, obligaría a mantener dos caminos) y GSAP vendorizado (100 KB de dependencia en un proyecto sin build).

## Escenas

### 1. Salida (hero)

- Al cargar: cinco luces rojas del semáforo de salida se encienden una a una (~180 ms entre cada una) sobre el panorama a brillo pleno, se apagan a la vez y el titular «Ven a rodar.» entra con máscara por línea. Es una animación por tiempo, no por scroll. Si el motor está desactivado, las luces no se muestran y el titular aparece ya en su sitio.
- El hero es una escena fija de ~180 vh. Con el scroll, el panorama avanza hacia el punto de fuga (escala 1 → ~1,35 con desplazamiento) y el titular sale hacia arriba con desvanecido.
- Se elimina la tarjeta inclinada con marco y brillo verde. La foto del auto pasa a un panel sin inclinación, con revelado por `clip-path` y un desplazamiento a distinta velocidad que el fondo.
- Para móvil se elige un encuadre vertical ya existente en el repositorio, tras inspeccionarlo visualmente, servido con `<source media>`.

### 2. Tablero (cifras)

- Fila de 10 luces de cambio, como las del volante, que se encienden con el progreso de la escena: verde del 1 al 6, rojo de bordillo del 7 al 10.
- Las tres cifras («400 m²», «1/10», «7 días») son cuentakilómetros: cada dígito es una columna que rueda hasta su valor final según `--p`. Prefijos y sufijos («1/», «m²», «días») son estáticos. Con motor desactivado se muestra el valor final.

### 3. La pista (recorrido horizontal)

- En pantallas ≥ 900 px la sección es fija (~400 vh) y el scroll vertical desplaza una fila de cuatro fotos en horizontal: curva ancha, hangar vertical, bordillo, ambiente. Cada foto se mueve a su ritmo, con su imagen interior en contramarcha (parallax) y entra con un corte diagonal por `clip-path` (chicane).
- Bajo la fila corre una línea de bordillo rojo y blanco (patrón CSS) que sirve de guía.
- Texto de la sección: se conservan «La pista.», «Rectas, curvas y asfalto.», «A tu ritmo.», «Una pista para sentir cada vuelta.» y la lista «Superficie / Asfalto real», «Recorrido / Rectas y curvas».
- En < 900 px y con movimiento reducido: apilado vertical, cada foto con revelado corto por `clip-path`.

### 4. Boxes (acceso)

- Una banda de bandera a cuadros (patrón `conic-gradient`) cruza la pantalla de lado a lado al entrar en la sección, ligada al scroll.
- El panel de acceso entra desde un lado con desaceleración, como un auto entrando a boxes. Pestañas, formularios y flujos no cambian.

### Transversal

- **Velocidad**: los titulares se inclinan (`skewY`) según `--vel` y las fotos dejan una estela en los bordes proporcional a `|--vel|`.
- **Cabecera**: se mantiene fija (`.entrada__barra`). La barra de progreso se conserva como línea fina con marcador; sigue siendo abstracta.
- **Hovers**: botón principal con barrido oblicuo y flecha que se adelanta; enlaces subrayados como huella de goma; pestañas conservan su indicador. Ningún otro elemento reacciona.

## Estructura de archivos

| Archivo | Cambio |
|---|---|
| `public/index.html` | Marcado nuevo; conserva `id` de formularios. Carga `portada.css`, `login.js`, `portada.js`. |
| `public/css/portada.css` | Nuevo. Todo el CSS de la portada. |
| `public/css/styles.css` | Se elimina el CSS específico de la portada (`.pagina-entrada`, `.entrada__*`) que deje de usarse. Los componentes compartidos (`.boton`, `.campo`, `.pestanas`, `.aviso`) se quedan. |
| `public/js/portada-motor.js` | Nuevo. Motor de scroll. |
| `public/js/portada.js` | Se reescribe: registra escenas, luces de salida, cuentakilómetros y mira. |
| `public/js/movimiento.js` | `revelarFiguras` deja de actuar sobre la portada (evita doble revelado). |
| `public/images/oficial/pista-circuito-panorama.webp` | Se restaura la versión de HEAD. |
| `tests/frontend.test.js` | Se reescriben los tests atados al diseño anterior. |

## Pruebas

Invariantes en lugar de nombres de clase:

1. La portada carga `portada.css`, `login.js` y `portada.js`; conserva los `id` que `login.js` necesita.
2. Todo `:hover` de `portada.css` apunta solo a elementos clicables (test que falla si un selector con `:hover` termina en algo que no sea `a`, `button`, `.boton`, `[role="tab"]`, `input`, `select`, `textarea`, `label` o una clase de enlace declarada).
3. `portada.js` sale antes de tocar el documento con movimiento reducido; `portada.css` deja todo visible bajo `prefers-reduced-motion: reduce`.
4. La mira mantiene su apariencia (`entrada__mira--segmento`, `entrada__mira-centro`) y solo se marca «sobre objetivo» en elementos clicables.
5. La cabecera permanece fija.
6. Todas las referencias a imágenes existen y cada `<img>` de la portada declara `width` y `height` (evita saltos de layout).
7. El copy no usa `·`, coordenadas decorativas ni identificadores artificiales.
8. Motor: pruebas unitarias del cálculo de progreso y de velocidad (funciones puras exportadas).

Se ejecutan además `npm test`, `npm run test:ui` y los flujos de login de las pruebas e2e.

## Verificación visual (criterio para el merge)

Con Playwright, en 1440×900 y 390×844, capturas en al menos 12 puntos del scroll (incluida la secuencia de salida y el cruce de la bandera) y comparación con las capturas del estado anterior. Se comprueba: fotos a brillo pleno y nítidas, ausencia de saltos o solapes, texto legible en cada punto, formulario funcional, sin desbordamiento horizontal en móvil, y que los frames largos no se disparan al recorrer la página. Solo si el resultado es sobresaliente se abre el PR y se hace el merge.

## Entrega

PR desde `codex/immersive-racing-rebuild` a `main`, CI en verde, merge. El merge dispara la publicación de GitHub Pages.

## Actualización tras integrar `origin/main` (#33)

Mientras se construía esta portada, `main` cambió la tipografía de todo el producto. Decisiones al integrarlo:

- **Tipografía:** titulares y cifras en Saira ancha (`--display`, `font-stretch` 116–125 %), texto en Sora; **interletraje 0** en todo (`tests/frontend.test.js` lo exige para `styles.css` y `tests/portada.test.js` para `portada.css`). Se retiró el tracking negativo del primer diseño.
- **Botones:** la portada usa el sistema compartido (chasis inclinado con estelas) con su primario verde; se retiró el barrido propio. `portada.css` solo añade hover a la acción de la cabecera y al enlace «Ver la pista».
- **Se descartan de #33** porque contradicen la regla «solo lo clicable tiene hover»: la respuesta al puntero sobre la foto del auto y el panel de acceso (inclinación, foco), los hovers de titulares y de fotos, y el test que los fijaba.
- `styles.css` se vuelve a extraer con el mismo filtro sobre la versión de `main`; las páginas que no son la portada coinciden píxel a píxel con `main`.

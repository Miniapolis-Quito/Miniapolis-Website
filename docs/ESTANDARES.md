# Manual Exhaustivo de Estándares: Diseño, Arquitectura y Calidad — Miniápolis

Este manual detalla los criterios técnicos, de diseño visual, accesibilidad y arquitectura que rigen todo el desarrollo de **Miniápolis**. Su lectura permite a cualquier agente o desarrollador entender el porqué de cada decisión y cómo extender el sistema sin degradar su consistencia ni su estética.

---

## 1. Filosofía de Diseño: Pit Lane Editorial

El diseño de Miniápolis se concibe como un **puesto de telemetría y cronometraje de automovilismo**:
- **Precisión técnica:** La información crucial (entradas restantes, tiempos de vuelta, identificadores de pack) domina visualmente con tipografía de alto impacto y números tabulares.
- **Líneas sobre cajas:** No se estructuran las pantallas apilando rectángulos grises genéricos. Un bloque se define por líneas de un píxel, aire generoso y ritmo tipográfico.
- **Contraste sin estridencias:** El lienzo es negro absoluto (`#000000`). Los datos resaltan en blanco de alto contraste (`#f4f6f3` / `#f3f7f4`), apoyados por un gris técnico (`#8b9296` / `#7e8d84`). El color verde de acento (`#93d241`) se reserva exclusivamente para lo que demanda atención: estados en vivo, acciones clave y datos de referencia.
- **Sin decoración gratuita:** No existen degradados arcoíris, sombras difuminadas que simulan relieve falso ni animaciones que retrasen la operativa.

---

## 2. Catálogo Completo de Tokens CSS

### 2.1. Colores y Superficies

```css
:root {
  /* Lienzo y profundidad */
  --fondo: #000000;         /* Lienzo negro puro */
  --fondo-2: #080b0c;       /* Superficie secundaria / pistas / fondos hundidos */
  --superficie: #0d1214;    /* Cajas técnicas / tarjetas principales */
  --superficie-2: #151c1e;  /* Superficies elevadas / hover de botones / modales */

  /* Líneas divisorias y bordes */
  --borde: rgba(226, 240, 231, .12);        /* Línea sutil de 1px */
  --borde-fuerte: rgba(226, 240, 231, .28); /* Línea de división destacada */
  --borde-campo: rgba(226, 240, 231, .4);   /* Borde de inputs y selectores (>= 3:1) */

  /* Tipografía */
  --texto: #f3f7f4;   /* Texto primario y encabezados */
  --texto-2: #b7c4bc; /* Texto secundario y descripciones */
  --texto-3: #7e8d84; /* Metadatos, rótulos técnicos y horas (>= 5.4:1) */

  /* Acento y estados funcionales */
  --acento: #93d241;                  /* Verde oficial Miniápolis (>= 12:1 sobre negro) */
  --acento-2: #93d241;                /* Tono continuo de acción */
  --acento-suave: rgba(147, 210, 65, .1);
  --acento-borde: rgba(147, 210, 65, .42);
  --sobre-acento: #041006;            /* Color del texto sobre relleno verde macizo */

  --ok: #93d241;
  --ok-suave: rgba(147, 210, 65, .1);
  --alerta: #ffd166;
  --alerta-suave: rgba(255, 209, 102, .1);
  --error: #ff746d;
  --error-suave: rgba(255, 116, 109, .1);

  /* Área pública (publico.css) */
  --pub-ancho: 1320px;
  --pub-cabecera: 72px;
  --pub-linea: rgba(255, 255, 255, .08);
  --pub-linea-2: rgba(255, 255, 255, .16);
  --pub-panel: #070809;
  --pub-tarjeta: #0b0d0e;
  --pub-radio: 6px;
}
```

### 2.2. Tipografía y Escalas

- **`Saira` (Variable: wght 300-900, wdth 100-125%):**
  - Titulares principales: `clamp(2.2rem, 7vw, 6.8rem)`, `font-stretch: 120% - 125%`, `line-height: .86 - 1.05`.
  - Subtítulos (`h2`, `h3`): `clamp(1.15rem, 2.5vw, 1.45rem)`.
  - Cifras métricas y contadores de saldo: `clamp(4.4rem, 18vw, 11rem)`.
- **`Sora` (Variable: wght 100-800):**
  - Texto corrido en cuerpo: `16px`, `line-height: 1.58`, `font-weight: 400`.
- **`ui-monospace` / SFMono:**
  - Códigos de pack: `0.92rem - 1.05rem`, `font-weight: 600`, `letter-spacing: .04em - .08em`.
  - Tablas técnicas: `font-variant-numeric: tabular-nums lining-nums`.
- **Rótulo Micro:**
  - Tamaño: `--micro-tam: .69rem`.
  - Interletraje: `--micro-track: .12em` (o hasta `.2em` en secciones públicas).
  - Transformación: `text-transform: uppercase`.
  - Peso: `600 - 650`.

### 2.3. Radios y Filos

- `--radio`: `12px - 16px` (tarjetas y diálogos).
- `--radio-s`: `9px - 11px` (botones y campos de formulario).
- `--radio-xs`: `6px - 7px` (pequeños contenedores o esqueletos).
- `--radio-micro`: `5px` (etiquetas, pastillas e insignias).
- `--filo`: `inset 0 1px 0 rgba(255, 255, 255, .055), inset 0 -1px 0 rgba(0, 0, 0, .45)` (canto mecánico sin relieve artificial).

### 2.4. Ritmo y Espaciado

- `--e1`: `6px`
- `--e2`: `10px`
- `--e3`: `16px`
- `--e4`: `24px`
- `--e5`: `40px`
- `--e6`: `72px`
- Espaciado fluido de secciones: `--pub-seccion: clamp(96px, 11vw, 168px)`.
- Márgenes laterales fluidos: `padding-inline: clamp(16px, 4vw, 42px)`.

---

## 3. Guía de Componentes y Patrones Visuales

### 3.1. Botones (`.boton`)

1. **Botón Principal (`.boton--principal`):**
   - Relleno verde macizo (`--acento`).
   - Texto en color oscuro (`--sobre-acento`, `#041006`).
   - Pseudo-elemento `::after` con animación `filoBarrido` al pasar el puntero (barrido oscuro a velocidad constante).
   - Efecto activo de pulsado: `transform: translateY(1px)`.
2. **Botón Fantasma / Secundario (`.boton--fantasma`):**
   - Fondo transparente, borde `--borde-fuerte`, texto `--texto-2`.
   - Hover: fondo `--superficie-2`, borde `--borde-campo`, texto `--texto`.
3. **Botón de Peligro (`.boton--peligro`):**
   - Borde y texto en rojo de error (`--error`), fondo transparente.
   - Hover: fondo `--error-suave`.
4. **Botón de Navegación (`.boton--nav`):**
   - Sin bordes externos.
   - Estado activo `[aria-current="page"]`: texto `--texto` o `--acento` con subrayado indicador de 2px en la base.

### 3.2. Campos de Formulario (`input`, `select`, `textarea`)

- Fondo hundido: `background: var(--superficie)`, caja interior con sombra de hueco: `box-shadow: inset 0 1px 0 rgba(0, 0, 0, .35)`.
- Borde sutil: `1px solid var(--borde-campo)`.
- Al recibir foco (`:focus-visible`):
  - Borde se ilumina con `--acento`.
  - Anillo de foco suave: `box-shadow: 0 0 0 3px var(--acento-suave)`.
- **Casillas de verificación (`input[type="checkbox"]`):**
  - Dimensionadas a 24x24 px (norma táctil WCAG 2.2).
  - Marcado mediante máscara SVG pura (`mask`), con fondo `--sobre-acento` sobre relleno `--acento`.
- **Selects:**
  - `appearance: none` con flecha SVG integrada de la casa (chevron redondeado).

### 3.3. Manejo de Imágenes y Fondos

- **Regla inquebrantable:** Jamás superponer texto legible sobre una fotografía sin un velo graduado de alto contraste.
- Las imágenes del sitio deben estar optimizadas en formato **WebP** y, cuando corresponda, proveer variantes responsivas (`srcset` o `<picture>`).
- Todas las imágenes deben declarar atributos `width`, `height` y `alt` descriptivo.

---

## 4. Arquitectura y Código

### 4.1. Frontend Vanilla (Sin Compilador)

- Todo archivo JS se sirve tal cual desde `public/js/`.
- No emplear dependencias de red o CDNs en caliente.
- La función de inicialización de la página debe residir en `public/js/shell.js` o en el módulo específico de la vista.
- Los módulos deben importar explícitamente sus dependencias:
  ```javascript
  import { $, $$, el, mostrarAviso, icono } from './ui.js';
  import { api } from './api.js';
  ```
- No usar funciones de `ui.js` como valores sin invocación (por ejemplo, escribir `icono('check')`, nunca pasar `icono` suelto).

### 4.2. Backend y Base de Datos

- **Servidor Express estructurado por responsabilidades:**
  - Rutas (`src/routes/`): orquestación HTTP y validaciones de entrada.
  - Servicios (`src/services/`): lógica de negocio pura, cálculo de saldos y reglas de acceso.
  - Biblioteca (`src/lib/`): utilidades desacopladas (criptografía, formato, tiempo, validación).
- **Base de datos SQLite:**
  - Conexión vía `better-sqlite3`.
  - **Migraciones inmutables:** Toda migración en `src/db/migrations.js` tiene un ID autoincremental estricto y se ejecuta una única vez. **Nunca se edita una migración anterior**. Toda modificación de tablas debe agregarse al final del archivo.
  - Consistencia: Operaciones financieras de canje, recarga o transferencia de packs deben realizarse dentro de una transacción `db.transaction(...)`.

### 4.3. Política de Seguridad

- Encabezados estrictos con Helmet: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- La directiva `style-src` no permite `unsafe-inline` para estilos en HTML.
- Las cookies de sesión deben configurarse como `HttpOnly`, `SameSite=Strict`, `Path=/` y con prefijo `__Host-` en entornos HTTPS.
- Toda entrada del usuario en consultas SQLite debe utilizar parámetros vinculados (`?` o `@param`), sin concatenar cadenas SQL.

---

## 5. Accesibilidad y Compatibilidad Móvil

1. **Contraste de color:**
   - Texto principal contra fondo: superior a 12:1.
   - Texto atenuado (`--texto-3`): superior a 5.4:1 (supera WCAG AA y AAA para texto regular).
   - Controles interactivos y bordes de campo: superior a 3:1.
2. **Navegación por teclado:**
   - Todo elemento interactivo debe presentar un foco visible claro (`:focus-visible`) mediante doble anillo de contraste.
   - Enlace accesible «Saltar al contenido» (`.sitio-saltar`) presente en páginas públicas.
3. **Lectores de pantalla:**
   - Formularios siempre asociados a `<label for="...">`.
   - Elementos dinámicos en vivo anotados con `aria-live="polite"`.
   - Diálogos implementados mediante la etiqueta nativa `<dialog>` o con `role="dialog"` y `aria-modal="true"`.
4. **Pantallas táctiles:**
   - Botones y controles tienen una altura mínima de 42px - 44px para facilitar la interacción con dedos.
   - Barras de pestañas horizontales con scroll suave y sin barras de desplazamiento visibles.

---

## 6. Verificación Automatizada

Cualquier cambio se valida ejecutando:

```bash
# 1. Suite completa de pruebas unitarias, de integración y estáticas
npm test

# 2. Pruebas de interfaz en navegador real (opcional, requiere Playwright)
npm run test:ui
```

Si `npm test` arroja un solo fallo, **la tarea no está completada**. Corrige el error asegurando el cumplimiento de las reglas descritas en este manual.

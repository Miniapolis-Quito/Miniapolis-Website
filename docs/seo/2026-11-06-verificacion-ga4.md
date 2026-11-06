# Miniapolis #3 — verificación de medición y búsqueda

Fecha: 6 de noviembre de 2026. Actualiza el [registro de configuración del día 5](2026-11-05-medicion-ga4.md). La activación se publicó mediante [PR 111](https://github.com/Miniapolis-Quito/Miniapolis-Website/pull/111), versión `5dda0e4214d38a12b5257822404d18ff27e1b1e5`, despliegue de Cloudflare Pages `bce4885e-850d-4313-96a9-eec410d178da`. Este registro documenta cambios en Google y pruebas en producción; no introduce otra etiqueta ni cambios de diseño.

## Cambios y evidencia

| Tarea | Antes | Estado / valor comprobado el 6 de noviembre | Evidencia y pendiente |
| --- | --- | --- | --- |
| Identidad del sitio | El buscador mostraba el dominio; hubo una propuesta intermedia con «Ecuador» | Publicado el nombre principal exacto **Miniapolis #3**, con variantes reales sin el dominio como nombre alternativo | [Corrección publicada y solicitud de rastreo del día 5](2026-11-05-nombre-sitio-google.md). La etiqueta del resultado de Google sigue pendiente de procesamiento; no se afirma que ya haya cambiado |
| Comprobación pública | Última referencia del día 5 | Portada, posiciones y privacidad responden 200 con `og:site_name` exacto; un solo `WebSite` en portada con nombre Miniapolis #3 | `output/seo/2026-11-06-publicado.json`: HTTP y www redirigen 301 a la raíz HTTPS preferida; sitemap y robots 200; error inexistente 404; áreas privadas noindex |
| Propiedad y flujo | Propiedad independiente creada; ID aún sin recepción demostrada | Propiedad `561697306`, flujo `16237934211`, medición `G-NX90JV1VSH`, origen exclusivo `https://racinghobbiesec.com` | El flujo muestra ese ID y el informe de Tiempo real pertenece a la misma propiedad |
| Recepción real | Pendiente de comprobar después de publicar | **Comprobada en Tiempo real**: 1 usuario activo; 2 `page_view` de «Privacidad y cookies \| Miniapolis #3», 1 `first_visit` y 1 `session_start` | `output/seo/2026-11-06-ga4-tiempo-real.txt` y `.png`. Son visitas de validación, no tráfico comercial ni conversiones |
| URL recibida | Depuración cubierta por pruebas locales | Desglose del evento `page_view`: las dos vistas corresponden a `https://racinghobbiesec.com/privacidad`, sin consulta ni fragmento | `output/seo/2026-11-06-ga4-url-recibida.txt` y `.png`; el parámetro temporal `gtm_debug` no aparece en el valor recibido |
| Consentimiento antes de aceptar | Implementado y probado localmente | Banner visible; ninguna etiqueta de Google en el DOM antes de aceptar. Tras aceptar tarde se carga una única integración `gtag.js` con el ID propio | JSON antes/después y captura `output/seo/2026-11-06-antes-consentimiento.png`. El arranque adicional de depuración pertenece a Tag Assistant, no a una segunda integración publicada |
| Retirada y elección persistente | Cubiertas por pruebas locales | Retirada desde Preferencias de cookies; al recargar la página limpia, no se vuelve a cargar ningún script de Google | `output/seo/2026-11-06-consentimiento-retirado.json` y `.png`. La eliminación efectiva de cookies en el navegador y los envíos de red tras la retirada siguen pendientes de inspección directa |
| Search Console → GA4 | Asistente sin guardar | **Vínculo creado y persistente tras recargar**, prefijo `https://racinghobbiesec.com/` → flujo `16237934211`, fecha 6 de noviembre | `output/seo/2026-11-06-vinculo-search-console.txt` y `.png`. No se vincula otra empresa |
| Colección Search Console | Sin informes disponibles al principio de la comprobación | Tras actualizar Biblioteca aparece **Publicada para todos**, con Consultas y Tráfico de búsqueda orgánica de Google; ambos informes abren y muestran datos | `output/seo/2026-11-06-coleccion-search-console.txt` y `.png`. No fue necesario crear otra colección |
| Dimensión `partner` | No existía | **Empresa enlazada**, ámbito Evento; valores cerrados `racing_hobbies` / `sim_racing_ecuador` | Guardada y comprobada tras recargar: `output/seo/2026-11-06-dimensiones.txt` y `.png` |
| Dimensión `cta_location` | No existía | **Ubicación del enlace**, ámbito Evento; valores cerrados `header` / `content` / `footer` | Guardada y comprobada tras recargar, misma evidencia. No se registran URLs, personas ni texto libre como dimensiones |
| Filtros | Interno en Prueba; Desarrollo Miniapolis creado en Pruebas | Permanecen sin activación irreversible | Tag Assistant no logró conectar su ventana; no se ha demostrado la identificación del filtro de desarrollo. No se considera excluido el tráfico de esta validación |
| Ajustes de atribución, sesión, referencias y multidominio | Pendientes de inspección en Google | El panel incrustado de Configurar ajustes de etiquetas queda vacío; no se cambian valores desconocidos | El código no implementa medición multidominio. No se atribuyen al panel valores predeterminados no observados |
| Accesos | Cuenta administradora disponible; propiedad propia creada | Se abre Gestión de accesos a la propiedad, pero el contenido no llega a mostrarse | No se añaden usuarios ni se modifican permisos. Auditoría de usuarios heredados pendiente |
| Bing | Inicio con Google autorizado por el usuario | Selector de cuenta abierto; el avance se queda cargando | No se afirma acceso completado, sitio verificado, sitemap enviado ni IndexNow activado |

Los archivos de `output/seo/` son evidencia local y están excluidos del repositorio. Las capturas de configuración pueden mostrar el correo del administrador y no se incorporan al sitio público.

La advertencia de los detalles del flujo «No se han recibido datos durante las últimas 48 horas» seguía visible durante esta sesión. Se conserva como estado observado de ese panel; la prueba de recepción es el informe de Tiempo real con sus eventos y valores, no esa advertencia ni la presencia del script.

Verificación local del registro y versión: `npm test`, **583/583**, cero fallos; `git diff --check`, sin incidencias. La primera ejecución restringida no pudo abrir los puertos locales de las pruebas y no se cuenta como validación; la suite completa se ejecutó con el permiso necesario.

## Alcance de la prueba y limpieza

Se inició Tag Assistant en la página de privacidad para validar aceptación tardía. La primera ventana no cargó Google hasta aceptar; el segundo intento abrió otra ventana de la misma página. Tiempo real mostró dos vistas de privacidad con la URL depurada. Esto acredita recepción real, pero el total agregado por sí solo no demuestra que toda interacción futura esté libre de duplicaciones. La prueba controlada individual de clics y de envíos de red sigue pendiente; las pruebas automatizadas cubren el envío explícito único por página.

Tag Assistant terminó mostrando «Este navegador no está depurando activamente ningún dominio». Se retiró el consentimiento desde la página de privacidad y se recargó su URL sin señal de depuración. No se añadió un modo de depuración permanente al código. Las sesiones de validación deben identificarse al analizar los primeros informes: el filtro de desarrollo continúa en pruebas y no se ha demostrado que estas visitas lleven `debug_mode`.

La lectura de cookies desde la interfaz de automatización no estuvo disponible. No se interpreta esa limitación como ausencia de cookies ni como prueba de borrado. Queda por verificar mediante una inspección directa del navegador, junto con la ausencia de solicitudes anteriores a aceptar y posteriores a revocar.

## Referencia de búsqueda: 28 y 90 días

Los informes de Search Console dentro de la propiedad propia de GA4 muestran lo siguiente. Las ventanas se solapan; no son dos periodos independientes de antes/después.

| Informe / periodo | Clics | Impresiones | CTR | Posición media contextual |
| --- | ---: | ---: | ---: | ---: |
| Páginas, 9 oct–5 nov de 2026, 28 días | 20 | 132 | 15,15 % | 3,95 |
| Páginas, 8 ago–5 nov de 2026, 90 días | 20 | 132 | 15,15 % | 3,95 |
| Consultas disponibles, ambos periodos | 13 | 43 | 30,23 % | 2,35 |

Páginas: portada 20 clics / 119 impresiones, posiciones 0 / 8 y privacidad 0 / 5. Las filas de consultas muestran «racing hobbies» con 8 clics / 27 impresiones y «racing hobbies ecuador» con 5 / 8. Otras siete consultas visibles suman 8 impresiones sin clics. No aparecen consultas de marca Miniapolis en estas filas. Las consultas omitidas o anonimizadas impiden equiparar su suma al total de páginas.

La coincidencia de totales en 28 y 90 días y la reciente verificación de esta propiedad no acreditan un histórico completo de 90 días ni una mejora causada por los cambios. Las consultas antiguas constituyen evidencia de señales históricas del dominio; no justifican adoptar la identidad de la tienda ni copiar sus palabras clave. El desglose por país y dispositivo todavía está pendiente.

La parte de Analytics de estos informes muestra cero usuarios y eventos para un periodo que termina el día 5; la recepción se verificó el día 6. Esos ceros no equivalen a cero contactos o ventas reales del negocio. No hay histórico de medición propia anterior a su activación.

Evidencia: `output/seo/2026-11-06-busqueda-28dias.txt`, `...-busqueda-90dias.txt`, `...-consultas-28dias.txt` y `...-consultas-90dias.txt`.

## Plan de eventos y límites comerciales

| Evento | Disparador / parámetros propios | Significado | Evento clave |
| --- | --- | --- | --- |
| `page_view` | Página pública real; título fijo, dirección y referente depurados | Consulta de una página, después de aceptar | No |
| `login_intent` | Enlace hacia `#acceso`; `cta_location` | Intención de acceder, sin éxito de autenticación demostrado | No |
| `partner_store_click` | Enlace a una de las dos tiendas existentes; `partner`, `cta_location` | Salida hacia otra empresa | No |
| `partner_whatsapp_click` | Enlace de WhatsApp de la tienda ya publicado; `partner`, `cta_location` | Intención de abrir una conversación de la tienda | No |
| `scroll` | Desplazamiento de medición mejorada, si hay consentimiento | Interacción de lectura | No |

No se generan compras, ingresos ni leads confirmados. El alojamiento público sigue siendo estático y no ofrece el backend de entradas. No existe una confirmación fiable de venta o contacto propio que permita marcar esas intenciones como resultados comerciales. La auditoría de los eventos clave predeterminados de la propiedad sigue pendiente; no se presenta esta tabla como una verificación de su lista administrativa.

## Pendientes y mantenimiento

1. Comprobar solicitudes de red y cookies reales durante rechazo, aceptación, retirada y revocación entre pestañas; validar un solo evento por interacción, recepción de los clics y el filtro de desarrollo antes de cualquier activación permanente.
2. Completar la inspección de atribución, ventanas, duración de sesión, referencias, multidominio, usuarios con acceso y eventos clave. Los paneles que no cargaron no se dan por auditados.
3. Terminar el inicio de Bing y, si permite el acceso, verificar este dominio con su token propio y enviar su sitemap. No se ha concedido a Bing acceso a todas las propiedades de Search Console.
4. Obtener los datos oficiales de Miniapolis y acceso a su ficha local: dirección o área de servicio, teléfono, horarios y perfiles propios. Se ha preguntado al usuario; la cuenta disponible no mostraba fichas administradas. No se copian datos de tiendas asociadas ni de directorios secundarios.
5. Revisar el nombre mostrado por Google tras procesar la solicitud de rastreo del día 5. No repetir solicitudes de indexación como intento de cambiar posiciones.
6. Completar desgloses de búsqueda por país y dispositivo y comparar de nuevo a 7, 28 y 90 días de medición suficiente. Se proponen revisiones; no hay automatizaciones creadas.

La herramienta de navegador terminó bloqueando el siguiente acceso a «Visualización de datos» porque su revisión automática alcanzó el límite de uso. La acción no se ejecutó. No se interpreta como rechazo de seguridad ni se intenta eludir la revisión mediante otro mecanismo de control.

Para revertir únicamente la activación de medición, vaciar el ID en `site.config.js`, regenerar los archivos y publicar mediante el mismo flujo de revisión y pruebas. No eliminar propiedades ni su histórico. Los documentos históricos se conservan con sus fechas y remisiones a este registro.

Fuentes oficiales consultadas: [vínculo e informes de Search Console](https://support.google.com/analytics/answer/10737381?hl=es), [DebugView](https://support.google.com/analytics/answer/7201382), [filtro de desarrollo y estado de pruebas](https://support.google.com/analytics/answer/13296662). La disponibilidad de datos de búsqueda y el tiempo de actualización de los informes no implican igualdad entre clics de Search Console y sesiones de Analytics.

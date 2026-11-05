# Miniapolis #3 — activación de GA4

Fecha: 5 de noviembre de 2026. Este registro actualiza los pendientes de Analytics del informe inicial del 29 de octubre. El usuario confirmó 1–10 personas y autorizó crear y configurar la propiedad independiente.

## Identificadores comprobados

| Recurso | Valor | Estado y evidencia |
| --- | --- | --- |
| Cuenta administrativa existente | 406621799, Chic&Love Ecuador | Contenedor administrativo compartido; no se comparten flujos ni visitantes entre empresas |
| Propiedad propia | 561697306, Miniápolis #3 — Web | Creada el 30 de octubre; accesible y comprobada de nuevo el 5 de noviembre |
| Flujo web propio | 16237934211, Miniápolis #3 — Sitio público | URL https://racinghobbiesec.com; detalles del flujo comprobados en Google |
| ID de medición | G-NX90JV1VSH | Copiado del campo ID de medición del flujo; no se deriva del número de flujo |
| País, sector, tamaño, zona y moneda | Ecuador; Deportes; 1–10 personas; hora continental de Ecuador, America/Guayaquil; USD | Guardados al crear la propiedad; registro `output/seo/ga4-propiedad-guardada.txt` |

## Configuración auditada

| Ajuste | Valor verificado / acción | Estado |
| --- | --- | --- |
| Medición mejorada | Solo cargas de página y desplazamientos; historial, salientes, búsquedas, formularios, vídeos y descargas automáticos desactivados | Guardado; reabierto y comprobado el 5 de noviembre |
| Vistas de página | `send_page_view:false` y `page_view` explícita, con URL, referente y título depurados | Implementado; prueba real de recepción pendiente de publicación |
| Ocultación de datos | Correo activo y 30 claves de parámetros sensibles | Guardado y comprobado de nuevo en los detalles del flujo |
| Etiquetas de sitio conectadas | 0 | Comprobado en el flujo; no se añade GTM ni una segunda integración |
| Conservación de usuarios y eventos | 14 meses; no reiniciar el plazo por nueva actividad | Guardado y comprobado el 5 de noviembre; privacidad actualizada para explicarlo |
| Signals, User-ID y datos aportados por usuarios | No se activan; código con `allow_google_signals:false` y sin identificadores de cuenta | Configuración de recogida revisada; no se habilitan funciones adicionales |
| Personalización publicitaria | Código con `allow_ad_personalization_signals:false`; las tres categorías de publicidad permanecen denegadas | Implementado; sin enlaces a cuentas publicitarias ni campañas |
| Tráfico interno | Filtro existente Internal Traffic, excluir, estado Prueba | Conservado; no se inventan IPs ni se activa una exclusión permanente |
| Tráfico de desarrollo | Filtro propio Desarrollo Miniapolis, excluir debug_mode/debug_event, estado Pruebas | Creado y confirmado en Google; validar identificación antes de activarlo |
| Search Console | Prefijo verificado https://racinghobbiesec.com/ | El asistente de vinculación selecciona el sitio correcto; vínculo aún no guardado |
| Dimensiones personalizadas | `partner` y `cta_location`, ámbito evento | Pendientes de guardar; no se crean dimensiones estándar duplicadas |
| Atribución, sesión y exclusiones | Revisar valores del flujo y necesidad real antes de cambiarlos | Auditoría restante pendiente; no se inventan pasarelas ni recorridos multidominio |

La retención de 14 meses permite analizar temporadas y exploraciones trimestrales y anuales. No modifica la duración máxima de 13 meses de las cookies ni la elección de consentimiento de 180 días. Los informes agregados de Google tienen reglas de conservación distintas.

## Publicación y verificación

Esta versión incorpora exclusivamente el ID propio en `site.config.js` y su archivo generado; mantiene el bloqueo básico antes de aceptar y las restricciones a HTTPS, origen de producción exacto y páginas públicas. Actualiza privacidad con la duración de la elección y la retención de Analytics. No configura ventas, leads ni compras confirmadas desde los enlaces de terceros.

La suite completa pasa con 583 pruebas. Las pruebas locales cubren rechazo, aceptación tardía, una sola vista, retirada, cookies accesibles, almacenamiento no disponible, revocación entre pestañas, exclusión de localhost y páginas privadas, y depuración de URLs. No acreditan por sí solas recepción en Google.

Antes de declarar la medición operativa, comprobar la publicación y una sesión controlada mediante Tag Assistant y Tiempo real o DebugView. Al terminar, desconectar Tag Assistant y retirar su señal de depuración. Los filtros nuevos permanecen en pruebas hasta validar su identificación; no se descartan visitas comerciales para acelerar la prueba. Los datos de prueba se deben identificar al analizar los primeros informes.

## Evidencias y próximos pasos

- `output/seo/2026-11-05-ga4-medicion-mejorada.txt`: ajustes del flujo reabiertos en Google, incluido historial desactivado.
- `output/seo/2026-11-05-ga4-retencion.txt`: dos periodos de 14 meses, reinicio desactivado y Guardar inactivo.
- `output/seo/2026-11-05-ga4-filtros.txt`: estado del filtro interno antes de añadir desarrollo.
- `output/seo/2026-11-05-ga4-filtro-desarrollo-creado.txt`: confirmación de creación y estado de pruebas.
- Completar vínculo y colección de Search Console, dimensiones, auditoría de atribución/sesión y recepción real. Ninguno se presenta aquí como terminado.
- Comparar datos tras la activación a 7, 28 y 90 días, anotando la fecha real de inicio y las sesiones de validación. No hay histórico propio de GA4 anterior a la activación. No se programan automatizaciones.

Fuentes oficiales: [DebugView y depuración del dispositivo](https://support.google.com/analytics/answer/7201382), [Tag Assistant](https://support.google.com/tagmanager/answer/10039345), [filtro de desarrolladores y validación](https://support.google.com/analytics/answer/13296662), [retención](https://support.google.com/analytics/answer/7667196), [vínculo con Search Console](https://support.google.com/analytics/answer/10737381).

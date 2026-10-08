# Guía de Contribución — Miniápolis

¡Gracias por contribuir a Miniápolis! Para mantener el código limpio, seguro y estéticamente impecable, sigue estas pautas al proponer cambios.

---

## 1. Antes de Empezar

- Revisa [AGENTS.md](./AGENTS.md) si utilizas un asistente o agente de IA para tu trabajo.
- Lee detalladamente el manual de [Estándares de Diseño y Código](./docs/ESTANDARES.md).
- Este proyecto no utiliza transpiladores ni frameworks en el frontend. La web se sirve con HTML semántico, CSS puro con variables y ES Modules nativos.

---

## 2. Reglas Cruciales de la Interfaz

1. **Respeta la estética actual:** No alteres colores, bordes ni maquetados establecidos salvo que la tarea lo pida explícitamente.
2. **Cero estilos en línea (`style="..."`):** Están bloqueados por la Política de Seguridad de Contenido (CSP) y hacen fallar la suite estática.
3. **Validador estático:** Toda clase CSS en el HTML debe existir en los archivos `.css`; todo `#identificador` buscado en JS debe existir en el HTML; toda función importada debe existir y estar exportada.
4. **Accesibilidad:** Mantén etiquetas `<label for="...">`, contrastes superiores a las normas WCAG y focos visibles claros.

---

## 3. Base de Datos y Migraciones

- Las migraciones en `src/db/migrations.js` son **estrictamente inmutables**.
- Nunca modifiques ni reordenes una migración existente. Añade siempre una nueva entrada al final del arreglo.
- Cualquier operación con saldo o canjes debe ejecutarse dentro de una transacción atómica `db.transaction(...)`.

---

## 4. Ejecución de Pruebas

Toda contribución debe superar la suite de pruebas completa:

```bash
# Ejecutar todas las pruebas (552+ tests)
npm test

# Modo desarrollo con recarga automática
npm run dev

# Pruebas de navegador (requieren Playwright instalado)
npm run test:ui
```

---

## 5. Mensajes de Commit y Pull Requests

- Escribe mensajes de commit claros y concisos en español, con estilo imperativo o descriptivo de la acción:
  - `docs: añade estándares de diseño y arquitectura para agentes`
  - `fix: corrige validación de código de pack en escáner`
  - `feat: añade soporte para exportación de registros`
- Asegúrate de que tu rama esté limpia y sincronizada con `origin/main` antes de abrir o fusionar un Pull Request.

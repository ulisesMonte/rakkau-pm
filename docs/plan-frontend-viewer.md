# Plan — frontend visor solo lectura

Branch: `frontend` · Repo: `ulisesMonte/rakkau-pm` · Preferencia: **sin commit** hasta que Ulises diga.

## Checklist

- [x] **view-flag** — `NEXT_PUBLIC_VIEW_ONLY=true` (default en `.env.example` / `.env.local`). UI oculta mutaciones cuando true (`lib/viewOnly.ts`).
- [x] **api-readonly** — List projects + pull OK. Push, fields POST, delete ítem, PUT project → 405 + mensaje viewer. Create draft/issue queda bloqueado vía push.
- [x] **pull-no-provision** — Pull sin `ensureAllUiFieldsOnGitHub` / `createField`. Reusa map items + rebuild hierarchy + normalize. Muestra Status, assignees, Due, Sprint, Responsable, EstadoOperativo, % avance.
- [x] **ui-viewer** — OpsDashboard/HierarchyTable: Traer + ojo. Sin «abrir compartido»; sin lápiz, basura, +, agregar tarea/subtarea, Publicar, selector Repo (dato si existe). Nunito, árbol, filtros. Sin Objetivos Q.
- [x] **docs-tests** — CONTEXT sección viewer; `.env.example` scopes `read:project` (+repo); tests unitarios de flag (no dependen de push); checklist Traer→árbol/%/asignados.

## Verificación

```bash
npm test
npx tsc --noEmit
```

Manual: Project → Traer → árbol con % / asignados / EstadoOperativo → ojo detalle.

## Nesting N-nivel (progreso)

- Traer pagina todos los ítems; mapea `Issue.parent` + `subIssues` + `subIssuesSummary`.
- Modelo: raíces → `generalTasks`; hijos (cualquier profundidad) → `items` con `parentIssueContentId`.
- Visor: árbol colapsado por defecto; cada padre muestra `done / total · %` + barra; hojas muestran Status/asignados al expandir.
- Verificar en Project con Hornos (p. ej. PROD #67 → Plan #68 → leaves): Traer de nuevo y expandir nivel a nivel.

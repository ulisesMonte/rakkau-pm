# Evidencias E2E — GitHub ↔ Rakkau Ops

Plantilla para documentar pruebas **pull → editar → push → verificar**. Completar en cada corrida; adjuntar capturas en `test-fixtures/e2e-runs/<run-id>/media/` o en el Agent Store `media/e2e/`.

## Metadatos de corrida

| Campo | Valor |
|-------|--------|
| Fecha (America/Buenos_Aires) | |
| Ejecutor | |
| Project ID | `PVT_kwHOB_sFhs4BpSjO` |
| Commit app | |
| `GH_ISSUE_REPOSITORY` | `ulisesMonte/ciam-ops-hybrid-test` |

## Pre-requisitos

- [ ] `GH_TOKEN` en `.env.local`, dev server reiniciado
- [ ] Project seleccionado en UI
- [ ] `dirty: false` antes del baseline (pull limpio o push previo OK)

## Fase A — Baseline (antes de editar)

**Acción:** Traer de GitHub (sin force).

**Artefactos:**

- [ ] `test-fixtures/e2e-runs/<run>/01-baseline-after-pull.json`
- [ ] Captura tabla Project en GitHub
- [ ] Inventario abajo rellenado

### Inventario baseline

| Entidad | Issue | Task | Status | Quarter | Sprint | DueDate | Track/Journey | HasDep / DependsOn | Notas |
|---------|-------|------|--------|---------|--------|---------|---------------|-------------------|-------|
| Padre TEST-1111 | #10 | | | | | | | | |
| Padre TEST-2222 | draft | | | | | | | | |
| Padre TEST-20000 | #12 | | | | | | | | |
| Subtarea | #11 | | | | | | | | |

## Casos de prueba

Repetir bloque por cada TC ejecutado.

### TC-__ — Título

| | Detalle |
|---|--------|
| **Antes** | |
| **Acción en Rakkau** | |
| **Después (GitHub UI)** | |
| **Después (`04-after-verify-pull.json`)** | |
| **Resultado** | PASS / FAIL |
| **Capturas / logs** | |

### Matriz sugerida

| ID | Qué probar |
|----|------------|
| TC-01 | Quarter en tarea general |
| TC-02 | Track / Journey en padre |
| TC-03 | Sprint |
| TC-04 | DueDate |
| TC-05 | HasDependency + DependsOn |
| TC-06 | Status subtarea |
| TC-07 | Track / Journey subtarea |
| TC-08 | Draft padre (Status + título) |
| TC-09 | Nueva subtarea + sub-issue |
| TC-10 | Pull post-push: `generalTasks` intactos |

## Push

**Respuesta API / warnings:**

```
(pegar warnings de Publicar en GitHub)
```

- [ ] `03-push-response.json` guardado (sin tokens)

## Fase D — Verificación final

**Acción:** Traer de GitHub (pull limpio).

- [ ] `04-after-verify-pull.json`
- [ ] Diff vs baseline en campos probados

## Conclusión

| | |
|---|---|
| TCs PASS | |
| TCs FAIL | |
| Bugs / follow-ups | |

---

Contexto del proyecto: [`CONTEXT.md`](./CONTEXT.md).

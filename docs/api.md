# API

API REST de **Kanban Consultoria**. Base `/api`. Respuestas JSON; errores con forma `{ "error": string, "details"? }`.

## Autenticación

- Todas las rutas (excepto `POST /api/auth/login` y `GET /api/health`) requieren sesión.
- La sesión se envía como cookie `HttpOnly` (`SESSION_COOKIE`) o como header `Authorization: Bearer <token>`.
- Sin sesión válida → `401 { "error": "Authentication required" }`.
- Sin rol permitido → `403 { "error": "Insufficient permissions" }`.

Convenciones de permisos:

- `SUPERUSER`: alcance global en todos los recursos.
- `USER` (consultor): solo recursos propios o asignados (empresas por `consultantId`, tickets por `createdById`/`assignedToId`, diagnósticos/DOFA/IA/recomendaciones/planes por empresa accesible).
- Recurso inexistente o no accesible devuelve `404` (no `403`) para no revelar existencia (protección IDOR).

## Health

### `GET /api/health`

Sin autenticación. Verificación de que la API está viva.

```json
{ "status": "ok" }
```

## Auth

### `POST /api/auth/login`

Autenticación de un usuario. Rate limited: 10 intentos por 15 min.

Cuerpo:

```json
{ "email": "admin@kanban.local", "password": "..." }
```

- `400` formato inválido (`{ "error": "Invalid credentials format" }`).
- `401` credenciales inválidas (misma respuesta para usuario inexistente o contraseña incorrecta).
- `200` establece la cookie de sesión y devuelve `{ "user": { id, email, name, role } }`.

### `POST /api/auth/logout`

Cierra la sesión activa (borra la sesión de BD y la cookie). `204` sin cuerpo.

### `GET /api/auth/me`

Devuelve el usuario de la sesión actual: `{ "user": { id, email, name, role } }`.

## Users

### `GET /api/users`

Lista usuarios para asignación. **No expone emails.** `{ "users": [{ id, name, role }] }`.

### `POST /api/users`

Solo `SUPERUSER`. Crea un usuario.

Cuerpo: `{ "name", "email", "password", "role? = "USER" }`.

- `409` si el email ya existe (`{ "error": "A resource with that value already exists" }`).
- `201` `{ "user": { id, name, email, role } }`.

## Tickets

### `GET /api/tickets`

Lista tickets visibles para el usuario. Query opcional: `status`, `priority`, `search` (título/descripción, insensible a mayúsculas).

`{ "tickets": [...] }` con `createdBy` y `assignedTo`.

### `POST /api/tickets`

Crea un ticket. Solo `SUPERUSER` puede asignar (`assignedToId`). `201` `{ "ticket": ... }`.

### `GET /api/tickets/:id`

Detalle de un ticket visible para el usuario.

### `PATCH /api/tickets/:id`

Actualiza campos permitidos (título, descripción, estado, prioridad, asignación). Cambiar la asignación requiere `SUPERUSER`.

### `DELETE /api/tickets/:id`

Elimina el ticket. Solo el creador o un `SUPERUSER`. `204` (las evidencias PDF se eliminan en cascada).

## Evidencias de mitigación (PDF)

Archivos PDF que respaldan el cierre de las actividades de mitigación. Se guardan con nombre aleatorio (`uuid.pdf`) dentro de `EVIDENCE_UPLOAD_DIR` (default `var/evidence`); la API nunca expone el nombre en disco, solo el nombre original del archivo. Toda la validación (extensión, MIME declarado, firma `%PDF-`, tamaño) ocurre antes de tocar disco. Límites: 10 MB por archivo y 11 MB por petición.

### `POST /api/tickets/:id/evidence`

Sube un PDF. Cuerpo `multipart/form-data` con el campo `file`. Requiere sesión y acceso al ticket, así que también puede subirlo el dueño del riesgo aunque no sea dueño ni creador del ticket.

- `201` `{ "evidence": ... }` con `uploadedBy` y `ticket`.
- `400` sin campo `file`, archivo vacío o multipart mal formado; `413` si supera 10 MB (o la petición 11 MB); `415` si no es `application/pdf` válido; `404` si el ticket no es visible.

### `GET /api/tickets/:id/evidence`

Lista la evidencia del ticket, de más reciente a más antigua: `{ "evidence": [...] }`.

### `GET /api/tickets/:id/evidence/:evidenceId`

Descarga el PDF (`Content-Type: application/pdf`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`). `404` si la fila o el archivo ya no existen.

### `DELETE /api/tickets/:id/evidence/:evidenceId`

Elimina la evidencia para cualquier usuario con acceso al ticket. `204`. La fila se borra primero y después el archivo del disco (un unlink fallido queda registrado, nunca con la fila viva).

### `GET /api/processes/:processId/risks/:riskId/plan-evidence`

Evidencia visible de un riesgo: los PDF de los tickets de las actividades de los planes de acción vinculados a ese riesgo, con el alcance del usuario sobre los tickets. `{ "evidence": [...] }`.

**Gate de cierre (`409`):** `PATCH /api/tickets/:id` y `PATCH /api/action-items/:id` responden `409` con `{ "error": "...PDF...", "reason": "MITIGATION_EVIDENCE_REQUIRED" }` cuando la transición marca la actividad como completada y su plan está ligado a un riesgo, pero el ticket aún no tiene ningún PDF. Las actividades canceladas no exigen evidencia, y el ticket se cierra normalmente si el plan no está ligado a un riesgo.

### `GET /api/processes/:processId/risks/:riskId/plan-activities`

Actividades de mitigación de un riesgo: los ítems de todos los planes de acción vinculados a ese riesgo, con responsable, vencimiento y ticket. `{ "activities": [...] }`. Requiere sesión con acceso al proceso y a ese riesgo exacto.

### `POST /api/processes/:processId/risks/:riskId/plan-activities`

Agrega una actividad al plan de mitigación del riesgo (SUPERUSER o COMPANY_ADMIN), sin vincular planes a mano. Cuerpo: `{ "title", "description?", "responsibleId", "dueDate" }` (la descripción, si falta, se rellena con el título).

- El plan «primario» del riesgo es el más antiguo con `riskId` = riesgo; si el riesgo todavía no tiene plan, se crea uno nuevo «Plan de mitigación <código>» bajo el diagnóstico más reciente de la empresa (`400` si la empresa no tiene diagnóstico). Los planes existentes no se renombran ni se duplican.
- La actividad nace `PENDING`/`MEDIUM` con su ticket y el aviso de asignación al responsable en la misma transacción (si el aviso falla, no queda ni actividad ni ticket).
- `400` con datos inválidos o responsable inexistente; `403` si el responsable pertenece a otra empresa; `404` si el proceso o el riesgo no son accesibles; `201` `{ "activity": ... }`.
- `409` si el riesgo no supera la compuerta por etapas (evaluación inherente completa, tratamiento definido y aceptado por el dueño del riesgo); el mensaje indica la etapa que falta. El bloqueo escribe: los controles, planes y actividades ya guardados siguen siendo consultables con `GET`.

## Companies

### `GET /api/companies`

Lista empresas visibles (por consultor). Query opcional: `search` (nombre, identificación, industria).

`{ "companies": [...] }` con `consultant`.

### `POST /api/companies`

Crea una empresa. Un `USER` solo puede asignarse a sí mismo como consultor. `201` `{ "company": ... }`.

### `GET /api/companies/:id`

Detalle de una empresa visible.

### `PATCH /api/companies/:id`

Actualiza la empresa. Un `USER` solo puede auto-asignarse. `{ "company": ... }`.

### `DELETE /api/companies/:id`

Elimina la empresa (cascada a diagnósticos). `204`.

## Diagnostics

### `GET /api/companies/:companyId/diagnostics`

Lista diagnósticos de una empresa visible. `{ "diagnostics": [...] }` con `company`, `createdBy` y `swotAnalysis.items`.

### `POST /api/companies/:companyId/diagnostics`

Crea un diagnóstico (crea además la matriz DOFA vacía).

Cuerpo: `{ "title", "description", "status? = "DRAFT" }`. `201` `{ "diagnostic": ... }`.

### `GET /api/diagnostics/:id`

Detalle de un diagnóstico visible (por empresa).

### `PATCH /api/diagnostics/:id`

Actualiza título/descripción/estado. `{ "diagnostic": ... }`.

### `DELETE /api/diagnostics/:id`

Elimina el diagnóstico (cascada a DOFA, análisis IA, recomendaciones y planes). `204`.

## SWOT (matriz DOFA)

### `POST /api/diagnostics/:id/swot/items`

Agrega un factor a la matriz del diagnóstico.

Cuerpo: `{ "type": "STRENGTH|WEAKNESS|OPPORTUNITY|THREAT", "description", "priority": "LOW|MEDIUM|HIGH", "impact": "LOW|MEDIUM|HIGH" }`.

- `409` si el diagnóstico no tiene matriz. `201` `{ "item": ... }`.

### `PATCH /api/swot/items/:id`

Actualiza un factor (por acceso a la empresa del diagnóstico).

### `DELETE /api/swot/items/:id`

Elimina un factor. `204`.

## AI Analysis

### `POST /api/diagnostics/:id/ai-analysis`

Genera (o regenera) el análisis IA del diagnóstico. Rate limited: 15 por hora por IP.

- `503` si la IA no está configurada (`{ "error": "AI analysis is not configured" }`).
- `502` si la IA devuelve JSON inválido o el proveedor falla.
- `200` `{ "analysis": {...} }` persistido (upsert por diagnóstico).

El análisis incluye: `executiveSummary`, `diagnosis`, `keyFindings` (con `basis`: `FACT`/`INFERENCE`), `foStrategies`, `doStrategies`, `faStrategies`, `daStrategies`, `priorityRisks`, `priorityOpportunities`, `recommendations`.

### `GET /api/diagnostics/:id/ai-analysis`

Devuelve el análisis persistido. `404` si aún no existe.

## Recommendations

### `GET /api/diagnostics/:id/recommendations`

Lista recomendaciones del diagnóstico. `{ "recommendations": [...] }`.

### `POST /api/diagnostics/:id/recommendations/import`

Importa las recomendaciones del `AIAnalysis` persistido al diagnóstico. Omite las que ya existen por título (deduplicación).

`{ "imported": [...], "skipped": number }`. `404` si no hay análisis IA guardado.

### `PATCH /api/recommendations/:id`

Actualiza el estado de una recomendación.

Cuerpo: `{ "status": "PENDING|ACCEPTED|REJECTED" }`. `{ "recommendation": ... }`.

## Action Plans

### `GET /api/diagnostics/:id/action-plans`

Lista planes de acción del diagnóstico. `{ "actionPlans": [...] }` con `createdBy` e `items`.

### `POST /api/diagnostics/:id/action-plans`

Crea un plan. `201` `{ "actionPlan": ... }`.

### `GET /api/action-plans/:id`

Detalle de un plan visible (por diagnóstico/empresa).

### `PATCH /api/action-plans/:id`

Actualiza título/descripción/estado.

## Action Items

### `POST /api/action-plans/:id/items`

Agrega un ítem al plan.

Cuerpo: `{ "title", "description", "priority", "status?", "recommendationId?", "responsibleId?", "dueDate?" }`.

- `400` si la recomendación no pertenece al diagnóstico del plan o si el responsable no existe.
- `409` si el plan pertenece a un riesgo que no supera la compuerta por etapas (mismo mensaje que el resto de la gestión de controles y mitigación).
- `201` `{ "item": ... }`.

### `PATCH /api/action-items/:id`

Actualiza un ítem (mismas validaciones de recomendación/responsable).

- `409` si cambia el contenido (título, descripción, prioridad, responsable, vencimiento o recomendación) de una acción ligada a un riesgo bloqueado por etapas. Cambiar el estado (completada/cancelada) y eliminar el ítem siguen permitidos: son cerrar trabajo ya asignado y mantienen el gate de evidencia PDF.

### `DELETE /api/action-items/:id`

Elimina un ítem. `204`.

## Dashboard

### `GET /api/dashboard`

Métricas de gestión de calidad filtradas por rol y consultor.

```json
{
  "summary": {
    "totalCompanies", "totalDiagnostics", "draftDiagnostics",
    "inProgressDiagnostics", "completedDiagnostics",
    "pendingRecommendations", "activeActionPlans",
    "pendingActionItems", "overdueActionItems"
  },
  "recentDiagnostics": [...],
  "priorityRecommendations": [...],
  "upcomingActions": [...],
  "recentCompanies": [...]
}
```

## Errores comunes

| Código | Caso |
|---|---|
| `400` | JSON mal formado, validación Zod fallida o recursos inconsistentes |
| `401` | Sesión ausente, inválida o expirada |
| `403` | Rol sin permiso o asignación no permitida |
| `404` | Recurso inexistente o no accesible para el usuario |
| `409` | Conflicto de unicidad (P2002), estado inválido, bloqueo por etapas del riesgo (evaluación/tratamiento/aceptación) o cierre de actividad sin evidencia PDF (`MITIGATION_EVIDENCE_REQUIRED`) |
| `429` | Rate limit excedido |
| `500` | Error interno (se registra el mensaje, no los detalles) |

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

### `GET /api/tickets/history`

Lista eventos append-only de tickets visibles. Query opcional: `page`, `pageSize` (1-100), `status`, `priority`, `search`, `assignedToId`, `eventType`, `from` y `to`. Responde `{ "events": [...], "total", "page", "pageSize" }` y ordena de más reciente a más antiguo.

### `GET /api/tickets/:id/history`

Lista el historial paginado de un ticket visible con los mismos filtros de evento y fecha. Los eventos guardan actor, resumen, cambios before/after y metadata no sensible; no existe endpoint de escritura de eventos.

### `PATCH /api/tickets/:id`

Actualiza campos permitidos (título, descripción, estado, prioridad, asignación). Cambiar la asignación requiere `SUPERUSER`.

### `DELETE /api/tickets/:id`

Elimina el ticket. Solo el creador o un `SUPERUSER`. `204` (las evidencias PDF se eliminan en cascada y queda un evento `TICKET_DELETED` con el título y empresa del ticket).

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

Las rutas históricas de Google Drive (`google-drive` y `drive-evidence`) están retiradas y responden `410 GOOGLE_DRIVE_RETIRED`. Las filas históricas se conservan sin modificar.

### `GET /api/processes/:processId/risks/:riskId/plan-evidence`

Evidencia visible de un riesgo: los PDF de los tickets de las actividades de los planes de acción vinculados a ese riesgo, con el alcance del usuario sobre los tickets. `{ "evidence": [...] }`.

**Gate de cierre (`409`):** `PATCH /api/tickets/:id` y `PATCH /api/action-items/:id` responden `409` con `{ "error": "...PDF...", "reason": "MITIGATION_EVIDENCE_REQUIRED" }` cuando la transición marca la actividad como completada y su plan está ligado a un riesgo, pero el ticket aún no tiene ningún PDF. Las actividades canceladas no exigen evidencia, y el ticket se cierra normalmente si el plan no está ligado a un riesgo.

### `GET /api/processes/:processId/risks/:riskId/plan-activities`

Actividades de mitigación de un riesgo: los ítems de todos los planes de acción vinculados a ese riesgo, con responsable, vencimiento y ticket. `{ "activities": [...] }`. Requiere sesión con acceso al proceso y a ese riesgo exacto.

### `POST /api/processes/:processId/risks/:riskId/plan-activities`

Agrega una actividad al plan de mitigación del riesgo (SUPERUSER o COMPANY_ADMIN), sin vincular planes a mano. Cuerpo: `{ "title", "description?", "responsibleId", "dueDate" }` (la descripción, si falta, se rellena con el título).

- El plan «primario» del riesgo es el más antiguo con `riskId` = riesgo; si el riesgo todavía no tiene plan, se crea uno nuevo «Plan de mitigación <código>» bajo el diagnóstico más reciente de la empresa. Si no existe diagnóstico, responde `400` con `reason: DIAGNOSTIC_REQUIRED`; el cliente debe llevar al usuario a la empresa del proceso para seleccionar o crear uno. Los planes existentes no se renombran ni se duplican.
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

## Aseguramiento de Calidad (Auditorías)

Módulo de auditorías de calidad sobre procesos. Rutas anidadas bajo `/api/processes/:processId/audits` y variantes top-level equivalentes bajo `/api/audits/:auditId` (el parámetro `processId` se resuelve en el servidor a partir de la auditoría).

### Auditorías

- `GET /api/audits` — lista auditorías de la empresa con indicadores (`findings`, `openFindings`, `checklistTotal`, `checklistRequiredPending`, `openRequiredActions`). Query: `status`, `search`, `processId`.
- `POST /api/audits` — crea una auditoría (`processId`, `title`, `auditType` Interna/Externa/Mixta, `scope`, `criteria`, `objectives?`, `plannedDate?`, `leadAuditorId?`, `responsibleId?`, `processIds?`, `procedureIds?`). Código automático `AUD-NNN`.
- `GET /api/audits/:auditId` — detalle completo (checklists con ítems, hallazgos con acciones y progreso, evidencias, relaciones, progreso de checklist).
- `PATCH /api/audits/:auditId` — actualiza campos de la auditoría.
- `PUT /api/audits/:auditId/relations` — sustituye los vínculos de procesos/procedimientos relacionados.
- `POST /api/audits/:auditId/status` — máquina de estados (`PLANNED` → `IN_PROGRESS` → `CLOSED` / `CANCELLED`). Cerrar exige `summary` (≥3 chars) y que **ningún ítem obligatorio** siga en `PENDING` (`409 reason: CHECKLIST_PENDING`).
- `GET /api/audits/:auditId/history` — historial paginado (`AuditEvent`).
- `DELETE /api/audits/:auditId` — elimina la auditoría y sus archivos de evidencia en disco (`204`). Bloqueado si tiene hallazgos.

### Hallazgos

- `GET|POST /api/audits/:auditId/findings` — lista/crea hallazgos (`title`, `description`, `type` NONCONFORMITY/OBSERVATION/OPPORTUNITY, `severity` CRITICAL/MAJOR/MINOR, `dueDate?`, `responsibleId?`, `itemId?`, `processId?`, `procedureId?`).
- `PATCH /api/audits/:auditId/findings/:findingId` — actualiza campos del hallazgo, incluyendo `efficacyVerification?` para la verificación de eficacia.
- `DELETE /api/audits/:auditId/findings/:findingId` — elimina el hallazgo. Borrar un hallazgo con acciones correctivas responde `409`.
- `POST /api/audits/:auditId/findings/:findingId/status` — máquina de estados (`OPEN` → `IN_PROGRESS` → `RESOLVED` → `VERIFIED`). `RESOLVED` exige `resolution` (≥3 chars) y que **ninguna acción obligatoria** siga abierta (`409 reason: ACTIONS_PENDING`). `VERIFIED` sobre una `NONCONFORMITY` exige `efficacyVerification` (≥3 chars) ya registrada en el hallazgo.

### Propuestas Checky para hallazgos

Las propuestas se almacenan separadas del expediente hasta una decisión explícita. No confirman causas,
no completan acciones y no verifican ni cierran hallazgos automáticamente.

- `GET|POST /api/audits/:auditId/findings/:findingId/checky/suggestions` — lista o genera propuestas. La solicitud puede enviar `{ "kinds": ["ROOT_CAUSE_ANALYSIS", "ROOT_CAUSE", "CORRECTIVE_ACTION"], "analysisId?": "..." }`; las evidencias y los análisis elegibles se validan contra el mismo hallazgo.
- `PATCH /api/audit-checky-suggestions/:suggestionId` — edita `editablePayload` mientras la propuesta está `PENDING`; `originalPayload` permanece inmutable.
- `POST /api/audit-checky-suggestions/:suggestionId/accept` — aceptación transaccional: crea un análisis `DRAFT`, una causa `POTENTIAL` o una acción `OPEN`, según el tipo, y registra `CHECKY_SUGGESTION_ACCEPTED`.
- `POST /api/audit-checky-suggestions/:suggestionId/reject` — rechaza una propuesta `PENDING` y registra `CHECKY_SUGGESTION_REJECTED`.
- Todas las operaciones validan empresa, auditoría, hallazgo, evidencias y estados terminales; las sugerencias generadas con el mismo contenido se deduplican por auditoría.

### Listas de verificación (Checklists)

- `GET|POST /api/audits/:auditId/checklists` — lista/crea listas (`name`).
- `PATCH|DELETE /api/audits/:auditId/checklists/:checklistId` — edita/elimina (cascade de ítems).
- `POST|PATCH|DELETE /api/audits/:auditId/checklists/:checklistId/items` — CRUD de ítems (`description`, `criteria`, `required?`, `position?`, `result?` PENDING/CONFORM/NON_CONFORM/NOT_APPLICABLE, `observations?`).

### Acciones correctivas

- `GET /api/audits/:auditId/actions` — lista las acciones correctivas de la auditoría.
- `POST /api/audits/:auditId/findings/:findingId/actions` — crea una acción integral (`title`, `description`, `objective?`, `implementationPlan?`, `resources?`, `observations?`, `responsibleId`, `priority?` LOW/MEDIUM/HIGH/CRITICAL, `required?`, `evidenceRequired?`, `dueDate?`). Las acciones nuevas reciben `workflowVersion=1` exclusivamente en el servidor; el cliente no puede escribirlo.
- `PATCH|DELETE /api/audits/:auditId/actions/:actionId` — edita/elimina. Borrar una acción con progreso responde `409`.
- `POST /api/audits/:auditId/actions/:actionId/status` — máquina de estados (`OPEN` → `IN_PROGRESS` → `COMPLETED` / `CANCELLED`). Completar una acción `workflowVersion=1` exige responsable activo, `progressPercent=100`, criterios obligatorios de implementación cumplidos, observaciones finales y evidencia cuando `evidenceRequired=true`.
- `POST /api/audits/:auditId/actions/:actionId/progress` — registra un avance cronológico (`note?`, `activities?`, `results?`, `difficulties?`, `pendingActivities?`, `observations?`, `percent?`). El porcentaje actual persistente vive en la acción; omitirlo conserva el porcentaje anterior. Llegar a `100` no cambia el estado.
- `GET /api/audits/:auditId/actions/:actionId/acceptance-criteria` — lista criterios de aceptación.
- `POST /api/audits/:auditId/actions/:actionId/acceptance-criteria` — crea un criterio (`type?` IMPLEMENTATION/EFFECTIVENESS, `description`, `expectedResult`, `required?`, `isMet?`, `observations?`). Los criterios de eficacia no se pueden marcar cumplidos en este bloque.
- `PATCH /api/audits/:auditId/actions/:actionId/acceptance-criteria/:criterionId` — edita un criterio y registra cumplimiento de criterios de implementación.
- Los criterios no se eliminan físicamente; las acciones con criterios no se pueden eliminar.

### Verificación integral de eficacia

La eficacia se registra en evaluaciones históricas separadas de la implementación de la acción. Solo
se pueden evaluar acciones `COMPLETED` de la misma empresa y hallazgo; cada evaluación conserva un
snapshot de los criterios de aceptación de eficacia y queda en solo lectura al finalizar o cancelar.

- `GET /api/audits/:auditId/findings/:findingId/efficacy-evaluations` — lista evaluaciones históricas y su resumen.
- `POST /api/audits/:auditId/findings/:findingId/efficacy-evaluations` — planifica una evaluación (`actionId`, `plannedDate`, `methodology`, `sampleDescription`, `sampleSize?`, `responsibleId`, `criteriaIds?`, `notes?`).
- `GET|PATCH /api/audits/:auditId/efficacy-evaluations/:evaluationId` — consulta o edita la planificación mientras está `PLANNED`.
- `POST /api/audits/:auditId/efficacy-evaluations/:evaluationId/status` — inicia, finaliza o cancela. Finalizar exige conclusión, dictamen, criterios evaluados y responsable activo; `outcome` puede ser `EFFECTIVE`, `PARTIALLY_EFFECTIVE` o `INEFFECTIVE`.
- `POST /api/audits/:auditId/efficacy-evaluations/:evaluationId/progress` — registra avances cronológicos (`note?`, `percent?`, `observations?`).
- `PATCH /api/audits/:auditId/efficacy-evaluations/:evaluationId/criteria/:criterionResultId` — registra el resultado de un criterio sin alterar el criterio histórico de la acción.
- `POST|DELETE /api/audits/:auditId/efficacy-evaluations/:evaluationId/evidences/:evidenceId` — vincula o desvincula una evidencia URL oficial.
- `POST|DELETE /api/audits/:auditId/efficacy-evaluations/:evaluationId/evidence-files/:evidenceFileId` — vincula o desvincula un PDF oficial.
- Una evidencia oficial vinculada a una evaluación no se puede modificar ni eliminar; responde `409` con razón `EVIDENCE_LINKED_TO_EFFICACY_EVALUATION` o `EVIDENCE_FILE_LINKED_TO_EFFICACY_EVALUATION`.
- Para acciones `workflowVersion=1`, completar una evaluación es requisito para verificar el hallazgo. El texto legacy `efficacyVerification` no permite saltarse el flujo estructurado.

### Vinculos entre causas y acciones

Los vínculos usan `AuditCorrectiveActionCause` y no cambian el estado de la acción, la causa ni el
hallazgo. Solo se aceptan causas `CONFIRMED` de análisis `CONFIRMED` del mismo hallazgo. Las rutas
anidadas bajo `/api/processes/:processId/audits/:auditId` son equivalentes.

- `GET /api/audits/:auditId/findings/:findingId/actions/:actionId/causes` — consulta vínculos activos. Añadir `?history=true` incluye también vínculos retirados.
- `POST /api/audits/:auditId/findings/:findingId/actions/:actionId/causes` — vincula una o varias causas con `{ "causeIds": ["..."] }`. Devuelve `{ "associations": [...] }`.
- `DELETE /api/audits/:auditId/findings/:findingId/actions/:actionId/causes/:causeId` — desactiva el vínculo sin borrarlo y devuelve la asociación histórica actualizada.
- `GET /api/audits/:auditId/findings/:findingId/eligible-root-causes` — lista causas confirmadas elegibles del hallazgo.
- `GET /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId/causes/:causeId/actions` — consulta acciones vinculadas a una causa; admite `?history=true`.
- La revinculación reactiva la fila existente porque `(findingId, actionId, causeId)` es único. La fila se actualiza con el nuevo actor/periodo y el periodo anterior queda trazado en los eventos `CORRECTIVE_ACTION_CAUSE_*`.
- Las consultas requieren autenticación y acceso a la empresa; las escrituras requieren `SUPERUSER` o `COMPANY_ADMIN`.
- Las escrituras se bloquean para auditorías `CLOSED`/`CANCELLED`, hallazgos `VERIFIED` y acciones `COMPLETED`/`CANCELLED`. Desvincular conserva el historial y no convierte una acción con vínculos históricos en eliminable; las acciones sin vínculos mantienen el comportamiento anterior.

Las evidencias URL aceptan `actionId` además de `findingId`; la acción y el hallazgo deben pertenecer a la misma auditoría y hallazgo. Los PDF siguen usando `AuditEvidenceFile.actionId`. Las evidencias vinculadas a acciones terminales no se pueden eliminar ni desvincular.

### Correcciones inmediatas

Las correcciones inmediatas documentan contención y tratamiento de consecuencias; no sustituyen ni
crean acciones correctivas. Las variantes anidadas bajo `/api/processes/:processId/audits/:auditId`
son equivalentes y aplican las mismas comprobaciones de empresa y auditoría.

- `GET /api/audits/:auditId/findings/:findingId/corrections` — lista las correcciones del hallazgo.
- `POST /api/audits/:auditId/findings/:findingId/corrections` — crea una corrección (`description`, `containmentMeasures?`, `consequencesIdentified?`, `consequencesTreatment?`, `responsibleId?`, `plannedDate?`, `observations?`). `createdById`, `createdAt` y `executedAt` no son controlables por el cliente.
- `GET /api/audits/:auditId/findings/:findingId/corrections/:correctionId` — consulta una corrección específica.
- `PATCH /api/audits/:auditId/findings/:findingId/corrections/:correctionId` — edita información descriptiva mientras la corrección está `OPEN` o `IN_PROGRESS`; no permite modificar estado, creador ni fecha real de ejecución.
- `POST /api/audits/:auditId/findings/:findingId/corrections/:correctionId/start` — `OPEN` → `IN_PROGRESS`.
- `POST /api/audits/:auditId/findings/:findingId/corrections/:correctionId/complete` — `IN_PROGRESS` → `COMPLETED`; exige `{ "observations": "..." }`, descripción y responsable activo. `executedAt` lo asigna el servidor.
- `POST /api/audits/:auditId/findings/:findingId/corrections/:correctionId/cancel` — `OPEN|IN_PROGRESS` → `CANCELLED`; exige `{ "justification": "..." }` y conserva la justificación en `observations` e historial.
- Las correcciones `COMPLETED` y `CANCELLED` son de solo lectura y no existe eliminación física.
- Las transiciones inválidas responden `409`; una corrección inmediata nunca resuelve ni verifica automáticamente su hallazgo.
- Las escrituras requieren `SUPERUSER` o `COMPANY_ADMIN`; `COMPANY_USER` conserva lectura cuando tiene acceso al proceso/empresa.
- Las escrituras se bloquean para auditorías `CLOSED`/`CANCELLED` y hallazgos `VERIFIED`.
- Los eventos emitidos son `IMMEDIATE_CORRECTION_CREATED`, `IMMEDIATE_CORRECTION_UPDATED` e `IMMEDIATE_CORRECTION_STATUS_CHANGED`.

### Analisis de causa raiz

Las investigaciones se crean con origen `MANUAL`. Un análisis `CONFIRMED` y sus causas confirmadas
son inmutables; para una nueva investigación se crea otro análisis. Las variantes anidadas bajo
`/api/processes/:processId/audits/:auditId` son equivalentes.

- `GET|POST /api/audits/:auditId/findings/:findingId/root-cause-analyses` — lista/crea análisis (`methodology` MANUAL/FIVE_WHYS/ISHIKAWA, `problemDescription`, `responsibleId?`).
- `GET|PATCH /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId` — consulta o edita un análisis `DRAFT`.
- `POST /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId/status` — confirma el análisis; exige al menos una causa `CONFIRMED` y, para FIVE_WHYS, pasos consecutivos desde 1.
- `POST /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId/causes` — crea una causa (`description`, `justification?`, `supportingEvidence?`, `ishikawaCategory?`, `position?`). Ishikawa exige categoría.
- `PATCH /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId/causes/:causeId` — edita una causa `POTENTIAL` de un análisis `DRAFT`.
- `POST /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId/causes/:causeId/status` — `POTENTIAL` → `CONFIRMED` o `DISCARDED`.
- `POST /api/audits/:auditId/findings/:findingId/root-cause-analyses/:analysisId/five-why-steps` y `PATCH|DELETE .../:stepId` — CRUD de pasos Five Whys (`sequence`, `question`, `answer`); la secuencia es única por análisis y no se fija una cantidad exacta de pasos.
- Las escrituras requieren `SUPERUSER` o `COMPANY_ADMIN`, usan el bloqueo de la auditoría y registran eventos `ROOT_CAUSE_*` en la misma transacción.
- Todas las escrituras de análisis, causas y pasos se rechazan con `409` y `reason: FINDING_VERIFIED` cuando el hallazgo está `VERIFIED`; las rutas `GET` continúan permitiendo lectura autorizada. El estado se revalida dentro de la transacción después de bloquear la auditoría.

### Plan de auditoría y agenda

- `GET /api/audits/:auditId/plan` — devuelve el plan o `{ "plan": null }` si aún no existe. Cada actividad conserva `responsible` como usuario operativo y añade `auditors[]` con `teamMemberId`, `auditorId`, `name`, `email`, `role`, `type`, `independenceStatus` y `mitigationMeasures`.
- `POST|PATCH /api/audits/:auditId/plan` — crea o actualiza el plan mientras está en `DRAFT`.
- `POST /api/audits/:auditId/plan/activities` y `PATCH /api/audits/:auditId/plan/activities/:activityId` — CRUD de actividades; `responsibleId` continúa identificando un `User` y `processId` puede ser `null` para reuniones generales.
- `PUT /api/audits/:auditId/plan/activities/:activityId/auditors` — sustituye atómicamente la asignación de auditores con `{ "auditTeamMemberIds": ["..."] }`. La lista puede estar vacía en `DRAFT`; los identificadores son de `AuditTeamMember`, no de `User`.
- `POST /api/audits/:auditId/plan/status` — `DRAFT` → `READY` → `APPROVED` y cancelación desde `DRAFT`/`READY`. Cada actividad activa debe tener al menos un integrante activo; `PENDING` y `CONFLICT` bloquean la transición y `MITIGATED` devuelve advertencias explícitas.

### Evidencias documentales (links)

- `GET|POST /api/audits/:auditId/evidences` — evidencias con URL (`name`, `description?`, `url`, `findingId?`).
- `PATCH|DELETE /api/audits/:auditId/evidences/:evidenceId` — edita/elimina; la eliminación devuelve `409` con `reason: EVIDENCE_LINKED_TO_ACTIVITY` si conserva un vínculo histórico con una actividad.

### Evidencias PDF (archivos)

- `POST /api/audits/:auditId/evidence-files` — sube un PDF (multipart, campos opcionales `findingId` / `actionId` / `itemId` para anclar). Validación: extensión `.pdf`, MIME, firma `%PDF-`, ≤10 MB. El proveedor se configura con `EVIDENCE_STORAGE_PROVIDER` (`local` o `r2`).
- `GET /api/audits/:auditId/evidence-files` — lista los archivos.
- `GET /api/audits/:auditId/evidence-files/:fileId` — descarga el PDF (`nosniff`, `no-store`) a través del backend autenticado.
- `DELETE /api/audits/:auditId/evidence-files/:fileId` — elimina el registro y el recurso del proveedor configurado; devuelve `409` con `reason: EVIDENCE_FILE_LINKED_TO_ACTIVITY` si conserva un vínculo histórico con una actividad.
- `GET /api/audits/:auditId/evidence-operations/:operationId` — consulta únicamente estados históricos de operaciones heredadas.

La respuesta de cada archivo incluye `storageProvider` (`LOCAL`, `R2` o el valor histórico `GOOGLE_DRIVE`) y `storageState`. Las cargas nuevas son síncronas; las operaciones históricas permanecen auditables.

Errores de dominio relevantes: `409` con `reason: CHECKLIST_PENDING` o `ACTIONS_PENDING` al intentar cerrar/resolver con pendientes; `409` al borrar hallazgos con acciones o acciones con progreso; `400` al verificar una no conformidad sin verificación de eficacia.

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

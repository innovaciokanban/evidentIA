# Seguridad

Controles de seguridad implementados en **Kanban Consultoria** (backend en `server/`).

## Autenticación

- **Contraseñas**: `bcrypt` con cost 12. La contraseña nunca viaja a la BD sin hash.
- **Anti enumeración de usuarios**: el login compara contra un **hash dummy** (`DUMMY_PASSWORD_HASH`) cuando el usuario no existe, de modo que la respuesta de "credenciales inválidas" es idéntica para email inexistente y contraseña incorrecta.
- **Login**: validación Zod (`loginSchema`), rate limiting (10 intentos / 15 min) y límite de longitud (8-128 caracteres).

## Sesiones

- Al iniciar sesión se genera un token aleatorio (32 bytes, `randomBytes`) y se guarda su **hash SHA-256** (`tokenHash`) en la tabla `Session`, junto con `expiresAt` (`SESSION_DAYS`, default 30). La BD nunca almacena el token en claro.
- Cada request autenticado resuelve la sesión por su hash; si está expirada, se **elimina la sesión** y se limpia la cookie antes de responder `401`.
- El logout borra la sesión por hash y limpia la cookie.
- La expiración de sesiones no presentadas se resuelve de forma perezosa (al autenticar).

## Cookies

| Atributo | Valor |
|---|---|
| `HttpOnly` | sí |
| `SameSite` | `Lax` en desarrollo/test; `None` en producción |
| `Secure` | solo en `NODE_ENV=production` |
| `Expires` | fecha de expiración de la sesión |
| `Path` | `/` |

## RBAC (control de acceso por rol)

- Roles: `SUPERUSER` (alcance global) y `USER` (consultor).
- `authorize(Role.SUPERUSER)` protege rutas sensibles: creación de usuarios y asignación de tickets/consultores.
- Un `USER` no puede asignar tickets a otros ni asignarse empresas que no sean suyas.

## Protección contra IDOR

Todo recurso por ID se valida contra el alcance del usuario antes de leer/escribir:

- **Tickets**: `canAccessTicket` — creador, asignado o `SUPERUSER`.
- **Empresas**: `canAccessCompany` — `consultantId` del usuario o `SUPERUSER`.
- **Diagnósticos / DOFA / IA / recomendaciones / planes / ítems**: acceso indirecto mediante la empresa del diagnóstico (consultas con `include` para traer `company.consultantId`).
- **Actividades de mitigación** (`GET`/`POST .../plan-activities`): sesión + proceso visible + riesgo exacto de ese proceso; el alta exige `userWriteGuard` (SUPERUSER o COMPANY_ADMIN) y que el responsable asignado pertenezca a la empresa del proceso (`403` si es de otra empresa). El plan nuevo se ancla al diagnóstico más reciente de la misma empresa; sin diagnóstico responde `400` con `DIAGNOSTIC_REQUIRED` y no escribe actividad, ticket ni notificación.
- **Dashboard**: `dashboardScopesFor` construye filtros por rol; `USER` solo ve sus propios datos (`Promise.all` de consultas con esos alcances).
- Los recursos inexistentes **y** los no accesibles devuelven `404` para no revelar existencia.
- Tests dedicados manipulan IDs de recursos de otros consultores y verifican `404`/`403`.

## Decisiones de aprobaciones de riesgos

- La decisión bloquea y relee en una sola transacción el riesgo, el proceso, sus controles/evidencias, el ciclo de aprobación y los usuarios participantes; el orden determinista es `Risk -> Process -> filas de revisión -> RiskApproval -> Users -> Companies`.
- Cada `APPROVAL_REQUESTED` persiste en `RiskAuditEvent.metadata` un snapshot de los campos que determinan la decisión y el ticket. Un snapshot ausente, incompleto o diferente marca el ciclo `OUTDATED` y responde `409` con `OUTDATED_APPROVAL`; no se crea ticket.
- El cambio concurrente de campos relevantes o del dueño invalida el ciclo pendiente dentro de la transacción de edición. El ticket, auditoría y notificación de una decisión válida se confirman juntos; el índice único de `RiskApproval.ticketId` y el estado `PENDING` impiden duplicados por reintentos.

## Rate limiting (`express-rate-limit`)

| Endpoint | Límite |
|---|---|
| `POST /api/auth/login` | 10 por 15 min por IP |
| `POST /api/diagnostics/:id/ai-analysis` | 15 por hora por IP |

- `TRUST_PROXY_HOPS` configura `trust proxy` para que detrás de un proxy reverso se respete la IP real del cliente.

## Validación (Zod)

- Todos los cuerpos (`*.createSchema`, `*.updateSchema`) y queries (`ticketQuerySchema`, `companyQuerySchema`) se validan con Zod antes de tocar la BD.
- Schemas parciales (`refine` de "al menos un campo") evitan actualizaciones vacías.
- Validación estricta del JSON devuelto por la IA (`aiAnalysisSchema`) antes de persistir.

## CORS

- Solo se permite el `origin` normalizado de `FRONTEND_URL` con `credentials: true` (cookies). Ningún otro origen recibe la cookie.
- CORS no es la defensa CSRF: las mutaciones cookie-authenticated validan además el encabezado `Origin` contra esa lista explícita de un origen confiable.

## CSRF

- `POST`, `PUT`, `PATCH` y `DELETE` con cookie de sesión requieren un `Origin` exacto igual al origen de `FRONTEND_URL`; un origen externo, ausente o `null` responde `403`.
- `POST /api/auth/login` y `POST /api/auth/logout` requieren el mismo `Origin` aunque todavía no exista cookie, para evitar login CSRF y logout CSRF.
- `Sec-Fetch-Site: cross-site` se rechaza como defensa adicional; Fetch Metadata no sustituye la validación de `Origin`.
- Una petición solo con `Authorization: Bearer` no lleva credenciales de navegador automáticas y puede operar sin `Origin`. Si incluye cookie y Bearer, la cookie tiene prioridad en autenticación y se aplica CSRF.
- El callback `GET /api/google-drive/oauth/callback` no usa la compuerta de métodos mutantes: es una navegación OAuth legítima y exige sesión, `state` de un solo uso, `sessionId` e iniciador coincidentes, expiración válida y PKCE.
- El frontend usa `credentials: include`; el navegador envía `Origin` automáticamente. No se añade ningún secreto CSRF al frontend.

## Cabeceras de seguridad

Aplicadas globalmente:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `X-Permitted-Cross-Domain-Policies: none`
- `Cache-Control: no-store` (respuestas de datos no cacheadas)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (solo producción)
- `X-Powered-By` deshabilitada (`app.disable('x-powered-by')`)

## Manejo de errores

- Único manejador en `server/app.ts`:
  - `SyntaxError` (JSON mal formado) → `400 { "error": "Invalid JSON body" }`.
  - `MultipartError` / `EvidenceValidationError` (subida de evidencia) → su propio estado (`400`/`413`/`415`) con el mensaje en español.
  - `MitigationEvidenceRequiredError` (actividad cerrándose sin PDF) → `409 { "error": ..., "reason": "MITIGATION_EVIDENCE_REQUIRED" }`.
  - `Prisma.P2002` (unicidad) → `409 { "error": "A resource with that value already exists" }`.
  - **Compuerta por etapas** (respuesta directa en cada ruta de escritura, no desde este manejador): si el riesgo aún no supera la etapa (evaluación inherente completa, tratamiento definido y aceptación decidida y aceptada por el dueño), crear/editar controles, dueño y vencimiento del plan, actividades de mitigación, acciones ligadas al riesgo y su calificación residual responden `409 { "error": "<mensaje de la etapa>" }` en inglés; las lecturas, los `DELETE` y los cambios de estado de las acciones siguen permitidos.
  - Ruta desconocida → `404 { "error": "Not found" }`.
  - Resto → `500 { "error": "Internal server error" }`; se registra solo `error.message` en consola (nunca detalles internos ni datos sensibles en la respuesta).

## Archivos de evidencia (PDF)

- Subida en `multipart/form-data` leída a mano con tope de **11 MB por petición** (se corta y drena el resto) y **10 MB por archivo**.
- Validación estricta **antes de tocar disco**: extensión `.pdf`, MIME `application/pdf`, firma `%PDF-` y tamaño > 0 (`server/evidence-storage.ts`); si algo falla no queda ni fila ni archivo.
- **Sin path traversal**: el nombre en disco es `randomUUID().pdf`; el nombre original se sanea (solo `basename`, sin comillas ni caracteres de control, ≤150 caracteres) y la API solo expone ese nombre saneado.
- **Fuera del árbol web**: los archivos viven en `EVIDENCE_UPLOAD_DIR` (default `var/evidence`, ignorado por git); en producción debe ser un volumen persistente.
- **Drive privado**: cuando `EVIDENCE_STORAGE_PROVIDER=google-drive`, los nuevos PDF se guardan en la jerarquía privada raíz/empresa/auditoría. La API no acepta ids de carpeta desde el cliente, no crea permisos públicos y sirve el contenido mediante una ruta autenticada.
- **OAuth por empresa**: cada empresa autoriza su propia cuenta Drive con el alcance mínimo `drive.file`; no existe una cuenta de servicio global ni delegación de dominio.
- **Credenciales server-side**: el refresh token se cifra con `OAUTH_TOKEN_ENCRYPTION_KEY` antes de persistirse; nunca se envía al navegador ni forma parte de una respuesta HTTP. La conexión usada queda referenciada en cada evidencia para evitar cruces entre empresas.
- **Autorización por ticket**: subir, listar, descargar y borrar exigen sesión + acceso al ticket (`canAccessTicket`); `plan-evidence` exige sesión + acceso al proceso y alcance del usuario sobre los tickets. El nombre en disco (`storedName`) jamás viaja en una respuesta.
- **Referencias Drive de tickets**: Google Picker recibe únicamente un access token temporal de la conexión Drive de la empresa, nunca el refresh token. `setParent` solo orienta la interfaz: el servidor verifica la ascendencia real del archivo hasta la raíz efectiva (la de `GOOGLE_DRIVE_EVIDENCE_ROOT_FOLDER_ID` o, si con `drive.file` no es visible, la raíz creada en la conexión OAuth, validada por tenant) y la subcarpeta marcada para la empresa, además de validar que sea PDF. Un 403/404 solo invalida la cadena si aún no se han alcanzado la raíz y la subcarpeta requeridas; los motivos de rechazo se registran como etiquetas sin identificadores. Persiste solo metadatos y `driveFileId`; eliminar la referencia no elimina ni cambia el archivo en Drive.
- Descarga con `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`.
- **Limpieza ordenada**: al subir se escribe el disco primero y se retira si falla la fila; al borrar se elimina la fila primero y después el archivo (un unlink fallido queda en `console.error`, nunca una fila que promete un archivo borrado). `DELETE /api/tickets/:id` elimina las evidencias en cascada.
- **Gate de cierre**: cerrar una actividad cuyo plan está ligado a un riesgo sin PDF local ni referencia PDF de Drive responde `409` con `MITIGATION_EVIDENCE_REQUIRED` y revierte la transacción; las canceladas no exigen evidencia.

## Secretos

- `.env` está en `.gitignore`; solo `dotenv` lo lee en el backend.
- `OPENAI_API_KEY` solo se usa en `server/ai-service.ts`; si falta, el endpoint responde `503` sin exponer información.
- En producción, `server/env.ts` (Zod) **rechaza el arranque** si `DATABASE_URL` o `FRONTEND_URL` quedan en los valores de desarrollo.
- El seed (`prisma/seed.ts`) **rechaza** `SEED_PASSWORD` por defecto en producción.

## Otras defensas

- `express.json` con límite de 1 MB.
- El análisis IA está limitado a los datos del diagnóstico y la respuesta debe cumplir JSON Schema estricto + validación Zod.
- Directorio de usuarios (`GET /api/users`) no expone emails.

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
| `SameSite` | `Lax` |
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
- **Dashboard**: `dashboardScopesFor` construye filtros por rol; `USER` solo ve sus propios datos (`Promise.all` de consultas con esos alcances).
- Los recursos inexistentes **y** los no accesibles devuelven `404` para no revelar existencia.
- Tests dedicados manipulan IDs de recursos de otros consultores y verifican `404`/`403`.

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

- Solo se permite el origen `FRONTEND_URL` con `credentials: true` (cookies). Ningún otro origen recibe la cookie.

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
  - `Prisma.P2002` (unicidad) → `409 { "error": "A resource with that value already exists" }`.
  - Ruta desconocida → `404 { "error": "Not found" }`.
  - Resto → `500 { "error": "Internal server error" }`; se registra solo `error.message` en consola (nunca detalles internos ni datos sensibles en la respuesta).

## Secretos

- `.env` está en `.gitignore`; solo `dotenv` lo lee en el backend.
- `OPENAI_API_KEY` solo se usa en `server/ai-service.ts`; si falta, el endpoint responde `503` sin exponer información.
- En producción, `server/env.ts` (Zod) **rechaza el arranque** si `DATABASE_URL` o `FRONTEND_URL` quedan en los valores de desarrollo.
- El seed (`prisma/seed.ts`) **rechaza** `SEED_PASSWORD` por defecto en producción.

## Otras defensas

- `express.json` con límite de 1 MB.
- El análisis IA está limitado a los datos del diagnóstico y la respuesta debe cumplir JSON Schema estricto + validación Zod.
- Directorio de usuarios (`GET /api/users`) no expone emails.

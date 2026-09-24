# Arquitectura

Descripción técnica de la arquitectura de **Kanban Consultoria**: un monorepo con una SPA (frontend) y una API REST (backend) que comparten el mismo repositorio.

## Vista general

```
┌─────────────────────┐        ┌──────────────────────────────┐
│   Frontend (SPA)    │  /api  │          Backend (API)       │
│  React + Vite + TS  │ ─────► │   Express + TypeScript       │
│  src/ (cliente)     │  JSON  │   server/                    │
└─────────────────────┘        └──────────────┬───────────────┘
                                              │ Prisma (driver adapter)
                                              ▼
                                   ┌─────────────────────┐     ┌──────────────┐
                                   │   PostgreSQL 14+    │     │   OpenAI API  │
                                   │   prisma/           │     │ (Responses)  │
                                   └─────────────────────┘     └──────────────┘
```

## Frontend

- **SPA** construida con **Vite + React 19 + TypeScript** en `src/`.
- Cliente HTTP propio en `src/api.ts` (`fetch` con `credentials: 'include'` y manejo de errores `ApiError`).
- En desarrollo, Vite proxya `/api` a `http://localhost:4000` (`vite.config.ts`). En producción, frontend y API se sirven bajo la misma URL pública (CORS restringido a `FRONTEND_URL`).
- Vistas: Login, Resumen (dashboard), Tickets y Empresas. La vista Empresas incluye el detalle de la empresa, los diagnósticos, la matriz DOFA, el análisis IA, las recomendaciones y los planes de acción.
- Búsqueda con debounce (350 ms) en tickets y empresas.

## Backend

- **API REST** con **Express 5** en `server/`, arrancada desde `server/index.ts`.
- `server/app.ts` expone `createApp(db, aiService)`, lo que permite **inyección de dependencias** (base de datos simulada y servicio de IA falso en pruebas).
- Organización por dominio (rutas): `auth`, `users`, `tickets`, `companies`, `diagnostics`, `swot`, `ai-analysis`, `recommendations`, `action-plans`, `dashboard`.
- Middleware transversal:
  - CORS restringido a `FRONTEND_URL`.
  - `express.json` con límite de 1 MB.
  - Cabeceras de seguridad y `Cache-Control: no-store`.
  - Autenticación (`authMiddleware`) y autorización por rol (`authorize`).
  - Rate limiting en login y análisis IA.
  - Manejador único de errores (JSON mal formado → 400, `P2002` → 409, resto → 500 con log del mensaje).
- Configuración de entorno validada con **Zod** en `server/env.ts`; en producción rechaza valores de desarrollo para `DATABASE_URL` y `FRONTEND_URL`.

## Base de datos

- **PostgreSQL** accedido mediante **Prisma 7** con el driver adapter `@prisma/adapter-pg` (`server/prisma.ts`, pool de conexiones con `pipeline`).
- Modelo en `prisma/schema.prisma` y migraciones versionadas en `prisma/migrations/`.

Modelos principales:

| Modelo | Propósito |
|---|---|
| `User` | Usuarios con rol (`SUPERUSER`/`USER`) y hash de contraseña |
| `Session` | Sesiones con `tokenHash` (SHA-256) y expiración |
| `Ticket` | Solicitudes operativas con estado, prioridad y asignación |
| `Company` | Clientes/empresas con consultor responsable |
| `QualityDiagnostic` | Diagnósticos por empresa con estado (`DRAFT`/`IN_PROGRESS`/`COMPLETED`) |
| `SWOTAnalysis` / `SWOTItem` | Matriz DOFA (1 por diagnóstico) y factores |
| `AIAnalysis` | Resultado estructurado del análisis IA (1 por diagnóstico) |
| `Recommendation` | Recomendaciones con estado (pendiente/aceptada/rechazada) |
| `ActionPlan` / `ActionItem` | Planes de acción e ítems con responsable y vencimiento |

## Servicio de IA

- Aislado en `server/ai-service.ts` (`AIService`).
- Usa el SDK de OpenAI (`responses.create`) con **JSON Schema estricto** (`text.format.json_schema`, `strict: true`).
- El resultado se valida de nuevo con `aiAnalysisSchema` (Zod); si falla, lanza `AIServiceError('INVALID_RESPONSE')` (→ 502).
- Sin `OPENAI_API_KEY` el servicio queda deshabilitado y el endpoint responde 503.
- Se inyecta como dependencia en `createApp` para poder simularlo en tests sin llamadas reales.

## Módulos

| Módulo | Archivos clave | Responsabilidad |
|---|---|---|
| Autenticación | `server/auth.ts` | Sesiones, cookie, login/logout/me, autorización |
| Usuarios | rutas `/api/users` en `app.ts` | Directorio (sin emails) y creación solo SUPERUSER |
| Tickets | rutas `/api/tickets` | CRUD con alcance por creador/asignado |
| Empresas | rutas `/api/companies` | CRUD con alcance por consultor |
| Diagnósticos | rutas de diagnostics | CRUD anidado por empresa |
| DOFA | rutas de swot items | Factores de la matriz |
| Análisis IA | `server/ai-service.ts` | Generación y persistencia del análisis |
| Recomendaciones | rutas de recommendations | Importación desde IA y estado |
| Planes de acción | rutas de action-plans/items | Planes e ítems vinculados |
| Dashboard | `server/dashboard-service.ts` | Métricas y listas con alcance por rol |

## Flujo de datos

1. **Autenticación**: `POST /api/auth/login` valida credenciales (Zod + bcrypt con hash dummy), crea una sesión (`token` aleatorio, hash SHA-256 en BD, cookie `HttpOnly`) y devuelve el usuario público.
2. **Lectura protegida**: cada request autenticado resuelve la sesión, expone `request.user` y aplica **alcances por objeto** (empresa por `consultantId`, tickets por `createdById`/`assignedToId`, dashboard por rol).
3. **Diagnóstico → IA**: el backend lee el diagnóstico con sus factores DOFA y construye el payload para `AIService.analyze`; la IA responde JSON estricto que se valida con Zod y se persiste (`AIAnalysis` upsert).
4. **Recomendaciones**: `POST /api/diagnostics/:id/recommendations/import` lee el `AIAnalysis` persistido, extrae las recomendaciones y crea solo las que no existen por título (deduplicación).
5. **Planes de acción**: se crean por diagnóstico; los ítems validan que la recomendación pertenezca al mismo diagnóstico.
6. **Dashboard**: 13 consultas en paralelo (`Promise.all`) con filtros de alcance según rol/consultor.

# Kanban Consultoria

Plataforma web para consultoras que quieren ordenar el trabajo operativo y llevar sus diagnósticos estratégicos de un tablero de ideas a un plan de acción medible. Autenticación con roles, gestión de tickets, portafolio de clientes, diagnósticos **DOFA** y un **análisis estratégico asistido por IA** con respuestas estructuradas y validadas.

> **MVP v1.0.0** — módulo inicial de operación: autenticación, dashboard, tickets, empresas, diagnósticos DOFA, análisis IA, recomendaciones y planes de acción.

---

## Problema que resuelve

Las consultoras pequeñas y medianas suelen atender solicitudes, clientes y entregables de forma dispersa (correo, hojas de cálculo, chats), lo que provoca:

- solicitudes sin seguimiento ni responsable claro;
- diagnósticos estratégicos (DOFA) que no se convierten en recomendaciones ejecutables;
- imposibilidad de medir avance por cliente o por consultor;
- exposición de información de un consultor a otro por falta de control de acceso.

**Kanban Consultoria** concentra tickets, clientes y diagnósticos en un solo espacio de trabajo, aplica control de acceso por rol y por consultor, y conecta el análisis DOFA con un motor de IA que propone estrategias y recomendaciones **trazables** a los factores registrados.

## Características principales

- **Autenticación por sesión**: cookies `HttpOnly`, `SameSite=Lax` y `Secure` en producción, token con hash SHA-256 en la base de datos y expiración configurable.
- **Roles y permisos (RBAC)**: `SUPERUSER` con alcance global y `USER` (consultor) con alcance limitado a lo propio o asignado.
- **Tickets**: creación, edición, asignación, estados, prioridades, filtros y búsqueda.
- **Empresas**: portafolio de clientes con consultor responsable asignado.
- **Diagnósticos y matriz DOFA**: CRUD de diagnósticos y factores (fortalezas, debilidades, oportunidades y amenazas) con prioridad e impacto.
- **Análisis IA estructurado**: resumen ejecutivo, diagnóstico, hallazgos (FACT/INFERENCE), estrategias FO-DO-FA-DA, riesgos y oportunidades priorizados.
- **Recomendaciones**: importación desde el análisis IA (con deduplicación por título) y gestión de estado (pendiente, aceptada, rechazada).
- **Planes de acción**: planes con ítems, responsables y fechas de vencimiento, vinculados a recomendaciones.
- **Dashboard ejecutivo**: métricas de calidad (empresas, diagnósticos, recomendaciones, planes, acciones vencidas) filtradas por rol y consultor.
- **Seguridad**: validación Zod en todas las entradas, protección contra IDOR, rate limiting, CORS restringido, cabeceras de seguridad y manejo de errores controlado.

## Flujo funcional

1. El usuario inicia sesión y recibe una cookie de sesión.
2. El dashboard muestra métricas y accesos rápidos según su rol.
3. El consultor registra **empresas** y crea **diagnósticos** para cada cliente.
4. Construye la **matriz DOFA** con factores (tipo, prioridad, impacto).
5. Ejecuta el **análisis IA** (rate limited): la IA devuelve solo JSON estructurado que es validado antes de persistirse.
6. **Importa las recomendaciones** del análisis a la pestaña de recomendaciones.
7. Crea **planes de acción** con ítems, responsables y vencimientos asociados a las recomendaciones.
8. Hace seguimiento desde el dashboard (acciones en curso y vencidas) y los tickets operativos.

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 19, TypeScript, Vite, CSS propio |
| Backend | Node.js, Express 5, TypeScript |
| Base de datos | PostgreSQL 14+ |
| ORM | Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`) |
| IA | OpenAI SDK (Responses API, JSON Schema estricto) |
| Validación | Zod 4 |
| Autenticación | `bcryptjs` + sesiones en base de datos |
| Seguridad HTTP | `express-rate-limit`, `cors`, `cookie-parser`, cabeceras propias |
| Testing | Vitest + Supertest |

## Arquitectura

- **Frontend (SPA)**: un solo `index.html` servido por Vite; el cliente consume la API a través de un proxy `/api` en desarrollo y de la misma URL pública en producción.
- **Backend (API REST)**: Express con rutas organizadas por dominio (auth, users, tickets, companies, diagnostics, swot, ai-analysis, recommendations, action-plans, dashboard), middleware de autenticación/autorización y un único manejador de errores.
- **Base de datos (PostgreSQL)**: Prisma como ORM con migraciones versionadas; sesiones, usuarios, tickets, empresas, diagnósticos, DOFA, análisis IA, recomendaciones, planes e ítems.
- **Servicio de IA**: aislado en `server/ai-service.ts`; se inyecta en la app para permitir pruebas sin llamadas reales; si no hay `OPENAI_API_KEY` responde `503` de forma controlada.

Detalles en [docs/architecture.md](docs/architecture.md).

## Módulos

| Módulo | Backend | Frontend |
|---|---|---|
| Autenticación | `server/auth.ts`, rutas `/api/auth/*` | Login, sesión, logout |
| Usuarios | `/api/users` | Selección de responsables/asignados |
| Tickets | `/api/tickets` | Vista Tickets (filtros, búsqueda) |
| Empresas | `/api/companies` | Vista Empresas (CRUD, detalle) |
| Diagnósticos | `/api/companies/:id/diagnostics`, `/api/diagnostics/*` | Detalle de diagnóstico, formularios |
| DOFA | `/api/diagnostics/:id/swot/items`, `/api/swot/items/*` | Matriz de 4 cuadrantes |
| Análisis IA | `server/ai-service.ts`, `/api/diagnostics/:id/ai-analysis` | Botón "Analizar con IA" y panel |
| Recomendaciones | `/api/diagnostics/:id/recommendations`, `/api/recommendations/*` | Panel de recomendaciones e importación |
| Planes de acción | `/api/diagnostics/:id/action-plans`, `/api/action-plans/*` | Panel de planes e ítems |
| Dashboard | `server/dashboard-service.ts`, `/api/dashboard` | Resumen con métricas y listas |

## IA y análisis DOFA

El análisis IA solo recibe la información del diagnóstico (título, descripción, estado y factores DOFA) y está instruido para **no inventar hechos ni cifras**. Cada hallazgo se clasifica como `FACT` (explícito en los datos) o `INFERENCE` (inferencia razonable).

- La respuesta se genera con **JSON Schema estricto** (`strict: true`) y se valida de nuevo con Zod antes de persistir.
- Si la IA no devuelve JSON válido o no cumple el esquema, la API responde `502` sin guardar nada.
- Si no hay `OPENAI_API_KEY`, el endpoint responde `503` ("AI analysis is not configured").
- El endpoint tiene **rate limit** propio (15 solicitudes/hora) para evitar abuso de costos.

## Seguridad

- Contraseñas con `bcrypt` (cost 12) y **comparación contra un hash dummy** para no revelar si el correo existe.
- Sesiones: token aleatorio (32 bytes) almacenado como **hash SHA-256**; cookie `HttpOnly`, `SameSite=Lax`, `Secure` en producción.
- **RBAC**: rutas protegidas por rol (`SUPERUSER`/`USER`) y **por objeto** (empresas por consultor, tickets por creador/asignado, dashboard con alcances por rol) para bloquear **IDOR**.
- **Rate limiting** en login (10/15 min) y análisis IA (15/h); soporte para `TRUST_PROXY_HOPS` detrás de proxy.
- **Validación Zod** en todos los cuerpos y consultas; respuestas de error sin exponer detalles internos.
- **CORS** restringido a `FRONTEND_URL`; cabeceras `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Permitted-Cross-Domain-Policies`, `Cache-Control: no-store`, HSTS en producción y `X-Powered-By` deshabilitada.
- En producción el backend **se niega a arrancar** si `DATABASE_URL` o `FRONTEND_URL` quedan en los valores de desarrollo.
- **Secretos**: `.env` está en `.gitignore`; la clave de OpenAI solo se usa en el backend.

Detalles en [docs/security.md](docs/security.md).

## Testing

- **47 tests** (Vitest + Supertest) sobre schemas de validación, autenticación/autorización, CRUD, alcances por rol, protección IDOR, respuesta IA (con cliente simulado, sin llamadas reales), rate limiting, importación de recomendaciones y planes de acción.
- **E2E real (61/61 verificados)**: flujo completo contra PostgreSQL y OpenAI reales: login, empresa, diagnóstico, DOFA, análisis IA, persistencia, importación de recomendaciones, plan de acción, logout y permisos.

## Estructura del proyecto

```
.
├── docs/                    # Documentación técnica
│   ├── architecture.md
│   ├── api.md
│   ├── security.md
│   └── development.md
├── prisma/
│   ├── migrations/          # Migraciones versionadas
│   ├── schema.prisma        # Modelo de datos
│   └── seed.ts              # Seed de desarrollo
├── public/                  # Assets estáticos (favicon, iconos)
├── server/                  # Backend (Express)
│   ├── app.ts               # Rutas, middleware y manejador de errores
│   ├── auth.ts              # Sesiones, autenticación y autorización
│   ├── ai-service.ts        # Cliente OpenAI y validación de respuesta
│   ├── dashboard-service.ts # Métricas y alcances del dashboard
│   ├── validation.ts        # Schemas Zod
│   ├── env.ts               # Variables de entorno (Zod)
│   └── index.ts             # Punto de entrada (build de producción)
├── src/                     # Frontend (React + Vite)
├── .env.example             # Plantilla de variables de entorno
├── package.json
├── tsconfig*.json           # Configuración TypeScript (app, node, server)
└── vite.config.ts           # Proxy /api en desarrollo
```

## Requisitos

- Node.js 20+ (probado con Node 24)
- PostgreSQL 14+
- npm

## Instalación

```bash
git clone <url-del-repositorio>
cd kanban-consultoria
npm install
```

## Variables de entorno

Copia `.env.example` a `.env` y ajusta los valores:

```bash
cp .env.example .env
```

| Variable | Descripción | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test` o `production` | `development` |
| `PORT` | Puerto de la API | `4000` |
| `DATABASE_URL` | Conexión PostgreSQL | valor local de desarrollo |
| `FRONTEND_URL` | Origen permitido por CORS | `http://localhost:5173` |
| `SESSION_COOKIE` | Nombre de la cookie de sesión | `kanban_session` |
| `SESSION_DAYS` | Días de vida de la sesión | `30` |
| `TRUST_PROXY_HOPS` | Niveles de proxy reverso (0 si no hay) | `0` |
| `SEED_PASSWORD` | Contraseña de los usuarios del seed | — |
| `OPENAI_API_KEY` | Clave de OpenAI (opcional; sin ella la IA responde 503) | — |
| `OPENAI_MODEL` | Modelo para el análisis IA | `gpt-4o-mini` |

> En **producción**, `DATABASE_URL` y `FRONTEND_URL` son obligatorias y no pueden ser los valores de desarrollo (el backend no arranca si lo son). No se requiere `SEED_PASSWORD` en producción (el seed la rechaza).

## Desarrollo local

```bash
npm run dev:api   # API en http://localhost:4000
npm run dev       # Frontend en http://localhost:5173 (proxy /api)
```

## Migraciones Prisma

```bash
npm run db:generate    # Genera el cliente Prisma
npx prisma migrate dev # Aplica migraciones y crea el esquema (desarrollo)
npx prisma migrate deploy # Aplica migraciones existentes (producción)
```

> `prisma` es una devDependency: `npx prisma migrate deploy` debe ejecutarse donde estén instaladas las dependencias de desarrollo (máquina de build/CI), no con `npm install --omit=dev`.

## Seed

```bash
npm run db:seed
```

Crea dos usuarios de desarrollo con la contraseña de `SEED_PASSWORD`:

- `admin@kanban.local` — rol `SUPERUSER`
- `usuario@kanban.local` — rol `USER`

> El seed es **manual**: no existe ningún hook (`postinstall`, `prestart`) ni configuración de seed en `prisma.config.ts`, por lo que nunca se ejecuta automáticamente, tampoco en producción. En `NODE_ENV=production` exige `SEED_PASSWORD` explícita.

## Build de producción

```bash
npm run build        # Frontend (dist) + Backend (dist-server)
npm run build:server # Solo backend
```

## Ejecución de producción

```bash
npm run build   # Frontend (dist) + Backend (dist-server)
npm run start   # node dist-server/index.js (requiere el build previo)
```

Pasos del despliegue:

1. **Base de datos**: `npx prisma migrate deploy` aplica las 5 migraciones a `DATABASE_URL` (ver nota de devDependencies en Migraciones).
2. **Backend**: `npm run build` y `npm run start`. El arranque valida `NODE_ENV=production`, `DATABASE_URL` y `FRONTEND_URL` (rechaza valores de desarrollo) y habilita `Secure` en cookies y HSTS.
3. **Frontend**: la API no sirve archivos estáticos; `dist/` se publica con un servidor estático (nginx, Caddy, CDN), que debe:

   - servir `dist/` en `FRONTEND_URL` (o en el dominio público), y
   - redirigir `/api/*` por proxy reverso al backend (`PORT`).

   Ejemplo mínimo con nginx:

   ```nginx
   server {
     listen 443 ssl;
     server_name kanban.example.com;

     root /srv/kanban/dist;
     index index.html;

     location /api/ {
       proxy_pass http://127.0.0.1:4000;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }

     location / { try_files $uri /index.html; }
   }
   ```

   Con el proxy reverso, ajusta `TRUST_PROXY_HOPS=1` para que el rate limiting use la IP real del cliente y las cookies `Secure` viajen por HTTPS.
4. **Health check**: `GET /api/health` responde `{ "status": "ok" }` sin autenticación.

Detalles de despliegue en [docs/development.md](docs/development.md).

## Estado actual del proyecto

> Estado del release: **MVP v1.0.0** (tag `v1.0.0`).

**Implementado**

- Autenticación por sesión con roles y control de acceso por objeto.
- Dashboard con métricas, tickets, empresas, diagnósticos DOFA, análisis IA, recomendaciones y planes de acción.
- Seguridad integral (RBAC, IDOR, rate limiting, validación, cabeceras, secretos fuera del repositorio).
- 47 tests unitarios/integración y E2E real verificado (61/61).
- Build de producción para frontend y backend; `npm audit` con 0 vulnerabilidades.

**Futuras mejoras (no implementadas)**

- Módulo de **Reportes** (navegación ya lo sugiere como "Pronto" en la UI).
- Notificaciones.
- Limpieza programada (TTL) de sesiones expiradas.
- Refuerzos opcionales: 2FA, reCAPTCHA, panel de administración completo de usuarios.

---

## Portfolio Highlights

- **React + Vite** con TypeScript y UI propia (sin biblioteca de componentes).
- **Node.js + Express** API REST con manejo de errores centralizado.
- **PostgreSQL + Prisma** con migraciones versionadas y driver adapter nativo.
- **Integración con OpenAI** (Responses API) con **respuestas estructuradas** validadas por JSON Schema + Zod.
- **Análisis DOFA** conectado a estrategias y recomendaciones trazables generadas por IA.
- **RBAC** (roles `SUPERUSER`/`USER`) y **protección contra IDOR** verificada con tests.
- **47 tests** (Vitest + Supertest) en schemas, auth, CRUD, permisos e IA.
- **E2E real** con 61/61 verificaciones contra PostgreSQL y OpenAI.
- **`npm audit` con 0 vulnerabilidades** y endurecimiento de producción (HSTS, cookies `Secure`, guard de entorno, rate limiting).

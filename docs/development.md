# Desarrollo

Guía de instalación, configuración y flujo de trabajo de **Kanban Consultoria**.

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

## PostgreSQL

Crea la base de datos local (ajusta credenciales a tu entorno):

```bash
createdb kanban_consultoria
```

Alternativa con `psql`:

```bash
psql -U postgres -c "CREATE DATABASE kanban_consultoria;"
```

## Variables de entorno

```bash
cp .env.example .env
```

| Variable | Descripción | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test` o `production` | `development` |
| `PORT` | Puerto de la API | `4000` |
| `DATABASE_URL` | Conexión PostgreSQL (`postgresql://usuario:password@host:puerto/bd`) | valor local de desarrollo |
| `FRONTEND_URL` | Origen permitido por CORS | `http://localhost:5173` |
| `SESSION_COOKIE` | Nombre de la cookie de sesión | `kanban_session` |
| `SESSION_DAYS` | Días de vida de la sesión | `30` |
| `TRUST_PROXY_HOPS` | Niveles de proxy reverso (0 si no hay) | `0` |
| `SEED_PASSWORD` | Contraseña de los usuarios del seed | — |
| `OPENAI_API_KEY` | Clave de OpenAI (opcional; sin ella la IA responde 503) | — |
| `OPENAI_MODEL` | Modelo para el análisis IA | `gpt-4o-mini` |

> No se incluyen secretos reales en el repositorio. `.env` está en `.gitignore`.

## Prisma

```bash
npm run db:generate          # Genera el cliente Prisma
npx prisma migrate dev       # Crea/aplica migraciones (desarrollo)
npx prisma migrate deploy    # Aplica migraciones existentes (producción)
npx prisma migrate status    # Estado de las migraciones
npx prisma validate          # Valida schema y configuración
```

Los modelos viven en `prisma/schema.prisma`; las migraciones, en `prisma/migrations/`.

## Seed

```bash
npm run db:seed
```

Crea dos usuarios con la contraseña de `SEED_PASSWORD`:

- `admin@kanban.local` — rol `SUPERUSER`
- `usuario@kanban.local` — rol `USER`

El seed rechaza `SEED_PASSWORD` por defecto en producción.

## Desarrollo local

```bash
npm run dev:api   # API en http://localhost:4000 (tsx watch)
npm run dev       # Frontend en http://localhost:5173 (proxy /api)
```

## Tests

```bash
npm test          # Vitest (una ejecución)
npm run test:watch
```

**47 tests** cubren schemas de validación, autenticación/autorización, CRUD, alcances por rol, protección IDOR, respuestas de IA (con cliente simulado), rate limiting, importación de recomendaciones y planes de acción. Los tests no hacen llamadas reales a OpenAI.

**E2E real (verificado, 61/61)**: flujo completo contra PostgreSQL y OpenAI reales (login, empresa, diagnóstico, DOFA, análisis IA, persistencia, importación, plan de acción, logout, permisos).

## Lint y typecheck

```bash
npm run lint
npm run typecheck
```

`typecheck` valida frontend (`tsconfig.app.json`), tooling (`tsconfig.node.json`) y backend (`tsconfig.server.json`).

## Build

```bash
npm run build        # Frontend (dist/) + Backend (dist-server/)
npm run build:server # Solo backend
```

- Frontend: `tsc -b && vite build`.
- Backend: `tsc -p tsconfig.server.build.json` emite `server/` a `dist-server/` (excluye `*.test.ts`).
- `dist/` y `dist-server/` están en `.gitignore`.

## Producción

### Checklist de despliegue

1. **Entorno** (`.env` del servidor, con valores reales):

   - `NODE_ENV=production`
   - `PORT` (puerto del backend)
   - `DATABASE_URL` (PostgreSQL administrado, ej. RDS/Supabase/Neon)
   - `FRONTEND_URL` (origen público del frontend; CORS)
   - `OPENAI_API_KEY` (clave real del backend)
   - `TRUST_PROXY_HOPS` (1 por nivel de proxy reverso)
   - `SESSION_COOKIE` / `SESSION_DAYS` / `OPENAI_MODEL` (opcionales)

2. **Base de datos** — aplicar migraciones. `prisma` es una devDependency, así que esto debe ejecutarse donde estén instaladas las dependencias de desarrollo (build/CI), no con `npm install --omit=dev`:

   ```bash
   npx prisma migrate deploy   # aplica migraciones pendientes (idempotente)
   npx prisma migrate status   # verifica que la BD esté al día
   ```

   El seed **no** se ejecuta automáticamente: no hay hooks ni config de seed en `prisma.config.ts`. Para crear usuarios iniciales, ejecútalo manualmente una vez con `SEED_PASSWORD` real (`npm run db:seed`; en producción rechaza el valor por defecto).

3. **Build**:

   ```bash
   npm run build   # Frontend (dist/) + Backend (dist-server/)
   ```

4. **Backend** — arranca el compilado:

   ```bash
   npm run start   # node dist-server/index.js (requiere el build previo)
   ```

   Al iniciar en `NODE_ENV=production` valida `DATABASE_URL` y `FRONTEND_URL` (rechaza los valores de desarrollo), habilita cookies `Secure`, HSTS y el rate limiting con la IP real (`TRUST_PROXY_HOPS`).

5. **Frontend** — la API **no sirve archivos estáticos**; publica `dist/` con un servidor estático (nginx, Caddy, CDN) que redirija `/api/*` al backend por proxy reverso. Ejemplo nginx:

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

6. **Health check**: `GET /api/health` responde `200 { "status": "ok" }` sin autenticación (sonda de liveness del contenedor/orquestador).

Consideraciones:

- En producción el backend no arranca si `DATABASE_URL` o `FRONTEND_URL` son los valores de desarrollo.
- Detrás de un proxy reverso, ajusta `TRUST_PROXY_HOPS` para que el rate limiting use la IP real del cliente.
- En producción la cookie de sesión usa `Secure` y se envía HSTS.
- `migrate deploy` es idempotente: no hay migraciones pendientes → no aplica nada.

## Flujo de trabajo sugerido

1. `npm run db:migrate` tras cambiar `schema.prisma`.
2. `npm run db:seed` en bases de desarrollo vacías.
3. `npm run typecheck && npm run lint && npm test` antes de abrir un cambio.
4. `npm run build` y `npm run start` para validar el despliegue.

# Datos DEMO (seed idempotente)

`prisma/seed-demo.ts` crea un conjunto de **datos ficticios claramente marcados como demo** para
probar el flujo completo de riesgos: responsables, controles, evidencias, aprobaciones
(aprobado / rechazado / pendiente / desactualizado), tickets de seguimiento, notificaciones e
**historial de auditoría** (`RiskAuditEvent`) de cada riesgo.

No ejecuta migraciones, no modifica el esquema, no borra datos reales y **se niega a correr con
`NODE_ENV=production`**.

## Qué crea

| Entidad | Contenido |
| --- | --- |
| Empresa | `Corporación Demo EvidentIA S.A.S.` (NIT `909888777-1`, id `d0e00000-0000-4000-8000-000000000001`) |
| Usuarios | `demo.admin@evidentia.demo` (`COMPANY_ADMIN`), `demo.dueno.misional@evidentia.demo` y `demo.dueno.estrategico@evidentia.demo` (`COMPANY_USER`, dueños de riesgos) |
| Procesos | `Gestión del servicio al cliente` (`PRO-MIS-001`, MISSIONAL) y `Planeación y seguimiento estratégico` (`PRO-EST-001`, ESTRATEGIC) |
| Riesgos | `MIS-R1`, `MIS-R2`, `EST-R1`, `EST-R2` (códigos en el formato que emite el backend) |
| Escenarios | `MIS-R1` aprobado con ticket de seguimiento **En curso** · `MIS-R2` **rechazado** con comentario · `EST-R1` **pendiente** de decisión (notificación al dueño) · `EST-R2` aprobado y luego **desactualizado** (`OUTDATED`) tras una edición relevante |
| Auditoría | Eventos del ciclo de vida de los 4 riesgos (creación, controles, evidencias, envío/decisión de aprobación, ticket, cambio de estado del ticket, edición y marcado `OUTDATED`), con el mismo formato de resumen/metadata que escribe el backend |

La contraseña de los usuarios demo es la misma que el seed base: `SEED_PASSWORD` o, si no está
definida, `CambiarEstaClave123!` (se avisa en consola).

## Ejecutar

```bash
npm run db:seed:demo
```

Requisito: migraciones aplicadas (`npx prisma migrate deploy` en el entorno correspondiente) y
`DATABASE_URL` apuntando a la base deseada.

Es **idempotente**: volver a ejecutarlo repone los datos demo a su estado inicial. Los usuarios
demo que ya existen **no se modifican** (ni contraseña ni rol ni nombre); para resetearlos,
ejecuta la limpieza y vuelve a sembrar.

Si detecta que algo no es suyo, **aborta sin escribir nada**: otro registro con el NIT demo, un
riesgo ajeno que ya use `MIS-R1`/`MIS-R2`/`EST-R1`/`EST-R2`, procesos homónimos en la empresa
demo o correos demo asociados a otra empresa.

## Recorrer el escenario en la app

Entra con cualquiera de los usuarios demo y revisa:

- **Procesos →** los dos procesos demo, sus riesgos y, en el detalle de cada riesgo, la sección
  **Trazabilidad / Historial del riesgo** (eventos con actor, fecha, cambios antes/después y
  enlaces a la aprobación y al ticket).
- **Mis aprobaciones** (`demo.dueno.estrategico@evidentia.demo` ve `EST-R1` pendiente; el dueño
  o el admin pueden decidirlo para ver el ciclo completo).
- **Tickets**: los tickets `MIS-R1 · …` (En curso) y `EST-R2 · …` (Abierto), derivados de las
  aprobaciones aprobadas.
- **Campanita** de notificaciones (3 avisos demo: 1 pendiente, 1 aprobado leído, 1 rechazado leído).

## Limpiar (solo datos demo)

```bash
npm run db:seed:demo:clean
```

Elimina **únicamente** las filas creadas por el seed demo, en orden seguro respecto a las
restricciones de clave foránea: notificaciones, eventos de auditoría, aprobaciones, controles,
evidencias, tickets demo, riesgos, historial de cambios de procesos demo, procesos demo,
diagnósticos de calidad de la empresa demo, usuarios demo y la empresa demo.

Nunca borra: otros usuarios (ni siquiera los del seed base `admin@kanban.local` y compañía),
otras empresas, procesos que no sean los dos ids demo, ni tickets que el seed no creó. Antes de
borrar verifica que no queden restos ajenos (procesos extra en la empresa demo, tickets creados
por los usuarios demo fuera del seed) y, si los encuentra, **aborta explicando qué falta limpiar
a mano**; no toca esos datos.

Nota: `RiskCodeSequence` (el contador de `MIS-Rn`/`EST-Rn`) **no se rebaja**. Tras la limpieza la
API seguirá emitiendo códigos con los números que falten, sin conflictos con los borrados.

## Archivos

- `prisma/seed-demo.ts` — el seed (argumento `clean` para la limpieza).
- `prisma/seed.ts` — seed base (empresa "Alimentos Andinos" + 3 usuarios); no se toca.
- `package.json` — scripts `db:seed:demo` y `db:seed:demo:clean`.

/**
 * Seed DEMO idempotente de EvidentIA.
 *
 * Crea (o repone) un conjunto de datos ficticios claramente marcados como demo: una empresa
 * demo, sus usuarios, dos procesos, cuatro riesgos con responsables, controles, evidencias,
 * ciclos de aprobación (aprobado, rechazado, pendiente y desactualizado), tickets de seguimiento,
 * notificaciones y el historial de auditoría (RiskAuditEvent) del ciclo de vida de cada riesgo.
 *
 * Reglas del seed:
 *  - No ejecuta migraciones ni toca el esquema.
 *  - No borra ni sobrescribe usuarios existentes: los usuarios demo solo se crean si faltan.
 *  - No elimina datos reales: todo lo que escribe usa ids determinísticos propios (d0e0…-…) y,
 *    si detecta colisiones con datos que no son suyos (otra empresa con el mismo NIT, un riesgo
 *    con los códigos MIS-R1/EST-R1… ajenos, procesos homónimos), aborta sin escribir nada.
 *  - Re-ejecutarlo es seguro: repone los datos demo a su estado inicial (los usuarios demo ya
 *    existentes se conservan tal cual, incluida su contraseña).
 *  - Se niega a ejecutarse con NODE_ENV=production.
 *
 * Ejecución y limpieza (solo datos demo): ver docs/seed-demo.md.
 *   npm run db:seed:demo          # crea/repara datos demo
 *   npm run db:seed:demo:clean    # elimina SOLO los datos demo
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import type { Prisma, RiskAuditEventType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PoolConfig } from 'pg'
import bcrypt from 'bcryptjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/kanban_consultoria'

const adapter = new PrismaPg({ connectionString, pipeline: true } as PoolConfig)
const prisma = new PrismaClient({ adapter })

type Tx = Prisma.TransactionClient

// ---- Ids determinísticos (UUID con forma v4: pasan z.string().uuid() de idReference) ----

const demoId = (n: number): string => `d0e00000-0000-4000-8000-${String(n).padStart(12, '0')}`

const COMPANY_ID = demoId(1)
const ADMIN_ID = demoId(10)
const OWNER_MISSIONAL_ID = demoId(11)
const OWNER_STRATEGIC_ID = demoId(12)

const PROCESS_MISSIONAL_ID = demoId(20)
const PROCESS_STRATEGIC_ID = demoId(21)

const RISK_MIS_R1_ID = demoId(30)
const RISK_MIS_R2_ID = demoId(31)
const RISK_EST_R1_ID = demoId(32)
const RISK_EST_R2_ID = demoId(33)

const RISK_IDS = [RISK_MIS_R1_ID, RISK_MIS_R2_ID, RISK_EST_R1_ID, RISK_EST_R2_ID]
const PROCESS_IDS = [PROCESS_MISSIONAL_ID, PROCESS_STRATEGIC_ID]

const TICKET_MIS_R1_ID = demoId(70)
const TICKET_EST_R2_ID = demoId(71)
const TICKET_IDS = [TICKET_MIS_R1_ID, TICKET_EST_R2_ID]

const APPROVAL_MIS_R1_ID = demoId(60)
const APPROVAL_MIS_R2_ID = demoId(61)
const APPROVAL_EST_R1_ID = demoId(62)
const APPROVAL_EST_R2_ID = demoId(63)

const DEMO_IDENTIFICATION = '909888777-1'
const DEMO_COMPANY_NAME = 'Corporación Demo EvidentIA S.A.S.'

// ---- Textos con marca DEMO ----

const DEMO_USERS = [
  { id: ADMIN_ID, name: 'Demo Admin EvidentIA', email: 'demo.admin@evidentia.demo', role: 'COMPANY_ADMIN' as const },
  { id: OWNER_MISSIONAL_ID, name: 'Demo Dueño Misional', email: 'demo.dueno.misional@evidentia.demo', role: 'COMPANY_USER' as const },
  { id: OWNER_STRATEGIC_ID, name: 'Demo Dueño Estratégico', email: 'demo.dueno.estrategico@evidentia.demo', role: 'COMPANY_USER' as const },
]

// Estilos de fecha: la historia demo se cuenta hacia atrás desde el día de la ejecución para que
// la traza siempre se vea "reciente". Cada evento ocupa un minuto distinto para que el orden del
// historial (occurredAt desc, id desc) sea determinista.
const at = (daysAgo: number, minutes = 0): Date => new Date(Date.now() - daysAgo * 86_400_000 + minutes * 60_000)

const approvalLink = (approvalId: string): string => `approvals/${approvalId}`

const ticketDescription = (
  riskDescription: string,
  processName: string,
  processCode: string,
  levelName: string,
  score: number,
  riskId: string,
  processId: string,
): string =>
  `Riesgo aprobado y aceptado por su dueño.\n\n${riskDescription}\n\nProceso: ${processName} (${processCode})\nNivel inherente: ${levelName} (${score})\nReferencia: riesgo ${riskId} del proceso ${processId}`

// ---- Guardas de seguridad ----

const fail = (message: string): never => {
  throw new Error(`[seed-demo] ${message}`)
}

/** El NIT demo solo puede pertenecer a la empresa demo; si lo tiene otra, no se escribe nada. */
const assertDemoCompanySlot = async (tx: Tx): Promise<void> => {
  const byId = await tx.company.findUnique({ where: { id: COMPANY_ID }, select: { id: true, identification: true } })
  const byNit = await tx.company.findUnique({ where: { identification: DEMO_IDENTIFICATION }, select: { id: true } })
  if (byId && byId.identification !== DEMO_IDENTIFICATION) {
    fail(`la empresa con id ${COMPANY_ID} existe pero no es la demo (NIT ${byId.identification}). No se modifica; revisa la base.`)
  }
  if (byNit && byNit.id !== COMPANY_ID) {
    fail(`el NIT ${DEMO_IDENTIFICATION} ya pertenece a otra empresa (id ${byNit.id}). Elige otro NIT de demo o elimina ese registro manualmente.`)
  }
}

/** Un correo demo ya existente nunca se toca: si pertenece a otra empresa, se aborta. */
const assertDemoUserSlot = async (tx: Tx, user: (typeof DEMO_USERS)[number]): Promise<'absent' | 'ours'> => {
  const byEmail = await tx.user.findUnique({ where: { email: user.email }, select: { id: true, companyId: true } })
  const byId = await tx.user.findUnique({ where: { id: user.id }, select: { email: true } })
  if (byEmail && byEmail.id !== user.id) {
    fail(`el correo ${user.email} ya existe con otro id (${byEmail.id}); no se sobrescribe usuarios existentes.`)
  }
  if (byEmail && byEmail.companyId && byEmail.companyId !== COMPANY_ID) {
    fail(`el usuario demo ${user.email} pertenece a la empresa ${byEmail.companyId}; no se modifica.`)
  }
  if (byId && byId.email !== user.email) {
    fail(`el id ${user.id} ya corresponde a otro usuario (${byId.email}); no se sobrescribe.`)
  }
  return byEmail ? 'ours' : 'absent'
}

/** Liberar el slot de código si el que existe es nuestro; si es de otro riesgo, abortar. */
const assertCodeSlot = async (tx: Tx, code: string, riskId: string): Promise<void> => {
  const existing = await tx.risk.findUnique({ where: { code }, select: { id: true } })
  if (existing && existing.id !== riskId) {
    fail(`el código de riesgo ${code} ya lo usa otro riesgo (id ${existing.id}). No se renumera riesgos reales; usa la base vacía o limpia esos códigos.`)
  }
}

const assertProcessSlot = async (tx: Tx, processId: string, companyId: string, name: string): Promise<void> => {
  const existing = await tx.process.findFirst({ where: { companyId, name }, select: { id: true } })
  if (existing && existing.id !== processId) {
    fail(`el proceso "${name}" ya existe en la empresa demo con otro id (${existing.id}); no se sobrescribe.`)
  }
}

// ---- Seed ----

const upsertDemoUsers = async (tx: Tx, passwordHash: string): Promise<void> => {
  for (const user of DEMO_USERS) {
    const state = await assertDemoUserSlot(tx, user)
    if (state === 'ours') continue // Usuario demo ya creado: se conserva sin cambios (rol, nombre, contraseña).
    await tx.user.create({
      data: { id: user.id, name: user.name, email: user.email, passwordHash, role: user.role, companyId: COMPANY_ID },
    })
  }
}

const upsertDemoProcesses = async (tx: Tx): Promise<void> => {
  await assertProcessSlot(tx, PROCESS_MISSIONAL_ID, COMPANY_ID, 'Gestión del servicio al cliente')
  await assertProcessSlot(tx, PROCESS_STRATEGIC_ID, COMPANY_ID, 'Planeación y seguimiento estratégico')

  await tx.process.upsert({
    where: { id: PROCESS_MISSIONAL_ID },
    create: {
      id: PROCESS_MISSIONAL_ID,
      companyId: COMPANY_ID,
      name: 'Gestión del servicio al cliente',
      type: 'MISSIONAL',
      objective: 'Atender las solicitudes de los clientes dentro de los compromisos de nivel de servicio acordados.',
      code: 'PRO-MIS-001',
      version: '1.0',
      status: 'ACTIVE',
      frequency: 'Diaria',
      organizationalArea: 'Servicio al cliente',
      personalData: true,
      critical: true,
      responsibleId: ADMIN_ID,
    },
    update: {
      name: 'Gestión del servicio al cliente',
      type: 'MISSIONAL',
      objective: 'Atender las solicitudes de los clientes dentro de los compromisos de nivel de servicio acordados.',
      version: '1.0',
      status: 'ACTIVE',
      frequency: 'Diaria',
      organizationalArea: 'Servicio al cliente',
      personalData: true,
      critical: true,
      responsibleId: ADMIN_ID,
    },
  })

  await tx.process.upsert({
    where: { id: PROCESS_STRATEGIC_ID },
    create: {
      id: PROCESS_STRATEGIC_ID,
      companyId: COMPANY_ID,
      name: 'Planeación y seguimiento estratégico',
      type: 'STRATEGIC',
      objective: 'Definir la hoja de ruta institucional y asegurar la alineación entre objetivos, presupuesto y proveedores críticos.',
      code: 'PRO-EST-001',
      version: '1.0',
      status: 'ACTIVE',
      frequency: 'Trimestral',
      organizationalArea: 'Dirección estratégica',
      critical: true,
      responsibleId: ADMIN_ID,
    },
    update: {
      name: 'Planeación y seguimiento estratégico',
      type: 'STRATEGIC',
      objective: 'Definir la hoja de ruta institucional y asegurar la alineación entre objetivos, presupuesto y proveedores críticos.',
      version: '1.0',
      status: 'ACTIVE',
      frequency: 'Trimestral',
      organizationalArea: 'Dirección estratégica',
      critical: true,
      responsibleId: ADMIN_ID,
    },
  })
}

/**
 * Cuatro riesgos con sus escenarios:
 *  MIS-R1 (aprobado + ticket en curso)  · MIS-R2 (rechazado con comentario)
 *  EST-R1 (pendiente de aprobación)     · EST-R2 (aprobado y luego desactualizado)
 */
const upsertDemoRisks = async (tx: Tx): Promise<void> => {
  await assertCodeSlot(tx, 'MIS-R1', RISK_MIS_R1_ID)
  await assertCodeSlot(tx, 'MIS-R2', RISK_MIS_R2_ID)
  await assertCodeSlot(tx, 'EST-R1', RISK_EST_R1_ID)
  await assertCodeSlot(tx, 'EST-R2', RISK_EST_R2_ID)

  const risks: Array<Prisma.RiskUncheckedCreateInput & { id: string }> = [
    {
      id: RISK_MIS_R1_ID,
      processId: PROCESS_MISSIONAL_ID,
      name: 'Demora en la atención de solicitudes críticas de clientes',
      description: 'Las solicitudes críticas de clientes estratégicos superan el tiempo comprometido del nivel de servicio, generando insatisfacción y riesgo de pérdida de contratos.',
      riskType: 'MISIONAL',
      code: 'MIS-R1',
      bpmnActivity: 'Registrar y clasificar solicitud del cliente',
      riskOwnerId: OWNER_MISSIONAL_ID,
      acceptanceStatus: 'ACCEPTED',
      treatment: 'MITIGATE',
      mitigationOwnerId: ADMIN_ID,
      mitigationDueDate: at(-30),
      inherentImpact: 4,
      inherentProbability: 4,
      residualImpact: 2,
      residualProbability: 2,
      createdAt: at(13, 5),
    },
    {
      id: RISK_MIS_R2_ID,
      processId: PROCESS_MISSIONAL_ID,
      name: 'Pérdida de información de clientes en el sistema de gestión',
      description: 'La ausencia de respaldos verificados puede provocar la pérdida irreversible de la información de los clientes registrada en el sistema de gestión.',
      riskType: 'MISIONAL',
      code: 'MIS-R2',
      bpmnActivity: 'Almacenar información del cliente en el sistema',
      riskOwnerId: OWNER_MISSIONAL_ID,
      acceptanceStatus: 'REJECTED',
      treatment: 'MITIGATE',
      mitigationOwnerId: ADMIN_ID,
      mitigationDueDate: at(-20),
      inherentImpact: 5,
      inherentProbability: 4,
      residualImpact: 3,
      residualProbability: 3,
      createdAt: at(11, 5),
    },
    {
      id: RISK_EST_R1_ID,
      processId: PROCESS_STRATEGIC_ID,
      name: 'Desalineación entre el plan estratégico y la asignación de recursos',
      description: 'Los objetivos estratégicos anuales no se traducen en presupuesto ni en capacidad humana asignada, y el seguimiento se hace sin indicadores confiables.',
      riskType: 'ESTRATEGICO',
      code: 'EST-R1',
      bpmnActivity: 'Aprobar el plan estratégico anual',
      riskOwnerId: OWNER_STRATEGIC_ID,
      acceptanceStatus: 'PENDING',
      treatment: null,
      inherentImpact: 3,
      inherentProbability: 3,
      residualImpact: 1,
      residualProbability: 1,
      createdAt: at(6, 5),
    },
    {
      id: RISK_EST_R2_ID,
      processId: PROCESS_STRATEGIC_ID,
      name: 'Dependencia de un proveedor crítico sin plan de contingencia',
      description: 'La interrupción del proveedor único de tecnología afectaría la operación completa, sin proveedor alterno ni acuerdo de contingencia vigente.',
      riskType: 'ESTRATEGICO',
      code: 'EST-R2',
      bpmnActivity: 'Seleccionar y evaluar proveedores estratégicos',
      riskOwnerId: OWNER_STRATEGIC_ID,
      acceptanceStatus: 'ACCEPTED',
      treatment: 'TRANSFER',
      mitigationOwnerId: OWNER_STRATEGIC_ID,
      mitigationDueDate: at(-25),
      inherentImpact: 4,
      inherentProbability: 3,
      residualImpact: 2,
      residualProbability: 3,
      createdAt: at(9, 5),
    },
  ]

  for (const risk of risks) {
    const { id, ...data } = risk
    await tx.risk.upsert({
      where: { id },
      create: risk,
      update: {
        name: data.name,
        description: data.description,
        riskType: data.riskType,
        bpmnActivity: data.bpmnActivity,
        riskOwnerId: data.riskOwnerId,
        acceptanceStatus: data.acceptanceStatus,
        treatment: data.treatment,
        mitigationOwnerId: data.mitigationOwnerId,
        mitigationDueDate: data.mitigationDueDate,
        inherentImpact: data.inherentImpact,
        inherentProbability: data.inherentProbability,
        residualImpact: data.residualImpact,
        residualProbability: data.residualProbability,
      },
    })
  }
}

const upsertDemoControls = async (tx: Tx): Promise<void> => {
  const controls = [
    { id: demoId(40), riskId: RISK_MIS_R1_ID, description: 'Tablero diario de solicitudes críticas con alerta al superar el 80 % del tiempo del nivel de servicio.', evaluation: 'EFFECTIVE' as const, createdAt: at(13, 60) },
    { id: demoId(41), riskId: RISK_MIS_R1_ID, description: 'Escalación automática al líder del área cuando una solicitud crítica cumple la mitad de su tiempo límite.', evaluation: 'PARTIAL' as const, createdAt: at(13, 120) },
    { id: demoId(42), riskId: RISK_MIS_R2_ID, description: 'Respaldo diario de la base de datos del sistema de gestión en almacenamiento externo.', evaluation: 'WEAK' as const, createdAt: at(11, 60) },
    { id: demoId(43), riskId: RISK_EST_R1_ID, description: 'Revisión trimestral del plan estratégico con mapa de objetivos y presupuesto asociado.', evaluation: 'PENDING' as const, createdAt: at(5, 60) },
    { id: demoId(44), riskId: RISK_EST_R2_ID, description: 'Acuerdo de continuidad con un proveedor alterno de tecnología y prueba semestral de conmutación.', evaluation: 'EFFECTIVE' as const, createdAt: at(9, 120) },
  ]
  for (const control of controls) {
    await tx.riskControl.upsert({
      where: { id: control.id },
      create: control,
      update: { description: control.description, evaluation: control.evaluation },
    })
  }
}

const upsertDemoEvidences = async (tx: Tx): Promise<void> => {
  const evidences = [
    { id: demoId(50), riskId: RISK_MIS_R1_ID, name: 'Política de nivel de servicio 2026', description: 'Documento aprobado con los tiempos de respuesta comprometidos por tipo de solicitud.', url: 'https://demo.evidentia.local/politica-nivel-servicio.pdf', createdAt: at(12, 30) },
    { id: demoId(51), riskId: RISK_MIS_R1_ID, name: 'Reporte semanal de cumplimiento de SLA', description: 'Exportación del tablero de solicitudes con el cumplimiento de los últimos 30 días.', url: 'https://demo.evidentia.local/reportes/sla-semanal.csv', createdAt: at(7, 45) },
    { id: demoId(52), riskId: RISK_MIS_R2_ID, name: 'Registro de respaldos de la base de datos', description: 'Log de los respaldos automáticos ejecutados en el último mes con su resultado.', url: 'https://demo.evidentia.local/respaldos/log-backup.txt', createdAt: at(10, 30) },
    { id: demoId(53), riskId: RISK_EST_R1_ID, name: 'Matriz de objetivos vs. presupuesto 2026', description: 'Cruce del plan estratégico con la asignación presupuestal aprobada por área.', url: 'https://demo.evidentia.local/estrategia/matriz-objetivos.xlsx', createdAt: at(5, 30) },
    { id: demoId(54), riskId: RISK_EST_R2_ID, name: 'Acuerdo de continuidad con proveedor alterno', description: 'Carta de compromiso del proveedor alterno con tiempos de respuesta y contactos de emergencia.', url: 'https://demo.evidentia.local/estrategia/acuerdo-continuidad.pdf', createdAt: at(8, 30) },
  ]
  for (const evidence of evidences) {
    await tx.riskEvidence.upsert({
      where: { id: evidence.id },
      create: evidence,
      update: { name: evidence.name, description: evidence.description, url: evidence.url },
    })
  }
}

/**
 * Ciclos de aprobación: uno por riesgo. Solo EST-R1 queda PENDING con openKey = riskId (la
 * restricción única garantiza un único ciclo abierto por riesgo); los decididos conservan
 * decidedBy/decidedAt/comentario, y los aprobados conservan su ticket de seguimiento.
 */
const upsertDemoApprovals = async (tx: Tx): Promise<void> => {
  await tx.riskApproval.upsert({
    where: { id: APPROVAL_MIS_R1_ID },
    create: {
      id: APPROVAL_MIS_R1_ID,
      riskId: RISK_MIS_R1_ID,
      requestedById: ADMIN_ID,
      status: 'APPROVED',
      decidedById: OWNER_MISSIONAL_ID,
      decidedAt: at(9, 90),
      comment: 'Plan de mitigación suficiente; se aprueba con seguimiento mediante ticket.',
      ticketId: TICKET_MIS_R1_ID,
      createdAt: at(10, 60),
    },
    update: {
      status: 'APPROVED',
      openKey: null,
      decidedById: OWNER_MISSIONAL_ID,
      decidedAt: at(9, 90),
      comment: 'Plan de mitigación suficiente; se aprueba con seguimiento mediante ticket.',
      ticketId: TICKET_MIS_R1_ID,
    },
  })

  await tx.riskApproval.upsert({
    where: { id: APPROVAL_MIS_R2_ID },
    create: {
      id: APPROVAL_MIS_R2_ID,
      riskId: RISK_MIS_R2_ID,
      requestedById: ADMIN_ID,
      status: 'REJECTED',
      decidedById: ADMIN_ID,
      decidedAt: at(7, 90),
      comment: 'El control propuesto no cubre el escenario de pérdida de datos; se requiere una nueva evaluación con respaldo verificable.',
      createdAt: at(8, 60),
    },
    update: {
      status: 'REJECTED',
      openKey: null,
      decidedById: ADMIN_ID,
      decidedAt: at(7, 90),
      comment: 'El control propuesto no cubre el escenario de pérdida de datos; se requiere una nueva evaluación con respaldo verificable.',
      ticketId: null,
    },
  })

  await tx.riskApproval.upsert({
    where: { id: APPROVAL_EST_R1_ID },
    create: {
      id: APPROVAL_EST_R1_ID,
      riskId: RISK_EST_R1_ID,
      requestedById: ADMIN_ID,
      status: 'PENDING',
      openKey: RISK_EST_R1_ID,
      createdAt: at(3, 60),
    },
    update: {
      status: 'PENDING',
      openKey: RISK_EST_R1_ID,
      decidedById: null,
      decidedAt: null,
      comment: null,
      ticketId: null,
    },
  })

  await tx.riskApproval.upsert({
    where: { id: APPROVAL_EST_R2_ID },
    create: {
      id: APPROVAL_EST_R2_ID,
      riskId: RISK_EST_R2_ID,
      requestedById: ADMIN_ID,
      status: 'OUTDATED',
      decidedById: OWNER_STRATEGIC_ID,
      decidedAt: at(5, 90),
      comment: 'Se aprueba el tratamiento de transferencia con el proveedor alterno.',
      ticketId: TICKET_EST_R2_ID,
      createdAt: at(6, 60),
    },
    update: {
      status: 'OUTDATED',
      openKey: null,
      decidedById: OWNER_STRATEGIC_ID,
      decidedAt: at(5, 90),
      comment: 'Se aprueba el tratamiento de transferencia con el proveedor alterno.',
      ticketId: TICKET_EST_R2_ID,
    },
  })
}

const upsertDemoTickets = async (tx: Tx): Promise<void> => {
  await tx.ticket.upsert({
    where: { id: TICKET_MIS_R1_ID },
    create: {
      id: TICKET_MIS_R1_ID,
      title: 'MIS-R1 · Demora en la atención de solicitudes críticas de clientes',
      description: ticketDescription(
        'Las solicitudes críticas de clientes estratégicos superan el tiempo comprometido del nivel de servicio, generando insatisfacción y riesgo de pérdida de contratos.',
        'Gestión del servicio al cliente',
        'PRO-MIS-001',
        'Alto',
        16,
        RISK_MIS_R1_ID,
        PROCESS_MISSIONAL_ID,
      ),
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      createdById: OWNER_MISSIONAL_ID,
      assignedToId: OWNER_MISSIONAL_ID,
      createdAt: at(9, 90),
    },
    update: {
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: OWNER_MISSIONAL_ID,
    },
  })

  await tx.ticket.upsert({
    where: { id: TICKET_EST_R2_ID },
    create: {
      id: TICKET_EST_R2_ID,
      title: 'EST-R2 · Dependencia de un proveedor crítico sin plan de contingencia',
      description: ticketDescription(
        'La interrupción del proveedor único de tecnología afectaría la operación completa, sin proveedor alterno ni acuerdo de contingencia vigente.',
        'Planeación y seguimiento estratégico',
        'PRO-EST-001',
        'Medio',
        12,
        RISK_EST_R2_ID,
        PROCESS_STRATEGIC_ID,
      ),
      status: 'OPEN',
      priority: 'MEDIUM',
      createdById: OWNER_STRATEGIC_ID,
      assignedToId: OWNER_STRATEGIC_ID,
      createdAt: at(5, 90),
    },
    update: {
      status: 'OPEN',
      priority: 'MEDIUM',
      assignedToId: OWNER_STRATEGIC_ID,
    },
  })
}

const upsertDemoNotifications = async (tx: Tx): Promise<void> => {
  const notifications = [
    {
      id: demoId(80),
      userId: OWNER_STRATEGIC_ID,
      title: 'Riesgo EST-R1 pendiente de tu revisión',
      body: '«Desalineación entre el plan estratégico y la asignación de recursos» está esperando tu aprobación. Nivel inherente: Medio (9).',
      link: approvalLink(APPROVAL_EST_R1_ID),
      readAt: null as Date | null,
    },
    {
      id: demoId(81),
      userId: ADMIN_ID,
      title: 'Riesgo MIS-R1 aprobado',
      body: '«Demora en la atención de solicitudes críticas de clientes» fue aprobado y aceptado; se generó un ticket de seguimiento.',
      link: approvalLink(APPROVAL_MIS_R1_ID),
      readAt: at(9, 100),
    },
    {
      id: demoId(82),
      userId: ADMIN_ID,
      title: 'Riesgo MIS-R2 rechazado',
      body: '«Pérdida de información de clientes en el sistema de gestión» fue rechazado por Demo Dueño Misional (nivel inherente Alto (20)). Motivo: El control propuesto no cubre el escenario de pérdida de datos; se requiere una nueva evaluación con respaldo verificable.',
      link: approvalLink(APPROVAL_MIS_R2_ID),
      readAt: at(7, 100),
    },
  ]
  for (const notification of notifications) {
    await tx.notification.upsert({
      where: { id: notification.id },
      create: notification,
      update: { title: notification.title, body: notification.body, link: notification.link, readAt: notification.readAt },
    })
  }
}

type DemoAuditEvent = {
  id: string
  riskId: string
  eventType: RiskAuditEventType
  summary: string
  occurredAt: Date
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  changes?: Prisma.InputJsonValue
  metadata?: Prisma.InputJsonValue
}

const audit = (
  id: number,
  riskId: string,
  eventType: DemoAuditEvent['eventType'],
  summary: string,
  occurredAt: Date,
  actor: { id: string; name: string; email: string } | null,
  extra: { changes?: unknown; metadata?: unknown } = {},
): DemoAuditEvent => ({
  id: demoId(id),
  riskId,
  eventType,
  summary,
  occurredAt,
  actorId: actor?.id ?? null,
  actorName: actor?.name ?? null,
  actorEmail: actor?.email ?? null,
  ...(extra.changes !== undefined ? { changes: extra.changes as Prisma.InputJsonValue } : {}),
  ...(extra.metadata !== undefined ? { metadata: extra.metadata as Prisma.InputJsonValue } : {}),
})

const ADMIN_ACTOR = { id: ADMIN_ID, name: 'Demo Admin EvidentIA', email: 'demo.admin@evidentia.demo' }
const OWNER_MISSIONAL_ACTOR = { id: OWNER_MISSIONAL_ID, name: 'Demo Dueño Misional', email: 'demo.dueno.misional@evidentia.demo' }
const OWNER_STRATEGIC_ACTOR = { id: OWNER_STRATEGIC_ID, name: 'Demo Dueño Estratégico', email: 'demo.dueno.estrategico@evidentia.demo' }

const change = (field: string, label: string, previousValue: string | number | boolean | null, newValue: string | number | boolean | null) =>
  ({ field, label, previousValue, newValue })

/**
 * Historial de auditoría con el MISMO formato que escribe el backend (resúmenes en español,
 * before/after por campo y metadata mínima). Los ids son fijos para que la re-ejecución
 * reemplace (upsert) los eventos demo en lugar de duplicarlos.
 */
const upsertDemoAuditEvents = async (tx: Tx): Promise<void> => {
  const events: DemoAuditEvent[] = [
    // ---- MIS-R1: aprobado, con ticket que avanzó a "En curso" ----
    audit(100, RISK_MIS_R1_ID, 'RISK_CREATED', 'Riesgo MIS-R1 creado', at(13, 5), ADMIN_ACTOR, {
      changes: [
        change('code', 'Código', null, 'MIS-R1'),
        change('name', 'Nombre', null, 'Demora en la atención de solicitudes críticas de clientes'),
        change('description', 'Descripción', null, 'Las solicitudes críticas de clientes estratégicos superan el tiempo comprometido del nivel de servicio, generando insatisfacción y riesgo de pérdida de contratos.'),
        change('riskOwnerId', 'Dueño del riesgo', null, 'Demo Dueño Misional'),
        change('inherentImpact', 'Impacto inherente', null, 4),
        change('inherentProbability', 'Probabilidad inherente', null, 4),
      ],
    }),
    audit(101, RISK_MIS_R1_ID, 'CONTROL_CREATED', 'Control agregado', at(13, 60), ADMIN_ACTOR, {
      changes: [
        change('description', 'Descripción del control', null, 'Tablero diario de solicitudes críticas con alerta al superar el 80 % del tiempo del nivel de servicio.'),
        change('evaluation', 'Evaluación de efectividad', null, 'EFFECTIVE'),
      ],
    }),
    audit(102, RISK_MIS_R1_ID, 'CONTROL_CREATED', 'Control agregado', at(13, 120), ADMIN_ACTOR, {
      changes: [
        change('description', 'Descripción del control', null, 'Escalación automática al líder del área cuando una solicitud crítica cumple la mitad de su tiempo límite.'),
        change('evaluation', 'Evaluación de efectividad', null, 'PARTIAL'),
      ],
    }),
    audit(103, RISK_MIS_R1_ID, 'EVIDENCE_CREATED', 'Evidencia agregada', at(12, 30), ADMIN_ACTOR, {
      changes: [
        change('name', 'Nombre de la evidencia', null, 'Política de nivel de servicio 2026'),
        change('description', 'Descripción de la evidencia', null, 'Documento aprobado con los tiempos de respuesta comprometidos por tipo de solicitud.'),
        change('url', 'Enlace de la evidencia', null, 'https://demo.evidentia.local/politica-nivel-servicio.pdf'),
      ],
    }),
    audit(104, RISK_MIS_R1_ID, 'EVIDENCE_CREATED', 'Evidencia agregada', at(7, 45), ADMIN_ACTOR, {
      changes: [
        change('name', 'Nombre de la evidencia', null, 'Reporte semanal de cumplimiento de SLA'),
        change('description', 'Descripción de la evidencia', null, 'Exportación del tablero de solicitudes con el cumplimiento de los últimos 30 días.'),
        change('url', 'Enlace de la evidencia', null, 'https://demo.evidentia.local/reportes/sla-semanal.csv'),
      ],
    }),
    audit(105, RISK_MIS_R1_ID, 'APPROVAL_REQUESTED', 'Enviado a aprobación', at(10, 60), ADMIN_ACTOR, {
      metadata: { approvalId: APPROVAL_MIS_R1_ID },
    }),
    audit(106, RISK_MIS_R1_ID, 'APPROVAL_DECIDED', 'Riesgo aprobado', at(9, 90), OWNER_MISSIONAL_ACTOR, {
      metadata: { approvalId: APPROVAL_MIS_R1_ID, decision: 'APPROVED', comment: 'Plan de mitigación suficiente; se aprueba con seguimiento mediante ticket.' },
    }),
    audit(107, RISK_MIS_R1_ID, 'TICKET_CREATED', 'Ticket de seguimiento creado', at(9, 90), OWNER_MISSIONAL_ACTOR, {
      metadata: { ticketId: TICKET_MIS_R1_ID, approvalId: APPROVAL_MIS_R1_ID },
    }),
    audit(108, RISK_MIS_R1_ID, 'TICKET_STATUS_CHANGED', 'Estado del ticket: En curso', at(5, 120), OWNER_MISSIONAL_ACTOR, {
      metadata: { ticketId: TICKET_MIS_R1_ID, approvalId: APPROVAL_MIS_R1_ID, previousStatus: 'OPEN', status: 'IN_PROGRESS' },
    }),

    // ---- MIS-R2: rechazado con comentario ----
    audit(120, RISK_MIS_R2_ID, 'RISK_CREATED', 'Riesgo MIS-R2 creado', at(11, 5), ADMIN_ACTOR, {
      changes: [
        change('code', 'Código', null, 'MIS-R2'),
        change('name', 'Nombre', null, 'Pérdida de información de clientes en el sistema de gestión'),
        change('description', 'Descripción', null, 'La ausencia de respaldos verificados puede provocar la pérdida irreversible de la información de los clientes registrada en el sistema de gestión.'),
        change('riskOwnerId', 'Dueño del riesgo', null, 'Demo Dueño Misional'),
        change('inherentImpact', 'Impacto inherente', null, 5),
        change('inherentProbability', 'Probabilidad inherente', null, 4),
      ],
    }),
    audit(121, RISK_MIS_R2_ID, 'CONTROL_CREATED', 'Control agregado', at(11, 60), ADMIN_ACTOR, {
      changes: [
        change('description', 'Descripción del control', null, 'Respaldo diario de la base de datos del sistema de gestión en almacenamiento externo.'),
        change('evaluation', 'Evaluación de efectividad', null, 'WEAK'),
      ],
    }),
    audit(122, RISK_MIS_R2_ID, 'EVIDENCE_CREATED', 'Evidencia agregada', at(10, 30), ADMIN_ACTOR, {
      changes: [
        change('name', 'Nombre de la evidencia', null, 'Registro de respaldos de la base de datos'),
        change('description', 'Descripción de la evidencia', null, 'Log de los respaldos automáticos ejecutados en el último mes con su resultado.'),
        change('url', 'Enlace de la evidencia', null, 'https://demo.evidentia.local/respaldos/log-backup.txt'),
      ],
    }),
    audit(123, RISK_MIS_R2_ID, 'APPROVAL_REQUESTED', 'Enviado a aprobación', at(8, 60), ADMIN_ACTOR, {
      metadata: { approvalId: APPROVAL_MIS_R2_ID },
    }),
    audit(124, RISK_MIS_R2_ID, 'APPROVAL_DECIDED', 'Riesgo rechazado', at(7, 90), ADMIN_ACTOR, {
      metadata: { approvalId: APPROVAL_MIS_R2_ID, decision: 'REJECTED', comment: 'El control propuesto no cubre el escenario de pérdida de datos; se requiere una nueva evaluación con respaldo verificable.' },
    }),

    // ---- EST-R1: pendiente de decisión ----
    audit(140, RISK_EST_R1_ID, 'RISK_CREATED', 'Riesgo EST-R1 creado', at(6, 5), ADMIN_ACTOR, {
      changes: [
        change('code', 'Código', null, 'EST-R1'),
        change('name', 'Nombre', null, 'Desalineación entre el plan estratégico y la asignación de recursos'),
        change('description', 'Descripción', null, 'Los objetivos estratégicos anuales no se traducen en presupuesto ni en capacidad humana asignada, y el seguimiento se hace sin indicadores confiables.'),
        change('riskOwnerId', 'Dueño del riesgo', null, 'Demo Dueño Estratégico'),
        change('inherentImpact', 'Impacto inherente', null, 3),
        change('inherentProbability', 'Probabilidad inherente', null, 3),
      ],
    }),
    audit(141, RISK_EST_R1_ID, 'CONTROL_CREATED', 'Control agregado', at(5, 60), ADMIN_ACTOR, {
      changes: [
        change('description', 'Descripción del control', null, 'Revisión trimestral del plan estratégico con mapa de objetivos y presupuesto asociado.'),
        change('evaluation', 'Evaluación de efectividad', null, 'PENDING'),
      ],
    }),
    audit(142, RISK_EST_R1_ID, 'EVIDENCE_CREATED', 'Evidencia agregada', at(5, 30), ADMIN_ACTOR, {
      changes: [
        change('name', 'Nombre de la evidencia', null, 'Matriz de objetivos vs. presupuesto 2026'),
        change('description', 'Descripción de la evidencia', null, 'Cruce del plan estratégico con la asignación presupuestal aprobada por área.'),
        change('url', 'Enlace de la evidencia', null, 'https://demo.evidentia.local/estrategia/matriz-objetivos.xlsx'),
      ],
    }),
    audit(143, RISK_EST_R1_ID, 'APPROVAL_REQUESTED', 'Enviado a aprobación', at(3, 60), ADMIN_ACTOR, {
      metadata: { approvalId: APPROVAL_EST_R1_ID },
    }),

    // ---- EST-R2: aprobado, con edición posterior que dejó la aprobación desactualizada ----
    audit(160, RISK_EST_R2_ID, 'RISK_CREATED', 'Riesgo EST-R2 creado', at(9, 5), ADMIN_ACTOR, {
      changes: [
        change('code', 'Código', null, 'EST-R2'),
        change('name', 'Nombre', null, 'Dependencia de un proveedor crítico sin plan de contingencia'),
        change('description', 'Descripción', null, 'La interrupción del proveedor único de tecnología afectaría la operación completa, sin proveedor alterno ni acuerdo de contingencia vigente.'),
        change('riskOwnerId', 'Dueño del riesgo', null, 'Demo Dueño Estratégico'),
        change('inherentImpact', 'Impacto inherente', null, 4),
        change('inherentProbability', 'Probabilidad inherente', null, 3),
      ],
    }),
    audit(161, RISK_EST_R2_ID, 'CONTROL_CREATED', 'Control agregado', at(9, 120), ADMIN_ACTOR, {
      changes: [
        change('description', 'Descripción del control', null, 'Acuerdo de continuidad con un proveedor alterno de tecnología y prueba semestral de conmutación.'),
        change('evaluation', 'Evaluación de efectividad', null, 'EFFECTIVE'),
      ],
    }),
    audit(162, RISK_EST_R2_ID, 'EVIDENCE_CREATED', 'Evidencia agregada', at(8, 30), ADMIN_ACTOR, {
      changes: [
        change('name', 'Nombre de la evidencia', null, 'Acuerdo de continuidad con proveedor alterno'),
        change('description', 'Descripción de la evidencia', null, 'Carta de compromiso del proveedor alterno con tiempos de respuesta y contactos de emergencia.'),
        change('url', 'Enlace de la evidencia', null, 'https://demo.evidentia.local/estrategia/acuerdo-continuidad.pdf'),
      ],
    }),
    audit(163, RISK_EST_R2_ID, 'APPROVAL_REQUESTED', 'Enviado a aprobación', at(6, 60), ADMIN_ACTOR, {
      metadata: { approvalId: APPROVAL_EST_R2_ID },
    }),
    audit(164, RISK_EST_R2_ID, 'APPROVAL_DECIDED', 'Riesgo aprobado', at(5, 90), OWNER_STRATEGIC_ACTOR, {
      metadata: { approvalId: APPROVAL_EST_R2_ID, decision: 'APPROVED', comment: 'Se aprueba el tratamiento de transferencia con el proveedor alterno.' },
    }),
    audit(165, RISK_EST_R2_ID, 'TICKET_CREATED', 'Ticket de seguimiento creado', at(5, 90), OWNER_STRATEGIC_ACTOR, {
      metadata: { ticketId: TICKET_EST_R2_ID, approvalId: APPROVAL_EST_R2_ID },
    }),
    audit(166, RISK_EST_R2_ID, 'RISK_UPDATED', 'Riesgo actualizado', at(2, 60), ADMIN_ACTOR, {
      changes: [
        change(
          'description',
          'Descripción',
          'La interrupción del proveedor único de tecnología afectaría la operación completa.',
          'La interrupción del proveedor único de tecnología afectaría la operación completa, sin proveedor alterno ni acuerdo de contingencia vigente.',
        ),
      ],
    }),
    audit(167, RISK_EST_R2_ID, 'APPROVAL_OUTDATED', 'Aprobación marcada para nueva revisión', at(2, 60), ADMIN_ACTOR, {
      metadata: { approvalId: APPROVAL_EST_R2_ID, previousStatus: 'APPROVED' },
    }),
  ]

  for (const event of events) {
    const { id, ...data } = event
    await tx.riskAuditEvent.upsert({
      where: { id },
      create: event,
      update: {
        riskId: data.riskId,
        eventType: data.eventType,
        summary: data.summary,
        occurredAt: data.occurredAt,
        actorId: data.actorId,
        actorName: data.actorName,
        actorEmail: data.actorEmail,
        changes: data.changes,
        metadata: data.metadata,
      },
    })
  }
}

/**
 * Mantén la secuencia de códigos por delante de los códigos demo (MIS-R1/R2 y EST-R1/R2), sin
 * bajarla nunca: si la base ya emitió códigos más altos, se conserva el valor actual y la API
 * seguirá asignando números libres.
 */
const bumpRiskSequences = async (tx: Tx): Promise<void> => {
  const categories = [
    { category: 'MISIONAL' as const, minNext: 2 },
    { category: 'ESTRATEGICO' as const, minNext: 2 },
  ]
  for (const { category, minNext } of categories) {
    const existing = await tx.riskCodeSequence.findUnique({ where: { category } })
    if (!existing) {
      await tx.riskCodeSequence.create({ data: { category, next: minNext } })
    } else if (existing.next < minNext) {
      await tx.riskCodeSequence.update({ where: { category }, data: { next: minNext } })
    }
  }
}

const seedDemo = async (passwordHash: string): Promise<void> => {
  await prisma.$transaction(
    async (tx) => {
      await assertDemoCompanySlot(tx)
      await tx.company.upsert({
        where: { id: COMPANY_ID },
        create: {
          id: COMPANY_ID,
          name: DEMO_COMPANY_NAME,
          identification: DEMO_IDENTIFICATION,
          industry: 'Servicios (demo)',
          description: 'Empresa ficticia de demostración. Datos seguros para borrar con `npm run db:seed:demo:clean`.',
        },
        update: {
          name: DEMO_COMPANY_NAME,
          industry: 'Servicios (demo)',
          description: 'Empresa ficticia de demostración. Datos seguros para borrar con `npm run db:seed:demo:clean`.',
        },
      })
      await upsertDemoUsers(tx, passwordHash)
      await upsertDemoProcesses(tx)
      await upsertDemoRisks(tx)
      await upsertDemoControls(tx)
      await upsertDemoEvidences(tx)
      await upsertDemoApprovals(tx)
      await upsertDemoTickets(tx)
      await upsertDemoNotifications(tx)
      await upsertDemoAuditEvents(tx)
      await bumpRiskSequences(tx)
    },
    { timeout: 60_000 },
  )
}

// ---- Limpieza (solo filas demo) ----

const cleanDemo = async (): Promise<void> => {
  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID }, select: { id: true, identification: true } })
  if (!company && !(await prisma.company.findUnique({ where: { identification: DEMO_IDENTIFICATION } }))) {
    console.log('[seed-demo] No hay datos demo que limpiar (la empresa demo no existe).')
    return
  }

  // Guardas previas: no borrar nada si quedaron restos que no son solo demo.
  const strayProcesses = await prisma.process.findMany({
    where: { companyId: COMPANY_ID, id: { notIn: PROCESS_IDS } },
    select: { name: true },
  })
  if (strayProcesses.length > 0) {
    fail(
      `la empresa demo tiene procesos que no creó este seed (${strayProcesses.map((process) => process.name).join(', ')}). ` +
        'Elimínalos (o muévelos de empresa) manualmente antes de limpiar; no se borran datos que no son demo.',
    )
  }

  const existingUsers = await prisma.user.findMany({ where: { email: { in: DEMO_USERS.map((user) => user.email) } }, select: { id: true, email: true, companyId: true } })
  const foreignUsers = existingUsers.filter((user) => user.companyId && user.companyId !== COMPANY_ID)
  if (foreignUsers.length > 0) {
    fail(`los correos demo pertenecen a usuarios de otra empresa (${foreignUsers.map((user) => user.email).join(', ')}); no se elimina nada.`)
  }
  const userIds = existingUsers.filter((user) => !user.companyId || user.companyId === COMPANY_ID).map((user) => user.id)
  if (userIds.length > 0) {
    const strayTickets = await prisma.ticket.findMany({
      where: { OR: [{ createdById: { in: userIds } }, { assignedToId: { in: userIds } }], id: { notIn: TICKET_IDS } },
      select: { id: true, title: true },
    })
    if (strayTickets.length > 0) {
      fail(
        `los usuarios demo tienen tickets que no creó este seed (${strayTickets.map((ticket) => ticket.title).join('; ')}). ` +
          'Reasígnalos o elímalos manualmente (Ticket.createdById es Restrict); no se borran tickets ajenos al seed.',
      )
    }
  }

  const riskIds = (await prisma.risk.findMany({ where: { id: { in: RISK_IDS }, processId: { in: PROCESS_IDS } }, select: { id: true } })).map((risk) => risk.id)

  await prisma.$transaction(
    async (tx) => {
      // Orden seguro de borrado respecto a las FK (Restrict/Cascade/SetNull del schema).
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } })
      await tx.riskAuditEvent.deleteMany({ where: { riskId: { in: riskIds } } })
      await tx.riskApproval.deleteMany({ where: { riskId: { in: riskIds } } })
      await tx.riskControl.deleteMany({ where: { riskId: { in: riskIds } } })
      await tx.riskEvidence.deleteMany({ where: { riskId: { in: riskIds } } })
      await tx.ticket.deleteMany({ where: { id: { in: TICKET_IDS } } })
      await tx.risk.deleteMany({ where: { id: { in: riskIds }, processId: { in: PROCESS_IDS } } })
      await tx.processChange.deleteMany({ where: { processId: { in: PROCESS_IDS } } })
      await tx.process.deleteMany({ where: { id: { in: PROCESS_IDS }, companyId: COMPANY_ID } })
      await tx.qualityDiagnostic.deleteMany({ where: { companyId: COMPANY_ID } })
      await tx.user.deleteMany({ where: { id: { in: userIds }, companyId: COMPANY_ID } })
      await tx.company.deleteMany({ where: { id: COMPANY_ID, identification: DEMO_IDENTIFICATION } })
    },
    { timeout: 60_000 },
  )
  console.log('[seed-demo] Datos demo eliminados. Los contadores de códigos de riesgo (RiskCodeSequence) se conservan: sus números quedan libres y la API los reutiliza sin conflicto.')
}

// ---- Entrada ----

const main = async (): Promise<void> => {
  const mode = process.argv[2]
  if (mode !== undefined && mode !== 'clean') {
    fail(`argumento desconocido "${mode}". Usa: npm run db:seed:demo  |  npm run db:seed:demo:clean`)
  }
  if (process.env.NODE_ENV === 'production') {
    fail('el seed DEMO se niega a ejecutarse con NODE_ENV=production (no escribe datos reales ni de producción).')
  }

  if (mode === 'clean') {
    await cleanDemo()
    return
  }

  const password = process.env.SEED_PASSWORD ?? 'CambiarEstaClave123!'
  if (!process.env.SEED_PASSWORD) {
    console.warn('[seed-demo] Usando la contraseña por defecto de SEED_PASSWORD para los usuarios demo.')
  }
  const passwordHash = await bcrypt.hash(password, 12)

  await seedDemo(passwordHash)
  console.log(
    [
      '[seed-demo] Datos DEMO listos (idempotente: volver a ejecutarlos repone el estado inicial).',
      `  Empresa : ${DEMO_COMPANY_NAME} (NIT ${DEMO_IDENTIFICATION}, id ${COMPANY_ID})`,
      '  Usuarios (solo se crean si faltan; la contraseña es de SEED_PASSWORD):',
      `    · demo.admin@evidentia.demo        (COMPANY_ADMIN) id ${ADMIN_ID}`,
      `    · demo.dueno.misional@evidentia.demo  (COMPANY_USER, dueño de MIS-R1/MIS-R2) id ${OWNER_MISSIONAL_ID}`,
      `    · demo.dueno.estrategico@evidentia.demo (COMPANY_USER, dueño de EST-R1/EST-R2) id ${OWNER_STRATEGIC_ID}`,
      '  Procesos : Gestión del servicio al cliente (PRO-MIS-001) · Planeación y seguimiento estratégico (PRO-EST-001)',
      '  Riesgos  : MIS-R1 aprobado con ticket en curso · MIS-R2 rechazado · EST-R1 pendiente · EST-R2 aprobado y desactualizado',
      '  Historial: eventos de auditoría del ciclo de vida de los 4 riesgos (creación, controles, evidencias, aprobaciones, ticket).',
      '  Limpieza : npm run db:seed:demo:clean   (borra solo estas filas demo)',
      '  Detalle  : docs/seed-demo.md',
    ].join('\n'),
  )
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

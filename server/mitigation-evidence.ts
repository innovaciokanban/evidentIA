import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Gate de evidencia de las actividades de mitigación: una actividad que pertenece a un plan de
 * mitigación de un riesgo (ActionPlan.riskId con valor) no puede marcarse como terminada sin
 * tener al menos un PDF adjunto en el ticket que la representa.
 *
 * Las reglas puras (¿cuándo aplica el gate?) viven aquí para poder probarlas sin base de datos ni
 * HTTP; la lectura del plan y del conteo de evidencias también, para que app.ts solo decida el
 * estado antes/después con sus propios mapas de transición y llame a esta función dentro de la
 * transacción de la modificación (así el gate, la escritura del estado y el aviso comparten
 * aislamiento: o pasan juntos o no pasa ninguno).
 */

/**
 * El cierre exige evidencia y no se puede esquivar cancelando: en el camino de las rutas, este
 * error sale con 409 y un motivo estructurado que el cliente interpreta como "falta evidencia".
 */
export class MitigationEvidenceRequiredError extends Error {
  readonly ticketId: string
  readonly reason = 'MITIGATION_EVIDENCE_REQUIRED' as const

  constructor(ticketId: string) {
    super('Para completar esta actividad de mitigación debes adjuntar al menos un PDF de evidencia en su ticket.')
    this.name = 'MitigationEvidenceRequiredError'
    this.ticketId = ticketId
  }
}

/** El cliente puede ser una transacción (rutas PATCH) o el cliente completo (lecturas sueltas). */
export type EvidenceGateClient = Prisma.TransactionClient | PrismaClient

/** Estado que decide si el gate corre, ya traducido por la ruta con sus propios mapas de estado. */
export type EvidenceGateTransition = {
  /** Ticket que representa a la actividad; sin ticket no hay dónde adjuntar evidencia. */
  ticketId: string | null | undefined
  /** Actividad vinculada; sin actividad no es una mitigación, es un ticket suelto. */
  actionItemId: string | null | undefined
  /** ¿La transición que se está escribiendo deja la actividad terminada? */
  willCompleteActivity: boolean
  /** ¿La actividad ya estaba terminada antes de esta escritura? */
  wasActivityCompleted: boolean
}

/**
 * Condición del gate, en una sola función:
 *
 * - Solo corre sobre transiciones NUEVAS a "terminada" (RESOLVED/CLOSED en el ticket, COMPLETED en
 *   la actividad). Un ticket ya cerrado que se vuelve a escribir no se bloquea: la evidencia exigida
 *   se comprobó la primera vez que se intentó cerrar.
 * - Solo aplica a tickets de actividades (actionItemId) y de planes con riesgo asociado; los tickets
 *   manuales y los planes sin riesgo (p. ej. tareas de ponderación) no forman parte de la
 *   mitigación y su cierre sigue funcionando como siempre.
 * - Sin ticket vinculado no hay contenedor de evidencia posible, así que el gate no corre: bloquear
 *   aquí dejaría la actividad imposible de completar y sin dónde adjuntar el PDF que desbloquea.
 */
export const evidenceGateApplies = (transition: EvidenceGateTransition): boolean =>
  transition.willCompleteActivity
  && !transition.wasActivityCompleted
  && Boolean(transition.ticketId)
  && Boolean(transition.actionItemId)

/**
 * Riesgo del plan de mitigación al que pertenece la actividad, o null si la actividad no pertenece
 * a ningún plan vinculado a un riesgo. Se lee con el cliente que entrega la ruta (misma
 * transacción), no con un snapshot previo.
 */
export const mitigationPlanRiskIdForActionItem = async (
  client: EvidenceGateClient,
  actionItemId: string,
): Promise<string | null> => {
  const item = await client.actionItem.findUnique({
    where: { id: actionItemId },
    select: { actionPlan: { select: { riskId: true } } },
  })
  return item?.actionPlan?.riskId ?? null
}

/**
 * Lanza MitigationEvidenceRequiredError si la transición cerraría una actividad de mitigación sin
 * evidencia. Debe llamarse dentro de la transacción que escribe el cambio: una excepción invierte
 * toda la escritura (el estado no cambia) y la ruta la traduce en 409.
 */
export const assertMitigationEvidence = async (client: EvidenceGateClient, transition: EvidenceGateTransition): Promise<void> => {
  if (!evidenceGateApplies(transition)) return
  const riskId = await mitigationPlanRiskIdForActionItem(client, transition.actionItemId!)
  if (!riskId) return
  const evidenceCount = await client.ticketEvidenceFile.count({ where: { ticketId: transition.ticketId! } })
  if (evidenceCount === 0) throw new MitigationEvidenceRequiredError(transition.ticketId!)
}

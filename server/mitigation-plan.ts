import type { ActionItemStatus, TicketStatus } from '@prisma/client'

/**
 * Reglas puras del aviso "plan de mitigación completado". Vive aparte de app.ts para que la
 * condición de finalización, el enlace navegable y los destinatarios sean unidades testables sin
 * base de datos ni HTTP. Ninguna función de aquí escribe datos: la escritura (y su transacción)
 * ocurre en app.ts.
 */

/**
 * Enlace in-app hacia la sección de evaluación residual del riesgo. Mismo formato que
 * approvalNotificationLink: segmentos separados por "/" que la campana interpreta al abrir la
 * notificación ("risks/<processId>/<riskId>/residual"). El cuarto segmento es el que empuja al
 * usuario hasta la tarjeta de riesgo residual, no solo al detalle del riesgo.
 */
export const riskResidualSectionLink = (processId: string, riskId: string): string =>
  `risks/${processId}/${riskId}/residual`

/** Pedidos mínimos de un plan de acción para decidir si su mitigación terminó. */
export type MitigationPlanSnapshot = {
  id: string
  /**
   * `ticketStatus` corrobora el estado real del ticket que representa la actividad. Es opcional
   * (y `null` cuando la actividad no tiene ticket) para que los consumidores que solo conocen la
   * actividad no tengan que fabricar el dato: solo quien pueda leer el ticket llena el campo.
   */
  items: Array<{ status: ActionItemStatus; ticketStatus?: TicketStatus | null }>
}

/** Estados de ticket que confirman que la actividad asociada terminó su recorrido. */
const finishedTicketStatuses: readonly TicketStatus[] = ['RESOLVED', 'CLOSED']

/**
 * Condición de finalización, sobre los estados reales del proyecto:
 *
 * - No hay plan asociado al riesgo → no hay nada que avisar.
 * - Un plan sin actividades NO cuenta como completado (nunca se asume vacío = terminado).
 * - Varios planes asociados deben estar TODOS completos: cada uno con al menos una actividad y
 *   todas sus actividades en COMPLETED.
 * - Solo COMPLETED cuenta. PENDING e IN_PROGRESS son estados intermedios que bloquean el aviso y
 *   CANCELLED no es "completada": una actividad cancelada deja el plan sin cerrar.
 * - Cuando la actividad tiene ticket, su estado real también debe estar cerrado (RESOLVED o
 *   CLOSED): una actividad COMPLETED con el ticket todavía abierto o en curso no afirma que la
 *   mitigación terminara. El ticket sin actividad (null) no bloquea: no hay estado que corroborar.
 */
export const mitigationPlansCompleted = (plans: readonly MitigationPlanSnapshot[]): boolean =>
  plans.length > 0
  && plans.every((plan) => plan.items.length > 0 && plan.items.every((item) => (
    item.status === 'COMPLETED'
    && (item.ticketStatus === undefined || item.ticketStatus === null || finishedTicketStatuses.includes(item.ticketStatus))
  )))

/**
 * Destinatarios del aviso, sin duplicar ids:
 *
 * - Si el plan tiene responsable de mitigación (Risk.mitigationOwnerId), el aviso es SOLO para él:
 *   quien se comprometió a ejecutar la mitigación es quien debe ver que ya quedó completa.
 * - Si el riesgo no tiene responsable de mitigación (planes legados o todavía sin asignar), se
 *   conserva el destinatario de siempre: creador del riesgo y su dueño.
 *
 * Los nulos (riesgo legado sin evento de creación, riesgo sin dueño ni responsable) se descartan
 * aquí; la existencia de los usuarios se comprueba después, contra la base, antes de escribir.
 */
export const mitigationNotificationRecipients = (
  mitigationOwnerId: string | null | undefined,
  riskOwnerId: string | null | undefined,
  creatorId: string | null | undefined,
): string[] => {
  const candidates = mitigationOwnerId ? [mitigationOwnerId] : [creatorId, riskOwnerId]
  return [...new Set(candidates.filter((id): id is string => Boolean(id)))]
}

/**
 * Texto del aviso. El cuerpo es el mensaje acordado para solicitar la calificación residual; el
 * código identifica el riesgo igual que en el resto de las notificaciones in-app (y si un riesgo
 * legado no tiene código, se usa su nombre para no dejar el mensaje a medias).
 */
export const mitigationCompletedNotification = (risk: { code: string | null; name: string }): { title: string; body: string } => {
  const reference = risk.code ?? risk.name
  return {
    title: `Riesgo ${reference}: plan de mitigación completado`,
    body: `Se finalizaron todas las actividades del plan de mitigación del riesgo ${reference}. Es necesario calificar el riesgo residual registrando su probabilidad e impacto.`,
  }
}

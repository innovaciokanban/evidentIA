import type { ActionItemStatus } from '@prisma/client'

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
  items: Array<{ status: ActionItemStatus }>
}

/**
 * Condición de finalización, sobre los estados reales del proyecto:
 *
 * - No hay plan asociado al riesgo → no hay nada que avisar.
 * - Un plan sin actividades NO cuenta como completado (nunca se asume vacío = terminado).
 * - Varios planes asociados deben estar TODOS completos: cada uno con al menos una actividad y
 *   todas sus actividades en COMPLETED.
 * - Solo COMPLETED cuenta. PENDING e IN_PROGRESS son estados intermedios que bloquean el aviso y
 *   CANCELLED no es "completada": una actividad cancelada deja el plan sin cerrar.
 */
export const mitigationPlansCompleted = (plans: readonly MitigationPlanSnapshot[]): boolean =>
  plans.length > 0
  && plans.every((plan) => plan.items.length > 0 && plan.items.every((item) => item.status === 'COMPLETED'))

/**
 * Destinatarios del aviso: el creador del riesgo y su dueño, sin duplicar ids. Los nulos (riesgo
 * legado sin evento de creación, o riesgo sin dueño asignado) se descartan aquí; la existencia de
 * los usuarios se comprueba después, contra la base, antes de escribir.
 */
export const mitigationNotificationRecipients = (
  creatorId: string | null | undefined,
  ownerId: string | null | undefined,
): string[] => [...new Set([creatorId, ownerId].filter((id): id is string => Boolean(id)))]

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

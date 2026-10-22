/**
 * Destinos de los links in-app que guarda cada notificación. El backend escribe el link como
 * segmentos separados por "/" (por ejemplo "approvals/<id>" o "risks/<processId>/<riskId>/residual")
 * y la campana solo lo interpreta al abrir la notificación: aquí se parte el link y se decide a qué
 * vista del cliente corresponde, incluida la sección concreta dentro del detalle del riesgo. Un link
 * desconocido no navega en vez de adivinar.
 */
export type NotificationTarget =
  | { kind: 'approval'; approvalId: string }
  | { kind: 'risk'; processId: string; riskId: string; section: 'residual' | null }
  | { kind: 'ticket'; ticketId: string }

export const parseNotificationLink = (link: string): NotificationTarget | null => {
  const [section, firstId, secondId, subsection] = link.split('/').map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  if (section === 'approvals' && firstId) return { kind: 'approval', approvalId: firstId }
  if (section === 'risks' && firstId && secondId) {
    return { kind: 'risk', processId: firstId, riskId: secondId, section: subsection === 'residual' ? 'residual' : null }
  }
  // Asignación de una actividad de mitigación: "tickets/<id>" abre ese ticket en su vista.
  if (section === 'tickets' && firstId) return { kind: 'ticket', ticketId: firstId }
  return null
}

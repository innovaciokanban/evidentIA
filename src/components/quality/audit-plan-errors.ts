import { ApiError } from '../../api'

export const friendlyPlanError = (error: unknown, fallback: string): string => {
  if (!(error instanceof ApiError)) return fallback
  const message = error.message
  if (message.includes('overlaps with')) return 'La actividad se solapa con otra actividad de la agenda. Ajusta las fechas y horarios.'
  if (message.includes('active agenda activity')) return 'Agrega al menos una actividad activa antes de preparar el plan.'
  const activityAssignment = message.match(/^Activity "(.+)" needs at least one active audit team member$/)
  if (activityAssignment) return `La actividad «${activityAssignment[1]}» necesita al menos un integrante activo del equipo auditor.`
  if (message.includes('active audit team')) return 'Asigna un equipo auditor activo antes de preparar el plan.'
  if (message.includes('active lead auditor')) return 'El equipo necesita un auditor líder activo antes de preparar el plan.'
  if (message.includes('clear or mitigated independence')) return 'Todas las independencias deben quedar en Sin conflicto o Mitigado antes de preparar el plan.'
  if (message.includes('Only a draft audit plan')) return 'El plan ya no está en borrador y no admite edición.'
  if (message.includes('Invalid audit plan status transition')) return 'Esta transición no está permitida para el estado actual del plan.'
  if (message.includes('closed or cancelled audit')) return 'La auditoría está cerrada o cancelada y no admite cambios en el plan.'
  if (message.includes('active audit team members')) return 'Solo puedes asignar integrantes activos del equipo auditor.'
  if (message.includes('retired audit team member')) return 'La actividad tiene un integrante retirado del equipo auditor.'
  if (message.includes('unresolved independence')) return 'La actividad tiene un auditor con independencia pendiente o en conflicto.'
  if (error.status === 403) return 'Tu usuario solo tiene permisos de consulta para este plan.'
  return message || fallback
}

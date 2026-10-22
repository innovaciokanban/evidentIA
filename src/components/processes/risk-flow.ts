import type { ActionItemStatus, MitigationActivity, ProcessRisk } from '../../types'

/** Causa que impide avanzar al paso 3 (controles y plan) y al paso 4 (residual) del detalle. */
export type RiskStageReason = 'risk' | 'evaluation' | 'treatment' | 'acceptance-pending' | 'acceptance-rejected'

/**
 * Inherente completo: impacto y probabilidad persistidos dentro de la escala 5×5. Un riesgo en
 * base de datos siempre cumple esta regla (la API solo admite 1..5), pero la comprobación vive
 * aquí para que el espejo del backend no dependa de ese detalle de validación.
 */
function inherentEvaluationComplete(risk: Pick<ProcessRisk, 'inherentImpact' | 'inherentProbability'>): boolean {
  const inScale = (value: number) => Number.isInteger(value) && value >= 1 && value <= 5
  return inScale(risk.inherentImpact) && inScale(risk.inherentProbability)
}

/**
 * Regla de negocio del orden de gestión (espejo de `riskStageLockReason` del backend): controles,
 * plan de mitigación y riesgo residual solo se escriben cuando la evaluación inherente está
 * completa, hay tratamiento definido y el riesgo está ACEPTADO por el ciclo de aprobación.
 *
 * Tres matices que la función concentra para que toda la interfaz pinte lo mismo:
 * - PENDING no es «decidido»: es «sin decisión», así que no habilita nada.
 * - REJECTED tampoco habilita: hace falta una nueva decisión autorizada (riesgo rechazado).
 * - El estado sale SIEMPRE del riesgo guardado, nunca del borrador: lo que el formulario cree en
 *   pantalla no sustituye una decisión persistida.
 *
 * La lista de controles y la del plan siguen siendo consultables: el bloqueo distingue lectura de
 * escritura. El backend aplica la misma regla con HTTP 409, de modo que ocultar botones no es la
 * única defensa.
 */
export function riskStageReason(risk: ProcessRisk | null): RiskStageReason | null {
  if (!risk) return 'risk'
  if (!inherentEvaluationComplete(risk)) return 'evaluation'
  if (risk.treatment === null) return 'treatment'
  if (risk.acceptanceStatus === 'PENDING') return 'acceptance-pending'
  if (risk.acceptanceStatus === 'REJECTED') return 'acceptance-rejected'
  return null
}

/** Mensajes que el detalle pinta en controles, plan y residual cuando el paso está bloqueado. */
export const riskStageMessages: Record<RiskStageReason, string> = {
  risk: 'Guarda el riesgo para continuar con la gestión.',
  evaluation: 'Completa primero la evaluación inherente del riesgo',
  treatment: 'Define el tratamiento del riesgo para continuar',
  'acceptance-pending': 'La gestión de controles y mitigación se habilitará cuando el dueño del riesgo acepte el riesgo',
  'acceptance-rejected': 'El riesgo fue rechazado. Se requiere una nueva decisión autorizada antes de continuar',
}

/** Explicación del bloqueo; vacía cuando el riesgo ya superó el paso 2. */
export function riskStageMessage(risk: ProcessRisk | null): string {
  const reason = riskStageReason(risk)
  return reason ? riskStageMessages[reason] : ''
}

export function controlsWriteLocked(risk: ProcessRisk | null): boolean {
  return riskStageReason(risk) !== null
}

export type RiskFlowStepStatus = 'completed' | 'pending' | 'blocked'
export type RiskFlowStep = { id: 'evaluation' | 'treatment' | 'mitigation' | 'residual'; label: string; status: RiskFlowStepStatus; hint: string }

/**
 * Estados de los cuatro pasos de la gestión del riesgo, derivados SIEMPRE del riesgo guardado
 * (no del borrador del formulario): «completado» solo se muestra cuando el requisito ya está
 * cumplido en base, que es lo que el backend exige para desbloquear la escritura de controles, el
 * plan y el residual. El primer paso no cumplido lleva la explicación de qué falta para
 * continuar, con el mismo texto que pintan las secciones bloqueadas (`riskStageMessages`).
 */
export function riskFlowSteps(risk: ProcessRisk | null): RiskFlowStep[] {
  const stageReason = riskStageReason(risk)
  const hasControls = Boolean(risk && risk.controls.length > 0)
  if (!risk) {
    return [
      { id: 'evaluation', label: 'Evaluación', status: 'pending', hint: 'Completa la información base y la evaluación inherente, y guarda el riesgo.' },
      { id: 'treatment', label: 'Tratamiento y aceptación', status: 'blocked', hint: 'Primero guarda el riesgo.' },
      { id: 'mitigation', label: 'Controles y plan', status: 'blocked', hint: riskStageMessages.risk },
      { id: 'residual', label: 'Riesgo residual', status: 'blocked', hint: riskStageMessages.risk },
    ]
  }
  const treatmentStatus: RiskFlowStepStatus = stageReason === null
    ? 'completed'
    : stageReason === 'treatment' || stageReason === 'acceptance-pending' ? 'pending' : 'blocked'
  const treatmentHint = stageReason === null
    ? ''
    : stageReason === 'treatment'
      ? `${riskStageMessages.treatment} y registra la aceptación (aceptado o rechazado) para continuar.`
      : riskStageMessages[stageReason]
  return [
    { id: 'evaluation', label: 'Evaluación', status: stageReason === 'evaluation' ? 'pending' : 'completed', hint: stageReason === 'evaluation' ? riskStageMessages.evaluation : '' },
    { id: 'treatment', label: 'Tratamiento y aceptación', status: treatmentStatus, hint: treatmentHint },
    stageReason
      ? { id: 'mitigation', label: 'Controles y plan', status: 'blocked', hint: riskStageMessages[stageReason] }
      : hasControls
        ? { id: 'mitigation', label: 'Controles y plan', status: 'completed', hint: '' }
        : { id: 'mitigation', label: 'Controles y plan', status: 'pending', hint: 'Agrega al menos un control para habilitar el riesgo residual.' },
    !stageReason && hasControls
      ? { id: 'residual', label: 'Riesgo residual', status: 'completed', hint: '' }
      : stageReason
        ? { id: 'residual', label: 'Riesgo residual', status: 'blocked', hint: riskStageMessages[stageReason] }
        : { id: 'residual', label: 'Riesgo residual', status: 'blocked', hint: 'Agrega al menos un control para habilitar el riesgo residual.' },
  ]
}

/**
 * Colapsa una fecha ISO o YYYY-MM-DD al día local, para comparar vencimientos sin que la zona
 * horaria corra la fecha un día hacia atrás.
 */
function dayStart(value: string): Date | null {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  }
  return new Date(year, month - 1, day)
}

export type ActivityDueStatus = 'none' | 'overdue' | 'soon'

/**
 * Vencimiento de una actividad según el día local: «overdue» si ya pasó y la actividad sigue
 * abierta; «soon» si vence hoy o en los próximos 7 días. Completadas y canceladas nunca se
 * destacan. Solo lectura de fechas ya cargadas: no cambia ninguna regla del backend.
 */
export function activityDueStatus(dueDate: string | null, status: ActionItemStatus, now = new Date()): ActivityDueStatus {
  if (!dueDate || status === 'COMPLETED' || status === 'CANCELLED') return 'none'
  const due = dayStart(dueDate)
  if (!due) return 'none'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (due.getTime() < today.getTime()) return 'overdue'
  return due.getTime() - today.getTime() <= 7 * 86400000 ? 'soon' : 'none'
}

/**
 * Progreso real del plan: actividades completadas sobre el total que devolvió el servidor. Nunca
 * se estima ni se calcula con listas a medias; el caller decide cuándo la lista está completa.
 */
export function activityProgressSummary(items: MitigationActivity[], now = new Date()) {
  const total = items.length
  const completed = items.filter((item) => item.status === 'COMPLETED').length
  const overdue = items.filter((item) => activityDueStatus(item.dueDate, item.status, now) === 'overdue').length
  return { total, completed, overdue, percent: total === 0 ? 0 : Math.round((completed / total) * 100) }
}

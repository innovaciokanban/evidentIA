import type { ProcessRisk, ProcessType, RiskType } from '../../types'

/**
 * El tipo de riesgo no lo elige el usuario: es el tipo del proceso asociado. El backend deriva la
 * misma categoría desde Process.type (STRATEGIC→ESTRATEGICO, MISSIONAL→MISIONAL, SUPPORT→APOYO),
 * así que el formulario solo la muestra en un campo desactivado y nunca la envía en el payload.
 */
export const riskTypeForProcessType: Record<ProcessType, RiskType> = {
  STRATEGIC: 'ESTRATEGICO',
  MISSIONAL: 'MISIONAL',
  SUPPORT: 'APOYO',
}

export const riskTypeLabels: Record<RiskType, string> = { ESTRATEGICO: 'Estratégico', MISIONAL: 'Misional', APOYO: 'Apoyo' }

// En el listado se pinta el valor almacenado: los riesgos legados pueden traer textos de catálogos
// anteriores (p. ej. «Operativo») que se muestran tal cual en lugar de ocultarlos.
export const riskTypeLabelFor = (value: string): string => riskTypeLabels[value as RiskType] ?? value

export type RiskDraft = {
  name: string
  description: string
  riskOwnerId: string
  acceptanceStatus: ProcessRisk['acceptanceStatus']
  treatment: string
  mitigationOwnerId: string
  mitigationStartDate: string
  mitigationDueDate: string
  inherentImpact: string
  inherentProbability: string
  residualImpact: string
  residualProbability: string
}

export const emptyRiskDraft: RiskDraft = {
  name: '', description: '', riskOwnerId: '', acceptanceStatus: 'PENDING', treatment: '', mitigationOwnerId: '', mitigationStartDate: '', mitigationDueDate: '', inherentImpact: '3', inherentProbability: '3', residualImpact: '1', residualProbability: '1',
}

export const draftFromRisk = (risk: ProcessRisk): RiskDraft => ({
  name: risk.name,
  description: risk.description,
  riskOwnerId: risk.riskOwner?.id ?? '',
  acceptanceStatus: risk.acceptanceStatus,
  treatment: risk.treatment ?? '',
  mitigationOwnerId: risk.mitigationOwner?.id ?? '',
  mitigationStartDate: risk.mitigationStartDate ? risk.mitigationStartDate.slice(0, 10) : '',
  mitigationDueDate: risk.mitigationDueDate ? risk.mitigationDueDate.slice(0, 10) : '',
  inherentImpact: String(risk.inherentImpact),
  inherentProbability: String(risk.inherentProbability),
  residualImpact: String(risk.residualImpact),
  residualProbability: String(risk.residualProbability),
})

/**
 * Cuerpo enviado al guardar. Nunca incluye riskType: la categoría la resuelve el backend a partir
 * del proceso, de modo que un formulario manipulado no puede registrar un tipo incompatible.
 */
export function riskPayloadFromDraft(draft: RiskDraft): Record<string, unknown> {
  return {
    name: draft.name,
    description: draft.description,
    riskOwnerId: draft.riskOwnerId || null,
    acceptanceStatus: draft.acceptanceStatus,
    treatment: draft.treatment || null,
    mitigationOwnerId: draft.mitigationOwnerId || null,
    mitigationStartDate: draft.mitigationStartDate || null,
    mitigationDueDate: draft.mitigationDueDate || null,
    inherentImpact: Number(draft.inherentImpact),
    inherentProbability: Number(draft.inherentProbability),
    residualImpact: Number(draft.residualImpact),
    residualProbability: Number(draft.residualProbability),
  }
}

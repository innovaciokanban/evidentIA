import type { AuditFinding, AuditRootCause, AuditRootCauseAnalysis, AuditRootCauseAnalysisMethod, AuditRootCauseFiveWhyStep } from '../../types'

export const rootCauseMethodLabels: Record<AuditRootCauseAnalysisMethod, string> = {
  MANUAL: 'Manual',
  FIVE_WHYS: 'Five Whys',
  ISHIKAWA: 'Ishikawa',
}

export const rootCauseMethodDescriptions: Record<AuditRootCauseAnalysisMethod, string> = {
  MANUAL: 'Documenta el problema y sus causas directamente.',
  FIVE_WHYS: 'Recorre preguntas y respuestas para profundizar hasta la causa de fondo.',
  ISHIKAWA: 'Ordena las causas potenciales por categorías para ver el sistema completo.',
}

export const ishikawaCategorySuggestions = [
  'Métodos y procedimientos',
  'Personas y competencias',
  'Tecnología y equipos',
  'Materiales e información',
  'Medición y control',
  'Entorno',
] as const

export const rootCauseAnalysisStatusLabels = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
} as const

export const rootCauseStatusLabels = {
  POTENTIAL: 'Potencial',
  CONFIRMED: 'Confirmada',
  DISCARDED: 'Descartada',
} as const

export type RootCauseAnalysisDraft = {
  problemDescription: string
  responsibleId: string
  methodology: AuditRootCauseAnalysisMethod
}

export type RootCauseDraft = {
  description: string
  justification: string
  supportingEvidence: string
  ishikawaCategory: string
}

export type FiveWhyStepDraft = {
  sequence: string
  question: string
  answer: string
}

export const rootCauseAnalysisDraftFromFinding = (finding: AuditFinding): RootCauseAnalysisDraft => ({
  problemDescription: `${finding.title}\n\n${finding.description}`.trim(),
  responsibleId: finding.responsible?.id ?? '',
  methodology: 'MANUAL',
})

export const emptyRootCauseDraft: RootCauseDraft = {
  description: '',
  justification: '',
  supportingEvidence: '',
  ishikawaCategory: '',
}

export const emptyFiveWhyStepDraft: FiveWhyStepDraft = { sequence: '1', question: '', answer: '' }

export const nextFiveWhySequence = (steps: AuditRootCauseFiveWhyStep[]): number =>
  steps.reduce((highest, step) => Math.max(highest, step.sequence), 0) + 1

export const fiveWhySequenceIssues = (steps: Array<Pick<AuditRootCauseFiveWhyStep, 'sequence' | 'question' | 'answer'>>): string[] => {
  const issues: string[] = []
  const sequences = steps.map((step) => step.sequence).sort((left, right) => left - right)
  if (steps.length === 0) issues.push('Registra al menos un paso de investigación.')
  if (new Set(sequences).size !== sequences.length) issues.push('Las secuencias deben ser únicas.')
  if (sequences.some((sequence, index) => sequence !== index + 1)) issues.push('Las secuencias deben ser consecutivas desde 1.')
  if (steps.some((step) => !step.question.trim() || !step.answer.trim())) issues.push('Cada paso necesita una pregunta y una respuesta.')
  return issues
}

export type RootCauseRequirement = {
  key: 'description' | 'responsible' | 'confirmedCause' | 'support' | 'noPotential' | 'fiveWhySteps' | 'ishikawaCategory'
  label: string
  met: boolean
}

export const rootCauseAnalysisRequirements = (analysis: AuditRootCauseAnalysis): RootCauseRequirement[] => {
  const confirmed = analysis.causes.filter((cause) => cause.status === 'CONFIRMED')
  const potential = analysis.causes.filter((cause) => cause.status === 'POTENTIAL')
  const requirements: RootCauseRequirement[] = [
    { key: 'description', label: 'Descripción válida del problema', met: analysis.problemDescription.trim().length > 0 },
    { key: 'responsible', label: 'Responsable válido', met: Boolean(analysis.responsible?.id) },
    { key: 'confirmedCause', label: 'Al menos una causa confirmada', met: confirmed.length > 0 },
    { key: 'support', label: 'Justificación y evidencia de soporte en causas confirmadas', met: confirmed.length > 0 && confirmed.every((cause) => Boolean(cause.justification?.trim()) && Boolean(cause.supportingEvidence?.trim())) },
    { key: 'noPotential', label: 'Sin causas potenciales pendientes', met: potential.length === 0 },
  ]
  if (analysis.methodology === 'FIVE_WHYS') {
    requirements.push({ key: 'fiveWhySteps', label: 'Pasos Five Whys consecutivos desde 1', met: fiveWhySequenceIssues(analysis.fiveWhySteps).length === 0 })
  }
  if (analysis.methodology === 'ISHIKAWA') {
    requirements.push({ key: 'ishikawaCategory', label: 'Una causa confirmada con categoría Ishikawa', met: confirmed.some((cause) => Boolean(cause.ishikawaCategory?.trim())) })
  }
  return requirements
}

export const rootCauseAnalysisCanBeConfirmed = (analysis: AuditRootCauseAnalysis): boolean =>
  rootCauseAnalysisRequirements(analysis).every((requirement) => requirement.met)

export const rootCauseCounts = (analyses: AuditRootCauseAnalysis[]) => {
  const causes = analyses.flatMap((analysis) => analysis.causes)
  return {
    analyses: analyses.length,
    potential: causes.filter((cause) => cause.status === 'POTENTIAL').length,
    confirmed: causes.filter((cause) => cause.status === 'CONFIRMED').length,
    discarded: causes.filter((cause) => cause.status === 'DISCARDED').length,
  }
}

export const causeCanBeEdited = (analysis: AuditRootCauseAnalysis, cause: AuditRootCause): boolean =>
  analysis.status === 'DRAFT' && cause.status === 'POTENTIAL'

export const causeCanBeConfirmed = (cause: AuditRootCause, methodology: AuditRootCauseAnalysisMethod = 'MANUAL'): boolean =>
  cause.status === 'POTENTIAL'
  && Boolean(cause.justification?.trim())
  && Boolean(cause.supportingEvidence?.trim())
  && (methodology !== 'ISHIKAWA' || Boolean(cause.ishikawaCategory?.trim()))

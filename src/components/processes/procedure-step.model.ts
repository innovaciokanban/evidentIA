import type { ProcedureStep } from '../../types'

export type ProcedureStepUser = { id: string; name: string; isActive?: boolean }

export type ProcedureStepEntry = {
  key: string
  id?: string
  position: number
  title: string
  instruction: string
  criteria: string
  responsibleIds?: string[]
}

export const emptyProcedureStep = (): ProcedureStepEntry => ({
  key: `temporary-procedure-step-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  position: 1,
  title: '',
  instruction: '',
  criteria: '',
  responsibleIds: [],
})

export const procedureStepEntryFromStep = (step: ProcedureStep): ProcedureStepEntry => ({
  key: step.id,
  id: step.id,
  position: step.position,
  title: step.title,
  instruction: step.instruction,
  criteria: step.criteria ?? '',
  responsibleIds: step.responsibleIds ?? step.responsibles?.map((user) => user.id) ?? [],
})

export function procedureStepPayloadOf(step: ProcedureStepEntry, position: number) {
  return {
    ...(step.id ? { id: step.id } : {}),
    position,
    title: step.title.trim(),
    instruction: step.instruction.trim(),
    criteria: step.criteria.trim() || null,
    responsibleIds: [...(step.responsibleIds ?? [])],
  }
}

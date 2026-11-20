import type { ProcedureIndicator } from '../../types'
import type { KpiIndicatorDraft } from './KpiForm'
import { kpiMissingFields, type KpiUser } from './process-kpi.model'

export type ProcedureIndicatorDraft = KpiIndicatorDraft

export type ProcedureIndicatorEntry = {
  key: string
  id?: string
  draft: ProcedureIndicatorDraft
}

export const emptyProcedureIndicatorDraft: ProcedureIndicatorDraft = {
  name: '',
  description: '',
  frequency: '',
  target: '',
  formula: '',
  dataSource: '',
  unit: '',
  reportResponsibleId: '',
  monitorResponsibleId: '',
  greenThreshold: '',
  yellowThreshold: '',
  redThreshold: '',
  baselineValue: '',
  measurementMethod: '',
  deadline: '',
}

export const procedureIndicatorEntryFromIndicator = (indicator: ProcedureIndicator): ProcedureIndicatorEntry => ({
  key: indicator.id,
  id: indicator.id,
  draft: {
    name: indicator.name,
    description: indicator.description,
    frequency: indicator.frequency,
    target: indicator.target,
    formula: indicator.formula,
    dataSource: indicator.dataSource,
    unit: indicator.unit,
    reportResponsibleId: indicator.reportResponsible?.id ?? '',
    monitorResponsibleId: indicator.monitorResponsible?.id ?? '',
    greenThreshold: indicator.greenThreshold ?? '',
    yellowThreshold: indicator.yellowThreshold ?? '',
    redThreshold: indicator.redThreshold ?? '',
    baselineValue: indicator.baselineValue ?? '',
    measurementMethod: indicator.measurementMethod ?? '',
    deadline: indicator.deadline ? indicator.deadline.slice(0, 10) : '',
  },
})

export function procedureIndicatorPayloadOf(draft: ProcedureIndicatorDraft) {
  const text = (value: string) => value.trim() || null
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    frequency: draft.frequency.trim(),
    target: draft.target.trim(),
    formula: draft.formula.trim(),
    dataSource: draft.dataSource.trim(),
    unit: draft.unit.trim(),
    reportResponsibleId: draft.reportResponsibleId || null,
    monitorResponsibleId: draft.monitorResponsibleId || null,
    greenThreshold: text(draft.greenThreshold),
    yellowThreshold: text(draft.yellowThreshold),
    redThreshold: text(draft.redThreshold),
    baselineValue: text(draft.baselineValue),
    measurementMethod: text(draft.measurementMethod),
    deadline: text(draft.deadline),
  }
}

export function procedureIndicatorMissingFields(draft: ProcedureIndicatorDraft): string[] {
  return kpiMissingFields(draft)
}

export type ProcedureIndicatorUser = KpiUser

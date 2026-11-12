import type { ProcessKpi, User } from '../../types'

export type KpiUser = Pick<User, 'id' | 'name' | 'isActive'> & { companyId: string | null }

export type KpiDraft = {
  name: string
  description: string
  frequency: string
  target: string
  formula: string
  dataSource: string
  unit: string
  reportResponsibleId: string
  monitorResponsibleId: string
  greenThreshold: string
  yellowThreshold: string
  redThreshold: string
}

export const emptyKpiDraft: KpiDraft = {
  name: '', description: '', frequency: '', target: '', formula: '', dataSource: '', unit: '',
  reportResponsibleId: '', monitorResponsibleId: '', greenThreshold: '', yellowThreshold: '', redThreshold: '',
}

export const draftFromKpi = (kpi: ProcessKpi): KpiDraft => ({
  name: kpi.name,
  description: kpi.description,
  frequency: kpi.frequency,
  target: kpi.target,
  formula: kpi.formula,
  dataSource: kpi.dataSource,
  unit: kpi.unit,
  reportResponsibleId: kpi.reportResponsible?.id ?? '',
  monitorResponsibleId: kpi.monitorResponsible?.id ?? '',
  greenThreshold: kpi.greenThreshold ?? '',
  yellowThreshold: kpi.yellowThreshold ?? '',
  redThreshold: kpi.redThreshold ?? '',
})

export const embeddedKpiEntryFromKpi = (kpi: ProcessKpi) => ({ key: kpi.id, id: kpi.id, draft: draftFromKpi(kpi) })

export function kpiPayloadOf(draft: KpiDraft) {
  return {
    name: draft.name,
    description: draft.description,
    frequency: draft.frequency,
    target: draft.target,
    formula: draft.formula,
    dataSource: draft.dataSource,
    unit: draft.unit,
    reportResponsibleId: draft.reportResponsibleId || null,
    monitorResponsibleId: draft.monitorResponsibleId || null,
    greenThreshold: draft.greenThreshold.trim() || null,
    yellowThreshold: draft.yellowThreshold.trim() || null,
    redThreshold: draft.redThreshold.trim() || null,
  }
}

export function kpiMissingFields(draft: KpiDraft): string[] {
  return [
    ['nombre', draft.name],
    ['descripción', draft.description],
    ['frecuencia', draft.frequency],
    ['meta', draft.target],
    ['fórmula', draft.formula],
    ['fuente de datos', draft.dataSource],
    ['unidad', draft.unit],
  ].flatMap(([label, value]) => value.trim() ? [] : [label])
}

import type { StrategicObjective } from '../../types'
import { ApiError } from '../../api'

export function smartMissingFields(objective: StrategicObjective): string[] {
  const missing: string[] = []
  if (!objective.title.trim()) missing.push('título')
  if (!objective.statement.trim()) missing.push('declaración')
  if (!objective.specificCriteria?.trim()) missing.push('criterio específico')
  if (!objective.measurableCriteria?.trim()) missing.push('criterio medible')
  if (!objective.achievableCriteria?.trim()) missing.push('criterio alcanzable')
  if (!objective.relevantCriteria?.trim()) missing.push('criterio relevante')
  if (!objective.timeBoundCriteria?.trim()) missing.push('criterio temporal')
  const indicators = objective.indicators?.length ? objective.indicators : objective.indicator ? [objective.indicator] : []
  if (indicators.length === 0) {
    missing.push('indicador')
    return missing
  }
  indicators.forEach((indicator, index) => {
    const prefix = indicators.length === 1 ? '' : ` ${index + 1}`
    if (!indicator.name?.trim()) missing.push(`nombre del indicador${prefix}`)
    if (!indicator.frequency?.trim()) missing.push(`frecuencia del indicador${prefix}`)
    if (!indicator.description?.trim()) missing.push(`descripción del indicador${prefix}`)
    if (!indicator.formula?.trim()) missing.push(`fórmula del indicador${prefix}`)
    if (!indicator.dataSource?.trim()) missing.push(`fuente de datos del indicador${prefix}`)
    if (!indicator.unit?.trim()) missing.push(`unidad del indicador${prefix}`)
    if (!indicator.baselineValue?.trim()) missing.push(`línea base${prefix}`)
    if (!indicator.targetValue?.trim()) missing.push(`meta${prefix}`)
    if (!indicator.measurementMethod?.trim()) missing.push(`método de medición${prefix}`)
    if (!indicator.deadline) missing.push(`fecha límite${prefix}`)
  })
  return missing
}

export function smartErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback
}

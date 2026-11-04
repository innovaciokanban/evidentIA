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
  if (!objective.indicator) {
    missing.push('indicador')
    return missing
  }
  if (!objective.indicator.name?.trim()) missing.push('nombre del indicador')
  if (!objective.indicator.unit?.trim()) missing.push('unidad del indicador')
  if (!objective.indicator.baselineValue?.trim()) missing.push('línea base')
  if (!objective.indicator.targetValue?.trim()) missing.push('meta')
  if (!objective.indicator.measurementMethod?.trim()) missing.push('método de medición')
  if (!objective.indicator.deadline) missing.push('fecha límite')
  return missing
}

export function smartErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback
}

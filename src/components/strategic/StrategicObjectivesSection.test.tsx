import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StrategicObjectivesSection, type StrategicStrategyOption } from './StrategicObjectivesSection'
import { smartErrorMessage, smartMissingFields } from './strategic-objectives.model'
import { ApiError } from '../../api'
import type { StrategicObjective } from '../../types'

const strategy = (overrides: Partial<StrategicStrategyOption> = {}): StrategicStrategyOption => ({
  id: 'cmstrategy-smart-1',
  title: 'Digitalizar la operación comercial',
  description: 'Reducir la dependencia de registros manuales.',
  source: 'CHECKY',
  sourceRef: 'a'.repeat(64),
  crossId: null,
  crossType: null,
  origin: null,
  factor1: null,
  factor2: null,
  weighting: { impactoEstrategico: 'ALTO', viabilidad: 'ALTO', urgencia: 'MEDIO', sinergiaInterna: 'ALTO', impactoReputacional: 'MEDIO', weightedScore: 4.2, weightingBand: 'CORTO_PLAZO' },
  weightedScore: 4.2,
  weightingBand: 'CORTO_PLAZO',
  actionPlan: null,
  ...overrides,
})

const objective = (overrides: Partial<StrategicObjective> = {}): StrategicObjective => ({
  id: 'cmobjective-smart-1',
  diagnosticId: 'cmdiagnostic-smart-1',
  title: 'Aumentar la eficiencia operativa',
  statement: 'Reducir tiempos de respuesta en el proceso comercial.',
  specificCriteria: 'En el proceso comercial',
  measurableCriteria: 'Reducir 20% el tiempo promedio',
  achievableCriteria: 'Con automatización',
  relevantCriteria: 'Mejora la experiencia del cliente',
  timeBoundCriteria: 'Durante 2026',
  status: 'DRAFT',
  origin: 'MANUAL',
  createdBy: { id: 'cmuser-smart-1', name: 'Admin', email: 'admin@test.local' },
  indicator: { id: 'cmindicator-smart-1', objectiveId: 'cmobjective-smart-1', name: 'Tiempo de respuesta', unit: 'horas', baselineValue: '48', targetValue: '38', measurementMethod: 'Reporte mensual', deadline: '2026-12-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  strategies: [{ id: 'cmlink-smart-1', objectiveId: 'cmobjective-smart-1', source: 'CHECKY', sourceRef: 'a'.repeat(64), strategyTitle: 'Digitalizar la operación comercial', strategyDescription: 'Reducir la dependencia de registros manuales.', weightedScore: 4.2, weightingBand: 'CORTO_PLAZO', linkedBy: { id: 'cmuser-smart-1', name: 'Admin', email: 'admin@test.local' }, linkedAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const renderSection = (objectives: StrategicObjective[], strategyOptions: StrategicStrategyOption[], canWrite = true, initialExpandedId?: string) => renderToStaticMarkup(
  <StrategicObjectivesSection diagnosticId="cmdiagnostic-smart-1" canWrite={canWrite} initialObjectives={objectives} initialStrategyOptions={strategyOptions} initialLoading={false} initialExpandedId={initialExpandedId} />,
)

describe('sección Objetivos SMART', () => {
  it('muestra estados, indicadores de resumen, estrategias vinculadas y el mapa de relaciones', () => {
    const markup = renderSection([objective(), objective({ id: 'cmobjective-smart-2', title: 'Objetivo aprobado', status: 'APPROVED', strategies: [] })], [strategy()])

    expect(markup).toContain('Objetivos SMART')
    expect(markup).toContain('En trabajo')
    expect(markup).toContain('Aprobados')
    expect(markup).toContain('1 estrategia vinculada')
    expect(markup).toContain('Digitalizar la operación comercial')
    expect(markup).toContain('Sugerir con IA-Checky')
    expect(markup).toContain('MAPA DE RELACIONES')
    expect(markup).toContain('Borrador')
    expect(markup).toContain('Aprobado')
  })

  it('muestra el estado vacío sin ofrecer escritura a un usuario de solo lectura', () => {
    const markup = renderSection([], [strategy()], false)

    expect(markup).toContain('Todavía no hay objetivos SMART')
    expect(markup).toContain('Los objetivos SMART de este análisis aparecerán aquí.')
    expect(markup).not.toContain('Nuevo objetivo')
    expect(markup).not.toContain('Crear primer objetivo')
    expect(markup).not.toContain('Sugerir con IA-Checky')
  })

  it('muestra carga y error de relación sin inventar datos de medición', () => {
    const loading = renderToStaticMarkup(<StrategicObjectivesSection diagnosticId="cmdiagnostic-smart-1" canWrite initialLoading />)
    expect(loading).toContain('Cargando objetivos y estrategias priorizadas...')

    const incomplete = objective({ indicator: null, specificCriteria: null, measurableCriteria: null, achievableCriteria: null, relevantCriteria: null, timeBoundCriteria: null, strategies: [] })
    const markup = renderSection([incomplete], [], true, incomplete.id)
    expect(markup).toContain('Sin indicador')
    expect(markup).toContain('Sin completar')
    expect(markup).not.toContain('Reducir 20% el tiempo promedio')
  })

  it('valida exactamente el contenido SMART requerido antes de aprobar', () => {
    const missing = smartMissingFields(objective({ indicator: null, specificCriteria: null, measurableCriteria: null, achievableCriteria: null, relevantCriteria: null, timeBoundCriteria: null }))
    expect(missing).toEqual(['criterio específico', 'criterio medible', 'criterio alcanzable', 'criterio relevante', 'criterio temporal', 'indicador'])
    expect(smartMissingFields(objective())).toEqual([])
  })

  it('conserva el mensaje que devuelve la API', () => {
    expect(smartErrorMessage(new ApiError('El objetivo está incompleto', 400), 'Error genérico')).toBe('El objetivo está incompleto')
  })
})

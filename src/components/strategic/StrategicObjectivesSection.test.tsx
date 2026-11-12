import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StrategicObjectivesSection, type StrategicStrategyOption } from './StrategicObjectivesSection'
import { smartErrorMessage, smartMissingFields } from './strategic-objectives.model'
import { ApiError } from '../../api'
import type { StrategicObjective, StrategicObjectiveSuggestionCard, StrategicObjectiveSuggestionPayload } from '../../types'
import { KpiFields } from '../processes/KpiForm'
import { emptyKpiDraft } from '../processes/process-kpi.model'

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
  indicators: [{ id: 'cmindicator-smart-1', objectiveId: 'cmobjective-smart-1', name: 'Tiempo de respuesta', description: 'Tiempo promedio por solicitud', frequency: 'Mensual', formula: 'Promedio de horas', dataSource: 'CRM', unit: 'horas', greenThreshold: '≤ 38', yellowThreshold: '39 - 48', redThreshold: '> 48', baselineValue: '48', targetValue: '38', measurementMethod: 'Reporte mensual', deadline: '2026-12-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  indicator: { id: 'cmindicator-smart-1', objectiveId: 'cmobjective-smart-1', name: 'Tiempo de respuesta', description: 'Tiempo promedio por solicitud', frequency: 'Mensual', formula: 'Promedio de horas', dataSource: 'CRM', unit: 'horas', greenThreshold: '≤ 38', yellowThreshold: '39 - 48', redThreshold: '> 48', baselineValue: '48', targetValue: '38', measurementMethod: 'Reporte mensual', deadline: '2026-12-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  strategies: [{ id: 'cmlink-smart-1', objectiveId: 'cmobjective-smart-1', source: 'CHECKY', sourceRef: 'a'.repeat(64), strategyTitle: 'Digitalizar la operación comercial', strategyDescription: 'Reducir la dependencia de registros manuales.', weightedScore: 4.2, weightingBand: 'CORTO_PLAZO', linkedBy: { id: 'cmuser-smart-1', name: 'Admin', email: 'admin@test.local' }, linkedAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const suggestionPayload: StrategicObjectiveSuggestionPayload = {
  title: 'Reducir el tiempo de respuesta',
  statement: 'Reducir el tiempo promedio de respuesta comercial.',
  specificCriteria: 'En el proceso comercial',
  measurableCriteria: 'Reducir 20% el tiempo promedio',
  achievableCriteria: 'Con automatización',
  relevantCriteria: 'Mejora la experiencia del cliente',
  timeBoundCriteria: 'Durante 2026',
  indicators: [{ name: 'Tiempo de respuesta', unit: 'horas', baselineValue: '48', targetValue: '38', measurementMethod: 'Reporte mensual', deadline: '2026-12-31' }],
  indicator: { name: 'Tiempo de respuesta', unit: 'horas', baselineValue: '48', targetValue: '38', measurementMethod: 'Reporte mensual', deadline: '2026-12-31' },
}

const suggestion = (status: StrategicObjectiveSuggestionCard['status'] = 'PENDING', overrides: Partial<StrategicObjectiveSuggestionCard> = {}): StrategicObjectiveSuggestionCard => ({
  id: `cmsuggestion-smart-${status.toLowerCase()}`,
  diagnosticId: 'cmdiagnostic-smart-1',
  requestedBy: { id: 'cmuser-smart-1', name: 'Admin', email: 'admin@test.local' },
  requestedById: 'cmuser-smart-1',
  originalPayload: suggestionPayload,
  editablePayload: suggestionPayload,
  strategyRefs: [strategy().id],
  dedupeKey: `dedupe-${status.toLowerCase()}`,
  status,
  decisionNote: status === 'REJECTED' ? 'No es prioritario ahora.' : null,
  acceptedObjectiveId: status === 'ACCEPTED' ? 'cmobjective-checky-1' : null,
  decidedAt: status === 'PENDING' ? null : '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  title: suggestionPayload.title,
  statement: suggestionPayload.statement,
  specificCriteria: suggestionPayload.specificCriteria,
  measurableCriteria: suggestionPayload.measurableCriteria,
  achievableCriteria: suggestionPayload.achievableCriteria,
  relevantCriteria: suggestionPayload.relevantCriteria,
  timeBoundCriteria: suggestionPayload.timeBoundCriteria,
  indicator: suggestionPayload.indicator,
  indicators: suggestionPayload.indicators ?? [],
  origin: 'CHECKY',
  missingInformation: [],
  pendingFields: [],
  strategies: [{ id: strategy().id, source: 'CHECKY', sourceRef: strategy().sourceRef, title: strategy().title, description: strategy().description, weightedScore: 4.2, weightingBand: 'CORTO_PLAZO' }],
  ...overrides,
})

const renderSection = (objectives: StrategicObjective[], strategyOptions: StrategicStrategyOption[], canWrite = true, initialExpandedId?: string, suggestions: StrategicObjectiveSuggestionCard[] = []) => renderToStaticMarkup(
  <StrategicObjectivesSection diagnosticId="cmdiagnostic-smart-1" canWrite={canWrite} initialObjectives={objectives} initialStrategyOptions={strategyOptions} initialSuggestions={suggestions} initialLoading={false} initialExpandedId={initialExpandedId} />,
)

describe('sección Objetivos SMART', () => {
  it('reutiliza los campos visuales del formulario de KPI para un indicador independiente', () => {
    const markup = renderToStaticMarkup(<KpiFields draft={{ ...emptyKpiDraft, name: 'Cumplimiento', description: 'Descripción', frequency: 'Mensual', target: '95%', unit: 'Porcentaje', formula: 'Cumplidos / total', dataSource: 'Sistema', greenThreshold: '>= 95%', yellowThreshold: '80% - 94%', redThreshold: '< 80%' }} setDraft={vi.fn()} users={[{ id: 'cmuser-smart-1', name: 'Admin', isActive: true, companyId: 'cmcompany-smart-1' }]} />)

    for (const label of ['Nombre del indicador', 'Frecuencia', 'Meta', 'Unidad de medida', 'Responsable de reporte', 'Responsable de monitoreo', 'Fórmula', 'Fuente de datos', 'Descripción', 'Umbral verde', 'Umbral amarillo', 'Umbral rojo']) expect(markup).toContain(label)
    for (const frequency of ['Diaria', 'Semanal', 'Quincenal', 'Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Anual']) expect(markup).toContain(`value="${frequency}"`)
    expect(markup).toContain('INFORMACIÓN GENERAL')
    expect(markup).toContain('RESPONSABLES')
    expect(markup).toContain('MEDICIÓN Y SEGUIMIENTO')
    expect(markup).toContain('CONFIGURACIÓN')
    expect(markup).toContain('UMBRALES DEL SEMÁFORO')
  })

  it('incluye los campos de seguimiento SMART en la sección compartida de medición', () => {
    const markup = renderToStaticMarkup(<KpiFields draft={{ ...emptyKpiDraft, frequency: 'Mensual' }} supplemental={{ baselineValue: '82%', measurementMethod: 'Reporte mensual', deadline: '2026-12-31' }} setDraft={vi.fn()} users={[]} />)

    for (const label of ['Línea base', 'Método de medición', 'Fecha límite']) expect(markup).toContain(label)
  })

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

  it('muestra varios indicadores con acciones independientes', () => {
    const second = { ...objective().indicators[0], id: 'cmindicator-smart-2', name: 'Cobertura de registros', targetValue: '98%' }
    const markup = renderSection([objective({ indicators: [objective().indicators[0], second] })], [strategy()])

    expect(markup).toContain('INDICADORES SMART')
    expect(markup).toContain('Tiempo de respuesta')
    expect(markup).toContain('Cobertura de registros')
    expect(markup).toContain('Editar')
    expect(markup).toContain('Eliminar')
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

    const incomplete = objective({ indicators: [], indicator: null, specificCriteria: null, measurableCriteria: null, achievableCriteria: null, relevantCriteria: null, timeBoundCriteria: null, strategies: [] })
    const markup = renderSection([incomplete], [], true, incomplete.id)
    expect(markup).toContain('Sin indicador')
    expect(markup).toContain('Sin completar')
    expect(markup).not.toContain('Reducir 20% el tiempo promedio')
  })

  it('valida exactamente el contenido SMART requerido antes de aprobar', () => {
    const missing = smartMissingFields(objective({ indicators: [], indicator: null, specificCriteria: null, measurableCriteria: null, achievableCriteria: null, relevantCriteria: null, timeBoundCriteria: null }))
    expect(missing).toEqual(['criterio específico', 'criterio medible', 'criterio alcanzable', 'criterio relevante', 'criterio temporal', 'indicador'])
    expect(smartMissingFields(objective())).toEqual([])
  })

  it('conserva el mensaje que devuelve la API', () => {
    expect(smartErrorMessage(new ApiError('El objetivo está incompleto', 400), 'Error genérico')).toBe('El objetivo está incompleto')
  })

  it('pinta propuestas persistentes de Checky como tarjetas independientes con contenido SMART y acciones', () => {
    const markup = renderSection([objective()], [strategy()], true, undefined, [suggestion()])

    expect(markup).toContain('COLABORACIÓN CON CHECKY')
    expect(markup).toContain('class="checky-avatar"')
    expect(markup).toContain('alt="Checky"')
    expect(markup).toContain('Propuestas SMART persistentes')
    expect(markup).toContain('IA-CHECKY')
    expect(markup).toContain('Pendiente')
    expect(markup).toContain('Reducir el tiempo promedio de respuesta comercial.')
    expect(markup).toContain('Tiempo de respuesta')
    expect(markup).toContain('Aceptar propuesta')
    expect(markup).toContain('Rechazar')
    expect(markup).toContain('Editar propuesta')
    expect(markup).toContain('Objetivos SMART')
  })

  it('conserva propuestas aceptadas y rechazadas después de hidratar el listado persistido', () => {
    const markup = renderSection([], [strategy()], true, undefined, [suggestion('ACCEPTED'), suggestion('REJECTED')])

    expect(markup).toContain('Aceptada')
    expect(markup).toContain('Aceptada: el objetivo quedó en borrador.')
    expect(markup).toContain('Rechazada')
    expect(markup).toContain('Rechazada: se conserva para consulta.')
    expect(markup).not.toContain('Aceptar propuesta')
  })

  it('no ofrece generar, editar, aceptar ni rechazar a un usuario de solo lectura', () => {
    const markup = renderSection([], [strategy()], false, undefined, [suggestion()])

    expect(markup).not.toContain('Sugerir con IA-Checky')
    expect(markup).not.toContain('Nuevo objetivo')
    expect(markup).not.toContain('Editar propuesta')
    expect(markup).not.toContain('Aceptar propuesta')
    expect(markup).not.toContain('Rechazar')
    expect(markup).toContain('Pendiente')
  })

  it('distingue el objetivo manual del objetivo aceptado de Checky sin mezclar sus estados', () => {
    const markup = renderSection([objective(), objective({ id: 'cmobjective-checky-1', title: 'Objetivo de Checky', origin: 'CHECKY' })], [strategy()], true, undefined, [suggestion('ACCEPTED')])

    expect(markup).toContain('Objetivo estratégico')
    expect(markup).toContain('Objetivo de Checky')
    expect(markup).toContain('IA-CHECKY')
    expect(markup).toContain('Borrador')
    expect(markup).toContain('Aceptada')
  })
})

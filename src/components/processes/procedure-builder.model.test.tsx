import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProcedureIndicatorSection } from './ProcedureIndicatorSection'
import { ProcedurePreview } from './ProcedurePreview'
import { ProcedureStepsSection } from './ProcedureStepsSection'
import { procedureIndicatorPayloadOf, type ProcedureIndicatorEntry } from './procedure-indicator.model'
import { procedureStepPayloadOf } from './procedure-step.model'

const indicatorDraft = {
  name: 'Tiempo de respuesta',
  description: 'Mide el tiempo de atención de una solicitud.',
  frequency: 'Mensual',
  target: '< 24 horas',
  formula: 'Horas transcurridas / solicitudes',
  dataSource: 'Mesa de ayuda',
  unit: 'Horas',
  reportResponsibleId: 'user-report',
  monitorResponsibleId: 'user-monitor',
  greenThreshold: '< 24',
  yellowThreshold: '24 - 48',
  redThreshold: '> 48',
  baselineValue: '36',
  measurementMethod: 'Reporte mensual',
  deadline: '2026-12-31',
}

describe('procedure builder models', () => {
  it('normalizes ordered step payloads without inventing a code', () => {
    expect(procedureStepPayloadOf({ key: 'temporary', position: 1, title: '  Recibir solicitud ', instruction: ' Registrar en el sistema ', criteria: '  ' }, 3)).toEqual({
      position: 3,
      title: 'Recibir solicitud',
      instruction: 'Registrar en el sistema',
      criteria: null,
      responsibleIds: [],
    })
  })

  it('keeps the complete independent indicator contract', () => {
    expect(procedureIndicatorPayloadOf(indicatorDraft)).toEqual({
      ...indicatorDraft,
      name: 'Tiempo de respuesta',
      description: 'Mide el tiempo de atención de una solicitud.',
      frequency: 'Mensual',
      target: '< 24 horas',
      formula: 'Horas transcurridas / solicitudes',
      dataSource: 'Mesa de ayuda',
      unit: 'Horas',
    })
    expect(procedureIndicatorPayloadOf(indicatorDraft)).not.toHaveProperty('kpiId')
  })

  it('renders the preview sections without edit controls', () => {
    const entries: ProcedureIndicatorEntry[] = [{ key: 'indicator-1', id: 'indicator-1', draft: indicatorDraft }]
    const markup = renderToStaticMarkup(<>
      <ProcedureStepsSection entries={[{ key: 'step-1', id: 'step-1', position: 1, title: 'Recibir solicitud', instruction: 'Registrar la solicitud.', criteria: 'Debe quedar trazabilidad.', responsibleIds: ['user-1'] }]} users={[{ id: 'user-1', name: 'Ana Torres', isActive: true }]} readOnly />
      <ProcedureIndicatorSection processId="process-1" procedureId="procedure-1" entries={entries} users={[]} readOnly />
    </>)
    expect(markup).toContain('Recibir solicitud')
    expect(markup).toContain('Actividad 01 de 01')
    expect(markup).toContain('Tiempo de respuesta')
    expect(markup).toContain('aria-current="step"')
    expect(markup).toContain('Ana Torres')
    expect(markup).not.toContain('Añadir primer paso')
    expect(markup).not.toContain('Añadir primer indicador')
  })

  it('presents the complete procedure as a read-only document', () => {
    const markup = renderToStaticMarkup(<ProcedurePreview code="PROC-04" name="Recepción de solicitudes" objective="Ordenar la recepción." scope="Solicitudes comerciales." description="Documento de referencia." processName="Gestión Comercial" processCode="PROC-01" responsibleName="Procedure Admin" statusLabel="Borrador" statusClass="draft" version="1.0" steps={[{ key: 'step-1', position: 1, title: 'Recibir solicitud', instruction: 'Registrar la solicitud.', criteria: '' }]} indicators={[]} onClose={() => undefined} />)
    expect(markup).toContain('PROC-04')
    expect(markup).toContain('Recepción de solicitudes')
    expect(markup).toContain('Secuencia operativa')
    expect(markup).toContain('Indicadores propios')
  })
})

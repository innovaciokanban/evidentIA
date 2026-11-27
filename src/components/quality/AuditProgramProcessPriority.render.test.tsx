import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuditProgramProcessPriorityMatrix, PriorityFormModal } from './AuditProgramProcessPriority'
import { priorityForScore } from './audit-program-priority.model'

const baseProps = { programId: 'program-1', companyId: 'company-1', programStatus: 'ACTIVE' as const, processes: [] }

describe('AuditProgramProcessPriorityMatrix', () => {
  it('maps score thresholds to backend priority bands', () => {
    expect(priorityForScore(3)).toBe('LOW')
    expect(priorityForScore(4)).toBe('LOW')
    expect(priorityForScore(5)).toBe('MEDIUM')
    expect(priorityForScore(7)).toBe('MEDIUM')
    expect(priorityForScore(8)).toBe('HIGH')
    expect(priorityForScore(9)).toBe('HIGH')
  })

  it('exposes evaluation only to users with write permission', () => {
    const writableMarkup = renderToStaticMarkup(<AuditProgramProcessPriorityMatrix {...baseProps} canWrite />)
    const readonlyMarkup = renderToStaticMarkup(<AuditProgramProcessPriorityMatrix {...baseProps} canWrite={false} />)
    const completedMarkup = renderToStaticMarkup(<AuditProgramProcessPriorityMatrix {...baseProps} programStatus="COMPLETED" canWrite />)
    expect(writableMarkup).toContain('Evaluar proceso')
    expect(readonlyMarkup).not.toContain('Evaluar proceso')
    expect(completedMarkup).not.toContain('Evaluar proceso')
    expect(readonlyMarkup).toContain('Cargando matriz de priorización')
  })

  it('starts without estimates and disables saving until a new evaluation is complete', () => {
    const markup = renderToStaticMarkup(<PriorityFormModal form={{ processId: '', criticality: null, recentChanges: null, previousUnfavorableResults: null, manualPriority: '', manualJustification: '', observations: '' }} editing={null} availableProcesses={[]} estimatedScore={null} estimatedPriority={null} canSubmit={false} saving={false} error="" onCriterionChange={() => undefined} onChange={() => undefined} onSubmit={() => undefined} onClose={() => undefined} />)
    expect(markup).not.toContain('Puntuación estimada')
    expect(markup).toContain('Permite ajustar la prioridad calculada mediante criterio profesional.')
    expect(markup).toContain('disabled=""')
  })

  it('keeps existing criteria and manual justification visible while editing', () => {
    const markup = renderToStaticMarkup(<PriorityFormModal form={{ processId: 'process-1', criticality: 3, recentChanges: 2, previousUnfavorableResults: 1, manualPriority: 'HIGH', manualJustification: 'Cambio regulatorio reciente.', observations: 'Revisar controles.' }} editing={{ id: 'priority-1' } as never} availableProcesses={[]} estimatedScore={6} estimatedPriority="MEDIUM" canSubmit saving={false} error="" onCriterionChange={() => undefined} onChange={() => undefined} onSubmit={() => undefined} onClose={() => undefined} />)
    expect(markup).toContain('Puntuación estimada')
    expect(markup).toContain('value="3"')
    expect(markup).toContain('Cambio regulatorio reciente.')
    expect(markup).toContain('required')
    expect(markup).toContain('type="submit" class="button primary">Guardar evaluación</button>')
  })
})

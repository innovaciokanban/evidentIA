import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuditScopeSelect } from './AuditScopeSelect'

const processes = [
  { id: 'process-1', label: 'PROC-01 · Operación' },
  { id: 'process-2', label: 'PROC-02 · Logística' },
]
const procedures = [{ id: 'procedure-1', processId: 'process-1', label: 'POL-01 · Política de calidad' }]

describe('AuditScopeSelect rendering', () => {
  it('renders empty state, groups, and help text', () => {
    const markup = renderToStaticMarkup(
      <AuditScopeSelect processes={processes} procedures={procedures} processIds={[]} procedureIds={[]} onChange={() => {}} />,
    )
    expect(markup).toContain('Selecciona procesos y/o procedimientos')
    expect(markup).toContain('Procesos')
    expect(markup).toContain('Procesos y procedimientos')
    expect(markup).toContain('Selecciona uno o varios procesos y/o procedimientos incluidos en la auditoría')
  })

  it('shows procedures below a selected process without selecting them automatically', () => {
    const markup = renderToStaticMarkup(
      <AuditScopeSelect processes={processes} procedures={procedures} processIds={['process-1']} procedureIds={[]} onChange={() => {}} />,
    )
    expect(markup).toContain('POL-01 · Política de calidad')
    expect(markup).toContain('audit-scope-procedure-option')
    expect(markup).not.toContain('audit-scope-procedure-option selected')
  })

  it('explains when a selected process has no procedures', () => {
    const markup = renderToStaticMarkup(
      <AuditScopeSelect processes={[{ id: 'process-3', label: 'PROC-03 · Sin procedimientos' }]} procedures={[]} processIds={['process-3']} procedureIds={[]} onChange={() => {}} />,
    )
    expect(markup).toContain('Este proceso no tiene procedimientos disponibles.')
  })

  it('renders selected chips with remove controls and locks the anchor process', () => {
    const markup = renderToStaticMarkup(
      <AuditScopeSelect
        processes={processes}
        procedures={procedures}
        processIds={['process-1', 'process-2']}
        procedureIds={['procedure-1']}
        lockedProcessId="process-1"
        onChange={() => {}}
      />,
    )
    expect(markup).toContain('PROC-01 · Operación')
    expect(markup).toContain('Principal')
    expect(markup).toContain('Quitar PROC-02 · Logística')
    expect(markup).toContain('Quitar POL-01 · Política de calidad')
    expect(markup).not.toContain('Quitar PROC-01 · Operación')
  })
})

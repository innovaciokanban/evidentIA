import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuditScopeSelect } from './AuditScopeSelect'

const processes = [
  { id: 'process-1', label: 'PROC-01 · Operación' },
  { id: 'process-2', label: 'PROC-02 · Logística' },
]
const procedures = [{ id: 'procedure-1', label: 'POL-01 · Política de calidad' }]

describe('AuditScopeSelect rendering', () => {
  it('renders empty state, groups, and help text', () => {
    const markup = renderToStaticMarkup(
      <AuditScopeSelect processes={processes} procedures={procedures} processIds={[]} procedureIds={[]} onChange={() => {}} />,
    )
    expect(markup).toContain('Selecciona procesos y/o procedimientos')
    expect(markup).toContain('Procesos')
    expect(markup).toContain('Procedimientos')
    expect(markup).toContain('Selecciona uno o varios procesos y/o procedimientos incluidos en la auditoría')
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

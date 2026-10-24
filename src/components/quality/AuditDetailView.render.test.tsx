import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Audit, Process } from '../../types'
import { AuditDetailView } from './AuditDetailView'
import type { QualityUser } from './quality.model'

const users = [
  { id: 'user-1', name: 'Laura Gómez', companyId: 'company-1' },
  { id: 'user-2', name: 'Carlos Ruiz', companyId: 'company-1' },
] as unknown as QualityUser[]

const processes = [
  { id: 'process-1', code: 'PROC-01', name: 'Operación', companyId: 'company-1' },
  { id: 'process-2', code: 'PROC-02', name: 'Comercial', companyId: 'company-1' },
] as unknown as Process[]

const noop = () => {}

const audit = {
  id: 'audit-1',
  companyId: 'company-1',
  processId: 'process-1',
  code: 'AUD-001',
  title: 'Auditoría interna de calidad',
  auditType: 'Interna',
  status: 'IN_PROGRESS',
  scope: 'Procesos críticos de la operación.',
  objectives: 'Verificar el cumplimiento del manual.',
  criteria: 'Manual de calidad v2.',
  plannedDate: '2026-03-01T00:00:00.000Z',
  startDate: '2026-03-02T00:00:00.000Z',
  endDate: null,
  summary: null,
  process: { id: 'process-1', companyId: 'company-1', name: 'Operación', code: 'PROC-01' },
  leadAuditor: { id: 'user-1', name: 'Laura Gómez' },
  responsible: { id: 'user-2', name: 'Carlos Ruiz' },
  relatedProcesses: [{ id: 'process-2', code: 'PROC-02', name: 'Comercial', companyId: 'company-1' }],
  procedures: [{ id: 'procedure-1', code: 'P-10', name: 'Procedimiento de compras', processId: 'process-1' }],
  checklists: [{
    id: 'checklist-1',
    name: 'Lista de cumplimiento',
    items: [
      { id: 'item-1', checklistId: 'checklist-1', description: '¿Se documenta el proceso?', criteria: 'Manual §4.', required: true, result: 'NON_CONFORM', observations: 'Falta anexo.', position: 1 },
      { id: 'item-2', checklistId: 'checklist-1', description: '¿Se revisa el acta?', criteria: 'Registro §7.', required: true, result: 'PENDING', observations: null, position: 2 },
    ],
  }],
  findings: [
    {
      id: 'finding-1',
      auditId: 'audit-1',
      title: 'Falta de registro de capacitación',
      description: 'No existen registros de la charla.',
      type: 'NONCONFORMITY',
      severity: 'MAJOR',
      status: 'RESOLVED',
      resolution: 'Se generó el registro.',
      efficacyVerification: null,
      dueDate: null,
      responsible: { id: 'user-2', name: 'Carlos Ruiz' },
      itemId: 'item-1',
      item: { id: 'item-1', description: '¿Se documenta el proceso?', checklistId: 'checklist-1' },
      process: { id: 'process-2', code: 'PROC-02', name: 'Comercial' },
      procedure: null,
      actions: [{
        id: 'action-1',
        findingId: 'finding-1',
        title: 'Dictar la charla faltante',
        description: 'Programar y dictar la charla.',
        required: true,
        status: 'OPEN',
        priority: 'HIGH',
        dueDate: '2000-01-01T00:00:00.000Z',
        completedAt: null,
        responsible: { id: 'user-1', name: 'Laura Gómez' },
        progress: [{ id: 'progress-1', note: 'Fecha agendada.', percent: 40, createdAt: '2026-03-05T00:00:00.000Z' }],
      }],
    },
    {
      id: 'finding-2',
      auditId: 'audit-1',
      title: 'Orden en el archivo físico',
      description: 'El archivo se encuentra desordenado.',
      type: 'OBSERVATION',
      severity: 'MINOR',
      status: 'OPEN',
      resolution: null,
      efficacyVerification: null,
      dueDate: null,
      responsible: null,
      itemId: null,
      process: null,
      procedure: null,
      actions: [],
    },
  ],
  evidences: [{ id: 'evidence-1', name: 'Acta de la reunión', description: 'Acta firmada.', url: 'https://example.test/acta', findingId: 'finding-1', createdAt: '2026-03-04T00:00:00.000Z' }],
  evidenceFiles: [{ id: 'file-1', filename: 'informe-calidad.pdf', originalName: 'informe.pdf', size: 2048, mimeType: 'application/pdf', findingId: 'finding-1', actionId: null, itemId: null, createdAt: '2026-03-06T00:00:00.000Z', uploadedBy: { id: 'user-1', name: 'Laura Gómez' } }],
  checklistProgress: { total: 2, completed: 1, requiredPending: 1 },
  indicators: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-06T00:00:00.000Z',
} as unknown as Audit

function render(overrides: { audit?: Audit; canWrite?: boolean; initialSection?: 'resumen' | 'checklist' | 'hallazgos' | 'evidencias' | 'acciones' | 'historial' } = {}) {
  return renderToStaticMarkup(
    <AuditDetailView
      audit={overrides.audit ?? audit}
      users={users}
      processes={processes}
      canWrite={overrides.canWrite ?? true}
      onChanged={noop}
      onBack={noop}
      onEdit={noop}
      onError={noop}
      onNotice={noop}
      initialSection={overrides.initialSection ?? 'resumen'}
    />,
  )
}

describe('AuditDetailView rendering', () => {
  it('renders the preparation summary with scope chips and the status transitions', () => {
    const markup = render()
    expect(markup).toContain('AUD-001')
    expect(markup).toContain('Auditoría interna de calidad')
    expect(markup).toContain('Procesos críticos de la operación.')
    expect(markup).toContain('PROC-01 · Operación')
    expect(markup).toContain('PROC-02 · Comercial')
    expect(markup).toContain('P-10 · Procedimiento de compras')
    expect(markup).toContain('Principal')
    expect(markup).toContain('Laura Gómez')
    expect(markup).toContain('Carlos Ruiz')
    expect(markup).toContain('Cerrar auditoría')
    expect(markup).toContain('Cancelar')
    // Seis pestañas del espacio de trabajo con sus paneles.
    expect(markup).toContain('role="tablist"')
    expect(markup.match(/role="tab"/g)).toHaveLength(6)
    expect(markup).toContain('Acciones correctivas')
  })

  it('renders checklist progress and highlights required pending and non conform items', () => {
    const markup = render({ initialSection: 'checklist' })
    expect(markup).toContain('<strong>1</strong> de <strong>2</strong> criterios evaluados')
    expect(markup).toContain('obligatorio(s) pendiente(s)')
    expect(markup).toContain('¿Se documenta el proceso?')
    expect(markup).toContain('is-non-conform')
    expect(markup).toContain('is-required-pending')
    expect(markup).toContain('Falta anexo.')
    expect(markup).toContain('+ Hallazgo')
  })

  it('renders findings with type badges, efficacy alert and link back to the criterion', () => {
    const markup = render({ initialSection: 'hallazgos' })
    expect(markup).toContain('Falta de registro de capacitación')
    expect(markup).toContain('quality-finding-type nonconformity')
    expect(markup).toContain('No conformidad')
    expect(markup).toContain('Observación')
    expect(markup).toContain('sin verificación de eficacia')
    expect(markup).toContain('Ver criterio')
    expect(markup).toContain('1 acción(es) · 1 abierta(s)')
  })

  it('renders corrective actions with overdue and required badges plus progress entries', () => {
    const markup = render({ initialSection: 'acciones' })
    expect(markup).toContain('Dictar la charla faltante')
    expect(markup).toContain('Vencida')
    expect(markup).toContain('Obligatoria')
    expect(markup).toContain('Alta')
    expect(markup).toContain('Fecha agendada.')
    expect(markup).toContain('(40%)')
    expect(markup).toContain('Hallazgo: Falta de registro de capacitación')
  })

  it('renders evidence links and PDF files with their relation label', () => {
    const markup = render({ initialSection: 'evidencias' })
    expect(markup).toContain('Acta de la reunión')
    expect(markup).toContain('informe-calidad.pdf')
    expect(markup).toContain('2.0 KB')
    expect(markup).toContain('Hallazgo: Falta de registro de capacitación')
    expect(markup).toContain('Laura Gómez')
  })

  it('hides write controls when the user cannot edit the audit', () => {
    const markup = render({ canWrite: false })
    expect(markup).not.toContain('+ Hallazgo')
    expect(markup).not.toContain('Cerrar auditoría')
    expect(markup).not.toContain('Editar')

    const checklist = render({ canWrite: false, initialSection: 'checklist' })
    expect(checklist).not.toContain('Añadir lista')
    expect(checklist).toContain('No conforme')
  })
})

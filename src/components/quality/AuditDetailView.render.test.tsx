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
  evidenceFiles: [{ id: 'file-1', filename: 'informe-calidad.pdf', originalName: 'informe.pdf', size: 2048, mimeType: 'application/pdf', findingId: 'finding-1', actionId: null, itemId: null, storageProvider: 'LOCAL', storageState: 'READY', createdAt: '2026-03-06T00:00:00.000Z', uploadedBy: { id: 'user-1', name: 'Laura Gómez' } }],
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
    // Solo se muestran las cuatro pestañas públicas del espacio de trabajo.
    expect(markup).toContain('role="tablist"')
    expect(markup.match(/role="tab"/g)).toHaveLength(4)
    expect(markup.indexOf('id="quality-tab-resumen"')).toBeLessThan(markup.indexOf('id="quality-tab-checklist"'))
    expect(markup.indexOf('id="quality-tab-checklist"')).toBeLessThan(markup.indexOf('id="quality-tab-hallazgos"'))
    expect(markup.indexOf('id="quality-tab-hallazgos"')).toBeLessThan(markup.indexOf('id="quality-tab-historial"'))
    expect(markup).not.toContain('id="quality-tab-evidencias"')
    expect(markup).not.toContain('id="quality-tab-acciones"')
  })

  it('renders checklist progress and highlights required pending and non conform items', () => {
    const markup = render({ initialSection: 'checklist' })
    expect(markup).toContain('<strong>1</strong> de <strong>2</strong> criterios evaluados')
    expect(markup).toContain('obligatorio(s) pendiente(s)')
    expect(markup).toContain('¿Se documenta el proceso?')
    expect(markup).toContain('is-non-conform')
    expect(markup).toContain('is-required-pending')
    expect(markup).toContain('Falta anexo.')
    expect(markup).toContain('Criterio de verificación')
    expect(markup).toContain('Fuente documental')
    expect(markup).toContain('Editar respuesta')
    expect(markup).toContain('Gestionar hallazgo')
    expect(markup).toContain('Nueva pregunta')
    expect(markup).toContain('Sugerir con IA-Checky')
    expect(markup).toContain('MANUAL')
    expect(markup).not.toContain('>Evidencia<')
  })

  it('keeps planned checklist responses read-only while allowing preparation controls', () => {
    const markup = render({ audit: { ...audit, status: 'PLANNED' } as Audit, initialSection: 'checklist' })
    expect(markup).toContain('La auditoría está planificada')
    expect(markup).toContain('Añadir lista')
    expect(markup).not.toContain('aria-label="Resultado de ¿Se documenta el proceso?"')
    expect(markup).toContain('No conforme')
  })

  it('renders the Checky generation action only in the editable checklist', () => {
    const editable = render({ initialSection: 'checklist' })
    const readonly = render({ initialSection: 'checklist', canWrite: false })
    expect(editable).toContain('Sugerir con IA-Checky')
    expect(readonly).not.toContain('Sugerir con IA-Checky')
    expect(editable).toContain('Nueva pregunta')
    expect(readonly).not.toContain('Nueva pregunta')
  })

  it('identifies Checky questions from the persisted checklist contract', () => {
    const checkyAudit = {
      ...audit,
      checklists: [{
        ...audit.checklists?.[0],
        items: [{
          ...audit.checklists?.[0].items[0],
          criteria: 'Evidencia esperada: Registro firmado\nFuente: Procedimiento de control\nDimensión: Cumplimiento',
        }],
      }],
    } as unknown as Audit
    const markup = render({ audit: checkyAudit, initialSection: 'checklist' })
    expect(markup).toContain('>CHECKY<')
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

  it('renders the audit history section', () => {
    const markup = render({ initialSection: 'historial' })
    expect(markup).toContain('risk-history-section')
    expect(markup).toContain('HISTORIAL DE LA AUDITORÍA')
    expect(markup).toContain('Cargar historial')
  })

  it('keeps evidence and actions accessible contextually without adding primary tabs', () => {
    const actionsMarkup = render({ initialSection: 'acciones' })
    const evidenceMarkup = render({ initialSection: 'evidencias' })
    expect(actionsMarkup).toContain('id="quality-panel-acciones"')
    expect(actionsMarkup).toContain('Seguimiento de acciones')
    expect(actionsMarkup).toContain('Nueva acción')
    expect(actionsMarkup).toContain('Hallazgo asociado')
    expect(actionsMarkup).toContain('Responsable')
    expect(actionsMarkup).toContain('Fecha límite')
    expect(actionsMarkup).toContain('+ Avance')
    expect(actionsMarkup).toContain('Editar')
    expect(evidenceMarkup).toContain('id="quality-panel-evidencias"')
    expect(evidenceMarkup).toContain('PDFs adjuntos')
    expect(evidenceMarkup).toContain('Añadir PDF')
    expect(evidenceMarkup).toContain('informe-calidad.pdf')
    expect(evidenceMarkup).toContain('Hallazgo asociado')
    expect(evidenceMarkup).toContain('Descargar')
    expect(evidenceMarkup).toContain('Eliminar')
    expect(evidenceMarkup).not.toContain('+ Enlace')
    expect(evidenceMarkup).not.toContain('Ver todas')
    expect(evidenceMarkup).not.toContain('Acta de la reunión')
  })

  it('renders the PDF evidence empty state without link actions', () => {
    const markup = render({ audit: { ...audit, evidences: [], evidenceFiles: [] } as Audit, initialSection: 'evidencias' })
    expect(markup).toContain('Aún no hay evidencias adjuntas')
    expect(markup).toContain('Adjunta un PDF para documentar los resultados de esta auditoría.')
    expect(markup).toContain('Añadir PDF')
    expect(markup).not.toContain('+ Enlace')
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

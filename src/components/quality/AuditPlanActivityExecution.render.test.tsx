import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Audit, AuditPlan, AuditPlanActivity } from '../../types'
import { AuditPlanActivityExecution } from './AuditPlanActivityExecution'

  const audit = {
   id: 'audit-1',
   status: 'IN_PROGRESS',
   checklists: [{ id: 'checklist-1', name: 'Lista operativa', items: [{ id: 'item-1', checklistId: 'checklist-1', description: 'Verificar registros y conservar la evidencia de la revisión', criteria: 'El registro debe estar completo.\nFuente: Procedimiento vigente\nDimensión: Cumplimiento\nOrigen: Checky', result: 'PENDING', observations: 'Revisar el anexo.', required: true, position: 1 }] }],
  evidences: [{ id: 'evidence-1', name: 'Procedimiento vigente', url: 'https://example.com/procedure' }],
  evidenceFiles: [{ id: 'file-1', filename: 'acta.pdf', storageState: 'READY' }],
  findings: [{ id: 'finding-1', title: 'Control pendiente', type: 'OBSERVATION', status: 'OPEN' }],
} as unknown as Audit

const plan = { id: 'plan-1', status: 'APPROVED' } as unknown as AuditPlan

const activity = {
  id: 'activity-1',
  title: 'Entrevista de proceso',
  status: 'IN_PROGRESS',
  updatedAt: '2026-11-22T12:00:00.000Z',
  auditors: [],
  execution: { actualStart: '2026-11-22T11:00:00.000Z', actualEnd: null, result: null, observations: null, startedBy: null, completedBy: null },
  resources: {
     checklistItems: [{ id: 'item-1', checklistId: 'checklist-1', description: 'Verificar registros y conservar la evidencia de la revisión', result: 'PENDING' }],
    evidences: [{ id: 'evidence-1', auditId: 'audit-1', findingId: null, name: 'Procedimiento vigente', description: '', url: 'https://example.com/procedure' }],
    evidenceFiles: [],
    findings: [],
  },
} as unknown as AuditPlanActivity

describe('AuditPlanActivityExecution frontend', () => {
  it('renders execution controls and linked resource state without changing the plan fields', () => {
    const markup = renderToStaticMarkup(<AuditPlanActivityExecution audit={audit} plan={plan} activity={activity} canWrite readOnly={false} onUpdated={() => {}} onNotice={() => {}} onOpenChecklistItem={() => {}} onCreateChecklistItem={() => {}} onRequestChecklistProposals={() => {}} onCreateFinding={() => {}} onOpenFinding={() => {}} />)

    expect(markup).toContain('EJECUCIÓN Y TRAZABILIDAD')
    expect(markup).toContain('Guardar avance')
    expect(markup).toContain('Completar')
    expect(markup).toContain('Recursos vinculados')
    expect(markup).toContain('Procedimiento vigente')
    expect(markup).toContain('audit-plan-resource-copy')
    expect(markup).toContain('Verificar registros y conservar la evidencia de la revisión')
    expect(markup).toContain('Abrir en checklist')
    expect(markup).toContain('Añadir pregunta manual')
    expect(markup).toContain('Solicitar preguntas a Checky')
    expect(markup).toContain('Nuevo hallazgo')
    expect(markup).toContain('Vincular hallazgo existente')
    expect(markup).toContain('Añadir evidencia')
    expect(markup).toContain('Vincular evidencia existente')
    expect(markup).toContain('Abrir evidencia oficial')
    expect(markup).toContain('El registro debe estar completo.')
    expect(markup).toContain('Revisar el anexo.')
    expect(markup).toContain('Fuente')
    expect(markup).toContain('Checky')
    expect(markup).toContain('checked')
  })

  it('keeps execution controls read-only for a viewer', () => {
    const markup = renderToStaticMarkup(<AuditPlanActivityExecution audit={audit} plan={plan} activity={activity} canWrite={false} readOnly onUpdated={() => {}} onNotice={() => {}} onOpenChecklistItem={() => {}} onCreateChecklistItem={() => {}} onRequestChecklistProposals={() => {}} onCreateFinding={() => {}} onOpenFinding={() => {}} />)

    expect(markup).not.toContain('Guardar avance')
    expect(markup).not.toContain('Añadir evidencia')
    expect(markup).not.toContain('Vincular evidencia existente')
    expect(markup).toContain('disabled')
  })

  it('keeps an unavailable linked item visible without inventing checklist data', () => {
    const markup = renderToStaticMarkup(
      <AuditPlanActivityExecution
        audit={{ ...audit, checklists: [] } as unknown as Audit}
        plan={plan}
        activity={{ ...activity, resources: { ...activity.resources, checklistItems: [{ id: 'removed-item', checklistId: 'checklist-1', description: 'Ítem histórico', result: 'PENDING' }] } } as unknown as AuditPlanActivity}
        canWrite
        readOnly={false}
        onUpdated={() => {}}
        onNotice={() => {}}
        onOpenChecklistItem={() => {}}
         onCreateChecklistItem={() => {}}
         onRequestChecklistProposals={() => {}}
         onCreateFinding={() => {}}
         onOpenFinding={() => {}}
      />,
    )

    expect(markup).toContain('Pregunta no disponible')
    expect(markup).toContain('ID: removed-item')
  })

  it('does not expose contextual creation actions after an activity is completed', () => {
    const markup = renderToStaticMarkup(
      <AuditPlanActivityExecution
        audit={audit}
        plan={plan}
        activity={{ ...activity, status: 'COMPLETED' } as unknown as AuditPlanActivity}
        canWrite
        readOnly={false}
        onUpdated={() => {}}
        onNotice={() => {}}
        onOpenChecklistItem={() => {}}
        onCreateChecklistItem={() => {}}
        onRequestChecklistProposals={() => {}}
        onCreateFinding={() => {}}
        onOpenFinding={() => {}}
      />,
    )

    expect(markup).not.toContain('Añadir pregunta manual')
    expect(markup).not.toContain('Solicitar preguntas a Checky')
    expect(markup).not.toContain('Nuevo hallazgo')
    expect(markup).not.toContain('Vincular hallazgo existente')
    expect(markup).not.toContain('Añadir evidencia')
    expect(markup).not.toContain('Vincular evidencia existente')
  })

  it('keeps linked findings readable after cancellation and exposes the official record action', () => {
    const markup = renderToStaticMarkup(
      <AuditPlanActivityExecution
        audit={{ ...audit, findings: [{ id: 'finding-1', auditId: 'audit-1', title: 'Control pendiente', type: 'OBSERVATION', severity: 'MINOR', status: 'OPEN', description: 'No se encontró el registro.', dueDate: null, responsible: { id: 'user-1', name: 'Auditor', isActive: true }, process: null, procedure: null, item: null, itemId: null, processId: null, procedureId: null, actions: [], resolution: null, verifiedBy: null, verifiedAt: null, efficacyVerification: null, efficacyVerifiedBy: null, efficacyVerifiedAt: null, createdAt: '', updatedAt: '' }] } as unknown as Audit}
        plan={plan}
        activity={{ ...activity, status: 'CANCELLED', resources: { ...activity.resources, findings: [{ id: 'finding-1', auditId: 'audit-1', title: 'Control pendiente', type: 'OBSERVATION', severity: 'MINOR', status: 'OPEN' }] } } as unknown as AuditPlanActivity}
        canWrite
        readOnly={false}
        onUpdated={() => {}}
        onNotice={() => {}}
        onOpenChecklistItem={() => {}}
        onCreateChecklistItem={() => {}}
        onRequestChecklistProposals={() => {}}
        onCreateFinding={() => {}}
        onOpenFinding={() => {}}
      />,
    )

    expect(markup).toContain('Control pendiente')
    expect(markup).toContain('Observación')
    expect(markup).toContain('Abrir hallazgo oficial')
    expect(markup).not.toContain('Nuevo hallazgo')
  })
})

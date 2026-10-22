import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanActivitiesBlock, PlanEvidenceBlock, RiskFlowBar, RiskPlanSummary } from './ProcessRiskPanel'
import { activityDueStatus, activityProgressSummary, controlsWriteLocked, riskFlowSteps, riskStageMessage, riskStageMessages, riskStageReason } from './risk-flow'
import type { MitigationActivity, ProcessRisk, ProcessRiskControl, TicketEvidence } from '../../types'

const makeControl = (overrides: Partial<ProcessRiskControl> = {}): ProcessRiskControl => ({
  id: 'cmcontrol000000000001',
  riskId: 'cmrisk0000000000000001',
  description: 'Revisión periódica de accesos',
  evaluation: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const makeRisk = (overrides: Partial<ProcessRisk> = {}): ProcessRisk => ({
  id: 'cmrisk0000000000000001',
  processId: 'cmprocess000000000000001',
  name: 'Entrega tardía de información',
  description: 'La información puede llegar después del plazo y afectar la respuesta.',
  riskType: 'MISIONAL',
  code: 'MIS-R1',
  riskOwner: null,
  acceptanceStatus: 'PENDING',
  treatment: null,
  mitigationOwner: null,
  mitigationDueDate: null,
  inherentImpact: 4,
  inherentProbability: 5,
  inherentScore: 20,
  inherentLevel: 'HIGH',
  residualImpact: 1,
  residualProbability: 1,
  residualScore: 1,
  residualLevel: 'LOW',
  controls: [],
  evidences: [],
  approval: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
})

describe('riskStageReason', () => {
  it('enumera las causas en el mismo orden que las comprueba el backend', () => {
    expect(riskStageReason(null)).toBe('risk')
    expect(riskStageReason(makeRisk())).toBe('treatment')
    expect(riskStageReason(makeRisk({ treatment: 'MITIGATE' }))).toBe('acceptance-pending')
    expect(riskStageReason(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'REJECTED' }))).toBe('acceptance-rejected')
    expect(riskStageReason(makeRisk({ inherentImpact: 7, treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }))).toBe('evaluation')
    expect(riskStageReason(makeRisk({ inherentProbability: 0, treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }))).toBe('evaluation')
    expect(riskStageReason(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }))).toBeNull()
  })

  it('pinta los mensajes clave que exige el bloqueo por etapas', () => {
    expect(riskStageMessages.evaluation).toBe('Completa primero la evaluación inherente del riesgo')
    expect(riskStageMessages.treatment).toBe('Define el tratamiento del riesgo para continuar')
    expect(riskStageMessages['acceptance-pending']).toBe('La gestión de controles y mitigación se habilitará cuando el dueño del riesgo acepte el riesgo')
    expect(riskStageMessages['acceptance-rejected']).toBe('El riesgo fue rechazado. Se requiere una nueva decisión autorizada antes de continuar')
    expect(riskStageMessage(makeRisk({ treatment: 'MITIGATE' }))).toBe(riskStageMessages['acceptance-pending'])
    expect(riskStageMessage(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }))).toBe('')
  })
})

describe('controlsWriteLocked', () => {
  it('bloquea sin riesgo guardado, sin tratamiento, sin aceptar o con evaluación incompleta', () => {
    expect(controlsWriteLocked(null)).toBe(true)
    expect(controlsWriteLocked(makeRisk())).toBe(true)
    expect(controlsWriteLocked(makeRisk({ treatment: 'MITIGATE' }))).toBe(true)
    expect(controlsWriteLocked(makeRisk({ acceptanceStatus: 'REJECTED' }))).toBe(true)
    expect(controlsWriteLocked(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'REJECTED' }))).toBe(true)
    expect(controlsWriteLocked(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', inherentImpact: 9 }))).toBe(true)
  })

  it('desbloquea solo con tratamiento definido y riesgo aceptado por el ciclo', () => {
    expect(controlsWriteLocked(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }))).toBe(false)
    expect(controlsWriteLocked(makeRisk({ treatment: 'AVOID', acceptanceStatus: 'ACCEPTED' }))).toBe(false)
    expect(controlsWriteLocked(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] }))).toBe(false)
  })
})

describe('riskFlowSteps', () => {
  it('sin riesgo guardado solo el primer paso está pendiente y el resto queda bloqueado', () => {
    const steps = riskFlowSteps(null)
    expect(steps.map((step) => step.status)).toEqual(['pending', 'blocked', 'blocked', 'blocked'])
    expect(steps[0].hint).toContain('guarda el riesgo')
  })

  it('un riesgo recién guardado espera tratamiento y aceptación en el paso 2', () => {
    const steps = riskFlowSteps(makeRisk())
    expect(steps.map((step) => step.id)).toEqual(['evaluation', 'treatment', 'mitigation', 'residual'])
    expect(steps.map((step) => step.status)).toEqual(['completed', 'pending', 'blocked', 'blocked'])
    expect(steps[1].hint).toContain('aceptación')
    expect(steps[2].hint).toContain('Define el tratamiento del riesgo')
  })

  it('con tratamiento y aceptación registradas solo faltan los controles', () => {
    const steps = riskFlowSteps(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }))
    expect(steps.map((step) => step.status)).toEqual(['completed', 'completed', 'pending', 'blocked'])
    expect(steps[2].hint).toContain('al menos un control')
    expect(steps[3].hint).toContain('al menos un control')
  })

  it('un riesgo rechazado mantiene bloqueados el plan y el residual pese a tener controles', () => {
    const steps = riskFlowSteps(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'REJECTED', controls: [makeControl()] }))
    expect(steps.map((step) => step.status)).toEqual(['completed', 'blocked', 'blocked', 'blocked'])
    expect(steps[2].hint).toBe(riskStageMessages['acceptance-rejected'])
    expect(steps[3].hint).toBe(riskStageMessages['acceptance-rejected'])
  })

  it('con al menos un control y el riesgo aceptado el flujo aparece completo', () => {
    const steps = riskFlowSteps(makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] }))
    expect(steps.every((step) => step.status === 'completed')).toBe(true)
  })
})

describe('RiskFlowBar', () => {
  it('renderiza los cuatro pasos con su chip de estado y la instrucción del siguiente', () => {
    const markup = renderToStaticMarkup(<RiskFlowBar risk={makeRisk()} />)
    expect(markup).toContain('Evaluación')
    expect(markup).toContain('Tratamiento y aceptación')
    expect(markup).toContain('Controles y plan')
    expect(markup).toContain('Riesgo residual')
    expect(markup).toContain('Completado')
    expect(markup).toContain('Pendiente')
    expect(markup).toContain('Bloqueado')
    expect(markup).toContain('Define el tratamiento del riesgo')
  })

  it('al completar los cuatro pasos muestra el mensaje de gestión completa', () => {
    const markup = renderToStaticMarkup(<RiskFlowBar risk={makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] })} />)
    expect(markup).toContain('Gestión completa')
    expect(markup).not.toContain('Bloqueado')
  })
})

const makeActivity = (overrides: Partial<MitigationActivity> = {}): MitigationActivity => ({
  id: 'cmactivity00000000000001',
  title: 'Actualizar procedimiento de entrega',
  description: 'Revisar el procedimiento y actualizar la plantilla.',
  status: 'PENDING',
  dueDate: null,
  responsible: { id: 'cmuser00000000000001', name: 'Ana López' },
  ticket: { id: 'cmticket00000000000001', status: 'OPEN' },
  createdAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
})

const makeEvidence = (overrides: Partial<TicketEvidence> = {}): TicketEvidence => ({
  id: 'cmevidence00000000000001',
  ticketId: 'cmticket00000000000001',
  filename: 'acta-comite.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  createdAt: '2026-10-05T08:00:00.000Z',
  uploadedBy: { id: 'cmuser00000000000001', name: 'Ana López' },
  ticket: { id: 'cmticket00000000000001', title: 'Actualizar procedimiento' },
  ...overrides,
})

describe('activityDueStatus', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0)

  it('marca como atrasada toda actividad abierta con vencimiento anterior al día local', () => {
    expect(activityDueStatus('2026-10-19', 'PENDING', now)).toBe('overdue')
    expect(activityDueStatus('2026-10-19T23:00:00.000Z', 'IN_PROGRESS', now)).toBe('overdue')
  })

  it('marca como próxima las que vencen hoy o en los siguientes 7 días', () => {
    expect(activityDueStatus('2026-10-20', 'PENDING', now)).toBe('soon')
    expect(activityDueStatus('2026-10-27', 'PENDING', now)).toBe('soon')
    expect(activityDueStatus('2026-10-28', 'PENDING', now)).toBe('none')
  })

  it('ignora completadas, canceladas y actividades sin fecha', () => {
    expect(activityDueStatus('2026-10-01', 'COMPLETED', now)).toBe('none')
    expect(activityDueStatus('2026-10-01', 'CANCELLED', now)).toBe('none')
    expect(activityDueStatus(null, 'PENDING', now)).toBe('none')
  })
})

describe('activityProgressSummary', () => {
  it('cuenta completadas sobre el total cargado y destaca atrasadas', () => {
    const now = new Date(2026, 9, 20, 12, 0, 0)
    const summary = activityProgressSummary([
      makeActivity({ status: 'COMPLETED' }),
      makeActivity({ status: 'IN_PROGRESS' }),
      makeActivity({ dueDate: '2026-10-10' }),
      makeActivity({ status: 'CANCELLED', dueDate: '2026-10-10' }),
    ], now)
    expect(summary).toEqual({ total: 4, completed: 1, overdue: 1, percent: 25 })
  })

  it('sin actividades el progreso es cero y no se estima nada', () => {
    expect(activityProgressSummary([])).toEqual({ total: 0, completed: 0, overdue: 0, percent: 0 })
  })
})

describe('RiskPlanSummary', () => {
  it('muestra responsable, vencimiento y el progreso real recibido', () => {
    const markup = renderToStaticMarkup(<RiskPlanSummary ownerLabel="Ana López" dueDate="2026-12-15T12:00:00.000Z" progress={{ total: 5, completed: 3, overdue: 0, percent: 60 }} />)
    expect(markup).toContain('Ana López')
    expect(markup).toContain('15 de dic')
    expect(markup).toContain('3 de 5 (60%)')
    expect(markup).toContain('role="progressbar"')
  })

  it('destaca el plan vencido y omite el progreso si aún no hay lista completa', () => {
    const markup = renderToStaticMarkup(<RiskPlanSummary ownerLabel="Sin asignar" dueDate="2020-01-01T00:00:00.000Z" progress={null} />)
    expect(markup).toContain('Plan vencido')
    expect(markup).not.toContain('progressbar')
  })
})

describe('PlanActivitiesBlock', () => {
  it('renderiza las filas con responsable, vencimiento, estado y acceso al ticket', () => {
    const markup = renderToStaticMarkup(
      <PlanActivitiesBlock
        hasRisk activities={{ items: [makeActivity({ dueDate: '2026-12-15T12:00:00.000Z' })], error: '' }}
        canWrite
        saving={false}
        onAdd={() => {}}
        onRetry={() => {}}
        onOpenTicket={() => {}}
      />,
    )
    expect(markup).toContain('Actualizar procedimiento de entrega')
    expect(markup).toContain('Ana López')
    expect(markup).toContain('Vence 15 de dic')
    expect(markup).toContain('Pendiente')
    expect(markup).toContain('Ver ticket')
  })

  it('pinta el vencido como alerta y ofrece reintentar si la carga falló', () => {
    const overdue = renderToStaticMarkup(
      <PlanActivitiesBlock hasRisk activities={{ items: [makeActivity({ dueDate: '2020-01-01T00:00:00.000Z' })], error: '' }} canWrite saving={false} onAdd={() => {}} onRetry={() => {}} />,
    )
    expect(overdue).toContain('risk-activity-item is-overdue')
    expect(overdue).toContain('Vencida el')
    const failed = renderToStaticMarkup(
      <PlanActivitiesBlock hasRisk activities={{ items: [], error: 'No pudimos cargar las actividades.' }} canWrite saving={false} onAdd={() => {}} onRetry={() => {}} />,
    )
    expect(failed).toContain('No pudimos cargar las actividades.')
    expect(failed).toContain('Reintentar')
  })

  it('en modo lectura oculta el botón de agregar y un riesgo nuevo pide guardarlo primero', () => {
    const loading = renderToStaticMarkup(<PlanActivitiesBlock hasRisk activities={null} canWrite={false} saving={false} onAdd={() => {}} onRetry={() => {}} />)
    expect(loading).toContain('Cargando actividades')
    expect(loading).not.toContain('+ Agregar actividad')
    const unsaved = renderToStaticMarkup(<PlanActivitiesBlock hasRisk={false} activities={null} canWrite saving={false} onAdd={() => {}} onRetry={() => {}} />)
    expect(unsaved).toContain('Guarda el riesgo para agregar actividades')
    expect(unsaved).not.toContain('+ Agregar actividad')
  })
})

describe('PlanEvidenceBlock', () => {
  it('renderiza cada PDF con tamaño, origen, quién lo subió y acciones', () => {
    const markup = renderToStaticMarkup(
      <PlanEvidenceBlock hasRisk evidence={{ items: [makeEvidence()], error: '' }} onRetry={() => {}} onOpenTicket={() => {}} />,
    )
    expect(markup).toContain('acta-comite.pdf')
    expect(markup).toContain('2 KB')
    expect(markup).toContain('Actualizar procedimiento')
    expect(markup).toContain('Ana López')
    expect(markup).toContain('Descargar')
    expect(markup).toContain('href=')
    expect(markup).toContain('Ver ticket')
  })

  it('muestra el estado vacío y el de error con reintento', () => {
    const empty = renderToStaticMarkup(<PlanEvidenceBlock hasRisk evidence={{ items: [], error: '' }} onRetry={() => {}} />)
    expect(empty).toContain('Sin evidencias PDF')
    const failed = renderToStaticMarkup(<PlanEvidenceBlock hasRisk evidence={{ items: [], error: 'No pudimos cargar las evidencias.' }} onRetry={() => {}} />)
    expect(failed).toContain('No pudimos cargar las evidencias.')
    expect(failed).toContain('Reintentar')
  })
})

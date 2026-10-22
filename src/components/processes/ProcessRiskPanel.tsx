import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, apiUrl, ApiError } from '../../api'
import { riskLevelFor, riskLevelLabel, riskScoreFor } from '../../risk-matrix'
import type { ActionItemStatus, Process, ProcessRisk, ProcessRiskControl, ProcessType, RiskAcceptanceStatus, RiskControlEvaluation, RiskLevel, RiskTreatment, MitigationActivity, TicketEvidence, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { ApprovalStatusChip } from '../approvals/ApprovalsInbox'
import { RiskHeatmap, type HeatmapSelection } from './RiskHeatmap'
import { RiskHistorySection } from './RiskHistorySection'
import { draftFromRisk, emptyRiskDraft, riskPayloadFromDraft, riskTypeForProcessType, riskTypeLabelFor, riskTypeLabels, type RiskDraft } from './risk-type'
import { activityDueStatus, activityProgressSummary, controlsWriteLocked, riskFlowSteps, riskStageMessage, riskStageReason, riskStageMessages, type ActivityDueStatus, type RiskFlowStepStatus } from './risk-flow'

type ControlDraft = { description: string; evaluation: RiskControlEvaluation }
/** Borrador del modal «Agregar actividad»: los cuatro datos que el usuario registra en el paso 3. */
type ActivityDraft = { title: string; description: string; responsibleId: string; dueDate: string }

const emptyControlDraft: ControlDraft = { description: '', evaluation: 'PENDING' }
const emptyActivityDraft: ActivityDraft = { title: '', description: '', responsibleId: '', dueDate: '' }
const activityStatusLabels: Record<ActionItemStatus, string> = { PENDING: 'Pendiente', IN_PROGRESS: 'En curso', COMPLETED: 'Completada', CANCELLED: 'Cancelada' }
const impactOptions = [['1', '1 - Insignificante'], ['2', '2 - Menor'], ['3', '3 - Moderado'], ['4', '4 - Mayor'], ['5', '5 - Catastrófico']]
const probabilityOptions = [['1', '1 - Raro'], ['2', '2 - Improbable'], ['3', '3 - Posible'], ['4', '4 - Probable'], ['5', '5 - Casi seguro']]
const controlEvaluationOptions: Array<[RiskControlEvaluation, string]> = [['PENDING', 'Pendiente'], ['WEAK', 'Débil'], ['PARTIAL', 'Parcial'], ['EFFECTIVE', 'Efectivo']]
const treatmentOptions: Array<[RiskTreatment, string]> = [['AVOID', 'Evitar'], ['MITIGATE', 'Mitigar'], ['TRANSFER', 'Transferir'], ['ACCEPT', 'Aceptar']]
const treatmentLabelFor = (value: RiskTreatment | null): string => value ? (treatmentOptions.find(([option]) => option === value)?.[1] ?? value) : '—'
const acceptanceOptions: Array<[RiskAcceptanceStatus, string]> = [['PENDING', 'Pendiente'], ['ACCEPTED', 'Aceptado'], ['REJECTED', 'Rechazado']]
const acceptanceLabelFor = (value: RiskAcceptanceStatus | null): string => value ? (acceptanceOptions.find(([option]) => option === value)?.[1] ?? value) : '—'
const approvalDate = (value: string): string => new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
const ticketCode = (ticketId: string): string => `#${ticketId.slice(-6).toUpperCase()}`
const fileSizeLabel = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** Texto del vencimiento en la fila de una actividad, con aviso cuando está vencida o por vencer. */
function activityDueLabel(dueDate: string, due: ActivityDueStatus): string {
  const formatted = approvalDate(dueDate)
  return due === 'overdue' ? `Vencida el ${formatted}` : due === 'soon' ? `Vence pronto · ${formatted}` : `Vence ${formatted}`
}

/**
 * Estado del ciclo de aprobación dentro del detalle del riesgo: informa en qué va la revisión y
 * ofrece enviar/reenviar a aprobación solo cuando corresponde (dueño asignado, canWrite y sin ciclo
 * abierto). Se muestra solo para riesgos ya guardados; un riesgo nuevo no tiene ciclo.
 */
export function ApprovalBar({ risk, canWrite, sending, onRequest }: {
  risk: ProcessRisk
  canWrite: boolean
  sending: boolean
  onRequest: () => void
}) {
  const approval = risk.approval
  const ownerName = risk.riskOwner?.name ?? 'el dueño asignado'
  const copy = !approval
    ? 'Aún no se ha enviado a aprobación.'
    : approval.status === 'PENDING'
      ? `Solicitado el ${approvalDate(approval.requestedAt)}; ${ownerName} debe aprobarlo o rechazarlo desde «Mis aprobaciones».`
      : approval.status === 'APPROVED'
        ? `Aprobado${approval.decidedBy ? ` por ${approval.decidedBy.name}` : ''}${approval.decidedAt ? ` el ${approvalDate(approval.decidedAt)}` : ''}.`
        : approval.status === 'REJECTED'
          ? `Rechazado${approval.decidedBy ? ` por ${approval.decidedBy.name}` : ''}${approval.decidedAt ? ` el ${approvalDate(approval.decidedAt)}` : ''}${approval.comment ? `: «${approval.comment}»` : '.'}`
          : `Aprobado${approval.decidedBy ? ` por ${approval.decidedBy.name}` : ''}${approval.decidedAt ? ` el ${approvalDate(approval.decidedAt)}` : ''} y marcado para nueva revisión porque el riesgo cambió.`
  const canRequest = canWrite && Boolean(risk.riskOwner) && (!approval || approval.status === 'REJECTED' || approval.status === 'OUTDATED')
  return (
    <div className="risk-approval-bar" role="note" aria-label="Estado de aprobación del riesgo">
      <span className="risk-approval-label">APROBACIÓN</span>
      {approval && <ApprovalStatusChip status={approval.status} />}
      <span className="risk-approval-copy">{copy}</span>
      {!risk.riskOwner && canWrite && <span className="risk-approval-hint">Asigna un dueño y guarda el riesgo para iniciar el flujo de aprobación.</span>}
      {canRequest && (
        <button type="button" className="button secondary small-button" disabled={sending} onClick={onRequest}>
          {sending ? 'Enviando...' : approval ? 'Reenviar a aprobación' : 'Enviar a aprobación'}
        </button>
      )}
    </div>
  )
}

function LevelBadge({ level, score }: { level: RiskLevel; score: number }) {
  return <span className={`risk-level-badge ${level.toLowerCase()}`}><span className="risk-level-dot" />{score} — {riskLevelLabel[level]}</span>
}

// El código lo genera el backend: aquí solo se muestra, nunca se edita.
export function RiskCodeInput({ code, creating }: { code: string | null; creating: boolean }) {
  return <label>Código del riesgo<input className="risk-code-input" disabled value={code ?? ''} placeholder={creating ? 'Se asignará automáticamente' : 'Se asignará al guardar el riesgo'} /></label>
}

/**
 * El tipo de riesgo lo resuelve el backend a partir del tipo del proceso, así que el formulario lo
 * pinta desactivado (igual que el código). El valor se recalcula en cada render: si cambia el
 * proceso seleccionado, el campo se actualiza solo.
 */
export function RiskTypeInput({ processType }: { processType: ProcessType }) {
  return <label>Tipo de riesgo<input className="risk-code-input" disabled value={riskTypeLabels[riskTypeForProcessType[processType]]} title="Se deriva del tipo de proceso asociado" /></label>
}

/**
 * «Aceptación del riesgo»: el veredicto formal (Pendiente · Aceptado · Rechazado) que solo decide
 * el ciclo de aprobación, nunca el formulario. El control va siempre con `disabled` y sin
 * `onChange` —también cuando `canWrite` está activo o tras aprobar/rechazar— así que no despliega
 * opciones ni admite escritura: un riesgo nuevo se pinta «Pendiente» y uno existente, exactamente
 * el valor persistido. Sigue siendo un `<select>` con su `<label>`, de modo que la presentación y
 * la lectura accesible del campo no cambian.
 */
export function AcceptanceStatusField({ value }: { value: RiskAcceptanceStatus }) {
  return <label>Aceptación del riesgo<select value={value} disabled title="Solo el flujo de aprobación decide este estado; el formulario solo lo muestra">{acceptanceOptions.map(([option, label]) => <option value={option} key={option}>{label}</option>)}</select></label>
}

/**
 * Tarjeta de evaluación de riesgo (inherente y residual): comparte lenguaje visual con los
 * bloques del plan de mitigación (mismo borde, radio, fondo y jerarquía tipográfica). El
 * `variant` da el color de acento y distingue ambas tarjetas; impacto, probabilidad y el nivel
 * calculado se alinean en tres celdas de igual medida dentro de `risk-evaluation-body`, que en
 * pantallas angostas se apilan. Solo cambia la presentación: el nivel sale de la matriz 5 × 5.
 */
export function EvaluationCard({ title, variant, impact, probability, onImpact, onProbability, disabled, note }: {
  title: string
  variant: 'inherent' | 'residual'
  impact: string
  probability: string
  onImpact: (value: string) => void
  onProbability: (value: string) => void
  disabled: boolean
  note?: string
}) {
  const level = riskLevelFor(Number(impact), Number(probability))
  const score = riskScoreFor(Number(impact), Number(probability))
  return (
    <div className={`risk-evaluation-card is-${variant}`}>
      <div className="risk-evaluation-title"><span>{title}</span><LevelBadge level={level} score={score} /></div>
      <div className="risk-evaluation-body">
        <label>Impacto<select value={impact} onChange={(event) => onImpact(event.target.value)} disabled={disabled}>{impactOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Probabilidad<select value={probability} onChange={(event) => onProbability(event.target.value)} disabled={disabled}>{probabilityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="risk-calculated-level">
          <span>Nivel calculado</span>
          <strong className={`risk-level-text ${level.toLowerCase()}`} aria-live="polite">
            <span className="risk-level-score">{score}</span>
            <span className="risk-level-word">{riskLevelLabel[level]}</span>
          </strong>
        </div>
      </div>
      {note && <p className="risk-field-note" role="note">{note}</p>}
    </div>
  )
}

/**
 * El riesgo residual solo se evalúa cuando el paso 2 (evaluación inherente, tratamiento y
 * aceptación) quedó superado Y el riesgo tiene al menos un control asociado: son dos requisitos
 * independientes y el primero se comprueba primero, igual que en el backend. Un riesgo en creación
 * o sin controles (incluido el que se está creando) mantiene la tarjeta residual bloqueada.
 * Cualquier control la habilita una vez aceptado, sin importar su evaluación (también «Pendiente»).
 * Al eliminar el último control, los valores residuales ya guardados se conservan en el modelo
 * (columnas NOT NULL): la tarjeta se bloquea de nuevo, pero los datos no se borran; el backend
 * rechaza cambios residuales hasta que exista un control y el riesgo esté aceptado, y
 * guardar/eliminar un control recarga los riesgos así que la tarjeta se habilita o bloquea sola.
 */
export function residualRiskLocked(risk: ProcessRisk | null): boolean {
  return Boolean(riskStageReason(risk)) || !risk || risk.controls.length === 0
}

/**
 * Barra de progreso del flujo de gestión (pasos 1-4) con estados visuales: completado, pendiente
 * o bloqueado. Bajo los pasos se muestra la instrucción del primer pendiente/bloqueado, de modo
 * que el usuario siempre sepa qué hacer para continuar. Es guía visual: la regla real vive en el
 * backend y en `controlsWriteLocked`.
 */
export function RiskFlowBar({ risk }: { risk: ProcessRisk | null }) {
  const steps = riskFlowSteps(risk)
  const next = steps.find((step) => step.status !== 'completed')
  const statusLabel: Record<RiskFlowStepStatus, string> = { completed: 'Completado', pending: 'Pendiente', blocked: 'Bloqueado' }
  return (
    <div className="risk-flow-bar" role="note" aria-label="Pasos de la gestión del riesgo">
      <ol className="risk-flow-steps">
        {steps.map((step, index) => (
          <li key={step.id} className={`risk-flow-step is-${step.status}`}>
            <span className="risk-flow-step-number" aria-hidden="true">{step.status === 'completed' ? '✓' : index + 1}</span>
            <span className="risk-flow-step-label">{step.label}</span>
            <span className={`risk-flow-chip ${step.status}`}>{statusLabel[step.status]}</span>
          </li>
        ))}
      </ol>
      <p className="risk-flow-guidance" role="status">
        {next ? next.hint : 'Gestión completa: tratamiento, aceptación, controles y evaluación residual registrados.'}
      </p>
    </div>
  )
}

export function RiskResidualCard({ risk, draft, onImpact, onProbability }: {
  risk: ProcessRisk | null
  draft: Pick<RiskDraft, 'residualImpact' | 'residualProbability'>
  onImpact: (value: string) => void
  onProbability: (value: string) => void
}) {
  const locked = residualRiskLocked(risk)
  // Prioridad de los mensajes: primero el paso que falta (evaluación, tratamiento o aceptación) y
  // solo después la falta de controles, igual que el orden de comprobaciones del backend.
  const stageReason = riskStageReason(risk)
  const note = stageReason ? riskStageMessages[stageReason] : locked ? 'Agrega al menos un control para habilitar el riesgo residual' : undefined
  // El id es el ancla de la notificación "plan de mitigación completado": el link
  // "risks/<proceso>/<riesgo>/residual" trae al usuario hasta esta tarjeta para calificar el
  // riesgo residual en cuanto se hayan cerrado las actividades del plan.
  return (
    <div id="risk-residual-section">
      <EvaluationCard title="RIESGO RESIDUAL" variant="residual" impact={draft.residualImpact} probability={draft.residualProbability} onImpact={onImpact} onProbability={onProbability} disabled={locked} note={note} />
    </div>
  )
}

function ControlEditor({ control, draft, saving, error, onDraftChange, onSave, onCancel }: {
  control: ProcessRiskControl | null
  draft: ControlDraft
  saving: boolean
  error: string
  onDraftChange: (draft: ControlDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="risk-control-editor">
      <label>{control ? 'Editar control' : 'Nuevo control'}<textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} placeholder="Describe la acción de control" rows={3} maxLength={1000} autoFocus /></label>
      <label>Evaluación<select value={draft.evaluation} onChange={(event) => onDraftChange({ ...draft, evaluation: event.target.value as RiskControlEvaluation })}>{controlEvaluationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error && <span className="risk-inline-error" role="alert">{error}</span>}
      <div className="risk-control-editor-actions"><button type="button" className="text-button" onClick={onCancel}>Cancelar</button><button type="button" className="button primary small-button" disabled={saving || draft.description.trim().length < 3} onClick={onSave}>{saving ? 'Guardando...' : control ? 'Guardar control' : 'Agregar control'}</button></div>
    </div>
  )
}

/**
 * Modal «Agregar actividad» del plan de mitigación. Se renderiza FUERA del formulario del detalle
 * (un <form> anidado no es HTML válido) y solo con canWrite, así que el fieldset disabled del
 * paso 3 no lo afecta. La descripción es opcional: el backend usa el título si no llega. Escape
 * cierra el modal mientras no se esté guardando, igual que el resto de diálogos del sistema.
 */
function ActivityModal({ draft, users, saving, error, onDraftChange, onSubmit, onCancel }: {
  draft: ActivityDraft
  users: Array<Pick<User, 'id' | 'name'>>
  saving: boolean
  error: string
  onDraftChange: (draft: ActivityDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}) {
  const titleTooShort = draft.title.trim().length > 0 && draft.title.trim().length < 3
  useEffect(() => {
    if (saving) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saving, onCancel])
  return (
    <div className="drawer-backdrop centered-backdrop">
      <form className="drawer centered-modal company-modal" role="dialog" aria-modal="true" aria-labelledby="activity-modal-title" onSubmit={onSubmit}>
        <div className="company-modal-header">
          <div className="company-modal-icon" aria-hidden="true">✓</div>
          <div className="company-modal-title">
            <p className="eyebrow">PLAN DE MITIGACIÓN</p>
            <h2 id="activity-modal-title">Agregar actividad</h2>
            <p className="company-modal-subtitle">La actividad se guarda en el plan de mitigación del riesgo y genera su ticket de seguimiento.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onCancel} disabled={saving}>×</button>
        </div>
        <label>Nombre de la actividad
          <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder="Ej. Actualizar el procedimiento de entrega" minLength={3} maxLength={120} required autoFocus disabled={saving} aria-describedby="activity-title-hint" />
          <small id="activity-title-hint" className={`activity-field-hint${titleTooShort ? ' is-invalid' : ''}`}>{titleTooShort ? 'Escribe al menos 3 caracteres.' : 'Entre 3 y 120 caracteres. Se usa también como título del ticket.'}</small>
        </label>
        <label>Descripción <span className="activity-field-optional">Opcional</span>
          <textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} placeholder="Qué se hará, cómo y qué resultado se espera." rows={4} maxLength={5000} disabled={saving} aria-describedby="activity-description-hint" />
          <small id="activity-description-hint" className="activity-field-hint">Si la dejas vacía, el sistema usa el nombre de la actividad.</small>
        </label>
        <div className="form-grid">
          <label>Responsable
            <select value={draft.responsibleId} onChange={(event) => onDraftChange({ ...draft, responsibleId: event.target.value })} required disabled={saving} aria-describedby="activity-responsible-hint"><option value="">Selecciona un responsable</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
            <small id="activity-responsible-hint" className="activity-field-hint">Recibirá la notificación y quedará a cargo del ticket.</small>
          </label>
          <label>Fecha de entrega
            <input type="date" value={draft.dueDate} onChange={(event) => onDraftChange({ ...draft, dueDate: event.target.value })} required disabled={saving} aria-describedby="activity-due-hint" />
            <small id="activity-due-hint" className="activity-field-hint">Los vencimientos pasados se marcan como «Vencida» en la lista.</small>
          </label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="drawer-actions">
          <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button type="submit" className="button primary" disabled={saving} aria-busy={saving}>{saving ? 'Guardando...' : 'Agregar actividad'}</button>
        </div>
      </form>
    </div>
  )
}

/**
 * Estado guardado del plan de mitigación del paso 3: responsable, vencimiento y progreso real de
 * actividades. El progreso solo se pinta cuando el servidor ya devolvió la lista completa; nunca
 * se estima con datos a medias.
 */
export function RiskPlanSummary({ ownerLabel, dueDate, progress }: {
  ownerLabel: string
  dueDate: string | null
  progress: { total: number; completed: number; overdue: number; percent: number } | null
}) {
  const due = dueDate ? activityDueStatus(dueDate, 'PENDING') : 'none'
  return (
    <div className="risk-plan-summary" role="group" aria-label="Estado del plan de mitigación">
      <div className="risk-plan-summary-cell"><span>Responsable</span><strong>{ownerLabel}</strong></div>
      <div className="risk-plan-summary-cell"><span>Vencimiento</span><strong>{dueDate ? approvalDate(dueDate) : 'Sin fecha de vencimiento'}</strong>{due !== 'none' && <span className={`risk-plan-due-chip ${due}`}>{due === 'overdue' ? 'Plan vencido' : 'Vence en 7 días o menos'}</span>}</div>
      {progress && (
        <div className="risk-plan-summary-cell">
          <span>Actividades completadas</span>
          <strong>{progress.completed} de {progress.total} ({progress.percent}%){progress.overdue > 0 ? ` · ${progress.overdue} vencida${progress.overdue === 1 ? '' : 's'}` : ''}</strong>
          <div className="risk-plan-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} de ${progress.total} actividades completadas`} aria-label="Progreso de actividades completadas">
            <span className={`risk-plan-progress-fill${progress.percent === 100 ? ' is-complete' : ''}`} style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityRow({ activity, onOpenTicket }: { activity: MitigationActivity; onOpenTicket?: (ticketId: string) => void }) {
  const due = activityDueStatus(activity.dueDate, activity.status)
  const ticketId = activity.ticket?.id ?? null
  return (
    <li className={`risk-activity-item${due === 'overdue' ? ' is-overdue' : due === 'soon' ? ' is-soon' : ''}`}>
      <span className="risk-control-mark" aria-hidden="true">{activity.status === 'COMPLETED' ? '✓' : '○'}</span>
      <div className="risk-activity-info">
        <strong>{activity.title}</strong>
        <div className="risk-activity-meta">
          <span className="risk-activity-meta-cell">Responsable: {activity.responsible?.name ?? 'Sin asignar'}</span>
          {activity.dueDate && <span className={`risk-activity-meta-cell risk-activity-due is-${due}`}>{activityDueLabel(activity.dueDate, due)}</span>}
          {ticketId && <span className="risk-activity-meta-cell">Ticket {ticketCode(ticketId)}</span>}
        </div>
      </div>
      <div className="risk-activity-side">
        <span className={`control-evaluation activity-status ${activity.status.toLowerCase()}`}>{activityStatusLabels[activity.status]}</span>
        {ticketId && onOpenTicket && <button type="button" className="text-button risk-activity-open" onClick={() => onOpenTicket(ticketId)} aria-label={`Ver ticket ${ticketCode(ticketId)} de la actividad ${activity.title}`}>Ver ticket →</button>}
      </div>
    </li>
  )
}

/**
 * Bloque «Actividades de mitigación» del paso 3: barra de progreso ya pintada en el resumen,
 * filas con título, responsable, vencimiento (destacando atrasos) y acceso al ticket, más los
 * estados de carga, vacío y error con reintento.
 */
export function PlanActivitiesBlock({ activities, hasRisk, canWrite, saving, onAdd, onRetry, onOpenTicket }: {
  activities: { items: MitigationActivity[]; error: string } | null
  hasRisk: boolean
  canWrite: boolean
  saving: boolean
  onAdd: () => void
  onRetry: () => void
  onOpenTicket?: (ticketId: string) => void
}) {
  return (
    <div className="risk-evidence-block">
      <div className="risk-controls-heading">
        <div><p className="detail-label">PLAN DE ACCIÓN</p><h3>ACTIVIDADES DE MITIGACIÓN</h3></div>
        {canWrite && hasRisk && <button type="button" className="button secondary small-button" disabled={saving} onClick={onAdd}>{saving ? 'Guardando...' : '+ Agregar actividad'}</button>}
      </div>
      {!hasRisk
        ? <div className="risk-controls-empty">Guarda el riesgo para agregar actividades de mitigación.</div>
        : !activities
          ? <div className="inline-loading" role="status"><span className="loader" />Cargando actividades...</div>
          : activities.error
            ? <div className="risk-controls-empty" role="alert">{activities.error} <button type="button" className="text-button" onClick={onRetry}>Reintentar</button></div>
            : activities.items.length === 0
              ? <div className="risk-controls-empty">Sin actividades todavía. Cada actividad genera automáticamente su ticket de seguimiento.</div>
              : <ul className="risk-activity-list">{activities.items.map((activity) => <ActivityRow key={activity.id} activity={activity} onOpenTicket={onOpenTicket} />)}</ul>}
      <p className="risk-field-note">Cada actividad genera su ticket y su evidencia PDF. Cuando todas las actividades estén completadas y sus tickets cerrados, el responsable de la mitigación recibirá un aviso para calificar el riesgo residual.</p>
    </div>
  )
}

/**
 * Bloque «Evidencias del plan»: PDFs adjuntos a los tickets de las actividades, en filas
 * compactas con tamaño, actividad de origen, quién lo subió, fecha y acciones de descarga y
 * apertura del ticket.
 */
export function PlanEvidenceBlock({ evidence, hasRisk, onRetry, onOpenTicket }: {
  evidence: { items: TicketEvidence[]; error: string } | null
  hasRisk: boolean
  onRetry: () => void
  onOpenTicket?: (ticketId: string) => void
}) {
  return (
    <div className="risk-evidence-block">
      <div className="risk-controls-heading">
        <div><p className="detail-label">EVIDENCIAS</p><h3>EVIDENCIAS DEL PLAN</h3></div>
        <span className="risk-method-note">PDF adjuntos en los tickets</span>
      </div>
      {!hasRisk
        ? <div className="risk-controls-empty">Guarda el riesgo para ver las evidencias del plan.</div>
        : !evidence
          ? <div className="inline-loading" role="status"><span className="loader" />Cargando evidencias...</div>
          : evidence.error
            ? <div className="risk-controls-empty" role="alert">{evidence.error} <button type="button" className="text-button" onClick={onRetry}>Reintentar</button></div>
            : evidence.items.length === 0
              ? <div className="risk-controls-empty">Sin evidencias PDF todavía. Adjunta el PDF desde el ticket de cada actividad de mitigación.</div>
              : (
                <ul className="risk-evidence-files">
                  {evidence.items.map((item) => (
                    <li key={item.id} className="risk-evidence-file">
                      <span className="risk-evidence-file-kind" aria-hidden="true">PDF</span>
                      <div className="risk-evidence-file-info">
                        <strong title={item.filename}>{item.filename}</strong>
                        <small>{fileSizeLabel(item.size)} · {item.ticket?.title ?? 'Actividad de mitigación'} · {item.uploadedBy.name} · {approvalDate(item.createdAt)}</small>
                      </div>
                      <div className="risk-evidence-file-actions">
                        <a className="text-button" href={apiUrl(`/tickets/${item.ticketId}/evidence/${item.id}`)} download={item.filename} aria-label={`Descargar ${item.filename}`}>Descargar</a>
                        {onOpenTicket && <button type="button" className="text-button" onClick={() => onOpenTicket(item.ticketId)} aria-label={`Ver ticket del archivo ${item.filename}`}>Ver ticket</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
    </div>
  )
}

export function ProcessRiskPanel({ process, users, canWrite, focusRiskId, focusRiskSection, onFocusConsumed, onBack, onOpenApproval, onOpenTicket }: { process: Process; users: Array<Pick<User, 'id' | 'name'> & { companyId: string | null }>; canWrite: boolean; focusRiskId?: string | null; focusRiskSection?: 'residual' | null; onFocusConsumed?: () => void; onBack: () => void; onOpenApproval?: (approvalId: string) => void; onOpenTicket?: (ticketId: string) => void }) {
  const [risks, setRisks] = useState<ProcessRisk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [sendingApproval, setSendingApproval] = useState(false)
  const [selected, setSelected] = useState<ProcessRisk | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [draft, setDraft] = useState<RiskDraft>(emptyRiskDraft)
  const [controlEditor, setControlEditor] = useState<{ control: ProcessRiskControl | null; draft: ControlDraft } | null>(null)
  // Evidencias PDF del plan de mitigación: los archivos adjuntos a los tickets de las actividades
  // de los planes vinculados al riesgo. El resultado recuerda a qué riesgo pertenece para que, al
  // cambiar de detalle, no se pinte la lista anterior mientras llega la nueva.
  const [planEvidence, setPlanEvidence] = useState<{ riskId: string; items: TicketEvidence[]; error: string } | null>(null)
  const [planEvidenceVersion, setPlanEvidenceVersion] = useState(0)
  // Actividades del plan de mitigación del riesgo abierto: se piden al servidor al cambiar de
  // riesgo y tras agregar una actividad. El resultado recuerda a qué riesgo pertenece para no
  // pintar la lista anterior mientras viaja la respuesta (mismo patrón que planEvidence).
  const [activitiesView, setActivitiesView] = useState<{ riskId: string; items: MitigationActivity[]; error: string } | null>(null)
  const [activitiesVersion, setActivitiesVersion] = useState(0)
  const [activityDraft, setActivityDraft] = useState<ActivityDraft | null>(null)
  const [savingActivity, setSavingActivity] = useState(false)
  const [riskView, setRiskView] = useState<'list' | 'heatmap'>('list')
  const [heatmapSelection, setHeatmapSelection] = useState<HeatmapSelection | null>(null)
  // Versión del historial: se incrementa tras cada mutación (riesgo, aprobación, controles o
  // evidencias) para que RiskHistorySection vuelva a consultar los eventos más recientes.
  const [historyVersion, setHistoryVersion] = useState(0)
  const touchHistory = () => setHistoryVersion((value) => value + 1)

  const loadRisks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<{ risks: ProcessRisk[] }>(`/processes/${process.id}/risks`)
      setRisks(result.risks)
      return result.risks
    } catch (requestError) {
      console.error('[process-risks] failed to load risks', requestError)
      setError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar los riesgos.')
      return []
    } finally {
      setLoading(false)
    }
  }, [process.id])

  useEffect(() => { void loadRisks() }, [loadRisks])

  // Las actividades del plan de mitigación se cargan al abrir el detalle de un riesgo ya
  // guardado (un riesgo nuevo no tiene plan); el efecto se dispara solo al cambiar de riesgo o
  // de versión, nunca desde un handler.
  const activityRiskId = selected?.id ?? null
  useEffect(() => {
    if (!activityRiskId) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setActivitiesView({ riskId: activityRiskId, items: [], error: '' })
      void api<{ activities: MitigationActivity[] }>(`/processes/${process.id}/risks/${activityRiskId}/plan-activities`)
        .then((result) => { if (!cancelled) setActivitiesView({ riskId: activityRiskId, items: result.activities, error: '' }) })
        .catch((requestError: unknown) => {
          if (cancelled) return
          const message = requestError instanceof ApiError ? requestError.message : 'No pudimos cargar las actividades de mitigación.'
          setActivitiesView({ riskId: activityRiskId, items: [], error: message })
        })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [process.id, activityRiskId, activitiesVersion])

  // Evidencias PDF del riesgo abierto: se piden al servidor al cambiar de riesgo y al refrescar
  // planEvidenceVersion (tras agregar una actividad, que crea su ticket). La carga se difiere un tick para no
  // encadenar renders desde el propio efecto; si el detalle cambia mientras viaja la respuesta, el
  // aviso se descarta con `cancelled`.
  const planRiskId = selected?.id ?? null
  useEffect(() => {
    if (!planRiskId) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setPlanEvidence(null)
      void api<{ evidence: TicketEvidence[] }>(`/processes/${process.id}/risks/${planRiskId}/plan-evidence`)
        .then((result) => { if (!cancelled) setPlanEvidence({ riskId: planRiskId, items: result.evidence, error: '' }) })
        .catch((requestError: unknown) => {
          if (cancelled) return
          const message = requestError instanceof ApiError ? requestError.message : 'No pudimos cargar las evidencias del plan.'
          setPlanEvidence({ riskId: planRiskId, items: [], error: message })
        })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [process.id, planRiskId, planEvidenceVersion])
  // Lista efectiva: solo la del riesgo abierto, para no mostrar la de otro detalle en transición.
  const planEvidenceView = planEvidence && planEvidence.riskId === planRiskId ? planEvidence : null

  // Enfoca el riesgo indicado por la bandeja de aprobaciones, por un ticket o por una
  // notificación, una sola vez y recién cargada la lista; si ya no existe se consume el foco
  // igual para no dejarlo huérfano. Un foco que además pide la sección residual deja el foco
  // armado para el efecto siguiente, que se consume recién cuando el scroll se ejecuta.
  useEffect(() => {
    if (!focusRiskId || loading) return
    const target = risks.find((risk) => risk.id === focusRiskId)
    if (!target) {
      onFocusConsumed?.()
      return
    }
    openEdit(target)
    if (focusRiskSection !== 'residual') onFocusConsumed?.()
    // openEdit y onFocusConsumed solo componen estado interno; no hace falta declararlos como
    // dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRiskId, focusRiskSection, risks, loading])

  // El detalle ya abierto con la intención de sección residual significa que el ancla está en el
  // DOM: se desplaza hasta la tarjeta de riesgo residual (el mismo id al que apunta el link de la
  // notificación "risks/<proceso>/<riesgo>/residual") y recién ahí se libera el foco. No hay
  // estado intermedio: todo se deriva de las props y del detalle abierto.
  useEffect(() => {
    if (!focusRiskId || focusRiskSection !== 'residual' || !showDetail) return
    document.getElementById('risk-residual-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRiskId, focusRiskSection, showDetail])

  function openCreate() {
    setShowDetail(true)
    setSelected(null)
    setDraft(emptyRiskDraft)
    setControlEditor(null)
    setActivityDraft(null)
    setNotice('')
    setError('')
  }

  function openEdit(risk: ProcessRisk) {
    setShowDetail(true)
    setSelected(risk)
    setDraft(draftFromRisk(risk))
    setControlEditor(null)
    setActivityDraft(null)
    setNotice('')
    setError('')
  }

  function closeDetail() {
    setShowDetail(false)
    setSelected(null)
    setControlEditor(null)
    setActivityDraft(null)
    setError('')
  }

  async function saveRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    // El payload no lleva riskType: el backend lo deriva del proceso y rechaza cualquier
    // categoría incompatible con el proceso asociado.
    const payload = riskPayloadFromDraft(draft)
    try {
      const result = selected
        ? await api<{ risk: ProcessRisk }>(`/processes/${process.id}/risks/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ risk: ProcessRisk }>(`/processes/${process.id}/risks`, { method: 'POST', body: JSON.stringify(payload) })
      await loadRisks()
      setSelected(result.risk)
      setDraft(draftFromRisk(result.risk))
      setNotice(`Riesgo ${selected ? 'actualizado' : 'creado'} correctamente.`)
      touchHistory()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el riesgo.')
    } finally {
      setSaving(false)
    }
  }

  async function removeRisk(risk: ProcessRisk) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar riesgo', message: `Se eliminará «${risk.name}», sus controles y evidencias. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setError('')
    try {
      await api(`/processes/${process.id}/risks/${risk.id}`, { method: 'DELETE' })
      await loadRisks()
      if (selected?.id === risk.id) closeDetail()
      setNotice('Riesgo eliminado correctamente.')
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el riesgo.')
    }
  }

  async function requestApproval() {
    if (!selected || !canWrite || sendingApproval) return
    const confirmed = await askConfirm({
      title: selected.approval ? 'Reenviar a aprobación' : 'Enviar a aprobación',
      message: selected.approval
        ? `Se abrirá un nuevo ciclo de revisión para «${selected.name}» y se notificará a ${selected.riskOwner?.name ?? 'el dueño'}. ¿Continuar?`
        : `Se enviará «${selected.name}» a revisión de ${selected.riskOwner?.name ?? 'el dueño'}. ¿Continuar?`,
      confirmLabel: 'Enviar',
    })
    if (!confirmed) return
    setSendingApproval(true)
    setError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}/risks/${selected.id}/approvals`, { method: 'POST' })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) {
        setSelected(updated)
        setDraft(draftFromRisk(updated))
      }
      setNotice('Riesgo enviado a aprobación. El dueño fue notificado.')
      touchHistory()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo enviar el riesgo a aprobación.')
    } finally {
      setSendingApproval(false)
    }
  }

  async function saveControl() {
    if (!selected || !canWrite || !controlEditor || saving) return
    // Defensa en profundidad en el cliente: la regla real la aplica el backend con 409, pero el
    // editor ni siquiera se ofrece mientras el requisito no se cumpla.
    if (controlsWriteLocked(selected)) return
    setSaving(true)
    setError('')
    try {
      const path = `/processes/${process.id}/risks/${selected.id}/controls${controlEditor.control ? `/${controlEditor.control.id}` : ''}`
      await api(path, { method: controlEditor.control ? 'PATCH' : 'POST', body: JSON.stringify(controlEditor.draft) })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) setSelected(updated)
      setControlEditor(null)
      setNotice(`Control ${controlEditor.control ? 'actualizado' : 'agregado'} correctamente.`)
      touchHistory()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el control.')
    } finally {
      setSaving(false)
    }
  }

  async function removeControl(control: ProcessRiskControl) {
    if (!selected || !canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar control', message: `Se eliminará «${control.description}».`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    try {
      await api(`/processes/${process.id}/risks/${selected.id}/controls/${control.id}`, { method: 'DELETE' })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) setSelected(updated)
      setNotice('Control eliminado correctamente.')
      touchHistory()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el control.')
    }
  }

  async function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !activityDraft || !canWrite || savingActivity) return
    // Misma defensa en profundidad que los controles: el backend responde 409, pero el modal ni
    // siquiera se abre (ni esta guarda deja pasar el envío) mientras el paso 2 no esté superado.
    if (controlsWriteLocked(selected)) return
    setSavingActivity(true)
    setError('')
    try {
      await api(`/processes/${process.id}/risks/${selected.id}/plan-activities`, { method: 'POST', body: JSON.stringify(activityDraft) })
      setActivityDraft(null)
      setActivitiesVersion((value) => value + 1)
      setPlanEvidenceVersion((value) => value + 1)
      setNotice('Actividad de mitigación agregada. El responsable fue notificado y su ticket quedó creado.')
      touchHistory()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo agregar la actividad.')
    } finally {
      setSavingActivity(false)
    }
  }

  const isDetail = showDetail
  const availableRiskOwners = users.filter((user) => user.companyId === process.companyId)
  // Lista efectiva: solo la del riesgo abierto, para no mostrar la de otro detalle en transición.
  const activities = activitiesView && activitiesView.riskId === activityRiskId ? activitiesView : null
  // Escritura del paso 3 (controles, plan) y del paso 4 (residual) bloqueada hasta superar el
  // paso 2: evaluación inherente completa, tratamiento definido y riesgo aceptado. La consulta de
  // los controles y del plan nunca se oculta: solo se diferencia lectura de escritura.
  const controlsLocked = controlsWriteLocked(selected)
  // Nombre visible del responsable del plan en el resumen del paso 3 (borrador en pantalla).
  const planOwnerLabel = availableRiskOwners.find((user) => user.id === draft.mitigationOwnerId)?.name ?? 'Sin asignar'
  const renderLevel = (level: RiskLevel, score: number) => <LevelBadge level={level} score={score} />
  const heatmapMatches = heatmapSelection ? risks.filter((risk) => {
    const impact = heatmapSelection.mode === 'inherent' ? risk.inherentImpact : risk.residualImpact
    const probability = heatmapSelection.mode === 'inherent' ? risk.inherentProbability : risk.residualProbability
    return impact === heatmapSelection.impact && probability === heatmapSelection.probability
  }) : []
  const heatmapSelectionLevel = heatmapSelection ? riskLevelFor(heatmapSelection.impact, heatmapSelection.probability) : null

  function toggleHeatmapCell(selection: HeatmapSelection) {
    setHeatmapSelection((current) => (
      current && current.mode === selection.mode && current.impact === selection.impact && current.probability === selection.probability
        ? null
        : selection
    ))
  }

  return (
    <div className="process-risk-page">
      <div className="risk-page-header">
        <button type="button" className="text-button risk-back-button" onClick={onBack}>← Volver a la caracterización</button>
        {!isDetail ? <div className="risk-page-heading"><div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO RIESGOS</p><h1>Riesgos</h1><p className="muted">Identifica y evalúa los riesgos asociados a este proceso.</p></div>{canWrite && <button type="button" className="button primary" onClick={openCreate}>+ Nuevo riesgo</button>}</div> : <div className="risk-page-heading"><div><p className="eyebrow">RIESGOS / DETALLE</p><h1>{selected ? 'Detalle del riesgo' : 'Nuevo riesgo'}</h1><p className="muted">Registra la información y evaluación del riesgo.</p></div></div>}
      </div>

      <section className="panel risk-process-context"><div><span>Proceso</span><strong>{process.name}</strong></div><div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div><div><span>Riesgos registrados</span><strong>{risks.length}</strong></div></section>
      {notice && <div className="form-success page-alert" role="status">{notice}</div>}
      {error && !controlEditor && !activityDraft && <div className="form-error page-alert" role="alert">{error}<button type="button" className="button secondary small-button" onClick={() => void loadRisks()}>Reintentar</button></div>}

      {isDetail ? (
        <>
        <form className="panel risk-detail-panel" onSubmit={(event) => void saveRisk(event)}>
          <div className="risk-detail-toolbar"><button type="button" className="text-button" onClick={closeDetail}>← Volver a riesgos</button>{selected && canWrite && <button type="button" className="button danger small-button" onClick={() => void removeRisk(selected)}>Eliminar riesgo</button>}</div>
          {selected && <ApprovalBar risk={selected} canWrite={canWrite} sending={sendingApproval} onRequest={() => void requestApproval()} />}
          <RiskFlowBar risk={selected} />
          <fieldset disabled={!canWrite} className="risk-detail-fields">
            {/* Paso 1: información base + evaluación inherente. */}
            <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">PASO 1 · INFORMACIÓN BASE</p><h2>DETALLE DEL RIESGO</h2></div><span className="risk-process-chip">{process.code ?? 'Proceso'}</span></div><div className="risk-base-grid"><RiskCodeInput code={selected ? selected.code : null} creating={!selected} /><label>Nombre del riesgo<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Entrega tardía de información" minLength={3} maxLength={160} required /></label><RiskTypeInput processType={process.type} /><label>Dueño del riesgo<select value={draft.riskOwnerId} onChange={(event) => setDraft({ ...draft, riskOwnerId: event.target.value })}><option value="">Sin asignar</option>{availableRiskOwners.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label><label className="risk-base-wide">Descripción del riesgo<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Qué puede ocurrir, por qué y qué efecto tendría." rows={4} maxLength={5000} required /></label></div></section>
            <section className="risk-detail-section risk-evaluation-section"><div className="risk-section-heading"><div><p className="detail-label">PASO 1 · VALORACIÓN</p><h2>EVALUACIÓN DE RIESGOS</h2></div><span className="risk-method-note">Matriz 5 × 5 · impacto × probabilidad</span></div><div className="risk-evaluation-layout"><EvaluationCard title="RIESGO INHERENTE" variant="inherent" impact={draft.inherentImpact} probability={draft.inherentProbability} onImpact={(value) => setDraft({ ...draft, inherentImpact: value })} onProbability={(value) => setDraft({ ...draft, inherentProbability: value })} disabled={!canWrite} /></div></section>
            {/* Paso 2: tratamiento y aceptación. Deben decidirse aquí antes de gestionar controles. */}
            <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">PASO 2 · TRATAMIENTO</p><h2>TRATAMIENTO Y ACEPTACIÓN</h2></div><span className="risk-method-note">Independiente de los niveles inherente y residual</span></div><div className="risk-base-grid"><label>Tratamiento del riesgo<select value={draft.treatment} onChange={(event) => setDraft({ ...draft, treatment: event.target.value })}><option value="">Sin tratamiento definido</option>{treatmentOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><AcceptanceStatusField value={draft.acceptanceStatus} /><p className="risk-field-note">El tratamiento lo decides aquí y define cómo se gestionará el riesgo; la aceptación es el veredicto formal del ciclo de aprobación: un riesgo nuevo nace «Pendiente» y solo cambia cuando el dueño aprueba o rechaza, nunca desde este formulario. Con el tratamiento definido y la aceptación decidida se habilita la gestión de controles del paso 3.</p></div></section>
            {/* Paso 3: controles (escritura bloqueada hasta completar el paso 2). */}
            <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">PASO 3 · MITIGACIÓN</p><h2>CONTROLES</h2></div>{canWrite && selected && !controlEditor && !controlsLocked && <button type="button" className="button secondary small-button" onClick={() => setControlEditor({ control: null, draft: emptyControlDraft })}>+ Agregar control</button>}</div><section className="risk-controls-card">{!selected ? <div className="risk-controls-empty">Guarda el riesgo para agregar controles.</div> : <>{controlsLocked && <div className="risk-controls-empty">{riskStageMessage(selected)} Los controles registrados siguen siendo consultables.</div>}{selected.controls.length === 0 && !controlsLocked && !controlEditor ? <div className="risk-controls-empty">Sin controles registrados{canWrite && <button type="button" className="text-button" onClick={() => setControlEditor({ control: null, draft: emptyControlDraft })}>+ Agregar control</button>}</div> : <div className="risk-control-list">{selected.controls.map((control) => <div className="risk-control-item" key={control.id}><span className="risk-control-mark">✓</span><div><strong>{control.description}</strong><span className={`control-evaluation ${control.evaluation.toLowerCase()}`}>{controlEvaluationOptions.find(([value]) => value === control.evaluation)?.[1]}</span></div>{canWrite && <span className="risk-control-actions">{!controlsLocked && <button type="button" className="sipoc-icon-button" title="Editar control" aria-label="Editar control" onClick={() => setControlEditor({ control, draft: { description: control.description, evaluation: control.evaluation } })}>✎</button>}<button type="button" className="sipoc-icon-button danger" title="Eliminar control" aria-label="Eliminar control" onClick={() => void removeControl(control)}>🗑</button></span>}</div>)}</div>}</>}{controlEditor && selected && <ControlEditor control={controlEditor.control} draft={controlEditor.draft} saving={saving} error={error} onDraftChange={(value) => setControlEditor({ ...controlEditor, draft: value })} onSave={() => void saveControl()} onCancel={() => setControlEditor(null)} />}</section></section>
          </fieldset>
          {/* Paso 3 (seguimiento): vive fuera del fieldset para que, en modo lectura, sigan
              siendo utilizables las acciones de las filas (ver ticket, descargar evidencia PDF). */}
          <section className="risk-detail-section risk-plan-section"><div className="risk-section-heading"><div><p className="detail-label">PASO 3 · SEGUIMIENTO</p><h2>PLAN DE MITIGACIÓN</h2></div><span className="risk-method-note">Responsable, vencimiento y evidencias</span></div>{controlsLocked && <p className="risk-field-note" role="note">{riskStageMessage(selected)}</p>}<div className="risk-base-grid"><label>Responsable del plan<select disabled={!canWrite || controlsLocked} value={draft.mitigationOwnerId} onChange={(event) => setDraft({ ...draft, mitigationOwnerId: event.target.value })}><option value="">Sin asignar</option>{availableRiskOwners.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label><label>Fecha de vencimiento<input type="date" disabled={!canWrite || controlsLocked} value={draft.mitigationDueDate} onChange={(event) => setDraft({ ...draft, mitigationDueDate: event.target.value })} /></label></div>{selected && <RiskPlanSummary ownerLabel={planOwnerLabel} dueDate={draft.mitigationDueDate || null} progress={activities && !activities.error && activities.items.length > 0 ? activityProgressSummary(activities.items) : null} />}<PlanActivitiesBlock activities={activities} hasRisk={Boolean(selected)} canWrite={canWrite && !controlsLocked} saving={savingActivity} onAdd={() => setActivityDraft({ ...emptyActivityDraft })} onRetry={() => setActivitiesVersion((value) => value + 1)} onOpenTicket={onOpenTicket} /><PlanEvidenceBlock evidence={planEvidenceView} hasRisk={Boolean(selected)} onRetry={() => setPlanEvidenceVersion((value) => value + 1)} onOpenTicket={onOpenTicket} /></section>
          {/* Paso 4: evaluación residual (habilitada por los controles del paso 3). Un fieldset
              propio mantiene los campos deshabilitados en modo lectura, como el resto del detalle. */}
          <fieldset disabled={!canWrite} className="risk-detail-fields">
            <section className="risk-detail-section risk-evaluation-section"><div className="risk-section-heading"><div><p className="detail-label">PASO 4 · RESIDUAL</p><h2>EVALUACIÓN RESIDUAL</h2></div><span className="risk-method-note">Después de controles</span></div><div className="risk-evaluation-layout"><RiskResidualCard risk={selected} draft={draft} onImpact={(value) => setDraft({ ...draft, residualImpact: value })} onProbability={(value) => setDraft({ ...draft, residualProbability: value })} /></div></section>
          </fieldset>
          {error && !controlEditor && !activityDraft && <div className="form-error risk-detail-error" role="alert">{error}</div>}
          <footer className="risk-detail-footer"><button type="button" className="button secondary" onClick={closeDetail}>Cancelar</button>{canWrite && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : selected ? 'Guardar cambios' : 'Guardar riesgo'}</button>}</footer>
        </form>
        {activityDraft && selected && <ActivityModal draft={activityDraft} users={availableRiskOwners} saving={savingActivity} error={error} onDraftChange={setActivityDraft} onSubmit={(event) => void saveActivity(event)} onCancel={() => { setActivityDraft(null); setError('') }} />}
        {selected && <RiskHistorySection processId={process.id} riskId={selected.id} refreshVersion={historyVersion} onOpenApproval={onOpenApproval} onOpenTicket={onOpenTicket} />}
        </>
      ) : (
         <section className="panel risk-list-panel"><div className="panel-heading risk-list-heading"><div><p className="detail-label">MATRIZ DEL PROCESO</p><h2>{riskView === 'heatmap' ? 'Matriz de calor' : 'Listado de riesgos'}</h2></div><div className="risk-view-toggle" role="group" aria-label="Vista de riesgos"><button type="button" className={riskView === 'list' ? 'is-active' : ''} aria-pressed={riskView === 'list'} onClick={() => setRiskView('list')}>Listado</button><button type="button" className={riskView === 'heatmap' ? 'is-active' : ''} aria-pressed={riskView === 'heatmap'} onClick={() => setRiskView('heatmap')}>Matriz de calor</button></div></div>{loading ? <div className="inline-loading"><span className="loader" />Cargando riesgos...</div> : risks.length === 0 ? <div className="risk-empty"><span className="risk-empty-icon">!</span><h3>Aún no hay riesgos registrados</h3><p>Documenta el primer riesgo asociado a este proceso.</p>{canWrite && <button type="button" className="button secondary" onClick={openCreate}>Crear primer riesgo</button>}</div> : riskView === 'heatmap' ? <div className="risk-heatmaps"><RiskHeatmap title="RIESGO INHERENTE" subtitle="ANTES DE CONTROLES" mode="inherent" risks={risks} selection={heatmapSelection} onSelect={toggleHeatmapCell} /><RiskHeatmap title="RIESGO RESIDUAL" subtitle="DESPUÉS DE CONTROLES" mode="residual" risks={risks} selection={heatmapSelection} onSelect={toggleHeatmapCell} />{heatmapSelection && heatmapSelectionLevel && <div className="risk-heatmap-results"><div className="risk-heatmap-results-heading"><h3>{heatmapSelection.mode === 'inherent' ? 'Inherente' : 'Residual'} · Impacto {heatmapSelection.impact} × Probabilidad {heatmapSelection.probability} <span className={`risk-level-badge ${heatmapSelectionLevel.toLowerCase()}`}><span className="risk-level-dot" />{riskScoreFor(heatmapSelection.impact, heatmapSelection.probability)} — {riskLevelLabel[heatmapSelectionLevel]}</span></h3><button type="button" className="text-button" onClick={() => setHeatmapSelection(null)}>Limpiar selección</button></div>{heatmapMatches.length === 0 ? <div className="risk-controls-empty">Sin riesgos en esta celda.</div> : heatmapMatches.map((risk) => <button type="button" className="risk-heatmap-result" key={risk.id} onClick={() => openEdit(risk)}><span className="risk-heatmap-result-name"><strong>{risk.name}</strong><small>{risk.code ? `${risk.code} · ` : ''}{risk.riskOwner?.name ?? 'Sin asignar'}</small></span><span>{renderLevel(heatmapSelection.mode === 'inherent' ? risk.inherentLevel : risk.residualLevel, heatmapSelection.mode === 'inherent' ? risk.inherentScore : risk.residualScore)}</span><span className="risk-list-arrow">→</span></button>)}</div>}</div> : <div className="risk-list"><div className="risk-list-head"><span>Código</span><span>Riesgo</span><span>Tipo</span><span>Dueño</span><span>Tratamiento</span><span>Aceptación</span><span>Inherente</span><span>Residual</span><span /></div>{risks.map((risk) => <article className="risk-list-item" key={risk.id}><button type="button" className="risk-list-main" onClick={() => openEdit(risk)}><span className="risk-list-code">{risk.code ?? '—'}</span><span className="risk-list-name"><strong>{risk.name}</strong><small>{risk.description}</small></span><span>{riskTypeLabelFor(risk.riskType)}</span><span>{risk.riskOwner?.name ?? 'Sin asignar'}</span><span className={`risk-treatment-chip ${risk.treatment ? risk.treatment.toLowerCase() : 'none'}`}>{treatmentLabelFor(risk.treatment)}</span><span className={`risk-acceptance-chip ${risk.acceptanceStatus.toLowerCase()}`}>{acceptanceLabelFor(risk.acceptanceStatus)}</span><span>{renderLevel(risk.inherentLevel, risk.inherentScore)}</span><span>{renderLevel(risk.residualLevel, risk.residualScore)}</span><span className="risk-list-arrow">→</span></button>{canWrite && <button type="button" className="risk-list-delete" aria-label={`Eliminar ${risk.name}`} onClick={() => void removeRisk(risk)}>×</button>}</article>)}</div>}</section>
      )}
    </div>
  )
}

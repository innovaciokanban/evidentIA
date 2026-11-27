import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { AuditEvent, AuditFinding, AuditImmediateCorrection, AuditImmediateCorrectionStatus } from '../../types'
import { activeUserOptions, userOptionLabel } from '../../user-status'
import { askConfirm } from '../ui/useConfirm'
import { formatAuditCalendarDate, formatAuditDateTime } from './audit-history.model'
import { cancellationDetailsFromHistory, immediateCorrectionPresentation, type ImmediateCorrectionCancellationDetail } from './finding-dossier.model'
import { findingSeverityLabels, findingStatusLabels, findingTypeLabels, type QualityUser } from './quality.model'
import { RootCauseAnalysisPanel } from './RootCauseAnalysisPanel'
import { RootCauseActionLinksPanel } from './RootCauseActionLinksPanel'
import { CorrectiveActionManagementPanel } from './CorrectiveActionManagementPanel'
import { EfficacyVerificationPanel } from './EfficacyVerificationPanel'
import { CheckyFindingSuggestionsPanel } from './CheckyFindingSuggestionsPanel'

const immediateCorrectionStatusLabels: Record<AuditImmediateCorrectionStatus, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
}

const immediateCorrectionStatusClass = (status: AuditImmediateCorrectionStatus) => status.toLowerCase().replace('_', '-')

type CorrectionDraft = {
  description: string
  containmentMeasures: string
  consequencesIdentified: string
  consequencesTreatment: string
  responsibleId: string
  plannedDate: string
  observations: string
}

const emptyCorrectionDraft: CorrectionDraft = {
  description: '',
  containmentMeasures: '',
  consequencesIdentified: '',
  consequencesTreatment: '',
  responsibleId: '',
  plannedDate: '',
  observations: '',
}

const dateInputValue = (value: string | null): string => value ? value.slice(0, 10) : ''

const correctionDraftFrom = (correction: AuditImmediateCorrection): CorrectionDraft => ({
  description: correction.description,
  containmentMeasures: correction.containmentMeasures ?? '',
  consequencesIdentified: correction.consequencesIdentified ?? '',
  consequencesTreatment: correction.consequencesTreatment ?? '',
  responsibleId: correction.responsible?.id ?? '',
  plannedDate: dateInputValue(correction.plannedDate),
  observations: correction.observations ?? '',
})

type FindingDossierStage = 'identificacion' | 'correccion' | 'causa' | 'acciones' | 'eficacia' | 'verificacion'

const findingDossierStages: Array<{ id: FindingDossierStage; label: string }> = [
  { id: 'identificacion', label: 'Identificación' },
  { id: 'correccion', label: 'Corrección inmediata' },
  { id: 'causa', label: 'Causa raíz' },
  { id: 'acciones', label: 'Acciones correctivas' },
  { id: 'eficacia', label: 'Eficacia' },
  { id: 'verificacion', label: 'Verificación' },
]

function requestMessage(requestError: unknown, fallback: string): string {
  return requestError instanceof ApiError ? requestError.message : fallback
}

function correctionPayload(draft: CorrectionDraft) {
  return {
    description: draft.description.trim(),
    containmentMeasures: draft.containmentMeasures.trim() || null,
    consequencesIdentified: draft.consequencesIdentified.trim() || null,
    consequencesTreatment: draft.consequencesTreatment.trim() || null,
    responsibleId: draft.responsibleId || null,
    plannedDate: draft.plannedDate ? `${draft.plannedDate}T00:00:00.000Z` : null,
    observations: draft.observations.trim() || null,
  }
}

export function ImmediateCorrectionsPanel({ auditId, finding, users, canWrite, onChanged, onError, onNotice, cancellationDetails }: {
  auditId: string
  finding: AuditFinding
  users: QualityUser[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
  cancellationDetails?: Record<string, ImmediateCorrectionCancellationDetail>
}) {
  const [corrections, setCorrections] = useState<AuditImmediateCorrection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AuditImmediateCorrection | null>(null)
  const [draft, setDraft] = useState<CorrectionDraft>(emptyCorrectionDraft)
  const [transitionFor, setTransitionFor] = useState<{ correction: AuditImmediateCorrection; target: Exclude<AuditImmediateCorrectionStatus, 'OPEN'> } | null>(null)
  const [transitionNote, setTransitionNote] = useState('')

  const readonly = !canWrite || finding.status === 'VERIFIED'
  const correctionUsers = activeUserOptions(users, corrections.flatMap((correction) => correction.responsible ? [{ ...correction.responsible, companyId: null }] : []))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const result = await api<{ corrections: AuditImmediateCorrection[] }>(`/audits/${auditId}/findings/${finding.id}/corrections`)
        if (!cancelled) setCorrections(result.corrections)
      } catch (requestError) {
        if (!cancelled) {
          const message = requestMessage(requestError, 'No se pudieron cargar las correcciones inmediatas.')
          setError(message)
          onError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [auditId, finding.id, onError])

  function startCreate() {
    setEditorOpen(true)
    setEditing(null)
    setDraft(emptyCorrectionDraft)
    setError('')
  }

  function startEdit(correction: AuditImmediateCorrection) {
    setEditorOpen(true)
    setEditing(correction)
    setDraft(correctionDraftFrom(correction))
    setTransitionFor(null)
    setError('')
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditing(null)
    setDraft(emptyCorrectionDraft)
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || readonly) return
    setSaving(true)
    setError('')
    try {
      const payload = correctionPayload(draft)
      const result = editing
        ? await api<{ correction: AuditImmediateCorrection }>(`/audits/${auditId}/findings/${finding.id}/corrections/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ correction: AuditImmediateCorrection }>(`/audits/${auditId}/findings/${finding.id}/corrections`, { method: 'POST', body: JSON.stringify(payload) })
      setCorrections((current) => editing ? current.map((item) => item.id === result.correction.id ? result.correction : item) : [...current, result.correction])
      closeEditor()
      await onChanged()
      onNotice(editing ? 'Corrección inmediata actualizada.' : 'Corrección inmediata registrada.')
    } catch (requestError) {
      const message = requestMessage(requestError, 'No se pudo guardar la corrección inmediata.')
      setError(message)
      onError(message)
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!transitionFor || saving || readonly) return
    const { correction, target } = transitionFor
    if (target === 'IN_PROGRESS') {
      const confirmed = await askConfirm({ title: 'Iniciar corrección', message: `«${correction.description}» pasará a «En curso».`, confirmLabel: 'Iniciar' })
      if (!confirmed) return
    }
    const note = transitionNote.trim()
    if ((target === 'COMPLETED' || target === 'CANCELLED') && note.length < 1) {
      setError(target === 'COMPLETED' ? 'Registra las observaciones de ejecución.' : 'Registra la justificación de cancelación.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const action = target === 'IN_PROGRESS' ? 'start' : target === 'COMPLETED' ? 'complete' : 'cancel'
      const body = target === 'COMPLETED' ? { observations: note } : target === 'CANCELLED' ? { justification: note } : {}
      const result = await api<{ correction: AuditImmediateCorrection }>(`/audits/${auditId}/findings/${finding.id}/corrections/${correction.id}/${action}`, { method: 'POST', body: JSON.stringify(body) })
      setCorrections((current) => current.map((item) => item.id === result.correction.id ? result.correction : item))
      setTransitionFor(null)
      setTransitionNote('')
      await onChanged()
      onNotice(`Corrección inmediata ${immediateCorrectionStatusLabels[target].toLowerCase()}.`)
    } catch (requestError) {
      const message = requestMessage(requestError, 'No se pudo cambiar el estado de la corrección inmediata.')
      setError(message)
      onError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="finding-dossier-corrections" aria-labelledby="immediate-corrections-title">
      <div className="finding-dossier-section-heading">
        <div>
          <p className="detail-label">CONTENCIÓN Y RESPUESTA</p>
          <h3 id="immediate-corrections-title">Correcciones inmediatas</h3>
        </div>
        {!readonly && !editorOpen && <button type="button" className="button primary small-button" onClick={startCreate}>+ Registrar corrección</button>}
      </div>
      {finding.status === 'VERIFIED' && <p className="finding-dossier-lock" role="note">Este hallazgo está verificado. Las correcciones inmediatas quedan en solo lectura.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {editorOpen && (
        <form className="finding-correction-form" onSubmit={saveCorrection}>
          <div className="finding-dossier-form-title"><strong>{editing ? 'Editar corrección inmediata' : 'Nueva corrección inmediata'}</strong><span>Describe la contención aplicada, no la causa raíz.</span></div>
          <label className="finding-correction-wide">Descripción de la corrección<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={5000} required autoFocus /></label>
          <label>Medidas de contención<textarea value={draft.containmentMeasures} onChange={(event) => setDraft((current) => ({ ...current, containmentMeasures: event.target.value }))} maxLength={5000} rows={3} /></label>
          <label>Consecuencias identificadas<textarea value={draft.consequencesIdentified} onChange={(event) => setDraft((current) => ({ ...current, consequencesIdentified: event.target.value }))} maxLength={5000} rows={3} /></label>
          <label>Tratamiento de consecuencias<textarea value={draft.consequencesTreatment} onChange={(event) => setDraft((current) => ({ ...current, consequencesTreatment: event.target.value }))} maxLength={5000} rows={3} /></label>
          <label>Responsable<select value={draft.responsibleId} onChange={(event) => setDraft((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Sin asignar</option>{correctionUsers.map((user) => <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>)}</select></label>
          <label>Fecha prevista<input type="date" value={draft.plannedDate} onChange={(event) => setDraft((current) => ({ ...current, plannedDate: event.target.value }))} /></label>
          <label className="finding-correction-wide">Observaciones<textarea value={draft.observations} onChange={(event) => setDraft((current) => ({ ...current, observations: event.target.value }))} maxLength={5000} rows={3} /></label>
          <div className="procedure-form-actions finding-correction-wide"><button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar corrección'}</button><button type="button" className="button secondary" onClick={closeEditor} disabled={saving}>Cancelar</button></div>
        </form>
      )}
      {loading ? <div className="inline-loading"><span className="loader" />Cargando correcciones...</div> : corrections.length === 0 && !editing ? (
        <div className="finding-dossier-empty"><strong>No hay correcciones inmediatas registradas.</strong><span>Usa este espacio para documentar la contención aplicada al hallazgo.</span></div>
      ) : (
        <div className="finding-correction-list">
          {corrections.map((correction) => (
            <article className="finding-correction-card" key={correction.id}>
              <header className="finding-correction-card-header"><div><span className={`finding-correction-status ${immediateCorrectionStatusClass(correction.status)}`}>{immediateCorrectionStatusLabels[correction.status]}</span><h4>{correction.description}</h4></div><time dateTime={correction.updatedAt}>Actualizada {formatAuditDateTime(correction.updatedAt)}</time></header>
              <div className="finding-correction-meta"><span><strong>Responsable</strong>{correction.responsible?.name ?? 'Sin asignar'}</span><span><strong>Fecha prevista</strong>{formatAuditCalendarDate(correction.plannedDate)}</span>{correction.executedAt && <span><strong>Ejecutada</strong>{formatAuditDateTime(correction.executedAt)}</span>}</div>
              <div className="finding-correction-details"><div><span>Medidas de contención</span><p>{immediateCorrectionPresentation(correction, cancellationDetails?.[correction.id]).containmentMeasures}</p></div><div><span>Consecuencias identificadas</span><p>{immediateCorrectionPresentation(correction, cancellationDetails?.[correction.id]).consequencesIdentified}</p></div><div><span>Tratamiento de consecuencias</span><p>{immediateCorrectionPresentation(correction, cancellationDetails?.[correction.id]).consequencesTreatment}</p></div><div><span>Observaciones</span><p>{immediateCorrectionPresentation(correction, cancellationDetails?.[correction.id]).observations}</p></div>{immediateCorrectionPresentation(correction, cancellationDetails?.[correction.id]).cancellationJustification && <div className="finding-correction-cancellation finding-correction-wide"><span>Justificación de cancelación</span><p>{immediateCorrectionPresentation(correction, cancellationDetails?.[correction.id]).cancellationJustification}</p></div>}</div>
              {!readonly && correction.status !== 'COMPLETED' && correction.status !== 'CANCELLED' && !editorOpen && (
                <div className="finding-correction-actions"><button type="button" className="button secondary small-button" onClick={() => startEdit(correction)}>Editar</button>{correction.status === 'OPEN' && <button type="button" className="button secondary small-button" onClick={() => { setTransitionFor({ correction, target: 'IN_PROGRESS' }); setTransitionNote('') }}>Iniciar</button>}{correction.status === 'IN_PROGRESS' && <button type="button" className="button primary small-button" onClick={() => { setTransitionFor({ correction, target: 'COMPLETED' }); setTransitionNote('') }}>Completar</button>}<button type="button" className="button danger small-button" onClick={() => { setTransitionFor({ correction, target: 'CANCELLED' }); setTransitionNote('') }}>Cancelar</button></div>
              )}
              {transitionFor?.correction.id === correction.id && (
                <form className="finding-correction-transition" onSubmit={changeStatus}>
                  {transitionFor.target === 'IN_PROGRESS' ? <p>Confirma el inicio de esta corrección.</p> : <label>{transitionFor.target === 'COMPLETED' ? 'Observaciones de ejecución' : 'Justificación de cancelación'}<textarea value={transitionNote} onChange={(event) => setTransitionNote(event.target.value)} maxLength={5000} minLength={1} rows={3} required autoFocus /></label>}
                  <div className="finding-correction-actions"><button type="submit" className="button primary small-button" disabled={saving}>{saving ? 'Procesando…' : transitionFor.target === 'CANCELLED' ? 'Confirmar cancelación' : transitionFor.target === 'COMPLETED' ? 'Confirmar finalización' : 'Confirmar inicio'}</button><button type="button" className="button secondary small-button" onClick={() => setTransitionFor(null)} disabled={saving}>Volver</button></div>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function FindingDossier({ auditId, finding, users, canWrite, onClose, onChanged, onError, onNotice, onGoToAction }: {
  auditId: string
  finding: AuditFinding
  users: QualityUser[]
  canWrite: boolean
  onClose: () => void
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
  onGoToAction?: (actionId: string) => void
}) {
  const [cancellationDetails, setCancellationDetails] = useState<Record<string, ImmediateCorrectionCancellationDetail>>({})
  const [openNewActionForEfficacyId, setOpenNewActionForEfficacyId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<FindingDossierStage>('identificacion')
  const [rootCauseSummary, setRootCauseSummary] = useState<{ analyses: number; confirmed: number } | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await api<{ events: AuditEvent[] }>(`/audits/${auditId}/history?pageSize=50`)
        if (!cancelled) setCancellationDetails(cancellationDetailsFromHistory(result.events))
      } catch {
        // El expediente conserva la presentación existente si el historial no está disponible.
      }
    })()
    return () => { cancelled = true }
  }, [auditId, finding.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await api<{ analyses: Array<{ status: string; causes: Array<{ status: string }> }> }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses`)
        if (!cancelled) setRootCauseSummary({ analyses: result.analyses.length, confirmed: result.analyses.reduce((count, analysis) => count + analysis.causes.filter((cause) => cause.status === 'CONFIRMED').length, 0) })
      } catch {
        if (!cancelled) setRootCauseSummary(null)
      }
    })()
    return () => { cancelled = true }
  }, [auditId, finding.id, finding.updatedAt])

  const actions = finding.actions ?? []
  const openActions = actions.filter((action) => action.status !== 'COMPLETED' && action.status !== 'CANCELLED').length
  const evidenceCount = actions.reduce((count, action) => count + (action.evidences?.length ?? 0) + (action.evidenceFiles?.filter((file) => file.storageState === 'READY').length ?? 0), 0)
  const efficacyEvaluations = finding.efficacyEvaluations ?? []
  const completedEfficacy = efficacyEvaluations.filter((evaluation) => evaluation.status === 'COMPLETED').length
  const recommendedStage: FindingDossierStage = finding.status === 'VERIFIED'
    ? 'verificacion'
    : openActions > 0
      ? 'acciones'
      : efficacyEvaluations.some((evaluation) => evaluation.status !== 'COMPLETED' && evaluation.status !== 'CANCELLED')
        ? 'eficacia'
        : efficacyEvaluations.length > 0
          ? 'verificacion'
        : rootCauseSummary?.confirmed
          ? 'acciones'
          : 'correccion'
  const recommendedStageLabel = findingDossierStages.find((stage) => stage.id === recommendedStage)?.label ?? 'Siguiente etapa'

  return (
    <div className="drawer-backdrop centered-backdrop finding-dossier-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="drawer centered-modal finding-dossier" role="dialog" aria-modal="true" aria-labelledby="finding-dossier-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="finding-dossier-header">
          <div className="finding-dossier-title"><p className="eyebrow">EXPEDIENTE DEL HALLAZGO</p><h2 id="finding-dossier-title">{finding.title}</h2><div className="quality-finding-badges"><span className={`quality-finding-type ${finding.type.toLowerCase()}`}>{findingTypeLabels[finding.type]}</span><span className={`quality-finding-badge severity ${finding.severity.toLowerCase()}`}>{findingSeverityLabels[finding.severity]}</span><span className={`quality-finding-badge status ${finding.status.toLowerCase()}`}>{findingStatusLabels[finding.status]}</span></div><div className="finding-dossier-header-meta"><span><small>Responsable</small><strong>{finding.responsible?.name ?? 'Sin asignar'}</strong></span><span><small>Plazo</small><strong>{finding.dueDate ? formatAuditCalendarDate(finding.dueDate) : 'Sin fecha'}</strong></span><span><small>Proceso</small><strong>{finding.process?.code ?? 'Sin proceso'}</strong></span></div></div>
          <button type="button" className="icon-button" aria-label="Cerrar expediente" onClick={onClose}>×</button>
        </header>
        <section className="finding-dossier-indicators" aria-label="Indicadores del hallazgo">
          <div><strong>{rootCauseSummary?.confirmed ?? '—'}</strong><span>Causas confirmadas</span></div>
          <div className={openActions > 0 ? 'attention' : ''}><strong>{actions.length}</strong><span>Acciones registradas</span></div>
          <div><strong>{evidenceCount}</strong><span>Evidencias objetivas</span></div>
          <div className={efficacyEvaluations.length > completedEfficacy ? 'attention' : ''}><strong>{completedEfficacy}/{efficacyEvaluations.length}</strong><span>Eficacias verificadas</span></div>
        </section>
        <nav className="finding-dossier-route" role="tablist" aria-label="Etapas del tratamiento del hallazgo">
          {findingDossierStages.map((stage, index) => <button type="button" role="tab" key={stage.id} aria-selected={activeStage === stage.id} className={`finding-dossier-route-step${activeStage === stage.id ? ' active' : ''}`} onClick={() => setActiveStage(stage.id)}><span>{index + 1}</span><strong>{stage.label}</strong></button>)}
        </nav>
        <div className="finding-dossier-recommendation" role="status"><div><p className="detail-label">Siguiente acción sugerida</p><strong>{recommendedStageLabel}</strong><span>{finding.status === 'VERIFIED' ? 'El hallazgo está verificado; conserva la trazabilidad y revisa su historial.' : openActions > 0 ? `${openActions} acción(es) permanecen abiertas.` : 'Continúa el tratamiento documentado según la información disponible.'}</span></div><button type="button" className="button secondary small-button" onClick={() => setActiveStage(recommendedStage)}>Abrir etapa</button></div>
        <div className="finding-dossier-stage-content">
          <section className="finding-dossier-stage" hidden={activeStage !== 'identificacion'} aria-labelledby="finding-stage-identificacion">
            <div className="finding-dossier-stage-heading"><div><p className="detail-label">ETAPA 1</p><h3 id="finding-stage-identificacion">Identificación</h3></div></div>
            <section className="finding-dossier-summary"><p className="detail-label">DESCRIPCIÓN Y EVIDENCIA OBJETIVA</p><p>{finding.description}</p><div className="finding-dossier-origin"><div><span>Criterio</span><strong>{finding.item?.description ?? 'Sin criterio vinculado'}</strong></div><div><span>Proceso</span><strong>{finding.process ? `${finding.process.code} · ${finding.process.name}` : 'Sin proceso vinculado'}</strong></div><div><span>Responsable</span><strong>{finding.responsible?.name ?? 'Sin asignar'}</strong></div></div></section>
          </section>
          <section className="finding-dossier-stage" hidden={activeStage !== 'correccion'} aria-labelledby="finding-stage-correccion"><div className="finding-dossier-stage-heading"><div><p className="detail-label">ETAPA 2</p><h3 id="finding-stage-correccion">Corrección inmediata</h3></div></div><ImmediateCorrectionsPanel auditId={auditId} finding={finding} users={users} canWrite={canWrite} onChanged={onChanged} onError={onError} onNotice={onNotice} cancellationDetails={cancellationDetails} /></section>
          <section className="finding-dossier-stage" hidden={activeStage !== 'causa'} aria-labelledby="finding-stage-causa"><div className="finding-dossier-stage-heading"><div><p className="detail-label">ETAPA 3</p><h3 id="finding-stage-causa">Causa raíz</h3></div></div><CheckyFindingSuggestionsPanel auditId={auditId} finding={finding} canWrite={canWrite} onChanged={onChanged} onError={onError} onNotice={onNotice} /><RootCauseAnalysisPanel auditId={auditId} finding={finding} users={users} canWrite={canWrite} onChanged={onChanged} onError={onError} onNotice={onNotice} /></section>
          <section className="finding-dossier-stage" hidden={activeStage !== 'acciones'} aria-labelledby="finding-stage-acciones"><div className="finding-dossier-stage-heading"><div><p className="detail-label">ETAPA 4</p><h3 id="finding-stage-acciones">Acciones correctivas</h3></div></div><RootCauseActionLinksPanel auditId={auditId} finding={finding} actions={actions} canWrite={canWrite} onChanged={onChanged} onError={onError} onNotice={onNotice} onGoToAction={onGoToAction} /><CorrectiveActionManagementPanel auditId={auditId} finding={finding} actions={actions} users={users} canWrite={canWrite} onChanged={onChanged} onError={onError} onNotice={onNotice} openNewActionForEfficacyId={openNewActionForEfficacyId} onNewActionRequestHandled={() => setOpenNewActionForEfficacyId(null)} /></section>
          <section className="finding-dossier-stage" hidden={activeStage !== 'eficacia'} aria-labelledby="finding-stage-eficacia"><div className="finding-dossier-stage-heading"><div><p className="detail-label">ETAPA 5</p><h3 id="finding-stage-eficacia">Eficacia de las acciones</h3></div></div><EfficacyVerificationPanel auditId={auditId} finding={finding} users={users} canWrite={canWrite} onChanged={onChanged} onError={onError} onNotice={onNotice} onRequestTreatment={(evaluationId) => setOpenNewActionForEfficacyId(evaluationId)} /></section>
          <section className="finding-dossier-stage" hidden={activeStage !== 'verificacion'} aria-labelledby="finding-stage-verificacion"><div className="finding-dossier-stage-heading"><div><p className="detail-label">ETAPA 6</p><h3 id="finding-stage-verificacion">Verificación</h3></div></div><div className="finding-verification-summary"><div><span>Estado oficial</span><strong className={`status-${finding.status.toLowerCase()}`}>{findingStatusLabels[finding.status]}</strong></div><div><span>Verificado por</span><strong>{finding.verifiedBy?.name ?? 'Pendiente de verificación'}</strong></div><div><span>Fecha de verificación</span><strong>{finding.verifiedAt ? formatAuditCalendarDate(finding.verifiedAt) : 'Pendiente'}</strong></div><div className="finding-verification-wide"><span>Resolución</span><p>{finding.resolution ?? 'No se ha registrado una resolución final.'}</p></div></div></section>
        </div>
      </aside>
    </div>
  )
}

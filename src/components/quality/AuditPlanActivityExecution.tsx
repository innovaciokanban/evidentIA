import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import type {
  Audit,
  AuditChecklistItem,
  AuditEvidence,
  AuditEvidenceFile,
  AuditFinding,
  AuditPlan,
  AuditPlanActivity,
  AuditPlanActivityResources,
  AuditActivityExecutionResult,
} from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { checklistItemContext, checklistResultLabels, findingSeverityLabels, findingStatusLabels, findingTypeLabels } from './quality.model'

const executionResultLabels: Record<AuditActivityExecutionResult, string> = {
  SATISFACTORY: 'Satisfactoria',
  PARTIAL: 'Parcial',
  ISSUE: 'Con incidencia',
  NOT_APPLICABLE: 'No aplica',
}

const resourceLabels = {
  checklistItems: 'Ítems de checklist',
  evidences: 'Evidencias URL',
  evidenceFiles: 'Archivos PDF',
  findings: 'Hallazgos',
} as const

type ResourceKey = keyof typeof resourceLabels
type ResourceIds = Record<ResourceKey, string[]>

type AuditPlanActivityExecutionProps = {
  audit: Audit
  plan: AuditPlan
  activity: AuditPlanActivity
  canWrite: boolean
  readOnly: boolean
  onUpdated: (plan: AuditPlan) => void
  onNotice: (message: string) => void
  onOpenChecklistItem: (itemId: string) => void
  onCreateChecklistItem: (activity: AuditPlanActivity) => void
  onRequestChecklistProposals: (activity: AuditPlanActivity) => void
  onCreateFinding: (activity: AuditPlanActivity) => void
  onOpenFinding: (findingId: string) => void
  onCreateEvidence?: (activity: AuditPlanActivity) => void
  onOpenEvidence?: (kind: 'url' | 'pdf', evidenceId: string) => void
}

const errorMessage = (error: unknown, fallback: string): string => error instanceof ApiError ? error.message : fallback

const resourceIdsFromActivity = (activity: AuditPlanActivity): ResourceIds => ({
  checklistItems: (activity.resources?.checklistItems ?? []).map((item) => item.id),
  evidences: (activity.resources?.evidences ?? []).map((evidence) => evidence.id),
  evidenceFiles: (activity.resources?.evidenceFiles ?? []).map((file) => file.id),
  findings: (activity.resources?.findings ?? []).map((finding) => finding.id),
})

const formatExecutionDate = (value: string | null | undefined): string => value
  ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Pendiente'

export function AuditPlanActivityExecution({ audit, plan, activity, canWrite, readOnly, onUpdated, onNotice, onOpenChecklistItem, onCreateChecklistItem, onRequestChecklistProposals, onCreateFinding, onOpenFinding, onCreateEvidence = () => {}, onOpenEvidence = () => {} }: AuditPlanActivityExecutionProps) {
  const execution = activity.execution
  const [result, setResult] = useState<AuditActivityExecutionResult | ''>(execution?.result ?? '')
  const [observations, setObservations] = useState(execution?.observations ?? '')
  const [linkedIds, setLinkedIds] = useState<ResourceIds>(() => resourceIdsFromActivity(activity))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [findingPickerOpen, setFindingPickerOpen] = useState(false)

  const canManage = canWrite && !readOnly
  const canExecute = canManage && plan.status === 'APPROVED' && audit.status !== 'CLOSED' && audit.status !== 'CANCELLED'
  const inProgress = activity.status === 'IN_PROGRESS'
  const unresolvedAuditors = activity.auditors.filter((auditor) => auditor.independenceStatus === 'PENDING' || auditor.independenceStatus === 'CONFLICT')
  const mitigatedAuditors = activity.auditors.filter((auditor) => auditor.independenceStatus === 'MITIGATED')
  const missingAuditors = activity.auditors.length === 0

  useEffect(() => {
    if (!findingPickerOpen) return
    document.getElementById('audit-plan-findings-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [findingPickerOpen])

  async function requestExecution(path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>, notice: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await api<{ plan: AuditPlan; warnings?: string[] }>(path, { method, body: JSON.stringify(body) })
      onUpdated(response.plan)
      response.warnings?.forEach(onNotice)
      onNotice(notice)
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo actualizar la ejecución.'))
    } finally {
      setBusy(false)
    }
  }

  async function startActivity() {
    await requestExecution(
      `/audits/${audit.id}/plan/activities/${activity.id}/execution/start`,
      'POST',
      {},
      'Ejecución iniciada.',
    )
  }

  async function saveExecution() {
    await requestExecution(
      `/audits/${audit.id}/plan/activities/${activity.id}/execution`,
      'PATCH',
      { executionResult: result || null, executionObservations: observations.trim() || null },
      'Ejecución actualizada.',
    )
  }

  async function completeActivity() {
    if (!result) {
      setError('Selecciona el resultado de la actividad antes de completarla.')
      return
    }
    const confirmed = await askConfirm({
      title: 'Completar actividad',
      message: `«${activity.title}» quedará completada y su resultado será parte de la trazabilidad de la auditoría.`,
      confirmLabel: 'Completar actividad',
    })
    if (!confirmed) return
    await requestExecution(
      `/audits/${audit.id}/plan/activities/${activity.id}/execution/complete`,
      'POST',
      { executionResult: result, executionObservations: observations.trim() || null },
      'Actividad completada.',
    )
  }

  async function cancelActivity() {
    const confirmed = await askConfirm({
      title: 'Cancelar ejecución',
      message: `«${activity.title}» quedará cancelada. La acción conserva el registro de la agenda.`,
      confirmLabel: 'Cancelar ejecución',
      variant: 'danger',
    })
    if (!confirmed) return
    await requestExecution(
      `/audits/${audit.id}/plan/activities/${activity.id}/execution/cancel`,
      'POST',
      { executionObservations: observations.trim() || null },
      'Ejecución cancelada.',
    )
  }

  async function replaceResources(resource: ResourceKey, ids: string[]) {
    if (busy || !inProgress || !canExecute) return
    setBusy(true)
    setError('')
    const endpoint = resource === 'checklistItems'
      ? 'checklist-items'
      : resource === 'evidenceFiles'
        ? 'evidence-files'
        : resource
    const field = resource === 'checklistItems'
      ? 'itemIds'
      : resource === 'evidences'
        ? 'evidenceIds'
        : resource === 'evidenceFiles'
          ? 'evidenceFileIds'
          : 'findingIds'
    try {
      const response = await api<{ plan: AuditPlan }>(`/audits/${audit.id}/plan/activities/${activity.id}/execution/${endpoint}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: ids }),
      })
      setLinkedIds(resourceIdsFromActivity(response.plan.activities.find((item) => item.id === activity.id) ?? activity))
      onUpdated(response.plan)
      onNotice(`${resourceLabels[resource]} actualizados.`)
    } catch (requestError) {
      setLinkedIds(resourceIdsFromActivity(activity))
      setError(errorMessage(requestError, `No se pudieron actualizar ${resourceLabels[resource].toLowerCase()}.`))
    } finally {
      setBusy(false)
    }
  }

  function toggleResource(resource: ResourceKey, id: string) {
    const next = linkedIds[resource].includes(id)
      ? linkedIds[resource].filter((current) => current !== id)
      : [...linkedIds[resource], id]
    setLinkedIds((current) => ({ ...current, [resource]: next }))
    void replaceResources(resource, next)
  }

  function focusEvidencePicker() {
    document.getElementById('audit-plan-evidence-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <section className="audit-plan-execution" aria-label={`Ejecución de ${activity.title}`}>
      <div className="audit-plan-execution-heading">
        <div>
          <p className="detail-label">EJECUCIÓN Y TRAZABILIDAD</p>
          <strong>{execution?.actualStart ? `Iniciada el ${formatExecutionDate(execution.actualStart)}` : 'Aún no iniciada'}</strong>
          {execution?.actualEnd && <span> · Finalizada el {formatExecutionDate(execution.actualEnd)}</span>}
        </div>
        {canExecute && activity.status === 'PLANNED' && <button type="button" className="button primary small-button" onClick={() => void startActivity()} disabled={busy || missingAuditors || unresolvedAuditors.length > 0}>Iniciar ejecución</button>}
      </div>

      {canExecute && inProgress && (
        <div className="audit-plan-checklist-actions" aria-label="Acciones de la actividad">
          <div>
            <strong>Recursos oficiales</strong>
            <span>Registra hallazgos y vincula recursos sin crear copias para esta actividad.</span>
          </div>
          <div className="audit-plan-checklist-action-buttons">
            <button type="button" className="button secondary small-button" onClick={() => onCreateChecklistItem(activity)}>Añadir pregunta manual</button>
            <button type="button" className="button secondary small-button" onClick={() => onRequestChecklistProposals(activity)}>Solicitar preguntas a Checky</button>
            <button type="button" className="button secondary small-button" onClick={() => onCreateFinding(activity)}>Nuevo hallazgo</button>
            <button type="button" className="button secondary small-button" onClick={() => setFindingPickerOpen((current) => !current)} aria-expanded={findingPickerOpen} aria-controls="audit-plan-findings-selector">Vincular hallazgo existente</button>
            <button type="button" className="button secondary small-button" onClick={() => onCreateEvidence(activity)}>Añadir evidencia</button>
            <button type="button" className="button secondary small-button" onClick={focusEvidencePicker}>Vincular evidencia existente</button>
          </div>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {missingAuditors && <p className="audit-plan-execution-warning is-blocked" role="alert">No se puede iniciar esta actividad: asigna al menos un auditor activo en el equipo de la auditoría.</p>}
      {unresolvedAuditors.length > 0 && <p className="audit-plan-execution-warning is-blocked" role="alert">No se puede iniciar esta actividad: {unresolvedAuditors.length} integrante(s) tienen independencia pendiente o en conflicto.</p>}
      {mitigatedAuditors.length > 0 && <p className="audit-plan-execution-warning">Advertencia: la actividad incluye {mitigatedAuditors.length} integrante(s) con independencia Mitigada. Requiere revisión profesional.</p>}
      {activity.status === 'PLANNED' && !canExecute && <p className="audit-plan-execution-help">La ejecución estará disponible cuando el plan esté aprobado y el usuario tenga permisos de administración.</p>}
      {activity.status === 'CANCELLED' && <p className="audit-plan-execution-help">Esta actividad está cancelada y no admite nuevas operaciones.</p>}

      {(inProgress || activity.status === 'COMPLETED' || activity.status === 'CANCELLED') && (
        <>
          <div className="audit-plan-execution-fields">
            <label>Resultado
              <select value={result} onChange={(event) => setResult(event.target.value as AuditActivityExecutionResult | '')} disabled={!canExecute || !inProgress || busy}>
                <option value="">Pendiente</option>
                {(Object.keys(executionResultLabels) as AuditActivityExecutionResult[]).map((value) => <option key={value} value={value}>{executionResultLabels[value]}</option>)}
              </select>
            </label>
            <label>Observaciones de ejecución
              <textarea value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={10000} rows={3} disabled={!canExecute || !inProgress || busy} placeholder="Registra hechos observados, alcance ejecutado o incidencias." />
            </label>
          </div>
          {canExecute && inProgress && <div className="audit-plan-activity-actions"><button type="button" className="button secondary small-button" onClick={() => void saveExecution()} disabled={busy}>{busy ? 'Guardando…' : 'Guardar avance'}</button><button type="button" className="button primary small-button" onClick={() => void completeActivity()} disabled={busy}>Completar</button><button type="button" className="button danger small-button" onClick={() => void cancelActivity()} disabled={busy}>Cancelar ejecución</button></div>}
            <ResourceLinks
              audit={audit}
              resources={activity.resources}
              linkedIds={linkedIds}
              editable={canExecute && inProgress && !busy}
              findingPickerOpen={findingPickerOpen}
              onToggle={toggleResource}
              onOpenChecklistItem={onOpenChecklistItem}
              onOpenFinding={onOpenFinding}
              onOpenEvidence={onOpenEvidence}
            />
        </>
      )}
    </section>
  )
}

function ResourceLinks({ audit, resources, linkedIds, editable, findingPickerOpen, onToggle, onOpenChecklistItem, onOpenFinding, onOpenEvidence }: { audit: Audit; resources?: AuditPlanActivityResources; linkedIds: ResourceIds; editable: boolean; findingPickerOpen: boolean; onToggle: (resource: ResourceKey, id: string) => void; onOpenChecklistItem: (itemId: string) => void; onOpenFinding: (findingId: string) => void; onOpenEvidence: (kind: 'url' | 'pdf', evidenceId: string) => void }) {
  const checklistItems = (audit.checklists ?? []).flatMap((checklist) => checklist.items)
  const checklistItemById = new Map(checklistItems.map((item) => [item.id, item]))
  const evidenceById = new Map((audit.evidences ?? []).map((evidence) => [evidence.id, evidence]))
  const evidenceFileById = new Map((audit.evidenceFiles ?? []).map((file) => [file.id, file]))
  const missingLinkedChecklistItems = linkedIds.checklistItems.filter((id) => !checklistItemById.has(id))
  const relatedFindings = new Map<string, AuditFinding[]>(checklistItems.map((item) => [item.id, (audit.findings ?? []).filter((finding) => finding.itemId === item.id)]))
  const relatedEvidenceFiles = new Map<string, AuditEvidenceFile[]>(checklistItems.map((item) => [item.id, (audit.evidenceFiles ?? []).filter((file) => file.itemId === item.id)]))
  const groups: Array<{ key: ResourceKey; items: Array<{ id: string; label: string; detail?: string }>; empty: string }> = [
    { key: 'checklistItems', items: checklistItems.map((item: AuditChecklistItem) => ({ id: item.id, label: item.description, detail: item.result })), empty: 'No hay ítems de checklist disponibles.' },
    { key: 'evidences', items: (audit.evidences ?? []).map((evidence: AuditEvidence) => ({ id: evidence.id, label: evidence.name, detail: evidence.url })), empty: 'No hay evidencias URL disponibles.' },
    { key: 'evidenceFiles', items: (audit.evidenceFiles ?? []).map((file: AuditEvidenceFile) => ({ id: file.id, label: file.filename, detail: file.storageState })), empty: 'No hay archivos PDF disponibles.' },
    { key: 'findings', items: (audit.findings ?? []).map((finding: AuditFinding) => ({ id: finding.id, label: finding.title, detail: `${finding.type} · ${finding.status}` })), empty: 'No hay hallazgos disponibles.' },
  ]
  const linkedTotal = Object.values(resources ?? {}).reduce((total, values) => total + (values?.length ?? 0), 0)

  return (
    <div className="audit-plan-resource-links">
      <div className="audit-plan-resource-heading"><div><strong>Recursos vinculados</strong><span>{linkedTotal} {linkedTotal === 1 ? 'recurso' : 'recursos'} · Los vínculos no modifican el recurso original.</span></div>{editable && <small>Selecciona o deselecciona para guardar</small>}</div>
      <div className="audit-plan-resource-grid">
        {groups.map((group) => <fieldset key={group.key} className="audit-plan-resource-group"><legend>{resourceLabels[group.key]} ({linkedIds[group.key].length})</legend>{group.items.length === 0 && group.key !== 'checklistItems' ? <p>{group.empty}</p> : group.key === 'checklistItems' ? (
          <>
            {group.items.map((item) => {
              const linked = linkedIds.checklistItems.includes(item.id)
              const checklistItem = checklistItemById.get(item.id)
              const context = checklistItem ? checklistItemContext(checklistItem.criteria ?? '') : null
              const findings = relatedFindings.get(item.id) ?? []
              const evidenceFiles = relatedEvidenceFiles.get(item.id) ?? []
              return (
                <div key={item.id} className={`audit-plan-resource-option${linked ? ' is-linked' : ''}`}>
                  <label>
                    <input className="audit-plan-resource-checkbox" type="checkbox" checked={linked} disabled={!editable || !checklistItem} onChange={() => onToggle(group.key, item.id)} />
                    <span className="audit-plan-resource-copy"><strong>{item.label}</strong>{item.detail && <small>{checklistItem ? checklistResultLabels[checklistItem.result] : item.detail}</small>}</span>
                  </label>
                  {linked && checklistItem && (
                    <div className="audit-plan-checklist-context">
                      <div className="audit-plan-checklist-context-copy">
                        <span>Pregunta oficial · {checklistItem.result ? checklistResultLabels[checklistItem.result] : 'Sin evaluar'}</span>
                        <p><strong>Criterio</strong>{checklistItem.criteria || 'No disponible en la respuesta actual.'}</p>
                        <p><strong>Observaciones</strong>{checklistItem.observations || 'Sin observaciones registradas.'}</p>
                        <p><strong>Origen</strong>{context?.origin ?? 'No disponible'} · <strong>Fuente</strong>{context?.source ?? 'No especificada'} · <strong>Dimensión</strong>{context?.dimension ?? 'No especificada'}</p>
                        {(evidenceFiles.length > 0 || findings.length > 0) && <p><strong>Relaciones</strong>{evidenceFiles.length > 0 ? ` ${evidenceFiles.length} evidencia(s) PDF` : ''}{evidenceFiles.length > 0 && findings.length > 0 ? ' · ' : ''}{findings.length > 0 ? ` ${findings.length} hallazgo(s)` : ''}</p>}
                        {evidenceFiles.length > 0 && <ul className="audit-plan-checklist-context-list">{evidenceFiles.map((file) => <li key={file.id}>{file.filename} · {file.storageState}</li>)}</ul>}
                        {findings.length > 0 && <ul className="audit-plan-checklist-context-list">{findings.map((finding) => <li key={finding.id}>{finding.title} · {finding.status}</li>)}</ul>}
                      </div>
                      <button type="button" className="button secondary small-button" onClick={() => onOpenChecklistItem(item.id)}>Abrir en checklist</button>
                    </div>
                  )}
                </div>
              )
            })}
            {missingLinkedChecklistItems.map((itemId) => <div key={itemId} className="audit-plan-resource-option is-linked is-unavailable"><span className="audit-plan-resource-copy"><strong>Pregunta no disponible</strong><small>El ítem vinculado ya no está en el checklist oficial. ID: {itemId}</small></span><button type="button" className="text-button" onClick={() => onOpenChecklistItem(itemId)}>Ver mensaje</button></div>)}
            {group.items.length === 0 && missingLinkedChecklistItems.length === 0 && <p>{group.empty}</p>}
          </>
        ) : group.key === 'findings' ? (
          <div id="audit-plan-findings-selector" className={`audit-plan-finding-selector${findingPickerOpen ? ' is-focused' : ''}`}>
            {group.items.map((item) => {
              const linked = linkedIds.findings.includes(item.id)
              const finding = audit.findings.find((candidate) => candidate.id === item.id)
              const evidenceCount = finding ? (audit.evidences ?? []).filter((evidence) => evidence.findingId === finding.id).length + (audit.evidenceFiles ?? []).filter((file) => file.findingId === finding.id).length : 0
              const actionCount = finding?.actions?.length ?? 0
              return (
                <div key={item.id} className={`audit-plan-finding-option${linked ? ' is-linked' : ''}`}>
                  <label className="audit-plan-resource-option">
                    <input className="audit-plan-resource-checkbox" type="checkbox" checked={linked} disabled={!editable} onChange={() => onToggle(group.key, item.id)} />
                    <span className="audit-plan-resource-copy">
                      <strong>{finding?.title ?? item.label}</strong>
                      <small>{finding ? `${findingTypeLabels[finding.type]} · ${findingSeverityLabels[finding.severity]} · ${findingStatusLabels[finding.status]}` : item.detail}</small>
                    </span>
                  </label>
                  {linked && finding && (
                    <div className="audit-plan-finding-context">
                      <p>{finding.description}</p>
                      <div className="audit-plan-finding-meta">
                        <span>{finding.process ? `${finding.process.code} · ${finding.process.name}` : 'Sin proceso'}</span>
                        <span>{finding.procedure ? `${finding.procedure.code} · ${finding.procedure.name}` : 'Sin procedimiento'}</span>
                        {finding.item && <span>Pregunta: {finding.item.description}</span>}
                        <span>Responsable: {finding.responsible?.name ?? 'Sin asignar'}</span>
                        <span>Fecha límite: {finding.dueDate ? formatExecutionDate(finding.dueDate) : 'Sin fecha límite'}</span>
                        <span>{evidenceCount} evidencia(s) · {actionCount} acción(es) correctiva(s)</span>
                      </div>
                      <button type="button" className="button secondary small-button" onClick={() => onOpenFinding(finding.id)}>Abrir hallazgo oficial</button>
                    </div>
                  )}
                </div>
              )
            })}
            {group.items.length === 0 && <p>{group.empty}</p>}
          </div>
        ) : (group.key === 'evidences' || group.key === 'evidenceFiles') ? (
          <div id={group.key === 'evidences' ? 'audit-plan-evidence-selector' : undefined} className="audit-plan-evidence-selector">
            {group.items.map((item) => {
              const linked = linkedIds[group.key].includes(item.id)
              const evidence = group.key === 'evidences' ? evidenceById.get(item.id) : undefined
              const evidenceFile = group.key === 'evidenceFiles' ? evidenceFileById.get(item.id) : undefined
              return (
                <div key={item.id} className={`audit-plan-resource-option${linked ? ' is-linked' : ''}`}>
                  <label>
                    <input className="audit-plan-resource-checkbox" type="checkbox" checked={linked} disabled={!editable} onChange={() => onToggle(group.key, item.id)} />
                    <span className="audit-plan-resource-copy">
                      <strong><span className={`audit-plan-evidence-icon ${group.key === 'evidences' ? 'is-url' : 'is-pdf'}`} aria-hidden="true">{group.key === 'evidences' ? '↗' : 'PDF'}</span>{item.label}</strong>
                      {evidence?.description && <small>{evidence.description}</small>}
                      {evidenceFile && <small>{evidenceFile.storageState} · {formatExecutionDate(evidenceFile.createdAt)}</small>}
                      {evidence && <small>Registrada el {formatExecutionDate(evidence.createdAt)}</small>}
                    </span>
                  </label>
                  {linked && (evidence || evidenceFile) && <button type="button" className="text-button audit-plan-resource-open" onClick={() => onOpenEvidence(group.key === 'evidences' ? 'url' : 'pdf', item.id)}>{group.key === 'evidences' ? 'Abrir evidencia oficial' : 'Consultar PDF oficial'}</button>}
                </div>
              )
            })}
            {group.items.length === 0 && <p>{group.empty}</p>}
          </div>
        ) : group.items.map((item) => <label key={item.id} className={`audit-plan-resource-option${linkedIds[group.key].includes(item.id) ? ' is-linked' : ''}`}><input className="audit-plan-resource-checkbox" type="checkbox" checked={linkedIds[group.key].includes(item.id)} disabled={!editable} onChange={() => onToggle(group.key, item.id)} /><span className="audit-plan-resource-copy"><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span></label>)}</fieldset>)}
      </div>
    </div>
  )
}

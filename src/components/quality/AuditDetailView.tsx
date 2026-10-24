import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { api, apiUpload, ApiError, apiUrl } from '../../api'
import type {
  Audit,
  AuditChecklist,
  AuditChecklistItem,
  AuditCorrectiveAction,
  AuditEvent,
  AuditFinding,
  AuditFindingStatus,
  AuditStatus,
  Process,
} from '../../types'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import {
  actionPriorityLabels,
  actionStatusLabels,
  actionTransitions,
  auditCloseBlockers,
  auditExecutionSummary,
  auditStatusLabels,
  auditTransitions,
  checklistResultLabels,
  checklistResults,
  draftFromFinding,
  emptyActionDraft,
  emptyChecklistDraft,
  emptyChecklistItemDraft,
  emptyEvidenceDraft,
  emptyFindingDraft,
  eventLabel,
  evidenceFileRelationLabel,
  findingSeverityLabels,
  findingStatusLabels,
  findingTransitions,
  findingTypeLabels,
  formatBytes,
  isAuditActionOverdue,
  isTerminalAudit,
  pendingEfficacyFindings,
  type ActionDraft,
  type AuditWorkspaceSection,
  type ChecklistDraft,
  type ChecklistItemDraft,
  type EvidenceDraft,
  type FindingDraft,
  type QualityUser,
} from './quality.model'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
const shortDateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

const formatMaybeDate = (value: string | null | undefined) => (value ? shortDateFormatter.format(new Date(value)) : '—')

function findErrorMessage(requestError: unknown, fallback: string): string {
  if (requestError instanceof ApiError) return requestError.message
  return fallback
}

/** Mensaje amable de un cierre rechazado por el servidor, enlazando con la condición incumplida. */
function closeErrorMessage(requestError: unknown): string {
  if (requestError instanceof ApiError) {
    const friendly: Record<string, string> = {
      CHECKLIST_PENDING: 'Quedan criterios obligatorios sin evaluar en el checklist.',
      ACTIONS_PENDING: 'Quedan acciones correctivas obligatorias pendientes.',
      EFFICACY_PENDING: 'Quedan no conformidades sin verificación de eficacia.',
    }
    const mapped = requestError.reason ? friendly[requestError.reason] : undefined
    return mapped ?? requestError.message
  }
  return 'No se pudo cerrar la auditoría.'
}

const sectionTabs: Array<{ id: AuditWorkspaceSection; label: string }> = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'hallazgos', label: 'Hallazgos' },
  { id: 'evidencias', label: 'Evidencias' },
  { id: 'acciones', label: 'Acciones correctivas' },
  { id: 'historial', label: 'Historial' },
]

/**
 * Espacio de trabajo de una auditoría: pestañas Resumen (preparación e inicio), Checklist,
 * Hallazgos, Evidencias, Acciones correctivas e Historial. Reutiliza los endpoints y reglas del
 * servidor (transiciones, gates de cierre, bloqueos terminales); el cliente solo anticipa los
 * bloqueos para mostrar qué falta, sin sustituir la validación del backend.
 */
export function AuditDetailView({ audit: initial, users, processes, canWrite, onChanged, onBack, onEdit, onError, onNotice, initialSection = 'resumen' }: {
  audit: Audit
  users: QualityUser[]
  processes: Process[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onBack: () => void
  onEdit: () => void
  onError: (message: string) => void
  onNotice: (message: string) => void
  initialSection?: AuditWorkspaceSection
}) {
  const [audit, setAudit] = useState(initial)
  const [activeSection, setActiveSection] = useState<AuditWorkspaceSection>(initialSection)
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [checklistDraft, setChecklistDraft] = useState<ChecklistDraft>({ name: '' })
  const [itemDraft, setItemDraft] = useState<ChecklistItemDraft>(emptyChecklistItemDraft)
  const [itemFor, setItemFor] = useState<{ checklistId: string; item: AuditChecklistItem | null } | null>(null)
  const [observationsFor, setObservationsFor] = useState<{ checklistId: string; itemId: string } | null>(null)
  const [observationsDraft, setObservationsDraft] = useState('')
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null)
  const [findingDraft, setFindingDraft] = useState<FindingDraft>(emptyFindingDraft)
  const [findingFor, setFindingFor] = useState<{ finding: AuditFinding | null } | null>(null)
  const [actionDraft, setActionDraft] = useState<ActionDraft>(emptyActionDraft)
  const [actionFor, setActionFor] = useState<{ findingId: string; action: AuditCorrectiveAction | null } | null>(null)
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(emptyEvidenceDraft)
  const [evidenceFor, setEvidenceFor] = useState<boolean>(false)
  const [uploadFor, setUploadFor] = useState<{ findingId?: string; actionId?: string; itemId?: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeSummary, setCloseSummary] = useState('')
  const [closeError, setCloseError] = useState('')
  const historyAuditId = useRef(initial.id)

  // Sincroniza el estado local cuando el padre reemplaza el objeto seleccionado (p. ej. tras
  // recargar la lista); la clave del estado es el id de la auditoría.
  const [auditKey, setAuditKey] = useState(initial.id)
  if (auditKey !== initial.id) {
    setAuditKey(initial.id)
    setAudit(initial)
    setActiveSection(initialSection)
    historyAuditId.current = initial.id
    setClosing(false)
    setCloseSummary('')
    setCloseError('')
  }

  // El listado entrega datos parciales (sin procesos/procedimientos vinculados, sin archivos de
  // evidencia y con acciones incompletas); al abrir el espacio de trabajo se pide el detalle
  // completo para que preparación, evidencias y acciones muestren todo el alcance real.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await api<{ audit: Audit }>(`/audits/${initial.id}`)
        if (!cancelled) setAudit(result.audit)
      } catch (requestError) {
        console.error('[quality] failed to load full audit detail', requestError)
      }
    })()
    return () => { cancelled = true }
  }, [initial.id])

  useEffect(() => {
    if (!highlightItemId) return
    const element = document.getElementById(`quality-item-${highlightItemId}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightItemId, activeSection])

  const companyUsers = users.filter((person) => !person.companyId || person.companyId === audit.companyId)
  const relatedProcessIds = new Set([audit.processId, ...(audit.relatedProcesses ?? []).map((process) => process.id)])
  const linkedProcedures = (audit.procedures ?? []).map((procedure) => procedure)

  const results = auditExecutionSummary(audit)
  const closeBlockers = auditCloseBlockers(audit)
  const pendingEfficacy = pendingEfficacyFindings(audit)
  const terminal = isTerminalAudit(audit)
  const readonly = terminal || !canWrite
  const checklistTotal = results.itemsTotal
  const checklistCompleted = results.itemsEvaluated
  const checklistPending = results.itemsRequiredPending
  const checklistPercent = checklistTotal > 0 ? Math.min(100, Math.round((checklistCompleted / checklistTotal) * 100)) : 0
  const evidenceFiles = audit.evidenceFiles ?? []
  const evidenceCount = audit.evidences.length + evidenceFiles.length
  const openActions = results.actionsRequiredOpen
  const overdueActions = results.actionsOverdue
  const allActions = audit.findings
    .flatMap((finding) => (finding.actions ?? []).map((action) => ({ action, finding })))
    .sort((left, right) => {
      const overdueDiff = Number(isAuditActionOverdue(right.action)) - Number(isAuditActionOverdue(left.action))
      if (overdueDiff !== 0) return overdueDiff
      return (left.action.dueDate ?? '9999-12-31').localeCompare(right.action.dueDate ?? '9999-12-31')
    })
  const historyForCurrentAudit = historyAuditId.current === audit.id
  const historyLoadedForCurrentAudit = historyLoaded && historyForCurrentAudit
  const historyLoadingForCurrentAudit = historyLoading && historyForCurrentAudit

  async function reload() {
    const result = await api<{ audit: Audit }>(`/audits/${audit.id}`)
    setAudit(result.audit)
    await onChanged()
  }

  function selectSection(section: AuditWorkspaceSection) {
    setActiveSection(section)
    if (section === 'historial' && !historyLoadedForCurrentAudit && !historyLoadingForCurrentAudit) void loadHistory()
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (currentIndex < 0) return
    event.preventDefault()
    let next = currentIndex
    if (event.key === 'ArrowRight') next = (currentIndex + 1) % buttons.length
    if (event.key === 'ArrowLeft') next = (currentIndex - 1 + buttons.length) % buttons.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = buttons.length - 1
    buttons[next].focus()
    selectSection(sectionTabs[next].id)
  }

  function goToChecklistItem(itemId: string) {
    setActiveSection('checklist')
    setHighlightItemId(itemId)
  }

  function startFinding(itemId?: string) {
    setFindingFor({ finding: null })
    setFindingDraft({ ...emptyFindingDraft, responsibleId: audit.responsible?.id ?? '', ...(itemId ? { itemId } : {}) })
    setActiveSection('hallazgos')
  }

  function startAction(findingId: string) {
    setActionFor({ findingId, action: null })
    setActionDraft(emptyActionDraft)
    setActiveSection('acciones')
  }

  async function changeStatus(to: AuditStatus, options: { summary?: string } = {}) {
    if (!canWrite || busy) return
    let summary: string | undefined
    if (to === 'CLOSED') {
      summary = (options.summary ?? '').trim()
      if (summary.length < 3) {
        setCloseError('El resumen de cierre debe tener al menos 3 caracteres.')
        return
      }
      if (closeBlockers.length > 0) {
        setCloseError('Resuelve los requisitos pendientes antes de cerrar la auditoría.')
        return
      }
      setCloseError('')
    } else if (to === 'CANCELLED') {
      const confirmed = await askConfirm({ title: auditStatusLabels[to], message: `«${audit.title}» pasará a «${auditStatusLabels[to]}».`, confirmLabel: 'Continuar' })
      if (!confirmed) return
    }
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/status`, { method: 'POST', body: JSON.stringify({ status: to, ...(summary ? { summary } : {}) }) })
      await reload()
      if (to === 'CLOSED') {
        setClosing(false)
        setCloseSummary('')
        onNotice('Auditoría cerrada correctamente.')
      } else if (to === 'CANCELLED') {
        onNotice('Auditoría cancelada.')
      } else {
        onNotice('Auditoría iniciada. Ya puedes registrar checklist, hallazgos y evidencias.')
      }
    } catch (requestError) {
      if (to === 'CLOSED') setCloseError(closeErrorMessage(requestError))
      else onError(findErrorMessage(requestError, 'No se pudo cambiar el estado de la auditoría.'))
    } finally {
      setBusy(false)
    }
  }

  async function loadHistory() {
    setHistoryLoading(true)
    const requestedAuditId = audit.id
    try {
      const result = await api<{ events: AuditEvent[] }>(`/audits/${audit.id}/history?pageSize=50`)
      if (historyAuditId.current === requestedAuditId) {
        setHistory(result.events)
        setHistoryLoaded(true)
      }
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No pudimos cargar el historial.'))
    } finally {
      if (historyAuditId.current === requestedAuditId) setHistoryLoading(false)
    }
  }

  async function saveChecklist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/checklists`, { method: 'POST', body: JSON.stringify(checklistDraft) })
      setChecklistDraft(emptyChecklistDraft)
      await reload()
      onNotice('Lista de verificación creada.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo crear la lista.'))
    } finally {
      setBusy(false)
    }
  }

  async function removeChecklist(checklist: AuditChecklist) {
    const confirmed = await askConfirm({ title: 'Eliminar lista', message: `Se eliminará la lista «${checklist.name}» y sus ítems. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/checklists/${checklist.id}`, { method: 'DELETE' })
      await reload()
      onNotice('Lista eliminada.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo eliminar la lista.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemFor || busy) return
    setBusy(true)
    try {
      if (itemFor.item) {
        await api(`/audits/${audit.id}/checklists/${itemFor.checklistId}/items/${itemFor.item.id}`, { method: 'PATCH', body: JSON.stringify(itemDraft) })
      } else {
        await api(`/audits/${audit.id}/checklists/${itemFor.checklistId}/items`, { method: 'POST', body: JSON.stringify(itemDraft) })
      }
      setItemFor(null)
      setItemDraft(emptyChecklistItemDraft)
      await reload()
      onNotice('Ítem guardado.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo guardar el ítem.'))
    } finally {
      setBusy(false)
    }
  }

  async function updateItemResult(checklistId: string, item: AuditChecklistItem, result: typeof checklistResults[number], observations: string) {
    if (!canWrite) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/checklists/${checklistId}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ result, observations: observations || null }) })
      await reload()
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo actualizar el ítem.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveObservations() {
    if (!observationsFor || busy) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/checklists/${observationsFor.checklistId}/items/${observationsFor.itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ observations: observationsDraft.trim() || null }),
      })
      setObservationsFor(null)
      setObservationsDraft('')
      await reload()
      onNotice('Observaciones guardadas.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudieron guardar las observaciones.'))
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(checklistId: string, item: AuditChecklistItem) {
    const confirmed = await askConfirm({ title: 'Eliminar ítem', message: 'Se eliminará el ítem de la lista.', confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/checklists/${checklistId}/items/${item.id}`, { method: 'DELETE' })
      await reload()
      onNotice('Ítem eliminado.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo eliminar el ítem.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!findingFor || busy) return
    setBusy(true)
    const payload = {
      title: findingDraft.title,
      description: findingDraft.description,
      type: findingDraft.type,
      severity: findingDraft.severity,
      dueDate: findingDraft.dueDate || null,
      responsibleId: findingDraft.responsibleId || null,
      itemId: findingDraft.itemId || null,
      processId: findingDraft.processId || null,
      procedureId: findingDraft.procedureId || null,
      ...(findingFor.finding ? { efficacyVerification: findingDraft.efficacyVerification || null } : {}),
    }
    try {
      if (findingFor.finding) {
        await api(`/audits/${audit.id}/findings/${findingFor.finding.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api(`/audits/${audit.id}/findings`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setFindingFor(null)
      await reload()
      onNotice(findingFor.finding ? 'Hallazgo actualizado.' : 'Hallazgo creado.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo guardar el hallazgo.'))
    } finally {
      setBusy(false)
    }
  }

  async function changeFindingStatus(finding: AuditFinding, to: AuditFindingStatus) {
    if (!canWrite || busy) return
    let resolution: string | undefined
    if (to === 'RESOLVED') {
      const input = window.prompt('Resolución del hallazgo (obligatoria):')
      if (input === null) return
      const trimmed = input.trim()
      if (trimmed.length < 3) {
        onError('La resolución debe tener al menos 3 caracteres.')
        return
      }
      resolution = trimmed
    } else {
      const confirmed = await askConfirm({ title: findingStatusLabels[to], message: `«${finding.title}» pasará a «${findingStatusLabels[to]}».`, confirmLabel: 'Continuar' })
      if (!confirmed) return
    }
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/findings/${finding.id}/status`, { method: 'POST', body: JSON.stringify({ status: to, ...(resolution ? { resolution } : {}) }) })
      await reload()
      onNotice(`Hallazgo actualizado a «${findingStatusLabels[to]}».`)
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo cambiar el estado del hallazgo.'))
    } finally {
      setBusy(false)
    }
  }

  async function removeFinding(finding: AuditFinding) {
    const confirmed = await askConfirm({ title: 'Eliminar hallazgo', message: `Se eliminará «${finding.title}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/findings/${finding.id}`, { method: 'DELETE' })
      await reload()
      onNotice('Hallazgo eliminado.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo eliminar el hallazgo.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!actionFor || busy) return
    setBusy(true)
    const payload = {
      title: actionDraft.title,
      description: actionDraft.description,
      responsibleId: actionDraft.responsibleId || null,
      priority: actionDraft.priority,
      required: actionDraft.required,
      dueDate: actionDraft.dueDate || null,
    }
    try {
      if (actionFor.action) {
        await api(`/audits/${audit.id}/actions/${actionFor.action.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api(`/audits/${audit.id}/findings/${actionFor.findingId}/actions`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setActionFor(null)
      await reload()
      onNotice(actionFor.action ? 'Acción actualizada.' : 'Acción correctiva creada.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo guardar la acción correctiva.'))
    } finally {
      setBusy(false)
    }
  }

  async function applyActionStatus(action: AuditCorrectiveAction, to: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
    if (!canWrite || busy) return
    const confirmed = await askConfirm({ title: actionStatusLabels[to], message: `«${action.title}» pasará a «${actionStatusLabels[to]}».`, confirmLabel: 'Continuar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/actions/${action.id}/status`, { method: 'POST', body: JSON.stringify({ status: to }) })
      await reload()
      onNotice(`Acción actualizada a «${actionStatusLabels[to]}».`)
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo cambiar el estado de la acción.'))
    } finally {
      setBusy(false)
    }
  }

  async function addProgress(action: AuditCorrectiveAction) {
    const note = window.prompt('Nota de avance (obligatoria):')
    if (note === null) return
    const trimmed = note.trim()
    if (trimmed.length < 3) {
      onError('La nota de avance debe tener al menos 3 caracteres.')
      return
    }
    const percentRaw = window.prompt('Porcentaje de avance (0-100, opcional):')
    if (percentRaw === null) return
    const percent = percentRaw.trim() === '' ? null : Number(percentRaw)
    if (percent !== null && (!Number.isInteger(percent) || percent < 0 || percent > 100)) {
      onError('El porcentaje debe ser un entero entre 0 y 100.')
      return
    }
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/actions/${action.id}/progress`, { method: 'POST', body: JSON.stringify({ note: trimmed, percent }) })
      await reload()
      onNotice('Avance registrado.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo registrar el avance.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/evidences`, {
        method: 'POST',
        body: JSON.stringify({
          name: evidenceDraft.name,
          description: evidenceDraft.description,
          url: evidenceDraft.url,
          findingId: evidenceDraft.findingId || null,
        }),
      })
      setEvidenceFor(false)
      setEvidenceDraft(emptyEvidenceDraft)
      await reload()
      onNotice('Evidencia registrada.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo registrar la evidencia.'))
    } finally {
      setBusy(false)
    }
  }

  async function removeEvidence(evidenceId: string) {
    const confirmed = await askConfirm({ title: 'Eliminar evidencia', message: 'Se eliminará el enlace de evidencia.', confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/evidences/${evidenceId}`, { method: 'DELETE' })
      await reload()
      onNotice('Evidencia eliminada.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo eliminar la evidencia.'))
    } finally {
      setBusy(false)
    }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!uploadFor || uploading) return
    const input = (event.currentTarget.elements.namedItem('file') as HTMLInputElement | null)
    const file = input?.files?.[0]
    if (!file) {
      onError('Selecciona un PDF.')
      return
    }
    setUploading(true)
    try {
      await apiUpload(`/audits/${audit.id}/evidence-files`, file, uploadFor)
      setUploadFor(null)
      await reload()
      onNotice('PDF adjuntado correctamente.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo subir el PDF.'))
    } finally {
      setUploading(false)
    }
  }

  async function removeFile(fileId: string) {
    const confirmed = await askConfirm({ title: 'Eliminar PDF', message: 'Se eliminará el archivo de evidencia.', confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/evidence-files/${fileId}`, { method: 'DELETE' })
      await reload()
      onNotice('Archivo eliminado.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo eliminar el archivo.'))
    } finally {
      setBusy(false)
    }
  }

  const tabBadges: Partial<Record<AuditWorkspaceSection, number>> = {
    checklist: checklistPending,
    hallazgos: results.findingsOpen,
    evidencias: evidenceCount,
    acciones: results.actionsOpen,
  }

  return (
    <div className="quality-detail">
      <div className="procedure-page-header">
        <button type="button" className="text-button procedure-back-button" onClick={onBack}>← Volver al listado</button>
        <div className="procedure-page-heading">
          <div>
            <p className="eyebrow">{audit.code} · {audit.process.name}</p>
            <h1>{audit.title}</h1>
            <p className="muted">{audit.scope}</p>
          </div>
          <div className="quality-detail-actions">
            <span className={`badge quality-status ${audit.status.toLowerCase()}`}>{auditStatusLabels[audit.status]}</span>
            {canWrite && !terminal && <button type="button" className="button secondary" onClick={onEdit}>Editar</button>}
          </div>
        </div>
      </div>

      {terminal && <p className="audit-terminal-note">Auditoría {auditStatusLabels[audit.status].toLowerCase()}: las escrituras quedan bloqueadas.</p>}
      <div className="quality-detail-overview">
        <div className="quality-detail-stat"><span className="quality-stat-mark blue">◷</span><span><small>Estado actual</small><strong>{auditStatusLabels[audit.status]}</strong></span></div>
        <div className="quality-detail-stat"><span className="quality-stat-mark amber">□</span><span><small>Checklist</small><strong>{checklistCompleted}/{checklistTotal || '—'} evaluados</strong></span></div>
        <div className="quality-detail-stat"><span className="quality-stat-mark red">!</span><span><small>Hallazgos abiertos</small><strong>{results.findingsOpen}</strong></span></div>
        <div className="quality-detail-stat"><span className="quality-stat-mark purple">↗</span><span><small>Evidencias</small><strong>{evidenceCount} registradas</strong></span></div>
      </div>

      <div className="quality-workspace-tabs" role="tablist" aria-label="Secciones de la auditoría" onKeyDown={handleTabKeyDown}>
        {sectionTabs.map((tab) => {
          const badge = tabBadges[tab.id]
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`quality-tab-${tab.id}`}
              aria-selected={activeSection === tab.id}
              aria-controls={`quality-panel-${tab.id}`}
              className={`quality-tab${activeSection === tab.id ? ' active' : ''}`}
              onClick={() => selectSection(tab.id)}
            >
              {tab.label}
              {!!badge && badge > 0 && <span>{badge}</span>}
            </button>
          )
        })}
      </div>

      {activeSection === 'resumen' && (
        <div role="tabpanel" id="quality-panel-resumen" aria-labelledby="quality-tab-resumen" tabIndex={0} className="quality-tab-panel">
          <section className="panel quality-resume">
            <p className="detail-label">PREPARACIÓN DE LA AUDITORÍA</p>
            <div className="quality-meta-grid">
              <div><small>Código</small><strong>{audit.code}</strong></div>
              <div><small>Tipo de auditoría</small><strong>{audit.auditType || '—'}</strong></div>
              <div><small>Estado</small><strong>{auditStatusLabels[audit.status]}</strong></div>
              <div><small>Responsable</small><strong>{audit.responsible?.name ?? 'Sin asignar'}</strong></div>
              <div><small>Auditor líder</small><strong>{audit.leadAuditor?.name ?? 'Sin asignar'}</strong></div>
              <div><small>Fecha planeada</small><strong>{formatMaybeDate(audit.plannedDate)}</strong></div>
              <div><small>Inicio</small><strong>{formatMaybeDate(audit.startDate)}</strong></div>
              <div><small>Cierre</small><strong>{formatMaybeDate(audit.endDate)}</strong></div>
            </div>
            <div className="quality-resume-blocks">
              <div><p className="detail-label">ALCANCE</p><p>{audit.scope}</p></div>
              <div><p className="detail-label">OBJETIVOS</p><p>{audit.objectives || 'Sin objetivos registrados.'}</p></div>
              <div><p className="detail-label">CRITERIOS</p><p>{audit.criteria}</p></div>
            </div>
            <div className="quality-relations-display">
              <p className="detail-label">PROCESOS Y PROCEDIMIENTOS VINCULADOS</p>
              <div className="audit-scope-chips">
                <span className="audit-scope-chip process"><span className="audit-scope-chip-dot" aria-hidden="true" />{audit.process.code} · {audit.process.name}<span className="audit-scope-chip-lock">Principal</span></span>
                {(audit.relatedProcesses ?? []).map((process) => (
                  <span key={process.id} className="audit-scope-chip process"><span className="audit-scope-chip-dot" aria-hidden="true" />{process.code} · {process.name}</span>
                ))}
                {linkedProcedures.map((procedure) => (
                  <span key={procedure.id} className="audit-scope-chip procedure"><span className="audit-scope-chip-dot" aria-hidden="true" />{procedure.code} · {procedure.name}</span>
                ))}
              </div>
              {(audit.relatedProcesses ?? []).length === 0 && linkedProcedures.length === 0 && (
                <p className="muted">Sin procesos ni procedimientos adicionales vinculados.</p>
              )}
            </div>
          </section>

          {!terminal && canWrite && (
            <section id="quality-status" className="panel quality-status-bar">
              <p className="detail-label">ESTADO</p>
              <div className="quality-status-bar-content">
                <div><strong>{auditStatusLabels[audit.status]}</strong><span className="muted"> Usa las transiciones para avanzar el ciclo de revisión · {openActions} acciones obligatorias abiertas.</span></div>
                <div className="quality-status-actions">
                  {auditTransitions[audit.status].map((transition) => (
                    <button
                      key={transition.to}
                      type="button"
                      className={`button ${transition.to === 'CANCELLED' ? 'secondary' : 'primary'}`}
                      disabled={busy}
                      onClick={() => {
                        if (transition.to === 'CLOSED') {
                          setClosing(true)
                          setCloseError('')
                          return
                        }
                        void changeStatus(transition.to)
                      }}
                    >
                      {transition.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {closing && !terminal && (
            <section className="panel quality-close-panel" aria-labelledby="quality-close-title">
              <p className="detail-label">CIERRE DE AUDITORÍA</p>
              <h3 id="quality-close-title">Resumen de resultados</h3>
              <div className="quality-close-stats">
                <div><small>Criterios evaluados</small><strong>{checklistCompleted}/{checklistTotal}</strong><span>{results.itemsPending} pendientes</span></div>
                <div><small>Conformidades</small><strong>{results.conform}</strong><span>criterios conformes</span></div>
                <div><small>No conformidades</small><strong>{results.nonConform}</strong><span>criterios no conformes</span></div>
                <div><small>Hallazgos</small><strong>{results.findingsTotal}</strong><span>{results.findingsOpen} abiertos</span></div>
                <div><small>Acciones pendientes</small><strong>{results.actionsOpen}</strong><span>{overdueActions} vencidas</span></div>
                <div><small>Requisitos pendientes</small><strong>{closeBlockers.length}</strong><span>para poder cerrar</span></div>
              </div>
              {closeBlockers.length > 0 ? (
                <ul className="quality-close-blockers">
                  {closeBlockers.map((blocker) => (
                    <li key={blocker.reason}>
                      <span aria-hidden="true">✕</span>
                      <div>
                        <strong>{blocker.message}</strong>
                        <button type="button" className="text-button" onClick={() => selectSection(blocker.section)}>Resolver en {sectionTabs.find((tab) => tab.id === blocker.section)?.label}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quality-close-ok" role="status">Condiciones de cierre cumplidas: criterios obligatorios evaluados, acciones finalizadas y eficacia verificada.</p>
              )}
              {pendingEfficacy.length > 0 && (
                <p className="muted">Las no conformidades resueltas sin eficacia se muestran en Hallazgos.</p>
              )}
              <label>Resumen de cierre
                <textarea value={closeSummary} onChange={(event) => setCloseSummary(event.target.value)} minLength={3} maxLength={10000} rows={3} placeholder="Resultados, decisiones y seguimiento acordado…" />
              </label>
              {closeError && <p className="form-error" role="alert">{closeError}</p>}
              <div className="procedure-form-actions">
                <button type="button" className="button secondary" onClick={() => { setClosing(false); setCloseError('') }} disabled={busy}>Cancelar</button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || closeBlockers.length > 0 || closeSummary.trim().length < 3}
                  onClick={() => void changeStatus('CLOSED', { summary: closeSummary })}
                >
                  {busy ? 'Cerrando…' : 'Confirmar cierre'}
                </button>
              </div>
            </section>
          )}

          {audit.summary && (
            <section className="panel quality-summary">
              <p className="detail-label">RESUMEN DE CIERRE</p>
              <p>{audit.summary}</p>
            </section>
          )}
        </div>
      )}

      {activeSection === 'checklist' && (
        <div role="tabpanel" id="quality-panel-checklist" aria-labelledby="quality-tab-checklist" tabIndex={0} className="quality-tab-panel">
          <section id="quality-checklists" className="panel quality-checklists">
            <div className="panel-heading">
              <div>
                <p className="detail-label">LISTAS DE VERIFICACIÓN</p>
                <h2>Checklist</h2>
              </div>
              {checklistTotal > 0 && (
                <div className="quality-section-progress"><strong>{checklistPercent}%</strong><span>{checklistCompleted}/{checklistTotal} evaluados</span></div>
              )}
            </div>
            <div className="quality-checklist-progress">
              <span><strong>{checklistCompleted}</strong> de <strong>{checklistTotal}</strong> criterios evaluados</span>
              <span className={checklistPending > 0 ? 'quality-pending-flag' : ''}><strong>{checklistPending}</strong> obligatorio(s) pendiente(s)</span>
              <span className="quality-progress-track"><i style={{ width: `${checklistPercent}%` }} /></span>
            </div>
            {checklistPending > 0 && !readonly && (
              <p className="quality-attention-note" role="status">Los criterios obligatorios pendientes y las no conformidades se resaltan; el cierre queda bloqueado hasta evaluarlos.</p>
            )}
            {!readonly && (
              <form onSubmit={saveChecklist} className="quality-inline-form">
                <input value={checklistDraft.name} onChange={(event) => setChecklistDraft({ name: event.target.value })} placeholder="Nombre de la lista" minLength={1} maxLength={160} required />
                <button type="submit" className="button secondary" disabled={busy}>Añadir lista</button>
              </form>
            )}
            {(audit.checklists ?? []).length === 0 ? (
              <p className="muted">Sin listas de verificación todavía.</p>
            ) : (
              (audit.checklists ?? []).map((checklist) => (
                <div key={checklist.id} className="quality-checklist">
                  <div className="quality-checklist-header">
                    <h3>{checklist.name}</h3>
                    {!readonly && (
                      <div>
                        <button type="button" className="text-button" onClick={() => setItemFor({ checklistId: checklist.id, item: null })}>+ Ítem</button>
                        <button type="button" className="text-button danger" onClick={() => void removeChecklist(checklist)}>Eliminar</button>
                      </div>
                    )}
                  </div>
                  {checklist.items.length === 0 ? (
                    <p className="muted">Sin ítems.</p>
                  ) : (
                    <div className="quality-items">
                      <div className="quality-item-row quality-item-head"><span>Ítem</span><span>Criterio</span><span>Resultado</span><span>Observaciones</span><span /></div>
                      {checklist.items.map((item) => {
                        const rowClasses = [
                          'quality-item-row',
                          item.result === 'NON_CONFORM' ? 'is-non-conform' : '',
                          item.required && item.result === 'PENDING' ? 'is-required-pending' : '',
                          highlightItemId === item.id ? 'is-highlight' : '',
                        ].filter(Boolean).join(' ')
                        return (
                          <div key={item.id} id={`quality-item-${item.id}`} className={rowClasses}>
                            <span>{item.required ? '★ ' : ''}{item.description}</span>
                            <span className="muted">{item.criteria}</span>
                            <span>
                              {readonly ? checklistResultLabels[item.result] : (
                                <select value={item.result} onChange={(event) => void updateItemResult(checklist.id, item, event.target.value as typeof checklistResults[number], item.observations ?? '')} aria-label={`Resultado de ${item.description.slice(0, 40)}`}>
                                  {checklistResults.map((result) => <option key={result} value={result}>{checklistResultLabels[result]}</option>)}
                                </select>
                              )}
                            </span>
                            <span className="muted quality-item-observations">
                              {observationsFor?.itemId === item.id ? (
                                <span className="quality-observations-editor">
                                  <textarea value={observationsDraft} onChange={(event) => setObservationsDraft(event.target.value)} maxLength={2000} rows={2} placeholder="Observaciones del criterio…" aria-label="Observaciones" />
                                  <span>
                                    <button type="button" className="text-button" disabled={busy} onClick={() => void saveObservations()}>Guardar</button>
                                    <button type="button" className="text-button" onClick={() => { setObservationsFor(null); setObservationsDraft('') }}>Cancelar</button>
                                  </span>
                                </span>
                              ) : (
                                <>
                                  {item.observations ?? '—'}
                                  {!readonly && (
                                    <button type="button" className="text-button quality-observations-trigger" onClick={() => { setObservationsFor({ checklistId: checklist.id, itemId: item.id }); setObservationsDraft(item.observations ?? '') }}>
                                      {item.observations ? 'Editar' : 'Añadir'}
                                    </button>
                                  )}
                                </>
                              )}
                            </span>
                            <span>
                              {!readonly && (
                                <>
                                  <button type="button" className="text-button" onClick={() => { setItemFor({ checklistId: checklist.id, item }); setItemDraft({ description: item.description, criteria: item.criteria, required: item.required }) }}>Editar</button>
                                  <button type="button" className="text-button" onClick={() => startFinding(item.id)}>+ Hallazgo</button>
                                  <button type="button" className="text-button danger" onClick={() => void removeItem(checklist.id, item)}>×</button>
                                </>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          {itemFor && (
            <section className="panel quality-inline-panel">
              <p className="detail-label">{itemFor.item ? 'EDITAR ÍTEM' : 'NUEVO ÍTEM'}</p>
              <form onSubmit={saveItem} className="procedure-form">
                <label className="procedure-field-wide">Descripción
                  <input value={itemDraft.description} onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={2000} required />
                </label>
                <label className="procedure-field-wide">Criterio
                  <input value={itemDraft.criteria} onChange={(event) => setItemDraft((current) => ({ ...current, criteria: event.target.value }))} minLength={1} maxLength={2000} required />
                </label>
                <label>Obligatorio
                  <input type="checkbox" checked={itemDraft.required} onChange={(event) => setItemDraft((current) => ({ ...current, required: event.target.checked }))} />
                </label>
                <div className="procedure-form-actions procedure-field-wide">
                  <button type="submit" className="button primary" disabled={busy}>Guardar</button>
                  <button type="button" className="button secondary" onClick={() => setItemFor(null)}>Cancelar</button>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {activeSection === 'hallazgos' && (
        <div role="tabpanel" id="quality-panel-hallazgos" aria-labelledby="quality-tab-hallazgos" tabIndex={0} className="quality-tab-panel">
          <section id="quality-findings" className="panel quality-findings">
            <div className="panel-heading">
              <div>
                <p className="detail-label">HALLAZGOS</p>
                <h2>No conformidades y observaciones</h2>
              </div>
              {!readonly && (
                <button type="button" className="button secondary" onClick={() => startFinding()}>+ Hallazgo</button>
              )}
            </div>
            {!readonly && pendingEfficacy.length > 0 && (
              <p className="quality-attention-note" role="status">{pendingEfficacy.length} no conformidad(es) resuelta(s) sin verificación de eficacia: regístrala antes de verificar y cerrar.</p>
            )}
            {audit.findings.length === 0 ? (
              <p className="muted">Sin hallazgos registrados.</p>
            ) : (
              audit.findings.map((finding) => (
                <article key={finding.id} className="quality-finding quality-finding-card">
                  <div className="quality-finding-header">
                    <div>
                      <h3>{finding.title}</h3>
                      <p className="quality-finding-badges">
                        <span className={`quality-finding-type ${finding.type.toLowerCase()}`}>{findingTypeLabels[finding.type]}</span>
                        <span className="muted">{findingSeverityLabels[finding.severity]} · {findingStatusLabels[finding.status]}</span>
                      </p>
                      {finding.item && (
                        <p className="muted">Criterio de origen: {finding.item.description.slice(0, 80)}
                          {' '}
                          <button type="button" className="text-button" onClick={() => goToChecklistItem(finding.item!.id)}>Ver criterio</button>
                        </p>
                      )}
                      {finding.process && <p className="muted">Proceso: {finding.process.code} · {finding.process.name}</p>}
                      {finding.procedure && <p className="muted">Procedimiento: {finding.procedure.code} · {finding.procedure.name}</p>}
                      {!readonly && (
                        <p className="muted">
                          {(finding.actions ?? []).length > 0
                            ? `${(finding.actions ?? []).length} acción(es) · ${(finding.actions ?? []).filter((action) => action.status !== 'COMPLETED' && action.status !== 'CANCELLED').length} abierta(s)`
                            : 'Sin acciones correctivas.'}
                          {' '}
                          <button type="button" className="text-button" onClick={() => selectSection('acciones')}>Ver acciones</button>
                        </p>
                      )}
                    </div>
                    <div>
                      {!readonly && findingTransitions[finding.status].map((transition) => (
                        <button key={transition.to} type="button" className="text-button" disabled={busy} onClick={() => void changeFindingStatus(finding, transition.to)}>{transition.label}</button>
                      ))}
                      {!readonly && (
                        <>
                          <button type="button" className="text-button" onClick={() => { setFindingFor({ finding }); setFindingDraft(draftFromFinding(finding)) }}>Editar</button>
                          <button type="button" className="text-button" onClick={() => startAction(finding.id)}>+ Acción</button>
                          {finding.status !== 'VERIFIED' && (
                            <button type="button" className="text-button danger" onClick={() => void removeFinding(finding)}>Eliminar</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <p>{finding.description}</p>
                  {finding.resolution && <p className="muted">Resolución: {finding.resolution}</p>}
                  {finding.efficacyVerification && <p className="muted">Verificación de eficacia: {finding.efficacyVerification}</p>}
                  {finding.type === 'NONCONFORMITY' && finding.status === 'RESOLVED' && (!finding.efficacyVerification || finding.efficacyVerification.trim().length < 3) && !readonly && (
                    <button type="button" className="text-button" onClick={() => { setFindingFor({ finding }); setFindingDraft(draftFromFinding(finding)) }}>Registrar verificación de eficacia</button>
                  )}
                </article>
              ))
            )}
          </section>

          {findingFor && (
            <section className="panel quality-inline-panel">
              <p className="detail-label">{findingFor.finding ? 'EDITAR HALLAZGO' : 'NUEVO HALLAZGO'}</p>
              <form onSubmit={saveFinding} className="procedure-form">
                <label className="procedure-field-wide">Título
                  <input value={findingDraft.title} onChange={(event) => setFindingDraft((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={200} required />
                </label>
                <label className="procedure-field-wide">Descripción y evidencia objetiva
                  <textarea value={findingDraft.description} onChange={(event) => setFindingDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={5000} required rows={3} placeholder="Describe el hallazgo y la evidencia objetiva constatada (qué se observó, dónde y cuándo)." />
                </label>
                <label>Tipo
                  <select value={findingDraft.type} onChange={(event) => setFindingDraft((current) => ({ ...current, type: event.target.value as FindingDraft['type'] }))}>
                    {(Object.keys(findingTypeLabels) as Array<FindingDraft['type']>).map((type) => <option key={type} value={type}>{findingTypeLabels[type]}</option>)}
                  </select>
                </label>
                <label>Severidad
                  <select value={findingDraft.severity} onChange={(event) => setFindingDraft((current) => ({ ...current, severity: event.target.value as FindingDraft['severity'] }))}>
                    {(Object.keys(findingSeverityLabels) as Array<FindingDraft['severity']>).map((severity) => <option key={severity} value={severity}>{findingSeverityLabels[severity]}</option>)}
                  </select>
                </label>
                <label>Responsable
                  <select value={findingDraft.responsibleId} onChange={(event) => setFindingDraft((current) => ({ ...current, responsibleId: event.target.value }))}>
                    <option value="">Sin asignar</option>
                    {companyUsers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                </label>
                <label>Fecha límite
                  <input type="date" value={findingDraft.dueDate} onChange={(event) => setFindingDraft((current) => ({ ...current, dueDate: event.target.value }))} />
                </label>
                <label>Ítem de checklist
                  <select value={findingDraft.itemId} onChange={(event) => setFindingDraft((current) => ({ ...current, itemId: event.target.value }))}>
                    <option value="">Sin vínculo</option>
                    {(audit.checklists ?? []).flatMap((checklist) => checklist.items.map((item) => (
                      <option key={item.id} value={item.id}>{checklist.name}: {item.description.slice(0, 60)}</option>
                    )))}
                  </select>
                </label>
                <label>Proceso
                  <select value={findingDraft.processId} onChange={(event) => setFindingDraft((current) => ({ ...current, processId: event.target.value }))}>
                    <option value="">Sin vínculo</option>
                    {processes.filter((process) => relatedProcessIds.has(process.id)).map((process) => (
                      <option key={process.id} value={process.id}>{process.code} · {process.name}</option>
                    ))}
                  </select>
                </label>
                <label>Procedimiento
                  <select value={findingDraft.procedureId} onChange={(event) => setFindingDraft((current) => ({ ...current, procedureId: event.target.value }))}>
                    <option value="">Sin vínculo</option>
                    {linkedProcedures.map((procedure) => (
                      <option key={procedure.id} value={procedure.id}>{procedure.code} · {procedure.name}</option>
                    ))}
                  </select>
                </label>
                {findingFor.finding && findingFor.finding.type === 'NONCONFORMITY' && (
                  <label className="procedure-field-wide">Verificación de eficacia
                    <textarea value={findingDraft.efficacyVerification} onChange={(event) => setFindingDraft((current) => ({ ...current, efficacyVerification: event.target.value }))} maxLength={5000} rows={2} placeholder="Resultado de la verificación de que la corrección surtió efecto." />
                  </label>
                )}
                <div className="procedure-form-actions procedure-field-wide">
                  <button type="submit" className="button primary" disabled={busy}>Guardar</button>
                  <button type="button" className="button secondary" onClick={() => setFindingFor(null)}>Cancelar</button>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {activeSection === 'evidencias' && (
        <div role="tabpanel" id="quality-panel-evidencias" aria-labelledby="quality-tab-evidencias" tabIndex={0} className="quality-tab-panel">
          <section id="quality-evidence" className="panel quality-evidence">
            <div className="panel-heading">
              <div>
                <p className="detail-label">EVIDENCIAS</p>
                <h2>Enlaces y archivos PDF</h2>
              </div>
              {!readonly && (
                <div>
                  <button type="button" className="button secondary" onClick={() => setEvidenceFor(true)}>+ Enlace</button>
                  <button type="button" className="button secondary" onClick={() => setUploadFor({})}>+ PDF</button>
                </div>
              )}
            </div>
            {audit.evidences.length === 0 && evidenceFiles.length === 0 ? (
              <p className="muted">Sin evidencias todavía.</p>
            ) : (
              <>
                <ul className="quality-evidence-list">
                  {audit.evidences.map((evidence) => (
                    <li key={evidence.id} className="quality-evidence-card">
                      <header>
                        <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.name}</a>
                        {!readonly && <button type="button" className="text-button danger" onClick={() => void removeEvidence(evidence.id)}>×</button>}
                      </header>
                      <p>{evidence.description}</p>
                      <p className="muted">
                        Enlace · {evidence.findingId ? `Hallazgo: ${audit.findings.find((finding) => finding.id === evidence.findingId)?.title ?? '—'}` : 'Auditoría'} · {formatMaybeDate(evidence.createdAt)}
                      </p>
                    </li>
                  ))}
                  {evidenceFiles.map((file) => (
                    <li key={file.id} className="quality-evidence-card">
                      <header>
                        <a href={apiUrl(`/audits/${audit.id}/evidence-files/${file.id}`)}>{file.filename}</a>
                        {!readonly && <button type="button" className="text-button danger" onClick={() => void removeFile(file.id)}>×</button>}
                      </header>
                      <p className="muted">{formatBytes(file.size)} · {file.uploadedBy?.name ?? '—'} · {formatMaybeDate(file.createdAt)}</p>
                      <p className="muted">{evidenceFileRelationLabel(file, audit)}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {uploadFor && !readonly && (
              <form onSubmit={uploadFile} className="quality-inline-form">
                <label>Adjuntar PDF
                  <input type="file" name="file" accept="application/pdf,.pdf" required />
                </label>
                <label>Anclar a
                  <select onChange={(event) => {
                    const value = event.target.value
                    if (value.startsWith('finding:')) setUploadFor({ findingId: value.slice(8) })
                    else if (value.startsWith('action:')) setUploadFor({ actionId: value.slice(7) })
                    else if (value.startsWith('item:')) setUploadFor({ itemId: value.slice(5) })
                    else setUploadFor({})
                  }}>
                    <option value="">Auditoría</option>
                    {audit.findings.map((finding) => <option key={finding.id} value={`finding:${finding.id}`}>Hallazgo: {finding.title}</option>)}
                    {audit.findings.flatMap((finding) => (finding.actions ?? []).map((action) => (
                      <option key={action.id} value={`action:${action.id}`}>Acción: {action.title}</option>
                    )))}
                    {(audit.checklists ?? []).flatMap((checklist) => checklist.items.map((item) => (
                      <option key={item.id} value={`item:${item.id}`}>Ítem: {item.description.slice(0, 50)}</option>
                    )))}
                  </select>
                </label>
                <button type="submit" className="button primary" disabled={uploading}>{uploading ? 'Subiendo…' : 'Subir'}</button>
                <button type="button" className="button secondary" onClick={() => setUploadFor(null)}>Cancelar</button>
              </form>
            )}
          </section>

          {evidenceFor && !readonly && (
            <section className="panel quality-inline-panel">
              <p className="detail-label">NUEVO ENLACE DE EVIDENCIA</p>
              <form onSubmit={saveEvidence} className="procedure-form">
                <label>Nombre
                  <input value={evidenceDraft.name} onChange={(event) => setEvidenceDraft((current) => ({ ...current, name: event.target.value }))} minLength={3} maxLength={160} required />
                </label>
                <label className="procedure-field-wide">Descripción
                  <input value={evidenceDraft.description} onChange={(event) => setEvidenceDraft((current) => ({ ...current, description: event.target.value }))} minLength={3} maxLength={2000} required />
                </label>
                <label className="procedure-field-wide">URL
                  <input type="url" value={evidenceDraft.url} onChange={(event) => setEvidenceDraft((current) => ({ ...current, url: event.target.value }))} required />
                </label>
                <label>Hallazgo asociado
                  <select value={evidenceDraft.findingId} onChange={(event) => setEvidenceDraft((current) => ({ ...current, findingId: event.target.value }))}>
                    <option value="">Auditoría (sin hallazgo)</option>
                    {audit.findings.map((finding) => <option key={finding.id} value={finding.id}>{finding.title}</option>)}
                  </select>
                </label>
                <div className="procedure-form-actions procedure-field-wide">
                  <button type="submit" className="button primary" disabled={busy}>Guardar</button>
                  <button type="button" className="button secondary" onClick={() => setEvidenceFor(false)}>Cancelar</button>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {activeSection === 'acciones' && (
        <div role="tabpanel" id="quality-panel-acciones" aria-labelledby="quality-tab-acciones" tabIndex={0} className="quality-tab-panel">
          <section id="quality-actions" className="panel quality-actions-section">
            <div className="panel-heading">
              <div>
                <p className="detail-label">ACCIONES CORRECTIVAS</p>
                <h2>Seguimiento de acciones</h2>
              </div>
              {!readonly && (
                <button type="button" className="button secondary" disabled={audit.findings.length === 0} onClick={() => startAction(audit.findings[0].id)}>+ Acción</button>
              )}
            </div>
            {!readonly && audit.findings.length === 0 && <p className="muted">Registra un hallazgo primero para poder crear acciones correctivas.</p>}
            {overdueActions > 0 && <p className="quality-attention-note" role="status">{overdueActions} acción(es) vencida(s): revisa fechas límite y estados.</p>}
            {allActions.length === 0 ? (
              <p className="muted">Sin acciones correctivas.</p>
            ) : (
              <div className="quality-actions-list">
                {allActions.map(({ action, finding }) => {
                  const overdue = isAuditActionOverdue(action)
                  return (
                    <article key={action.id} className={`quality-action-card${overdue ? ' is-overdue' : ''}`}>
                      <header>
                        <div>
                          <strong>{action.title}</strong>
                          <p className="muted">Hallazgo: {finding.title}</p>
                        </div>
                        <div className="quality-action-badges">
                          {overdue && <span className="quality-overdue-badge">Vencida</span>}
                          <span className={`badge quality-status ${action.status.toLowerCase()}`}>{actionStatusLabels[action.status]}</span>
                          <span className="badge priority">{actionPriorityLabels[action.priority]}</span>
                          {action.required && <span className="quality-required-badge">Obligatoria</span>}
                        </div>
                      </header>
                      <p>{action.description}</p>
                      <p className="muted">
                        Responsable: {action.responsible?.name ?? 'Sin asignar'} · Vence: {formatMaybeDate(action.dueDate)}
                        {action.completedAt ? ` · Completada ${formatMaybeDate(action.completedAt)}` : ''}
                      </p>
                      {action.progress.length > 0 && (
                        <ul className="quality-action-progress">
                          {action.progress.map((entry) => (
                            <li key={entry.id}>{entry.note}{entry.percent !== null ? ` (${entry.percent}%)` : ''} <span className="muted">{formatMaybeDate(entry.createdAt)}</span></li>
                          ))}
                        </ul>
                      )}
                      {!readonly && (
                        <div className="quality-action-controls">
                          {actionTransitions[action.status].map((transition) => (
                            <button key={transition.to} type="button" className="text-button" disabled={busy} onClick={() => void applyActionStatus(action, transition.to)}>{transition.label}</button>
                          ))}
                          {action.status !== 'COMPLETED' && action.status !== 'CANCELLED' && (
                            <>
                              <button type="button" className="text-button" onClick={() => void addProgress(action)}>+ Avance</button>
                              <button type="button" className="text-button" onClick={() => { setActionFor({ findingId: finding.id, action }); setActionDraft({ title: action.title, description: action.description, responsibleId: action.responsible?.id ?? '', priority: action.priority, required: action.required, dueDate: action.dueDate ? action.dueDate.slice(0, 10) : '' }) }}>Editar</button>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {actionFor && (
            <section className="panel quality-inline-panel">
              <p className="detail-label">{actionFor.action ? 'EDITAR ACCIÓN' : 'NUEVA ACCIÓN CORRECTIVA'}</p>
              <form onSubmit={saveAction} className="procedure-form">
                {!actionFor.action && (
                  <label>Hallazgo asociado
                    <select value={actionFor.findingId} onChange={(event) => setActionFor({ ...actionFor, findingId: event.target.value })}>
                      {audit.findings.map((finding) => <option key={finding.id} value={finding.id}>{finding.title}</option>)}
                    </select>
                  </label>
                )}
                <label className="procedure-field-wide">Título
                  <input value={actionDraft.title} onChange={(event) => setActionDraft((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={200} required />
                </label>
                <label className="procedure-field-wide">Descripción
                  <textarea value={actionDraft.description} onChange={(event) => setActionDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={5000} required rows={3} />
                </label>
                <label>Responsable
                  <select value={actionDraft.responsibleId} onChange={(event) => setActionDraft((current) => ({ ...current, responsibleId: event.target.value }))}>
                    <option value="">Sin asignar</option>
                    {companyUsers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                </label>
                <label>Prioridad
                  <select value={actionDraft.priority} onChange={(event) => setActionDraft((current) => ({ ...current, priority: event.target.value as ActionDraft['priority'] }))}>
                    {(Object.keys(actionPriorityLabels) as Array<ActionDraft['priority']>).map((priority) => <option key={priority} value={priority}>{actionPriorityLabels[priority]}</option>)}
                  </select>
                </label>
                <label>Obligatoria
                  <input type="checkbox" checked={actionDraft.required} onChange={(event) => setActionDraft((current) => ({ ...current, required: event.target.checked }))} />
                </label>
                <label>Fecha límite
                  <input type="date" value={actionDraft.dueDate} onChange={(event) => setActionDraft((current) => ({ ...current, dueDate: event.target.value }))} />
                </label>
                <div className="procedure-form-actions procedure-field-wide">
                  <button type="submit" className="button primary" disabled={busy}>Guardar</button>
                  <button type="button" className="button secondary" onClick={() => setActionFor(null)}>Cancelar</button>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {activeSection === 'historial' && (
        <div role="tabpanel" id="quality-panel-historial" aria-labelledby="quality-tab-historial" tabIndex={0} className="quality-tab-panel">
          <section id="quality-history" className="panel quality-history">
            <div className="panel-heading">
              <div>
                <p className="detail-label">HISTORIAL</p>
                <h2>Trazabilidad de la auditoría</h2>
              </div>
              {!historyLoadedForCurrentAudit && !historyLoadingForCurrentAudit && (
                <button type="button" className="button secondary" onClick={() => void loadHistory()}>Cargar historial</button>
              )}
            </div>
            {historyLoadingForCurrentAudit ? (
              <LoadingState text="Cargando historial…" />
            ) : !historyLoadedForCurrentAudit ? (
              <p className="muted">El historial es de solo lectura y lo escribe el servidor.</p>
            ) : history.length === 0 ? (
              <p className="muted">Sin eventos.</p>
            ) : (
              <ul className="quality-history-list">
                {history.map((event) => (
                  <li key={event.id}>
                    <strong>{eventLabel(event)}</strong> — {event.summary}
                    <span className="muted"> · {dateFormatter.format(new Date(event.occurredAt))}{event.actor ? ` · ${event.actor.name}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

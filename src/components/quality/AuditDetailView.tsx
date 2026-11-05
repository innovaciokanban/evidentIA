import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { api, apiUpload, ApiError, apiUrl } from '../../api'
import checkyImage from '../../assets/Aprobado por checky.png'
import { activeUserOptions, userOptionLabel } from '../../user-status'
import type {
  Audit,
  AuditChecklist,
  AuditChecklistItem,
  AuditCorrectiveAction,
  AuditEvent,
  AuditEvidenceFile,
  AuditFinding,
  AuditFindingStatus,
  AuditStatus,
  EvidenceStorageOperation,
  Process,
  ProcessChangeValue,
} from '../../types'
import { askConfirm } from '../ui/useConfirm'
import {
  actionPriorityLabels,
  actionStatusLabels,
  actionTransitions,
  auditEvidenceStorageSummary,
  auditCloseBlockers,
  auditChecklistAIContext,
  auditChecklistAIDimensionLabels,
  auditExecutionSummary,
  auditStatusLabels,
  auditTransitions,
  checklistResultLabels,
  checklistResults,
  dedupeAuditChecklistAIProposals,
  draftFromFinding,
  emptyActionDraft,
  emptyChecklistDraft,
  emptyChecklistItemDraft,
  emptyFindingDraft,
  eventLabel,
  evidenceFileRelationLabel,
  evidenceStorageStateLabels,
  evidenceStorageStateMessages,
  findingSeverityLabels,
  findingStatusLabels,
  findingTransitions,
  findingTypeLabels,
  formatBytes,
  isAuditActionOverdue,
  isTerminalAudit,
  pendingEfficacyFindings,
  type ActionDraft,
  type AuditChecklistAIProposal,
  type AuditChecklistAIDimension,
  type AuditWorkspaceSection,
  type ChecklistDraft,
  type ChecklistItemDraft,
  type ChecklistItemOrigin,
  type FindingDraft,
  type QualityUser,
} from './quality.model'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
const shortDateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

const formatMaybeDate = (value: string | null | undefined) => (value ? shortDateFormatter.format(new Date(value)) : '—')

const auditHistoryGlyph = (eventType: AuditEvent['eventType']): string => {
  if (eventType.includes('DELETED')) return '−'
  if (eventType.includes('STATUS')) return '↕'
  if (eventType.includes('PROGRESS')) return '↗'
  if (eventType.includes('EVIDENCE') || eventType.includes('CHECKLIST')) return '▣'
  if (eventType.includes('CREATED')) return '+'
  return '✎'
}

const auditHistoryCategory = (eventType: AuditEvent['eventType']): string => {
  if (eventType.includes('FINDING')) return 'Hallazgo'
  if (eventType.includes('ACTION')) return 'Acción'
  if (eventType.includes('EVIDENCE')) return 'Evidencia'
  if (eventType.includes('CHECKLIST')) return 'Checklist'
  return 'Auditoría'
}

const auditHistoryTechnicalLabels: Record<string, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En curso',
  PENDING: 'Pendiente',
  NON_CONFORM: 'No conforme',
  CONFORM: 'Conforme',
  NOT_APPLICABLE: 'No aplica',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  PLANNED: 'Planificada',
  CLOSED: 'Cerrada',
  RESOLVED: 'Resuelto',
  VERIFIED: 'Verificado',
  READY: 'Disponible',
  FAILED: 'Fallido',
  DELETE_PENDING: 'Eliminación pendiente',
  RETRYABLE: 'Reintento programado',
  CRITICAL: 'Crítica',
  HIGH: 'Alta',
  MEDIUM: 'Media',
  LOW: 'Baja',
  MAJOR: 'Mayor',
  MINOR: 'Menor',
  NONCONFORMITY: 'No conformidad',
  OBSERVATION: 'Observación',
  OPPORTUNITY: 'Oportunidad',
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  APPROVED: 'Aprobado',
  OBSOLETE: 'Obsoleto',
  SUPERUSER: 'Superusuario',
  COMPANY_ADMIN: 'Administrador',
  COMPANY_USER: 'Usuario de empresa',
}

const auditHistoryValue = (value: ProcessChangeValue): string => {
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return auditHistoryTechnicalLabels[String(value)] ?? String(value)
}

const auditHistoryPresentation = (event: AuditEvent): { title: string; detail: string } => {
  const title = eventLabel(event)
  const quoted = event.summary.match(/«([^»]+)»/)
  if (!quoted || quoted.index === undefined) return { title, detail: event.summary === title ? '' : event.summary }
  const suffix = event.summary.slice(quoted.index + quoted[0].length).trim()
  const genericSuffixes = new Set(['creado', 'creada', 'actualizado', 'actualizada', 'eliminado', 'eliminada', 'registrada', 'adjuntada', 'añadido', 'añadida'])
  return { title, detail: [quoted[1], suffix && !genericSuffixes.has(suffix) ? suffix : ''].filter(Boolean).join(' · ') }
}

type AuditChecklistAIProcessFilter = 'ALL' | Process['type']
type EvidenceAnchor = { findingId?: string; actionId?: string; itemId?: string }
type EvidenceOperationResponse = { operationId?: string; operationStatus?: EvidenceStorageOperation['status']; file?: AuditEvidenceFile | null }

const storageOperationStatusLabels: Record<EvidenceStorageOperation['status'], string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  SUCCEEDED: 'Completada',
  RETRYABLE: 'Reintento programado',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
}

const isTerminalStorageOperation = (status: EvidenceStorageOperation['status']): boolean =>
  status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED'


function findErrorMessage(requestError: unknown, fallback: string): string {
  if (requestError instanceof ApiError) return requestError.message
  return fallback
}

/** Mensaje amable de un cierre rechazado por el servidor, enlazando con la condición incumplida. */
function closeErrorMessage(requestError: unknown): string {
  if (requestError instanceof ApiError) {
    const friendly: Record<string, string> = {
      CHECKLIST_PENDING: 'Quedan criterios obligatorios sin evaluar en el checklist.',
      CHECKLIST_FINDING_MISSING: 'Hay no conformidades del checklist sin un hallazgo válido vinculado.',
      ACTIONS_PENDING: 'Quedan acciones correctivas obligatorias pendientes.',
      EFFICACY_PENDING: 'Quedan no conformidades sin verificación de eficacia.',
      EVIDENCE_PENDING: 'Hay archivos de evidencia pendientes de procesamiento.',
      EVIDENCE_FAILED: 'Hay archivos de evidencia con una operación de almacenamiento fallida.',
      EVIDENCE_DELETE_PENDING: 'Hay eliminaciones de evidencia pendientes de sincronización.',
    }
    const mapped = requestError.reason ? friendly[requestError.reason] : undefined
    return mapped ?? requestError.message
  }
  return 'No se pudo cerrar la auditoría.'
}

function checklistItemContext(criteria: string): { verification: string; source: string; dimension: string; origin: ChecklistItemOrigin } {
  const lines = criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const valueFor = (prefix: string) => lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() || null
  const expectedEvidence = valueFor('Evidencia esperada:')
  const source = valueFor('Fuente:')
  const dimension = valueFor('Dimensión:')
  const origin = valueFor('Origen:')
  const contentLines = lines.filter((line) => !['evidencia esperada:', 'fuente:', 'dimensión:', 'origen:'].some((prefix) => line.toLowerCase().startsWith(prefix)))
  return {
    verification: (expectedEvidence ?? contentLines.join('\n')) || criteria,
    source: source ?? 'No especificada',
    dimension: dimension ?? 'No especificada',
    origin: origin?.toLowerCase() === 'checky' || Boolean(expectedEvidence) ? 'CHECKY' : 'MANUAL',
  }
}

function checklistDimensionValue(label: string): AuditChecklistAIDimension | '' {
  const match = (Object.entries(auditChecklistAIDimensionLabels) as Array<[AuditChecklistAIDimension, string]>)
    .find(([, value]) => value.toLowerCase() === label.toLowerCase())
  return match?.[0] ?? ''
}

function checklistCriteriaFromDraft(draft: ChecklistItemDraft): string {
  return [
    draft.criteria.trim(),
    draft.source.trim() ? `Fuente: ${draft.source.trim()}` : '',
    draft.dimension ? `Dimensión: ${auditChecklistAIDimensionLabels[draft.dimension]}` : '',
    `Origen: ${draft.origin === 'CHECKY' ? 'Checky' : 'Manual'}`,
  ].filter(Boolean).join('\n')
}

const sectionTabs: Array<{ id: AuditWorkspaceSection; label: string }> = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'hallazgos', label: 'Hallazgos' },
  { id: 'historial', label: 'Historial' },
]

const sectionLabels: Record<AuditWorkspaceSection, string> = {
  resumen: 'Resumen',
  checklist: 'Checklist',
  hallazgos: 'Hallazgos',
  evidencias: 'Evidencias',
  acciones: 'Acciones correctivas',
  historial: 'Historial',
}

function visibleSection(section: AuditWorkspaceSection): AuditWorkspaceSection {
  return section
}

/**
 * Espacio de trabajo de una auditoría: pestañas Resumen (preparación e inicio), Checklist,
 * Hallazgos e Historial. Reutiliza los endpoints y reglas del
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
  const [activeSection, setActiveSection] = useState<AuditWorkspaceSection>(() => visibleSection(initialSection))
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [checklistDraft, setChecklistDraft] = useState<ChecklistDraft>({ name: '' })
  const [itemDraft, setItemDraft] = useState<ChecklistItemDraft>(emptyChecklistItemDraft)
  const [itemFor, setItemFor] = useState<{ checklistId: string; item: AuditChecklistItem | null } | null>(null)
  const [itemError, setItemError] = useState('')
  const [aiProposals, setAIProposals] = useState<AuditChecklistAIProposal[]>([])
  const [aiChecklistId, setAIChecklistId] = useState('')
  const [aiGenerating, setAIGenerating] = useState(false)
  const [aiError, setAIError] = useState('')
  const [aiMissingInformation, setAIMissingInformation] = useState<string[]>([])
  const [aiProcessFilter, setAIProcessFilter] = useState<AuditChecklistAIProcessFilter>('ALL')
  const [aiDimensionFilter, setAIDimensionFilter] = useState<AuditChecklistAIProposal['dimension'] | 'ALL'>('ALL')
  const [aiExpandedProposalIds, setAIExpandedProposalIds] = useState<Set<string>>(new Set())
  const [responseEditorFor, setResponseEditorFor] = useState<string | null>(null)
  const [observationsFor, setObservationsFor] = useState<{ checklistId: string; itemId: string } | null>(null)
  const [observationsDraft, setObservationsDraft] = useState('')
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null)
  const [highlightActionId, setHighlightActionId] = useState<string | null>(null)
  const [findingDraft, setFindingDraft] = useState<FindingDraft>(emptyFindingDraft)
  const [findingFor, setFindingFor] = useState<{ finding: AuditFinding | null } | null>(null)
  const [pendingNonConformity, setPendingNonConformity] = useState<{ checklistId: string; itemId: string; observations: string } | null>(null)
  const [actionDraft, setActionDraft] = useState<ActionDraft>(emptyActionDraft)
  const [actionFor, setActionFor] = useState<{ findingId: string; action: AuditCorrectiveAction | null } | null>(null)
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceAnchor | null>(null)
  const [evidenceOperations, setEvidenceOperations] = useState<Record<string, EvidenceStorageOperation>>({})
  const [uploadFor, setUploadFor] = useState<{ findingId?: string; actionId?: string; itemId?: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
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
    setActiveSection(visibleSection(initialSection))
    setAIProposals([])
    setAIChecklistId('')
    setAIError('')
    setAIMissingInformation([])
    setAIProcessFilter('ALL')
    setAIDimensionFilter('ALL')
    setAIExpandedProposalIds(new Set())
    setResponseEditorFor(null)
    setEvidenceFilter(null)
    setEvidenceOperations({})
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

  useEffect(() => {
    if (!highlightActionId || activeSection !== 'acciones') return
    const element = document.getElementById(`quality-action-${highlightActionId}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightActionId, activeSection])

  const activeCompanyUsers = users.filter((person) => (!person.companyId || person.companyId === audit.companyId) && person.isActive !== false)
  const findingUsers = activeUserOptions(activeCompanyUsers, findingFor?.finding?.responsible ? [findingFor.finding.responsible] : [])
  const actionUsers = activeUserOptions(activeCompanyUsers, actionFor?.action?.responsible ? [actionFor.action.responsible] : [])
  const relatedProcessIds = new Set([audit.processId, ...(audit.relatedProcesses ?? []).map((process) => process.id)])
  const linkedProcedures = (audit.procedures ?? []).map((procedure) => procedure)

  const results = auditExecutionSummary(audit)
  const closeBlockers = auditCloseBlockers(audit)
  const evidenceStorage = auditEvidenceStorageSummary(audit)
  const pendingEfficacy = pendingEfficacyFindings(audit)
  const terminal = isTerminalAudit(audit)
  const readonly = terminal || !canWrite
  const checklistResponseReadonly = readonly || audit.status !== 'IN_PROGRESS'
  const checklistTotal = results.itemsTotal
  const checklistCompleted = results.itemsEvaluated
  const checklistPending = results.itemsRequiredPending
  const checklistPercent = checklistTotal > 0 ? Math.min(100, Math.round((checklistCompleted / checklistTotal) * 100)) : 0
  const evidenceFiles = audit.evidenceFiles ?? []
  const evidenceCount = evidenceFiles.length
  const hasEvidenceFilter = Boolean(evidenceFilter && Object.values(evidenceFilter).some(Boolean))
  const filteredEvidenceFiles = hasEvidenceFilter
    ? evidenceFiles.filter((file) => (
      (evidenceFilter?.findingId && file.findingId === evidenceFilter.findingId)
      || (evidenceFilter?.actionId && file.actionId === evidenceFilter.actionId)
      || (evidenceFilter?.itemId && file.itemId === evidenceFilter.itemId)
    ))
    : evidenceFiles
  const visibleEvidenceCount = filteredEvidenceFiles.length
  const activeStorageOperations = Object.values(evidenceOperations).filter((operation) => !isTerminalStorageOperation(operation.status) || operation.status === 'FAILED')
  const closeWarnings = [
    results.itemsPending - results.itemsRequiredPending > 0 ? `${results.itemsPending - results.itemsRequiredPending} pregunta(s) no obligatoria(s) siguen pendientes; no bloquean el cierre.` : '',
    results.findingsOpen > 0 ? `${results.findingsOpen} hallazgo(s) siguen abiertos; el cierre no exige que todos estén verificados.` : '',
  ].filter(Boolean)
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
    const nextSection = visibleSection(section)
    setActiveSection(nextSection)
    if (nextSection === 'historial' && !historyLoadedForCurrentAudit && !historyLoadingForCurrentAudit) void loadHistory()
  }

  function goToActions() {
    const firstPendingAction = allActions.find(({ action }) => action.required && action.status !== 'COMPLETED' && action.status !== 'CANCELLED')
    setHighlightActionId(firstPendingAction?.action.id ?? null)
    selectSection('acciones')
  }

  function goToCloseBlocker(section: AuditWorkspaceSection) {
    if (section === 'acciones') goToActions()
    else selectSection(section)
  }

  function selectEvidenceContext(anchor: EvidenceAnchor | null = null) {
    setEvidenceFilter(anchor)
    selectSection('evidencias')
  }

  function evidenceCountFor(anchor: EvidenceAnchor): number {
    return evidenceFiles.filter((file) => (
        (anchor.findingId && file.findingId === anchor.findingId)
        || (anchor.actionId && file.actionId === anchor.actionId)
        || (anchor.itemId && file.itemId === anchor.itemId)
    )).length
  }

  function evidenceContextLabel(anchor: EvidenceAnchor): string {
    if (anchor.findingId) return `Hallazgo: ${audit.findings.find((finding) => finding.id === anchor.findingId)?.title ?? '—'}`
    if (anchor.actionId) return `Acción: ${audit.findings.flatMap((finding) => finding.actions ?? []).find((action) => action.id === anchor.actionId)?.title ?? '—'}`
    if (anchor.itemId) return `Criterio: ${(audit.checklists ?? []).flatMap((checklist) => checklist.items).find((item) => item.id === anchor.itemId)?.description ?? '—'}`
    return 'Auditoría'
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

  function cancelFinding() {
    setFindingFor(null)
    setPendingNonConformity(null)
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
    setHistoryError('')
    const requestedAuditId = audit.id
    try {
      const result = await api<{ events: AuditEvent[] }>(`/audits/${audit.id}/history?pageSize=50`)
      if (historyAuditId.current === requestedAuditId) {
        setHistory(result.events)
        setHistoryLoaded(true)
        setHistoryError('')
      }
    } catch (requestError) {
      const message = findErrorMessage(requestError, 'No pudimos cargar el historial.')
      setHistoryError(message)
      onError(message)
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

  async function generateChecklistWithAI() {
    if (readonly || aiGenerating || busy) return
    setAIGenerating(true)
    setAIError('')
    setAIMissingInformation([])
    try {
      const result = await api<{
        proposals: Array<Omit<AuditChecklistAIProposal, 'id' | 'selected'>>
        missingInformation: string[]
      }>(`/audits/${audit.id}/checklists/generate`, { method: 'POST', body: JSON.stringify({}) })
      const existingQuestions = (audit.checklists ?? []).flatMap((checklist) => checklist.items.map((item) => item.description))
      const uniqueProposals = dedupeAuditChecklistAIProposals(existingQuestions, result.proposals)
      setAIProposals(uniqueProposals.map((proposal, index) => ({ ...proposal, id: `checky-${Date.now()}-${index}`, selected: true })))
      setAIExpandedProposalIds(new Set())
      setAIChecklistId((current) => current || audit.checklists?.[0]?.id || '')
      setAIMissingInformation(result.missingInformation)
      if (uniqueProposals.length === 0 && result.missingInformation.length === 0) setAIError('Checky no encontró preguntas sustentadas en la documentación disponible.')
    } catch (requestError) {
      setAIError(findErrorMessage(requestError, 'No se pudieron generar preguntas con IA-Checky.'))
    } finally {
      setAIGenerating(false)
    }
  }

  async function saveAIProposals() {
    const existingQuestions = (audit.checklists ?? []).flatMap((checklist) => checklist.items.map((item) => item.description))
    const selected = dedupeAuditChecklistAIProposals(existingQuestions, aiProposals.filter((proposal) => proposal.selected))
    if (selected.length === 0) {
      setAIError('Selecciona al menos una propuesta para guardar.')
      return
    }
    if (!aiChecklistId || busy) {
      setAIError('Selecciona una lista de verificación de destino.')
      return
    }
    if (selected.some((proposal) => proposal.question.trim().length < 10 || proposal.expectedEvidence.trim().length < 3 || proposal.source.trim().length < 3)) {
      setAIError('Completa la pregunta, la evidencia esperada y la fuente antes de guardar.')
      return
    }
    setBusy(true)
    setAIError('')
    const savedIds = new Set<string>()
    try {
      for (const proposal of selected) {
        const criteria = [
          `Evidencia esperada: ${proposal.expectedEvidence.trim()}`,
          `Fuente: ${proposal.source.trim()}`,
          `Dimensión: ${auditChecklistAIDimensionLabels[proposal.dimension]}`,
        ].join('\n')
        await api(`/audits/${audit.id}/checklists/${aiChecklistId}/items`, {
          method: 'POST',
          body: JSON.stringify({ description: proposal.question.trim(), criteria, required: true }),
        })
        savedIds.add(proposal.id)
      }
      setAIProposals((current) => current.filter((proposal) => !savedIds.has(proposal.id)))
      await reload()
      onNotice(`${savedIds.size} pregunta(s) de IA-Checky guardada(s).`)
    } catch (requestError) {
      setAIProposals((current) => current.filter((proposal) => !savedIds.has(proposal.id)))
      onError(findErrorMessage(requestError, savedIds.size > 0 ? 'Algunas propuestas se guardaron, pero otras no.' : 'No se pudieron guardar las propuestas.'))
    } finally {
      setBusy(false)
    }
  }

  function updateAIProposal(id: string, changes: Partial<AuditChecklistAIProposal>) {
    setAIProposals((current) => current.map((proposal) => proposal.id === id ? { ...proposal, ...changes } : proposal))
  }

  function toggleAIProposalDetails(id: string) {
    setAIExpandedProposalIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function discardAIProposal(id: string) {
    const proposal = aiProposals.find((item) => item.id === id)
    if (!proposal) return
    const confirmed = await askConfirm({
      title: 'Descartar propuesta',
      message: 'La propuesta y sus ediciones se retirarán de esta revisión.',
      confirmLabel: 'Descartar',
      variant: 'danger',
    })
    if (confirmed) setAIProposals((current) => current.filter((item) => item.id !== id))
  }

  const aiProposalCards = aiProposals.map((proposal) => ({ proposal, context: auditChecklistAIContext(proposal, audit, processes) }))
  const visibleAIProposalCards = aiProposalCards.filter(({ proposal, context }) => (
    (aiProcessFilter === 'ALL' || context.processType === aiProcessFilter)
      && (aiDimensionFilter === 'ALL' || proposal.dimension === aiDimensionFilter)
  ))
  const selectedAIProposalCount = aiProposals.filter((proposal) => proposal.selected).length
  const allVisibleAIProposalsSelected = visibleAIProposalCards.length > 0 && visibleAIProposalCards.every(({ proposal }) => proposal.selected)

  function setVisibleAISelection(selected: boolean) {
    const visibleIds = new Set(visibleAIProposalCards.map(({ proposal }) => proposal.id))
    setAIProposals((current) => current.map((proposal) => visibleIds.has(proposal.id) ? { ...proposal, selected } : proposal))
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

  function openNewChecklistItem(checklistId: string) {
    setItemError('')
    setItemDraft(emptyChecklistItemDraft)
    setItemFor({ checklistId, item: null })
  }

  function openEditChecklistItem(checklistId: string, item: AuditChecklistItem) {
    const context = checklistItemContext(item.criteria)
    setItemError('')
    setItemDraft({
      description: item.description,
      criteria: context.verification,
      source: context.source === 'No especificada' ? '' : context.source,
      dimension: checklistDimensionValue(context.dimension),
      origin: context.origin,
      required: item.required,
    })
    setItemFor({ checklistId, item })
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemFor || busy) return
    const description = itemDraft.description.trim()
    const criteria = itemDraft.criteria.trim()
    if (!description) {
      setItemError('Escribe la pregunta de verificación.')
      return
    }
    if (!criteria) {
      setItemError('Escribe el criterio de verificación.')
      return
    }
    const duplicate = (audit.checklists ?? [])
      .flatMap((checklist) => checklist.items)
      .some((item) => item.id !== itemFor.item?.id && item.description.trim().toLowerCase() === description.toLowerCase())
    if (duplicate) {
      setItemError('Ya existe una pregunta con ese texto en esta auditoría.')
      return
    }
    setItemError('')
    setBusy(true)
    try {
      const payload = { description, criteria: checklistCriteriaFromDraft({ ...itemDraft, description, criteria }), required: itemDraft.required }
      if (itemFor.item) {
        await api(`/audits/${audit.id}/checklists/${itemFor.checklistId}/items/${itemFor.item.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api(`/audits/${audit.id}/checklists/${itemFor.checklistId}/items`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setItemFor(null)
      setItemDraft(emptyChecklistItemDraft)
      setItemError('')
      await reload()
      onNotice(itemFor.item ? 'Pregunta actualizada.' : 'Pregunta manual guardada.')
    } catch (requestError) {
      const message = findErrorMessage(requestError, 'No se pudo guardar la pregunta.')
      setItemError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  async function updateItemResult(checklistId: string, item: AuditChecklistItem, result: typeof checklistResults[number], observations: string) {
    if (checklistResponseReadonly) return
    let findingReviewConfirmed = false
    if (item.result === 'NON_CONFORM' && (result === 'CONFORM' || result === 'NOT_APPLICABLE')) {
      const confirmed = await askConfirm({
        title: 'Revisar hallazgo asociado',
        message: 'La respuesta cambiará, pero el hallazgo se conservará. Confirma que revisaste su situación y seguimiento.',
        confirmLabel: 'Confirmar revisión',
      })
      if (!confirmed) return
      findingReviewConfirmed = true
    }
    if (result === 'NON_CONFORM' && item.result !== 'NON_CONFORM') {
      const existingFinding = audit.findings.find((finding) => finding.itemId === item.id && finding.type === 'NONCONFORMITY')
      if (!existingFinding) {
        setPendingNonConformity({ checklistId, itemId: item.id, observations })
        setResponseEditorFor(null)
        startFinding(item.id)
        return
      }
    }
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/checklists/${checklistId}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ result, observations: observations || null, ...(findingReviewConfirmed ? { findingReviewConfirmed: true } : {}) }),
      })
      setResponseEditorFor(null)
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
        if (pendingNonConformity) {
          await api(`/audits/${audit.id}/checklists/${pendingNonConformity.checklistId}/items/${pendingNonConformity.itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ result: 'NON_CONFORM', observations: pendingNonConformity.observations || null }),
          })
        }
      }
      setFindingFor(null)
      setPendingNonConformity(null)
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

  async function watchEvidenceOperation(operationId: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const result = await api<{ operation: EvidenceStorageOperation }>(`/audits/${audit.id}/evidence-operations/${operationId}`)
        setEvidenceOperations((current) => ({ ...current, [operationId]: result.operation }))
        if (isTerminalStorageOperation(result.operation.status)) {
          await reload()
          return
        }
      } catch {
        return
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
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
    setUploadProgress(0)
    try {
      const result = await apiUpload<EvidenceOperationResponse>(`/audits/${audit.id}/evidence-files`, file, uploadFor, setUploadProgress)
      if (result.operationId) void watchEvidenceOperation(result.operationId)
      setUploadFor(null)
      await reload()
      onNotice(result.operationId ? 'PDF registrado; se está procesando.' : 'PDF adjuntado correctamente.')
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo subir el PDF.'))
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  async function removeFile(fileId: string) {
    const confirmed = await askConfirm({ title: 'Eliminar PDF', message: 'Se eliminará el archivo de evidencia.', confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await api<EvidenceOperationResponse | undefined>(`/audits/${audit.id}/evidence-files/${fileId}`, { method: 'DELETE' })
      if (result?.operationId) void watchEvidenceOperation(result.operationId)
      await reload()
      onNotice(result?.operationId ? 'Eliminación registrada; se está procesando.' : 'Archivo eliminado.')
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
        <div className="quality-detail-stat"><span className="quality-stat-mark purple">↗</span><span><small>Evidencias</small><strong>{evidenceCount} registradas</strong><button type="button" className="text-button" onClick={() => selectEvidenceContext()}>Ver evidencias</button></span></div>
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
              <div><small>Responsable</small><strong>{audit.responsible ? userOptionLabel(audit.responsible) : 'Sin asignar'}</strong></div>
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
                 <div><small>Criterios evaluados</small><strong>{checklistCompleted}/{checklistTotal}</strong><span>{results.itemsPending} pendientes totales · {results.itemsRequiredPending} obligatorios</span></div>
                 <div><small>Preguntas obligatorias</small><strong>{results.itemsRequiredEvaluated}/{results.itemsRequiredTotal}</strong><span>{results.itemsRequiredPending} pendientes que bloquean</span></div>
                 <div><small>Conformidades</small><strong>{results.conform}</strong><span>criterios conformes</span></div>
                 <div><small>No conformidades</small><strong>{results.nonConform}</strong><span>criterios no conformes</span></div>
                 <div><small>Hallazgos</small><strong>{results.findingsTotal}</strong><span>{results.findingsOpen} abiertos</span></div>
                 <div><small>Acciones pendientes</small><strong>{results.actionsOpen}</strong><span>{overdueActions} vencidas</span></div>
                 <div><small>Archivos READY</small><strong>{evidenceStorage.READY}</strong><span>disponibles</span></div>
                 <div><small>Archivos PENDING</small><strong>{evidenceStorage.PENDING}</strong><span>sincronización pendiente</span></div>
                 <div><small>Archivos FAILED</small><strong>{evidenceStorage.FAILED}</strong><span>requieren revisión</span></div>
                 <div><small>DELETE_PENDING</small><strong>{evidenceStorage.DELETE_PENDING}</strong><span>eliminación pendiente</span></div>
                 <div><small>Requisitos pendientes</small><strong>{closeBlockers.length}</strong><span>para poder cerrar</span></div>
               </div>
              {closeBlockers.length > 0 ? (
                <ul className="quality-close-blockers">
                  {closeBlockers.map((blocker) => (
                    <li key={blocker.reason}>
                      <span aria-hidden="true">✕</span>
                      <div>
                        <strong>{blocker.message}</strong>
                         <button type="button" className="text-button" onClick={() => goToCloseBlocker(blocker.section)}>Resolver en {sectionLabels[blocker.section]}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quality-close-ok" role="status">Condiciones de cierre cumplidas: criterios obligatorios evaluados, acciones finalizadas y eficacia verificada.</p>
              )}
              {closeWarnings.length > 0 && (
                <div className="quality-close-warnings" role="status">
                  <strong>Advertencias que no bloquean el cierre</strong>
                  <ul>{closeWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
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
              {!readonly && (
                <button type="button" className="button secondary" onClick={() => void generateChecklistWithAI()} disabled={busy || aiGenerating}>
                  {aiGenerating ? 'Preparando sugerencias…' : 'Sugerir con IA-Checky'}
                </button>
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
            {!readonly && audit.status !== 'IN_PROGRESS' && (
              <p className="quality-attention-note" role="status">La auditoría está planificada: puedes preparar el checklist, pero las respuestas se habilitan al iniciar la ejecución.</p>
            )}
            {!readonly && (
              <form onSubmit={saveChecklist} className="quality-inline-form">
                <input value={checklistDraft.name} onChange={(event) => setChecklistDraft({ name: event.target.value })} placeholder="Nombre de la lista" minLength={1} maxLength={160} required />
                <button type="submit" className="button secondary" disabled={busy}>Añadir lista</button>
              </form>
            )}
            {aiError && <p className="form-error" role="alert">{aiError}</p>}
            {aiMissingInformation.length > 0 && (
              <div className="quality-attention-note" role="status">
                <strong>Documentación incompleta:</strong> {aiMissingInformation.join(' ')}
              </div>
            )}
            {aiProposals.length > 0 && (
              <section className="quality-ai-review" aria-labelledby="quality-ai-review-title">
                <header className="quality-ai-review-head">
                  <div className="quality-ai-avatar-frame"><img src={checkyImage} alt="IA-Checky" /></div>
                  <div className="quality-ai-review-identity">
                    <p className="detail-label">REVISIÓN HUMANA</p>
                    <h3 id="quality-ai-review-title">IA-Checky</h3>
                    <p className="quality-ai-review-role">Tu consultor experto en auditorías y gestión por procesos</p>
                    <p className="quality-ai-review-welcome">Preparé estas preguntas para <strong>{audit.title}</strong>. Revisa cada propuesta y conserva solo las que tengan sentido para tu auditoría.</p>
                  </div>
                  <div className="quality-ai-review-count" aria-label={`${aiProposals.length} preguntas generadas`}>
                    <strong>{aiProposals.length}</strong>
                    <span>preguntas generadas</span>
                  </div>
                </header>

                <div className="quality-ai-review-toolbar">
                  <div className="quality-ai-review-filters" aria-label="Filtros de propuestas">
                    <label>Proceso
                      <select value={aiProcessFilter} onChange={(event) => setAIProcessFilter(event.target.value as AuditChecklistAIProcessFilter)} disabled={busy}>
                        <option value="ALL">Todos los procesos</option>
                        <option value="STRATEGIC">Estratégico</option>
                        <option value="MISSIONAL">Misional</option>
                        <option value="SUPPORT">Apoyo</option>
                      </select>
                    </label>
                    <label>Dimensión
                      <select value={aiDimensionFilter} onChange={(event) => setAIDimensionFilter(event.target.value as AuditChecklistAIProposal['dimension'] | 'ALL')} disabled={busy}>
                        <option value="ALL">Todas las dimensiones</option>
                        {(Object.keys(auditChecklistAIDimensionLabels) as AuditChecklistAIProposal['dimension'][]).map((dimension) => <option key={dimension} value={dimension}>{auditChecklistAIDimensionLabels[dimension]}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="quality-ai-review-selection-cluster" aria-label="Acciones de selección">
                    <div className="quality-ai-review-selection" aria-live="polite">
                      <strong>{selectedAIProposalCount} de {aiProposals.length}</strong> seleccionadas
                      <span>{visibleAIProposalCards.length} visibles</span>
                    </div>
                    <div className="quality-ai-review-bulk-actions">
                      <button type="button" className="text-button" onClick={() => setVisibleAISelection(true)} disabled={busy || visibleAIProposalCards.length === 0 || allVisibleAIProposalsSelected}>Seleccionar visibles</button>
                      <button type="button" className="text-button" onClick={() => setVisibleAISelection(false)} disabled={busy || visibleAIProposalCards.length === 0 || !visibleAIProposalCards.some(({ proposal }) => proposal.selected)}>Desmarcar visibles</button>
                    </div>
                  </div>
                </div>

                <div className="quality-ai-review-savebar">
                  <label>Lista de destino
                    <select value={aiChecklistId} onChange={(event) => setAIChecklistId(event.target.value)} disabled={busy}>
                      <option value="">Selecciona una lista</option>
                      {(audit.checklists ?? []).map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="button primary" onClick={() => void saveAIProposals()} disabled={busy || aiGenerating || !aiChecklistId || selectedAIProposalCount === 0} aria-busy={busy}>
                    {busy ? 'Guardando…' : <>Guardar seleccionadas <span aria-hidden="true">→</span></>}
                  </button>
                </div>

                {visibleAIProposalCards.length === 0 ? (
                  <div className="quality-ai-review-empty" role="status">
                    <span aria-hidden="true">⌕</span>
                    <strong>No hay propuestas con estos filtros</strong>
                    <p>Prueba otra combinación de proceso o dimensión. Tus ediciones y selecciones se conservan.</p>
                  </div>
                ) : (
                  <div className="quality-ai-proposal-grid">
                    {visibleAIProposalCards.map(({ proposal, context }, index) => {
                      const expanded = aiExpandedProposalIds.has(proposal.id)
                      return (
                        <article key={proposal.id} className={`quality-ai-proposal-card${proposal.selected ? ' is-selected' : ''}`}>
                          <div className="quality-ai-proposal-card-top">
                            <label className="quality-ai-proposal-select">
                              <input type="checkbox" checked={proposal.selected} onChange={(event) => updateAIProposal(proposal.id, { selected: event.target.checked })} disabled={busy} />
                              <span>Incluir propuesta</span>
                            </label>
                            <span className={`quality-ai-dimension quality-ai-dimension-${proposal.dimension.toLowerCase()}`}>{auditChecklistAIDimensionLabels[proposal.dimension]}</span>
                            <button type="button" className="text-button danger" onClick={() => void discardAIProposal(proposal.id)} disabled={busy}>Descartar</button>
                          </div>
                          <div className="quality-ai-question-field">
                            <span className="quality-ai-card-kicker">Pregunta {index + 1}</span>
                            <textarea aria-label={`Pregunta propuesta ${index + 1}`} value={proposal.question} onChange={(event) => updateAIProposal(proposal.id, { question: event.target.value })} rows={3} maxLength={2000} disabled={busy} />
                          </div>
                          <div className="quality-ai-proposal-context">
                            <div><span>Proceso</span><strong>{context.process ?? 'No identificado en la fuente'}</strong></div>
                            <div><span>{context.procedure ? 'Procedimiento' : 'Origen documental'}</span><strong>{context.procedure ?? `${context.sourceTypeLabel} · ${context.source}`}</strong></div>
                          </div>
                          <button type="button" className="quality-ai-details-toggle" aria-expanded={expanded} aria-controls={`quality-ai-details-${proposal.id}`} onClick={() => toggleAIProposalDetails(proposal.id)}>
                            <span>{expanded ? 'Ocultar evidencia y fuente' : 'Ver evidencia y fuente'}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
                          </button>
                          {expanded && (
                            <div id={`quality-ai-details-${proposal.id}`} className="quality-ai-proposal-details">
                              <label>Evidencia esperada
                                <textarea value={proposal.expectedEvidence} onChange={(event) => updateAIProposal(proposal.id, { expectedEvidence: event.target.value })} rows={3} maxLength={1600} disabled={busy} />
                              </label>
                              <label>Fuente documental
                                <input value={proposal.source} onChange={(event) => updateAIProposal(proposal.id, { source: event.target.value })} maxLength={240} disabled={busy} />
                              </label>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )}
            {(audit.checklists ?? []).length === 0 ? (
              <p className="muted">Sin listas de verificación todavía.</p>
            ) : (
              (audit.checklists ?? []).map((checklist) => (
                <div key={checklist.id} className="quality-checklist">
                  <div className="quality-checklist-header">
                    <h3>{checklist.name}</h3>
                    {!readonly && (
                      <div className="quality-checklist-actions">
                        <button type="button" className="button secondary small-button" onClick={() => openNewChecklistItem(checklist.id)}>Nueva pregunta</button>
                        <button type="button" className="text-button danger" onClick={() => void removeChecklist(checklist)}>Eliminar</button>
                      </div>
                    )}
                  </div>
                  {checklist.items.length === 0 ? (
                    <p className="muted">Sin ítems.</p>
                  ) : (
                    <div className="quality-items">
                      {checklist.items.map((item) => {
                        const context = checklistItemContext(item.criteria)
                        const editingResponse = responseEditorFor === item.id
                        const cardClasses = [
                          'quality-item-card',
                          item.result === 'NON_CONFORM' ? 'is-non-conform' : '',
                          item.required && item.result === 'PENDING' ? 'is-required-pending' : '',
                          highlightItemId === item.id ? 'is-highlight' : '',
                        ].filter(Boolean).join(' ')
                        return (
                          <article key={item.id} id={`quality-item-${item.id}`} className={cardClasses}>
                            <div className="quality-item-card-header">
                              <div className="quality-item-question">
                                <span className="quality-item-number" aria-hidden="true">{String(item.position).padStart(2, '0')}</span>
                                <div>
                                  <div className="quality-item-kicker"><span>Pregunta de verificación</span><span className={`quality-item-origin-badge ${context.origin.toLowerCase()}`}>{context.origin}</span>{item.required && <span className="quality-required-badge">Obligatorio</span>}</div>
                                  <h4>{item.description}</h4>
                                </div>
                              </div>
                              <div className="quality-item-response">
                                <span className="quality-item-label">Respuesta seleccionada</span>
                                {editingResponse ? (
                                  <select className="quality-item-result-select" value={item.result} onChange={(event) => void updateItemResult(checklist.id, item, event.target.value as typeof checklistResults[number], item.observations ?? '')} aria-label={`Resultado de ${item.description.slice(0, 40)}`}>
                                    {checklistResults.map((result) => <option key={result} value={result}>{checklistResultLabels[result]}</option>)}
                                  </select>
                                ) : (
                                  <span className={`quality-result-badge ${item.result.toLowerCase()}`}>{checklistResultLabels[item.result]}</span>
                                )}
                              </div>
                            </div>
                            <div className="quality-item-context" aria-label="Contexto de verificación">
                              <div><span>Criterio de verificación</span><p>{context.verification}</p></div>
                              <div><span>Fuente documental</span><p>{context.source}</p></div>
                              <div><span>Dimensión</span><p>{context.dimension}</p></div>
                            </div>
                            <div className="quality-item-observation-block">
                              <div className="quality-item-observation-heading">
                                <span className="quality-item-label">Observación</span>
                                {!checklistResponseReadonly && !observationsFor && (
                                  <button type="button" className="quality-item-subtle-button" onClick={() => { setObservationsFor({ checklistId: checklist.id, itemId: item.id }); setObservationsDraft(item.observations ?? '') }}>
                                    {item.observations ? 'Editar observación' : 'Añadir observación'}
                                  </button>
                                )}
                              </div>
                              {observationsFor?.itemId === item.id ? (
                                <span className="quality-observations-editor">
                                  <textarea value={observationsDraft} onChange={(event) => setObservationsDraft(event.target.value)} maxLength={2000} rows={2} placeholder="Observaciones del criterio…" aria-label="Observaciones" />
                                  <span className="quality-observations-editor-actions">
                                    <button type="button" className="button secondary small-button" disabled={busy} onClick={() => void saveObservations()}>Guardar observación</button>
                                    <button type="button" className="quality-item-subtle-button" onClick={() => { setObservationsFor(null); setObservationsDraft('') }}>Cancelar</button>
                                  </span>
                                </span>
                              ) : (
                                <p>{item.observations || 'Sin observación registrada.'}</p>
                              )}
                            </div>
                            <div className="quality-item-actions" aria-label="Acciones de la pregunta">
                              {!checklistResponseReadonly && (
                                <button type="button" className="button secondary small-button quality-item-action" onClick={() => setResponseEditorFor((current) => current === item.id ? null : item.id)}>
                                  <span className="quality-item-action-icon" aria-hidden="true">↻</span>{editingResponse ? 'Cerrar edición' : 'Editar respuesta'}
                                </button>
                              )}
                              {!readonly && (
                                <>
                                  <button type="button" className="button secondary small-button quality-item-action" onClick={() => openEditChecklistItem(checklist.id, item)}>
                                    <span className="quality-item-action-icon" aria-hidden="true">✎</span>Editar pregunta
                                  </button>
                                  <button type="button" className="button primary small-button quality-item-action" onClick={() => startFinding(item.id)}>
                                    <span className="quality-item-action-icon" aria-hidden="true">△</span>Gestionar hallazgo
                                  </button>
                                  <button type="button" className="quality-item-delete" aria-label={`Eliminar pregunta ${item.description.slice(0, 40)}`} onClick={() => void removeItem(checklist.id, item)}>×</button>
                                </>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          {itemFor && (
            <div className="drawer-backdrop centered-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setItemFor(null); setItemError('') } }}>
              <form className="drawer centered-modal company-modal checklist-item-modal" onSubmit={saveItem} noValidate role="dialog" aria-modal="true" aria-labelledby="checklist-item-modal-title" aria-describedby={itemError ? 'checklist-item-error' : undefined}>
                <div className="company-modal-header">
                  <div className="company-modal-icon checklist-item-modal-icon">?</div>
                  <div className="company-modal-title">
                    <p className="eyebrow">{itemFor.item ? 'EDITAR PREGUNTA' : 'NUEVA PREGUNTA'}</p>
                    <h2 id="checklist-item-modal-title">{itemFor.item ? 'Editar pregunta de verificación' : 'Crear pregunta manual'}</h2>
                    <p className="company-modal-subtitle">Redacta una pregunta clara para esta lista. La respuesta quedará disponible cuando la auditoría esté en curso.</p>
                  </div>
                  <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => { setItemFor(null); setItemError('') }}>×</button>
                </div>
                {itemError && <p id="checklist-item-error" className="form-error" role="alert">{itemError}</p>}
                <label>Pregunta de verificación
                  <textarea value={itemDraft.description} onChange={(event) => { setItemError(''); setItemDraft((current) => ({ ...current, description: event.target.value })) }} placeholder="¿Qué debe comprobar el auditor?" minLength={1} maxLength={2000} rows={3} required autoFocus />
                </label>
                <label>Criterio de verificación
                  <textarea value={itemDraft.criteria} onChange={(event) => { setItemError(''); setItemDraft((current) => ({ ...current, criteria: event.target.value })) }} placeholder="Describe qué debe cumplirse o revisarse." minLength={1} maxLength={2000} rows={3} required />
                </label>
                <div className="form-grid checklist-item-context-fields">
                  <label>Fuente documental <span className="field-optional">Opcional</span>
                    <input value={itemDraft.source} onChange={(event) => setItemDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Manual, procedimiento o registro" maxLength={240} />
                  </label>
                  <label>Dimensión <span className="field-optional">Opcional</span>
                    <select value={itemDraft.dimension} onChange={(event) => setItemDraft((current) => ({ ...current, dimension: event.target.value as ChecklistItemDraft['dimension'] }))}>
                      <option value="">Sin especificar</option>
                      {(Object.entries(auditChecklistAIDimensionLabels) as Array<[AuditChecklistAIDimension, string]>).map(([dimension, label]) => <option key={dimension} value={dimension}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="checklist-item-origin-note">
                  <span className="checklist-item-origin-mark" aria-hidden="true">{itemDraft.origin === 'CHECKY' ? '✦' : '✎'}</span>
                  <span><strong>Origen: {itemDraft.origin === 'CHECKY' ? 'CHECKY' : 'MANUAL'}</strong><small>{itemDraft.origin === 'CHECKY' ? 'Se conserva el origen de la sugerencia asistida.' : 'Pregunta redactada por el equipo auditor.'}</small></span>
                </div>
                <label className="checklist-item-required-toggle"><input type="checkbox" checked={itemDraft.required} onChange={(event) => setItemDraft((current) => ({ ...current, required: event.target.checked }))} /><span><strong>Pregunta obligatoria</strong><small>Bloquea el cierre hasta que tenga una respuesta.</small></span></label>
                <div className="drawer-actions">
                  <button type="button" className="button secondary" onClick={() => { setItemFor(null); setItemError('') }}>Cancelar</button>
                  <button type="submit" className="button primary" disabled={busy}>{busy ? 'Guardando…' : itemFor.item ? 'Guardar cambios' : 'Crear pregunta'}</button>
                </div>
              </form>
            </div>
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
                <article key={finding.id} className={`quality-finding quality-finding-card quality-finding-${finding.type.toLowerCase()} quality-finding-${finding.status.toLowerCase()}`}>
                  <div className="quality-finding-card-main">
                    <header className="quality-finding-header">
                      <div className="quality-finding-title-block">
                        <span className="quality-finding-kicker">Hallazgo</span>
                        <h3>{finding.title}</h3>
                        <div className="quality-finding-badges" aria-label="Clasificación del hallazgo">
                          <span className={`quality-finding-type ${finding.type.toLowerCase()} quality-finding-badge type`}>{findingTypeLabels[finding.type]}</span>
                          <span className={`quality-finding-badge severity ${finding.severity.toLowerCase()}`}>{findingSeverityLabels[finding.severity]}</span>
                          <span className={`quality-finding-badge status ${finding.status.toLowerCase()}`}>{findingStatusLabels[finding.status]}</span>
                        </div>
                      </div>
                      {!readonly && (
                        <div className="quality-finding-header-actions">
                          <div className="quality-finding-transitions">
                            {findingTransitions[finding.status].map((transition) => (
                              <button key={transition.to} type="button" className={`button small-button ${transition.to === 'RESOLVED' || transition.to === 'VERIFIED' ? 'primary' : 'secondary'}`} disabled={busy} onClick={() => void changeFindingStatus(finding, transition.to)}>{transition.label}</button>
                            ))}
                          </div>
                          <details className="quality-finding-menu">
                            <summary className="quality-finding-menu-trigger" aria-label={`Más acciones para ${finding.title}`}><span aria-hidden="true">•••</span><span>Más</span></summary>
                            <div className="quality-finding-menu-panel">
                              <button type="button" onClick={() => { setFindingFor({ finding }); setFindingDraft(draftFromFinding(finding)) }}>Editar</button>
                              <button type="button" onClick={() => startAction(finding.id)}>+ Acción</button>
                              {finding.status !== 'VERIFIED' && <button type="button" className="danger" onClick={() => void removeFinding(finding)}>Eliminar</button>}
                            </div>
                          </details>
                        </div>
                      )}
                    </header>

                    <div className="quality-finding-body">
                      <p className="quality-finding-description">{finding.description}</p>
                      {finding.resolution && <p className="quality-finding-note"><strong>Resolución</strong>{finding.resolution}</p>}
                      {finding.efficacyVerification && <p className="quality-finding-note"><strong>Verificación de eficacia</strong>{finding.efficacyVerification}</p>}
                      {finding.type === 'NONCONFORMITY' && finding.status === 'RESOLVED' && (!finding.efficacyVerification || finding.efficacyVerification.trim().length < 3) && !readonly && (
                        <button type="button" className="text-button quality-finding-efficacy-link" onClick={() => { setFindingFor({ finding }); setFindingDraft(draftFromFinding(finding)) }}>Registrar verificación de eficacia</button>
                      )}
                    </div>

                    <section className="quality-finding-origin" aria-label="Origen y seguimiento">
                      <div className="quality-finding-origin-heading"><span>Origen y seguimiento</span><span className="quality-finding-origin-rule" aria-hidden="true" /></div>
                      <div className="quality-finding-origin-grid">
                        <div>
                          <span>Criterio</span>
                          {finding.item ? <p title={finding.item.description}>{finding.item.description}</p> : <p className="is-empty">Sin criterio vinculado</p>}
                          {finding.item && <button type="button" className="text-button" onClick={() => goToChecklistItem(finding.item!.id)}>Ver criterio</button>}
                        </div>
                        <div>
                          <span>Proceso</span>
                          <p className={finding.process ? '' : 'is-empty'}>{finding.process ? `${finding.process.code} · ${finding.process.name}` : 'No vinculado'}</p>
                        </div>
                        <div>
                          <span>Procedimiento</span>
                          <p className={finding.procedure ? '' : 'is-empty'}>{finding.procedure ? `${finding.procedure.code} · ${finding.procedure.name}` : 'No vinculado'}</p>
                        </div>
                      </div>
                    </section>

                    <footer className="quality-finding-footer">
                      <div className="quality-finding-links">
                        <button type="button" className="quality-finding-link" onClick={() => selectEvidenceContext({ findingId: finding.id })}>
                          <span className="quality-finding-link-icon" aria-hidden="true">▧</span>
                          <span>{evidenceCountFor({ findingId: finding.id }) > 0 ? `Evidencias (${evidenceCountFor({ findingId: finding.id })})` : 'Añadir evidencia'}</span>
                        </button>
                        <button type="button" className="quality-finding-link" onClick={goToActions}>
                          <span className="quality-finding-link-icon" aria-hidden="true">↗</span>
                          <span>{(finding.actions ?? []).length > 0 ? `${(finding.actions ?? []).length} acción(es) · ${(finding.actions ?? []).filter((action) => action.status !== 'COMPLETED' && action.status !== 'CANCELLED').length} abierta(s)` : 'Sin acciones correctivas'}</span>
                        </button>
                      </div>
                    </footer>
                  </div>
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
                  {findingDraft.itemId && (
                    <div className="procedure-field-wide quality-finding-criterion">
                      <strong>Criterio incumplido</strong>
                      <span>{(audit.checklists ?? []).flatMap((checklist) => checklist.items).find((item) => item.id === findingDraft.itemId)?.criteria ?? 'Criterio no disponible'}</span>
                    </div>
                  )}
                  <label className="procedure-field-wide">Descripción y evidencia objetiva
                    <textarea value={findingDraft.description} onChange={(event) => setFindingDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={5000} required rows={3} placeholder="Describe el hallazgo y la evidencia objetiva constatada (qué se observó, dónde y cuándo)." />
                </label>
                  <label>Tipo
                    <select value={findingDraft.type} onChange={(event) => setFindingDraft((current) => ({ ...current, type: event.target.value as FindingDraft['type'] }))} disabled={Boolean(pendingNonConformity)}>
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
                    {findingUsers.map((person) => <option key={person.id} value={person.id}>{userOptionLabel(person)}</option>)}
                  </select>
                </label>
                <label>Fecha límite
                  <input type="date" value={findingDraft.dueDate} onChange={(event) => setFindingDraft((current) => ({ ...current, dueDate: event.target.value }))} />
                </label>
                  <label>Ítem de checklist
                    <select value={findingDraft.itemId} onChange={(event) => setFindingDraft((current) => ({ ...current, itemId: event.target.value }))} disabled={Boolean(pendingNonConformity)}>
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
                  <button type="button" className="button secondary" onClick={cancelFinding}>Cancelar</button>
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
                <p className="detail-label">ARCHIVOS DE EVIDENCIA</p>
                <h2>PDFs adjuntos</h2>
                <p className="quality-evidence-context">
                  {hasEvidenceFilter ? <><span>Hallazgo asociado</span> {evidenceContextLabel(evidenceFilter!)}</> : `${evidenceCount} PDF(s) adjunto(s)`}
                </p>
              </div>
              <div>
                {!readonly && (
                  <button type="button" className="button primary quality-evidence-add-button" onClick={() => setUploadFor(hasEvidenceFilter ? evidenceFilter : {})}>
                    <span aria-hidden="true">+</span> Añadir PDF
                  </button>
                )}
              </div>
            </div>
            {activeStorageOperations.length > 0 && (
              <div className="notice" role="status">
                <strong>Operaciones de almacenamiento</strong>
                <ul>
                  {activeStorageOperations.map((operation) => (
                    <li key={operation.id}>Operación {operation.operationType === 'UPLOAD' ? 'de carga' : 'de eliminación'}: {storageOperationStatusLabels[operation.status]}{operation.lastErrorCode ? ` · ${operation.lastErrorCode}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
            {visibleEvidenceCount === 0 ? (
              <div className="quality-evidence-empty" role="status">
                <span className="quality-evidence-empty-icon" aria-hidden="true">▧</span>
                <strong>Aún no hay evidencias adjuntas</strong>
                <p>Adjunta un PDF para documentar los resultados de esta auditoría.</p>
              </div>
            ) : (
              <ul className="quality-evidence-list">
                {filteredEvidenceFiles.map((file) => (
                  <li key={file.id} className="quality-evidence-card">
                    <div className="quality-evidence-card-header">
                      <div className="quality-evidence-file-heading">
                        <span className="quality-evidence-pdf-mark" aria-hidden="true">PDF</span>
                        <div className="quality-evidence-file-info">
                          <a className="quality-evidence-file-name" href={apiUrl(`/audits/${audit.id}/evidence-files/${file.id}`)} download={file.filename}>{file.filename}</a>
                          <p>{formatBytes(file.size)} · {file.uploadedBy?.name ?? '—'} · {formatMaybeDate(file.createdAt)}</p>
                        </div>
                      </div>
                      <span className={`quality-evidence-status quality-evidence-status-${file.storageState.toLowerCase()}`}>
                        {evidenceStorageStateLabels[file.storageState]}
                      </span>
                    </div>
                    <div className="quality-evidence-relation">
                      <span>Hallazgo asociado</span>
                      <strong>{evidenceFileRelationLabel(file, audit)}</strong>
                    </div>
                    {file.storageState !== 'READY' && (
                      <p className={`quality-evidence-storage quality-evidence-storage-${file.storageState.toLowerCase()}`}>
                        {evidenceStorageStateMessages[file.storageState]}
                      </p>
                    )}
                    <div className="quality-evidence-card-actions">
                      <a className="button secondary small-button" href={apiUrl(`/audits/${audit.id}/evidence-files/${file.id}`)} download={file.filename}>Descargar</a>
                      {!readonly && <button type="button" className="button secondary small-button quality-evidence-delete" onClick={() => void removeFile(file.id)}>Eliminar</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {uploadFor && !readonly && (
              <form onSubmit={uploadFile} className="quality-inline-form">
                <label>Archivo PDF
                  <input type="file" name="file" accept="application/pdf,.pdf" required />
                </label>
                <label>Anclar a
                  <select
                    value={uploadFor.findingId ? `finding:${uploadFor.findingId}` : uploadFor.actionId ? `action:${uploadFor.actionId}` : uploadFor.itemId ? `item:${uploadFor.itemId}` : ''}
                    onChange={(event) => {
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
                {uploading && <span className="quality-upload-progress" role="status" aria-live="polite">
                  {uploadProgress === null ? 'Subiendo…' : `Subiendo… ${uploadProgress}%`}
                </span>}
                <button type="submit" className="button primary" disabled={uploading}>{uploading ? 'Subiendo…' : 'Adjuntar PDF'}</button>
                <button type="button" className="button secondary" onClick={() => setUploadFor(null)}>Cancelar</button>
              </form>
            )}
          </section>
        </div>
      )}

      {activeSection === 'acciones' && (
        <div role="tabpanel" id="quality-panel-acciones" aria-labelledby="quality-tab-acciones" tabIndex={0} className="quality-tab-panel">
          <section id="quality-actions" className="panel quality-actions-section">
            <div className="panel-heading">
              <div>
                <p className="detail-label">ACCIONES CORRECTIVAS</p>
                <h2>Seguimiento de acciones</h2>
                <p className="quality-actions-subtitle">Convierte cada hallazgo en un compromiso claro, asignado y verificable.</p>
              </div>
              {!readonly && audit.findings.length > 0 && allActions.length > 0 && (
                <button type="button" className="button primary quality-new-action-button" onClick={() => startAction(audit.findings[0].id)}>Nueva acción</button>
              )}
            </div>
            {!readonly && audit.findings.length === 0 && <p className="muted">Registra un hallazgo primero para poder crear acciones correctivas.</p>}
            {overdueActions > 0 && <p className="quality-attention-note" role="status">{overdueActions} acción(es) vencida(s): revisa fechas límite y estados.</p>}
            {allActions.length === 0 ? (
              <div className="quality-actions-empty" role="status">
                <span className="quality-actions-empty-icon" aria-hidden="true">↗</span>
                <strong>Aún no hay acciones correctivas</strong>
                <p>{audit.findings.length > 0 ? 'Registra la primera acción para dar seguimiento a los hallazgos de esta auditoría.' : 'Cuando exista un hallazgo, podrás asignar y seguir una acción desde aquí.'}</p>
                {!readonly && audit.findings.length > 0 && (
                  <button type="button" className="button primary" onClick={() => startAction(audit.findings[0].id)}>Nueva acción</button>
                )}
              </div>
            ) : (
              <div className="quality-actions-list">
                {allActions.map(({ action, finding }) => {
                  const overdue = isAuditActionOverdue(action)
                  return (
                    <article id={`quality-action-${action.id}`} key={action.id} className={`quality-action-card${overdue ? ' is-overdue' : ''}`}>
                      <header className="quality-action-card-header">
                        <div className="quality-action-card-title">
                          <span className="quality-action-kicker">Acción correctiva</span>
                          <strong>{action.title}</strong>
                          <p><span>Hallazgo asociado</span>{finding.title}</p>
                        </div>
                        <div className="quality-action-badges">
                          {overdue && <span className="quality-overdue-badge">Vencida</span>}
                          <span className={`badge quality-status ${action.status.toLowerCase()}`}>{actionStatusLabels[action.status]}</span>
                          <span className="badge priority">{actionPriorityLabels[action.priority]}</span>
                          {action.required && <span className="quality-required-badge">Obligatoria</span>}
                        </div>
                      </header>
                      <p className="quality-action-description">{action.description}</p>
                      <div className="quality-action-meta">
                        <div><span>Responsable</span><strong>{action.responsible ? userOptionLabel(action.responsible) : 'Sin asignar'}</strong></div>
                        <div><span>Fecha límite</span><strong>{formatMaybeDate(action.dueDate)}</strong></div>
                        {action.completedAt && <div><span>Completada</span><strong>{formatMaybeDate(action.completedAt)}</strong></div>}
                      </div>
                      {action.progress.length > 0 && (
                        <ul className="quality-action-progress" aria-label="Avances registrados">
                          {action.progress.map((entry) => (
                            <li key={entry.id}>{entry.note}{entry.percent !== null ? ` (${entry.percent}%)` : ''} <span className="muted">{formatMaybeDate(entry.createdAt)}</span></li>
                          ))}
                        </ul>
                      )}
                      {!readonly && (
                        <div className="quality-action-controls">
                          {actionTransitions[action.status].map((transition) => (
                            <button key={transition.to} type="button" className="button secondary small-button" disabled={busy} onClick={() => void applyActionStatus(action, transition.to)}>{transition.label}</button>
                          ))}
                          {action.status !== 'COMPLETED' && action.status !== 'CANCELLED' && (
                            <>
                              <button type="button" className="button secondary small-button" onClick={() => void addProgress(action)}>+ Avance</button>
                              <button type="button" className="button secondary small-button" onClick={() => { setActionFor({ findingId: finding.id, action }); setActionDraft({ title: action.title, description: action.description, responsibleId: action.responsible?.id ?? '', priority: action.priority, required: action.required, dueDate: action.dueDate ? action.dueDate.slice(0, 10) : '' }) }}>Editar</button>
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
            <div className="drawer-backdrop centered-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionFor(null) }}>
              <form className="drawer centered-modal company-modal quality-action-modal" onSubmit={saveAction} role="dialog" aria-modal="true" aria-labelledby="quality-action-modal-title">
                <div className="company-modal-header">
                  <div className="company-modal-icon quality-action-modal-icon" aria-hidden="true">↗</div>
                  <div className="company-modal-title">
                    <p className="eyebrow">{actionFor.action ? 'EDITAR ACCIÓN' : 'NUEVA ACCIÓN'}</p>
                    <h2 id="quality-action-modal-title">{actionFor.action ? 'Editar acción correctiva' : 'Crear acción correctiva'}</h2>
                    <p className="company-modal-subtitle">Define el siguiente paso, quién lo ejecuta y cuándo debe estar listo.</p>
                  </div>
                  <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setActionFor(null)}>×</button>
                </div>
                <div className="quality-action-modal-body">
                  <label className="quality-action-field-wide">Hallazgo asociado
                    {actionFor.action ? (
                      <div className="quality-action-associated" title={audit.findings.find((finding) => finding.id === actionFor.findingId)?.title}>
                        <span aria-hidden="true">!</span>
                        <strong>{audit.findings.find((finding) => finding.id === actionFor.findingId)?.title ?? 'Hallazgo no disponible'}</strong>
                      </div>
                    ) : (
                      <select className="quality-action-finding-select" value={actionFor.findingId} onChange={(event) => setActionFor({ ...actionFor, findingId: event.target.value })}>
                        {audit.findings.map((finding) => <option key={finding.id} value={finding.id}>{finding.title}</option>)}
                      </select>
                    )}
                  </label>
                  <label className="quality-action-field-wide">Título
                    <input value={actionDraft.title} onChange={(event) => setActionDraft((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={200} required autoFocus />
                  </label>
                  <label className="quality-action-field-wide">Descripción
                    <textarea value={actionDraft.description} onChange={(event) => setActionDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={5000} required rows={4} placeholder="Describe el resultado esperado y el trabajo necesario." />
                  </label>
                  <div className="quality-action-modal-grid">
                    <label>Responsable
                      <select value={actionDraft.responsibleId} onChange={(event) => setActionDraft((current) => ({ ...current, responsibleId: event.target.value }))}>
                        <option value="">Sin asignar</option>
                        {actionUsers.map((person) => <option key={person.id} value={person.id}>{userOptionLabel(person)}</option>)}
                      </select>
                    </label>
                    <label>Prioridad
                      <select value={actionDraft.priority} onChange={(event) => setActionDraft((current) => ({ ...current, priority: event.target.value as ActionDraft['priority'] }))}>
                        {(Object.keys(actionPriorityLabels) as Array<ActionDraft['priority']>).map((priority) => <option key={priority} value={priority}>{actionPriorityLabels[priority]}</option>)}
                      </select>
                    </label>
                    <label>Fecha límite
                      <input type="date" value={actionDraft.dueDate} onChange={(event) => setActionDraft((current) => ({ ...current, dueDate: event.target.value }))} />
                    </label>
                  </div>
                  <label className="quality-action-required-toggle">
                    <input type="checkbox" checked={actionDraft.required} onChange={(event) => setActionDraft((current) => ({ ...current, required: event.target.checked }))} />
                    <span><strong>Acción obligatoria</strong><small>Impide cerrar la auditoría hasta que esta acción esté completada o cancelada.</small></span>
                  </label>
                </div>
                <div className="drawer-actions">
                  <button type="button" className="button secondary" onClick={() => setActionFor(null)}>Cancelar</button>
                  <button type="submit" className="button primary" disabled={busy}>{busy ? 'Guardando…' : actionFor.action ? 'Guardar cambios' : 'Crear acción'}</button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {activeSection === 'historial' && (
        <div role="tabpanel" id="quality-panel-historial" aria-labelledby="quality-tab-historial" tabIndex={0} className="quality-tab-panel">
          <section id="quality-history" className="panel risk-history-section" aria-label="Historial de la auditoría">
            <div className="panel-heading risk-history-heading">
              <div>
                <p className="detail-label">TRAZABILIDAD</p>
                <h2>HISTORIAL DE LA AUDITORÍA</h2>
              </div>
              <div className="risk-history-tools">
                {!historyLoadingForCurrentAudit && historyLoadedForCurrentAudit && <span className="risk-history-count">{history.length} {history.length === 1 ? 'evento' : 'eventos'}</span>}
                {!historyLoadedForCurrentAudit && !historyLoadingForCurrentAudit && <button type="button" className="button secondary small-button" onClick={() => void loadHistory()}>Cargar historial</button>}
                <button type="button" className="text-button" aria-expanded={historyOpen} aria-controls="quality-history-list" onClick={() => setHistoryOpen((current) => !current)}>
                  {historyOpen ? 'Ocultar historial' : 'Ver historial'}
                </button>
              </div>
            </div>
            <div id="quality-history-list" hidden={!historyOpen}>
              {historyError ? (
                <div className="form-error page-alert" role="alert"><span>{historyError}</span><button type="button" className="button secondary small-button" onClick={() => void loadHistory()}>Reintentar</button></div>
              ) : historyLoadingForCurrentAudit ? (
                <div className="inline-loading"><span className="loader" />Cargando historial...</div>
              ) : !historyLoadedForCurrentAudit ? (
                <div className="risk-history-empty"><span className="history-empty-icon" aria-hidden="true">◷</span><p>El historial es de solo lectura y lo escribe el servidor.</p></div>
              ) : history.length === 0 ? (
                <div className="risk-history-empty"><span className="history-empty-icon" aria-hidden="true">◷</span><p>Todavía no hay eventos registrados para esta auditoría.</p></div>
              ) : (
                <div className="risk-history-list">
                  {history.map((event) => {
                    const comment = typeof event.metadata?.comment === 'string' ? event.metadata.comment : null
                    const presentation = auditHistoryPresentation(event)
                    return (
                      <article key={event.id} className="risk-history-entry">
                        <div className="risk-history-marker" aria-hidden="true"><span className="risk-history-glyph">{auditHistoryGlyph(event.eventType)}</span></div>
                        <div className="risk-history-body">
                          <header className="risk-history-header">
                            <div>
                              <span className={`risk-history-chip risk-history-chip-${event.eventType.toLowerCase()}`}>{auditHistoryCategory(event.eventType)}</span>
                              <h3>{presentation.title}</h3>
                              {presentation.detail && <p className="quality-history-detail">{presentation.detail}</p>}
                            </div>
                            <time dateTime={event.occurredAt}>{dateFormatter.format(new Date(event.occurredAt))}</time>
                          </header>
                          <p className="risk-history-actor">Registrado por: <strong>{event.actorName ?? event.actor?.name ?? 'Sistema'}</strong>{event.actorEmail && <span> · {event.actorEmail}</span>}</p>
                          {event.changes.length > 0 && (
                            <div className="history-change-list">
                              {event.changes.map((change) => (
                                <div className="history-change" key={`${event.id}-${change.field}`}>
                                  <span>{change.label}</span>
                                  <strong>{auditHistoryValue(change.previousValue)}</strong>
                                  <b aria-hidden="true">→</b>
                                  <strong>{auditHistoryValue(change.newValue)}</strong>
                                </div>
                              ))}
                            </div>
                          )}
                          {comment && <p className="risk-history-comment">Motivo: «{comment}»</p>}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Procedure, ProcedureStatus, ProcedureVersion, Process, ProcessChangeItem, ProcessChangeValue, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { activeUserOptions, userOptionLabel } from '../../user-status'
import { ProcedureIndicatorSection } from './ProcedureIndicatorSection'
import { ProcedurePreview } from './ProcedurePreview'
import { ProcedureStepsSection } from './ProcedureStepsSection'
import { procedureIndicatorEntryFromIndicator, type ProcedureIndicatorEntry } from './procedure-indicator.model'
import { procedureStepEntryFromStep, procedureStepPayloadOf, type ProcedureStepEntry } from './procedure-step.model'

export type ProcedureUser = Pick<User, 'id' | 'name' | 'isActive'> & { companyId: string | null }

const procedureStatusLabels: Record<ProcedureStatus, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  APPROVED: 'Aprobado',
  OBSOLETE: 'Obsoleto',
}

const procedureActionLabels: Record<ProcedureVersion['action'], string> = {
  CREATED: 'Procedimiento creado',
  UPDATED: 'Procedimiento actualizado',
  STATUS_CHANGED: 'Cambio de estado',
}

export type ProcedureDraft = {
  name: string
  objective: string
  scope: string
  description: string
  responsibleId: string
  steps: ProcedureStepEntry[]
  indicators: ProcedureIndicatorEntry[]
}

const emptyProcedureDraft: ProcedureDraft = {
  name: '', objective: '', scope: '', description: '', responsibleId: '', steps: [], indicators: [],
}

const draftFromProcedure = (procedure: Procedure): ProcedureDraft => ({
  name: procedure.name,
  objective: procedure.objective,
  scope: procedure.scope,
  description: procedure.description ?? '',
  responsibleId: procedure.responsible?.id ?? '',
  steps: procedure.steps?.map(procedureStepEntryFromStep) ?? [],
  indicators: procedure.indicators?.map(procedureIndicatorEntryFromIndicator) ?? [],
})

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const procedureSnapshotStepsOf = (snapshot: ProcedureVersion['snapshot']) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.steps)) return []
  return snapshot.steps.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object' && !Array.isArray(step))
}

const changeValueLabel = (change: ProcessChangeItem, value: ProcessChangeValue) => {
  if (change.field === 'status') return procedureStatusLabels[value as ProcedureStatus] ?? String(value)
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value
}

function documentCompletionOf(draft: ProcedureDraft) {
  const values = [draft.name, draft.objective, draft.scope, ...draft.steps.flatMap((step) => [step.title, step.instruction])]
  const completed = values.filter((value) => value.trim()).length
  const recommendations = [
    draft.steps.length === 0 ? 'Añade la secuencia operativa.' : '',
    draft.description.trim() ? '' : 'La descripción contextual aún está vacía.',
  ].filter(Boolean)
  return { completed, total: values.length, recommendations }
}

type ProcedureFormProps = {
  processId: string
  procedureId?: string
  processName: string
  processCode: string | null
  draft: ProcedureDraft
  setDraft: React.Dispatch<React.SetStateAction<ProcedureDraft>>
  users: ProcedureUser[]
  editing: boolean
  procedureCode: string | null
  procedureCodeLoading: boolean
  procedureCodeError: string
  onRetryProcedureCode: () => void
  procedureStatus: ProcedureStatus
  procedureVersion: string
  responsibleName: string
  formDirty: boolean
  saving: boolean
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onDirty: () => void
  onRefresh: () => Promise<void>
  history: ProcedureVersion[]
  historyLoading: boolean
  historyError: string
  onLoadHistory: () => void
  historyUsers: ProcedureUser[]
}

function ProcedureForm({ processId, procedureId, processName, processCode, draft, setDraft, users, editing, procedureCode, procedureCodeLoading, procedureCodeError, onRetryProcedureCode, procedureStatus, procedureVersion, responsibleName, formDirty, saving, error, onSubmit, onClose, onDirty, onRefresh, history, historyLoading, historyError, onLoadHistory, historyUsers }: ProcedureFormProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'steps' | 'indicators' | 'history'>('general')
  const [previewOpen, setPreviewOpen] = useState(false)
  const displayedProcedureCode = procedureCode ?? (procedureCodeLoading ? 'Consultando...' : 'Código no disponible')
  const completion = documentCompletionOf(draft)
  const update = <K extends keyof ProcedureDraft>(field: K, value: ProcedureDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    onDirty()
  }
  const tabClass = (tab: string) => `procedure-form-tab${activeTab === tab ? ' active' : ''}`

  return (
    <form className="procedure-form procedure-workspace panel" onSubmit={onSubmit}>
      <header className="procedure-form-header">
        <div className="procedure-document-heading">
          <p className="eyebrow">GESTIÓN POR PROCESOS / DOCUMENTO OPERATIVO</p>
          <div className="procedure-document-title"><span>{displayedProcedureCode}</span><h2>{draft.name || (editing ? 'Procedimiento sin nombre' : 'Nuevo procedimiento')}</h2></div>
          <div className="procedure-document-meta"><span>Proceso: <strong>{processCode ? `${processCode} · ` : ''}{processName}</strong></span><span>Responsable: <strong>{responsibleName}</strong></span><span className={`procedure-status ${procedureStatus.toLowerCase()}`}>{procedureStatusLabels[procedureStatus]}</span><span>v{procedureVersion}</span></div>
        </div>
        <div className="procedure-workspace-actions"><span className={`procedure-dirty-indicator${formDirty ? ' pending' : ''}`} role="status"><i />{formDirty ? 'Cambios pendientes' : 'Sin cambios pendientes'}</span><button type="button" className="button secondary small-button" onClick={() => setPreviewOpen(true)}>Vista previa</button><button type="button" className="button secondary small-button" onClick={onClose}>Cerrar</button></div>
      </header>
      {error && <div className="form-error procedure-form-error" role="alert">{error}</div>}
      {previewOpen ? <ProcedurePreview code={procedureCode ?? undefined} name={draft.name} objective={draft.objective} scope={draft.scope} description={draft.description} processName={processName} processCode={processCode} responsibleName={responsibleName} statusLabel={procedureStatusLabels[procedureStatus]} statusClass={procedureStatus.toLowerCase()} version={procedureVersion} steps={draft.steps} indicators={draft.indicators} users={users} onClose={() => setPreviewOpen(false)} /> : <>
      <div className="procedure-completion-bar"><div className="procedure-completion-copy"><span className="detail-label">ESTADO DEL DOCUMENTO</span><strong>{completion.completed}/{completion.total} campos base completos</strong>{completion.recommendations.length > 0 && <span>{completion.recommendations[0]}</span>}</div><div className="procedure-completion-meter" aria-label={`${completion.completed} de ${completion.total} campos base completos`}><span style={{ width: `${completion.total === 0 ? 0 : Math.round((completion.completed / completion.total) * 100)}%` }} /></div><span className="procedure-completion-note">Indicadores y criterios son opcionales</span></div>
      <nav className="procedure-form-tabs" aria-label="Secciones del procedimiento">
        <button type="button" className={tabClass('general')} onClick={() => setActiveTab('general')} aria-selected={activeTab === 'general'} role="tab"><span>01</span>Información general</button>
        <button type="button" className={tabClass('steps')} onClick={() => setActiveTab('steps')} aria-selected={activeTab === 'steps'} role="tab"><span>02</span>Secuencia operativa{draft.steps.length > 0 && <b>{draft.steps.length}</b>}</button>
        <button type="button" className={tabClass('indicators')} onClick={() => setActiveTab('indicators')} aria-selected={activeTab === 'indicators'} role="tab"><span>03</span>Indicadores{draft.indicators.length > 0 && <b>{draft.indicators.length}</b>}</button>
        <button type="button" className={tabClass('history')} onClick={() => { setActiveTab('history'); if (editing) onLoadHistory() }} aria-selected={activeTab === 'history'} role="tab"><span>04</span>Control documental</button>
      </nav>
      <section className={`procedure-tab-panel${activeTab === 'general' ? ' active' : ''}`} hidden={activeTab !== 'general'}>
         <div className="procedure-section-intro"><p className="detail-label">IDENTIDAD DEL DOCUMENTO</p><h3>Información general</h3><span>Define el contexto que guía la ejecución del procedimiento.</span></div>
         <div className="procedure-form-grid">
           <div className="characterization-field"><span>Código del procedimiento</span><strong aria-live="polite">{displayedProcedureCode}</strong>{procedureCodeError && <><small role="alert">{procedureCodeError}</small><button type="button" className="text-button" onClick={onRetryProcedureCode}>Reintentar</button></>}</div>
           <label>Responsable<select value={draft.responsibleId} onChange={(event) => update('responsibleId', event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>)}</select></label>
          <label className="procedure-field-wide">Nombre del procedimiento<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Atención de solicitudes del cliente" minLength={3} maxLength={160} required /></label>
          <label className="procedure-field-wide">Objetivo<textarea value={draft.objective} onChange={(event) => update('objective', event.target.value)} placeholder="Para qué existe este procedimiento" rows={3} maxLength={2000} required /></label>
          <label className="procedure-field-wide">Alcance<textarea value={draft.scope} onChange={(event) => update('scope', event.target.value)} placeholder="Qué cubre y qué queda por fuera" rows={3} maxLength={2000} required /></label>
          <label className="procedure-field-wide">Descripción<textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Pasos, criterios o contexto adicional del procedimiento (opcional)" rows={4} maxLength={10000} /></label>
        </div>
      </section>
      <div className={`procedure-tab-panel${activeTab === 'steps' ? ' active' : ''}`} hidden={activeTab !== 'steps'}>
         <ProcedureStepsSection entries={draft.steps} setEntries={(next) => setDraft((current) => ({ ...current, steps: typeof next === 'function' ? next(current.steps) : next }))} users={users} onDirty={onDirty} />
      </div>
      <div className={`procedure-tab-panel${activeTab === 'indicators' ? ' active' : ''}`} hidden={activeTab !== 'indicators'}>
        <ProcedureIndicatorSection processId={processId} procedureId={procedureId} entries={draft.indicators} setEntries={(next) => setDraft((current) => ({ ...current, indicators: typeof next === 'function' ? next(current.indicators) : next }))} users={users} onDirty={onDirty} onPersistedChange={async () => { await onRefresh() }} />
      </div>
      <section className={`procedure-tab-panel procedure-history-tab${activeTab === 'history' ? ' active' : ''}`} hidden={activeTab !== 'history'}>
        <div className="procedure-section-intro"><p className="detail-label">TRAZABILIDAD</p><h3>Historial de versiones</h3><span>Registro de cambios generado por el servidor. No es editable.</span></div>
        {!editing ? <div className="procedure-builder-empty"><strong>Disponible después de guardar</strong><span>El historial aparecerá cuando el procedimiento tenga su primera versión.</span></div> : historyLoading ? <div className="inline-loading"><span className="loader" />Cargando historial...</div> : historyError ? <div className="form-error procedure-history-error" role="alert">{historyError}</div> : history.length === 0 ? <p className="procedure-history-empty">Sin cambios registrados.</p> : <div className="history-list procedure-history-list">{history.map((entry) => { const snapshotSteps = procedureSnapshotStepsOf(entry.snapshot); return <article className="history-entry" key={entry.id}><div className="history-entry-marker" aria-hidden="true"><span /></div><div className="history-entry-body"><header className="history-entry-header"><div><span className="history-version">Versión {entry.version}</span><h3>{procedureActionLabels[entry.action]}</h3></div><time dateTime={entry.changedAt}>{dateFormatter.format(new Date(entry.changedAt))}</time></header><p className="history-actor">Responsable del cambio: <strong>{entry.changedByName ?? entry.changedBy?.name ?? 'Usuario no disponible'}</strong>{entry.changedByEmail && <span> · {entry.changedByEmail}</span>}</p>{entry.changes.length > 0 && <div className="history-change-list">{entry.changes.map((change) => <div className="history-change" key={`${entry.id}-${change.field}`}><span>{change.label}</span><strong>{changeValueLabel(change, change.previousValue)}</strong><b aria-hidden="true">→</b><strong>{changeValueLabel(change, change.newValue)}</strong></div>)}</div>}{snapshotSteps.some((step) => Array.isArray(step.responsibleIds)) && <div className="procedure-history-responsibles"><span>Responsables por actividad</span>{snapshotSteps.map((step, index) => { const ids = Array.isArray(step.responsibleIds) ? step.responsibleIds.filter((id): id is string => typeof id === 'string') : []; const names = ids.map((id) => historyUsers.find((user) => user.id === id)?.name ?? 'Usuario no disponible'); return <p key={`${entry.id}-step-${index}`}><strong>{typeof step.title === 'string' && step.title ? step.title : `Actividad ${index + 1}`}</strong><small>{names.length > 0 ? names.join(', ') : 'Sin responsables asignados'}</small></p> })}</div>}</div></article> })}</div>}
       </section>
       </>}
       <footer className="procedure-form-footer">
          <div className="procedure-footer-status">{previewOpen ? 'Vista de consulta' : formDirty ? 'Tienes cambios por guardar' : 'Todos los cambios están guardados'}</div>
          <button type="button" className="button secondary" onClick={previewOpen ? () => setPreviewOpen(false) : onClose}>{previewOpen ? 'Volver al editor' : 'Cancelar'}</button>
          {!previewOpen && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar procedimiento'}</button>}
      </footer>
    </form>
  )
}

export function ProcessProcedurePanel({ process, users, canWrite, onBack }: { process: Process; users: ProcedureUser[]; canWrite: boolean; onBack: () => void }) {
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Procedure | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProcedureDraft>(emptyProcedureDraft)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<ProcedureVersion[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [formDirty, setFormDirty] = useState(false)
  const [newProcedureCode, setNewProcedureCode] = useState<string | null>(null)
  const [newProcedureCodeLoading, setNewProcedureCodeLoading] = useState(false)
  const [newProcedureCodeError, setNewProcedureCodeError] = useState('')
  const nextProcedureCodeRequest = useRef(0)

  const procedureUsers = users.filter((user) => user.companyId === process.companyId)
  const historicalUsers: ProcedureUser[] = [
    ...(editing?.responsible ? [{ ...editing.responsible, companyId: process.companyId }] : []),
    ...(editing?.steps?.flatMap((step) => step.responsibles ?? []).map((user) => ({ ...user, companyId: process.companyId })) ?? []),
  ]
  const availableUsers = activeUserOptions<ProcedureUser>(procedureUsers, historicalUsers)

  const loadProcedures = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ procedures: Procedure[] }>(`/processes/${process.id}/procedures`)
      setProcedures(result.procedures)
    } catch (requestError) {
      console.error('[process-procedures] failed to load procedures', requestError)
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar los procedimientos.')
    } finally {
      setLoading(false)
    }
  }, [process.id])

  // Carga inicial diferida con setTimeout, mismo patrón que ProcessChangeHistory: evita ejecutar
  // setState sincrónico dentro del cuerpo del efecto.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProcedures()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProcedures])

  function cancelNextProcedureCodeRequest() {
    nextProcedureCodeRequest.current += 1
    setNewProcedureCode(null)
    setNewProcedureCodeLoading(false)
    setNewProcedureCodeError('')
  }

  async function loadNextProcedureCode() {
    const requestId = nextProcedureCodeRequest.current + 1
    nextProcedureCodeRequest.current = requestId
    setNewProcedureCode(null)
    setNewProcedureCodeLoading(true)
    setNewProcedureCodeError('')
    try {
      const result = await api<{ code: string }>(`/processes/${process.id}/procedures/next-code`)
      if (requestId !== nextProcedureCodeRequest.current) return
      setNewProcedureCode(result.code)
    } catch (requestError) {
      if (requestId !== nextProcedureCodeRequest.current) return
      setNewProcedureCodeError(requestError instanceof ApiError ? requestError.message : 'No pudimos consultar el próximo código.')
    } finally {
      if (requestId === nextProcedureCodeRequest.current) setNewProcedureCodeLoading(false)
    }
  }

  const filtered = procedures.filter((procedure) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || procedure.code.toLowerCase().includes(term) || procedure.name.toLowerCase().includes(term)
    const matchesStatus = !statusFilter || procedure.status === statusFilter
    return matchesSearch && matchesStatus
  })

  async function closeForm() {
    if (formDirty) {
      const confirmed = await askConfirm({ title: 'Descartar cambios', message: 'Hay cambios sin guardar en este procedimiento. ¿Quieres cerrar el formulario?', confirmLabel: 'Descartar cambios' })
      if (!confirmed) return
    }
    setShowForm(false)
    setEditing(null)
    setFormError('')
    setFormDirty(false)
    cancelNextProcedureCodeRequest()
  }

  async function handleBack() {
    if (showForm && formDirty) {
      const confirmed = await askConfirm({ title: 'Salir del constructor', message: 'Hay cambios sin guardar en este procedimiento. ¿Quieres salir?', confirmLabel: 'Salir sin guardar' })
      if (!confirmed) return
    }
    onBack()
  }

  function startCreate() {
    cancelNextProcedureCodeRequest()
    setEditing(null)
    setDraft({ ...emptyProcedureDraft, steps: [], indicators: [] })
    setFormError('')
    setNotice('')
    setFormDirty(false)
    setShowForm(true)
    void loadNextProcedureCode()
  }

  function startEdit(procedure: Procedure) {
    cancelNextProcedureCodeRequest()
    setEditing(procedure)
    setDraft(draftFromProcedure(procedure))
    setFormError('')
    setNotice('')
    setFormDirty(false)
    setShowForm(true)
  }

  async function saveProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setFormError('')
    setNotice('')
    const missing = [
      ['nombre', draft.name],
      ['objetivo', draft.objective],
      ['alcance', draft.scope],
      ...draft.steps.flatMap((step, index) => [
        [`título del paso ${index + 1}`, step.title],
        [`instrucción del paso ${index + 1}`, step.instruction],
      ]),
    ].flatMap(([label, value]) => value.trim() ? [] : [label])
    if (missing.length > 0) {
      setFormError(`Completa: ${missing.join(', ')}.`)
      return
    }
    setSaving(true)
    const payload = {
      name: draft.name,
      objective: draft.objective,
      scope: draft.scope,
      description: draft.description.trim() || null,
      responsibleId: draft.responsibleId || null,
      steps: draft.steps.map((step, index) => procedureStepPayloadOf(step, index)),
      ...(!editing ? { indicators: draft.indicators.map((entry) => ({ ...entry.draft, name: entry.draft.name.trim(), description: entry.draft.description.trim(), frequency: entry.draft.frequency.trim(), target: entry.draft.target.trim(), formula: entry.draft.formula.trim(), dataSource: entry.draft.dataSource.trim(), unit: entry.draft.unit.trim(), reportResponsibleId: entry.draft.reportResponsibleId || null, monitorResponsibleId: entry.draft.monitorResponsibleId || null, greenThreshold: entry.draft.greenThreshold.trim() || null, yellowThreshold: entry.draft.yellowThreshold.trim() || null, redThreshold: entry.draft.redThreshold.trim() || null, baselineValue: entry.draft.baselineValue.trim() || null, measurementMethod: entry.draft.measurementMethod.trim() || null, deadline: entry.draft.deadline.trim() || null })) } : {}),
    }
    try {
      if (editing) {
        await api<{ procedure: Procedure }>(`/processes/${process.id}/procedures/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api<{ procedure: Procedure }>(`/processes/${process.id}/procedures`, { method: 'POST', body: JSON.stringify(payload) })
      }
      await loadProcedures()
      cancelNextProcedureCodeRequest()
      setFormDirty(false)
      setShowForm(false)
      setEditing(null)
      setNotice(`Procedimiento ${editing ? 'actualizado' : 'creado'} correctamente.`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el procedimiento.')
    } finally {
      setSaving(false)
    }
  }

  async function removeProcedure(procedure: Procedure) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar procedimiento', message: `Se eliminará «${procedure.name}» y su historial sin versiones aprobadas. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}/procedures/${procedure.id}`, { method: 'DELETE' })
      await loadProcedures()
      setNotice('Procedimiento eliminado correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el procedimiento.')
    }
  }

  async function loadHistoryFor(procedure: Procedure) {
    setHistoryFor(procedure.id)
    setHistory([])
    setHistoryError('')
    setHistoryLoading(true)
    try {
      const result = await api<{ versions: ProcedureVersion[] }>(`/processes/${process.id}/procedures/${procedure.id}/history?pageSize=50`)
      setHistory(result.versions)
    } catch (requestError) {
      setHistoryError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar el historial de versiones.')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function toggleHistory(procedure: Procedure) {
    if (historyFor === procedure.id) {
      setHistoryFor(null)
      setHistory([])
      setHistoryError('')
      return
    }
    await loadHistoryFor(procedure)
  }

  return (
    <div className="process-procedure-page">
      <div className="procedure-page-header">
        <button type="button" className="text-button procedure-back-button" onClick={() => void handleBack()}>← Volver a la caracterización</button>
        <div className="procedure-page-heading">
          <div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO PROCEDIMIENTOS</p><h1>Procedimientos</h1><p className="muted">Documenta, revisa y aprueba los procedimientos que pertenecen exclusivamente a este proceso.</p></div>
          {!showForm && canWrite && <button type="button" className="button primary" onClick={startCreate}>+ Nuevo procedimiento</button>}
        </div>
      </div>

      <section className="panel procedure-process-context">
        <div><span>Proceso</span><strong>{process.name}</strong></div>
        <div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div>
        <div><span>Procedimientos</span><strong>{procedures.length}</strong></div>
      </section>

      {notice && !showForm && <div className="form-success page-alert" role="status">{notice}</div>}
      {formError && !showForm && <div className="form-error page-alert" role="alert">{formError}</div>}
      {showForm ? (
         <ProcedureForm key={editing?.id ?? 'new-procedure'} processId={process.id} procedureId={editing?.id} processName={process.name} processCode={process.code} draft={draft} setDraft={setDraft} users={availableUsers} historyUsers={procedureUsers} editing={Boolean(editing)} procedureCode={editing?.code ?? newProcedureCode} procedureCodeLoading={!editing && newProcedureCodeLoading} procedureCodeError={!editing ? newProcedureCodeError : ''} onRetryProcedureCode={() => void loadNextProcedureCode()} procedureStatus={editing?.status ?? 'DRAFT'} procedureVersion={editing?.version ?? '1.0'} responsibleName={availableUsers.find((user) => user.id === draft.responsibleId)?.name ?? 'Sin asignar'} formDirty={formDirty} saving={saving} error={formError} onSubmit={(event) => void saveProcedure(event)} onClose={() => void closeForm()} onDirty={() => setFormDirty(true)} onRefresh={loadProcedures} history={history} historyLoading={historyLoading} historyError={historyError} onLoadHistory={() => { if (editing) void loadHistoryFor(editing) }} />
      ) : (
        <section className="panel procedure-list-panel">
          <div className="panel-heading procedure-list-heading"><div><p className="detail-label">DOCUMENTOS DEL PROCESO</p><h2>Listado de procedimientos</h2></div><span className="procedure-list-note">Documentos operativos del proceso</span></div>
          {procedures.length > 0 && (
            <div className="filters">
              <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por código o nombre..." aria-label="Buscar procedimientos por código o nombre" /></div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado">
                <option value="">Todos los estados</option>
                {(Object.keys(procedureStatusLabels) as ProcedureStatus[]).map((status) => <option key={status} value={status}>{procedureStatusLabels[status]}</option>)}
              </select>
            </div>
          )}
          {loadError && <div className="form-error procedure-list-error" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadProcedures()}>Reintentar</button></div>}
          {loading ? <div className="inline-loading"><span className="loader" />Cargando procedimientos...</div> : procedures.length === 0 ? (
            <div className="procedure-empty"><span className="procedure-empty-icon">▤</span><h3>Aún no hay procedimientos</h3><p>Documenta el primer procedimiento de este proceso para empezar su flujo de aprobación.</p>{canWrite && <button type="button" className="button secondary" onClick={startCreate}>Crear primer procedimiento</button>}</div>
          ) : filtered.length === 0 ? (
            <div className="procedure-empty"><span className="procedure-empty-icon">⌕</span><h3>Sin resultados</h3><p>Ningún procedimiento coincide con la búsqueda o el filtro de estado.</p></div>
          ) : (
            <div className="procedure-table-wrap">
              <div className="procedure-table-head"><span>Código</span><span>Procedimiento</span><span>Estado</span><span>Versión</span><span /></div>
              {filtered.map((procedure) => {
                const expanded = expandedId === procedure.id
                return <article className={`procedure-row${expanded ? ' expanded' : ''}`} key={procedure.id}>
                  <button type="button" className="procedure-row-summary" onClick={() => setExpandedId(expanded ? null : procedure.id)} aria-expanded={expanded}>
                    <span className="procedure-code-cell">{procedure.code}</span>
                    <span className="procedure-name-cell"><strong>{procedure.name}</strong><small>{procedure.objective}</small></span>
                    <span className={`procedure-status ${procedure.status.toLowerCase()}`}>{procedureStatusLabels[procedure.status]}</span>
                    <span className="procedure-version-cell">v{procedure.version}</span>
                    <span className="procedure-expand-icon">{expanded ? '⌃' : '⌄'}</span>
                  </button>
                   {expanded && <div className="procedure-detail procedure-consultation-detail">
                     <div className="procedure-detail-summary" aria-label="Resumen operativo del procedimiento">
                       <div className="procedure-detail-summary-title"><span>Resumen operativo</span><strong>Contenido documentado</strong><small>Lectura rápida del procedimiento</small></div>
                       <div className="procedure-detail-metric"><strong>{procedure.steps.length}</strong><span>Actividades</span></div>
                       <div className="procedure-detail-metric"><strong>{procedure.indicators.length}</strong><span>Indicadores propios</span></div>
                       <div className="procedure-detail-metric"><strong>{procedure.steps.filter((step) => step.title.trim() && step.instruction.trim()).length}</strong><span>Actividades documentadas</span></div>
                     </div>
                     <div className="procedure-detail-grid">
                       <div><span>Objetivo</span><p>{procedure.objective}</p></div>
                       <div><span>Alcance</span><p>{procedure.scope}</p></div>
                      <div><span>Descripción</span><p>{procedure.description ?? 'Sin descripción'}</p></div>
                      <div><span>Responsable</span><p>{procedure.responsible ? userOptionLabel(procedure.responsible) : 'Sin asignar'}</p></div>
                      <div><span>Estado</span><p><span className={`procedure-status ${procedure.status.toLowerCase()}`}>{procedureStatusLabels[procedure.status]}</span></p></div>
                      <div><span>Versión</span><p>v{procedure.version}</p></div>
                     <div><span>Creado</span><p>{dateFormatter.format(new Date(procedure.createdAt))}</p></div>
                     <div><span>Última actualización</span><p>{dateFormatter.format(new Date(procedure.updatedAt))}</p></div>
                     </div>
                     <div className="procedure-preview-sections">
                         <ProcedureStepsSection entries={procedure.steps.map(procedureStepEntryFromStep)} users={procedureUsers} readOnly />
                       <ProcedureIndicatorSection processId={process.id} procedureId={procedure.id} entries={procedure.indicators.map(procedureIndicatorEntryFromIndicator)} users={availableUsers} readOnly />
                     </div>
                     <div className="procedure-detail-control">
                       <button type="button" className={`procedure-history-toggle-button${historyFor === procedure.id ? ' active' : ''}`} onClick={() => void toggleHistory(procedure)} aria-expanded={historyFor === procedure.id}>
                         <span><strong>Control documental</strong><small>{historyFor === procedure.id ? 'Ocultar historial' : 'Ver historial de versiones'}</small></span>
                         <b aria-hidden="true">{historyFor === procedure.id ? '⌃' : '⌄'}</b>
                       </button>
                       {canWrite && <div className="procedure-detail-actions">
                         {procedure.status === 'DRAFT' && <button type="button" className="button primary small-button" onClick={() => startEdit(procedure)}>Editar</button>}
                         {procedure.status !== 'APPROVED' && <button type="button" className="button danger small-button" onClick={() => void removeProcedure(procedure)}>Eliminar</button>}
                       </div>}
                     </div>
                     {historyFor === procedure.id && (historyLoading ? (
                      <div className="inline-loading"><span className="loader" />Cargando historial...</div>
                    ) : historyError ? (
                      <div className="form-error procedure-history-error" role="alert">{historyError}</div>
                    ) : history.length === 0 ? (
                      <p className="procedure-history-empty">Sin cambios registrados.</p>
                    ) : (
                      <div className="history-list procedure-history-list">
                        {history.map((entry) => (
                          <article className="history-entry" key={entry.id}>
                            <div className="history-entry-marker" aria-hidden="true"><span /></div>
                            <div className="history-entry-body">
                              <header className="history-entry-header">
                                <div><span className="history-version">Versión {entry.version}</span><h3>{procedureActionLabels[entry.action]}</h3></div>
                                <time dateTime={entry.changedAt}>{dateFormatter.format(new Date(entry.changedAt))}</time>
                              </header>
                              <p className="history-actor">Responsable del cambio: <strong>{entry.changedByName ?? entry.changedBy?.name ?? 'Usuario no disponible'}</strong>{entry.changedByEmail && <span> · {entry.changedByEmail}</span>}</p>
                              {entry.changes.length > 0 && <div className="history-change-list">
                                {entry.changes.map((change) => <div className="history-change" key={`${entry.id}-${change.field}`}><span>{change.label}</span><strong>{changeValueLabel(change, change.previousValue)}</strong><b aria-hidden="true">→</b><strong>{changeValueLabel(change, change.newValue)}</strong></div>)}
                              </div>}
                            </div>
                          </article>
                        ))}
                      </div>
                    ))}
                  </div>}
                </article>
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

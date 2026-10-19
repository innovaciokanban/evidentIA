import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Procedure, ProcedureStatus, ProcedureVersion, Process, ProcessChangeItem, ProcessChangeValue, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'

export type ProcedureUser = Pick<User, 'id' | 'name'> & { companyId: string | null }

const procedureStatusLabels: Record<ProcedureStatus, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  APPROVED: 'Aprobado',
  OBSOLETE: 'Obsoleto',
}

// Transiciones del flujo documental, espejo exacto de la máquina que valida el servidor: lo
// aprobado solo vuelve a borrador (nueva revisión) u obsolétaca, y lo obsoleto solo se reactiva.
const procedureTransitions: Record<ProcedureStatus, Array<{ to: ProcedureStatus; label: string }>> = {
  DRAFT: [
    { to: 'IN_REVIEW', label: 'Enviar a revisión' },
    { to: 'OBSOLETE', label: 'Dar de baja' },
  ],
  IN_REVIEW: [
    { to: 'APPROVED', label: 'Aprobar' },
    { to: 'DRAFT', label: 'Devolver a borrador' },
    { to: 'OBSOLETE', label: 'Dar de baja' },
  ],
  APPROVED: [
    { to: 'DRAFT', label: 'Abrir nueva revisión' },
    { to: 'OBSOLETE', label: 'Dar de baja' },
  ],
  OBSOLETE: [
    { to: 'DRAFT', label: 'Reactivar' },
  ],
}

const procedureActionLabels: Record<ProcedureVersion['action'], string> = {
  CREATED: 'Procedimiento creado',
  UPDATED: 'Procedimiento actualizado',
  STATUS_CHANGED: 'Cambio de estado',
}

export type ProcedureDraft = {
  code: string
  name: string
  objective: string
  scope: string
  description: string
  responsibleId: string
}

const emptyProcedureDraft: ProcedureDraft = {
  code: '', name: '', objective: '', scope: '', description: '', responsibleId: '',
}

const draftFromProcedure = (procedure: Procedure): ProcedureDraft => ({
  code: procedure.code,
  name: procedure.name,
  objective: procedure.objective,
  scope: procedure.scope,
  description: procedure.description ?? '',
  responsibleId: procedure.responsible?.id ?? '',
})

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const changeValueLabel = (change: ProcessChangeItem, value: ProcessChangeValue) => {
  if (change.field === 'status') return procedureStatusLabels[value as ProcedureStatus] ?? String(value)
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value
}

type ProcedureFormProps = {
  draft: ProcedureDraft
  setDraft: React.Dispatch<React.SetStateAction<ProcedureDraft>>
  users: ProcedureUser[]
  editing: boolean
  saving: boolean
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

function ProcedureForm({ draft, setDraft, users, editing, saving, error, onSubmit, onClose }: ProcedureFormProps) {
  const update = <K extends keyof ProcedureDraft>(field: K, value: ProcedureDraft[K]) => setDraft((current) => ({ ...current, [field]: value }))

  return (
    <form className="procedure-form panel" onSubmit={onSubmit}>
      <header className="procedure-form-header">
        <div>
          <p className="eyebrow">PROCEDIMIENTOS</p>
          <h2>{editing ? 'EDITAR PROCEDIMIENTO' : 'NUEVO PROCEDIMIENTO'}</h2>
          <p>Documento operativo del proceso. Solo los borradores pueden editarse; para modificar un procedimiento aprobado, abre una nueva revisión desde su ficha.</p>
        </div>
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      </header>
      {error && <div className="form-error procedure-form-error" role="alert">{error}</div>}
      <section className="procedure-form-section">
        <div className="procedure-form-grid">
          <label>Código<input value={draft.code} onChange={(event) => update('code', event.target.value)} placeholder="Ej. PRO-COM-01" minLength={2} maxLength={40} required /></label>
          <label>Responsable<select value={draft.responsibleId} onChange={(event) => update('responsibleId', event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label className="procedure-field-wide">Nombre del procedimiento<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Atención de solicitudes del cliente" minLength={3} maxLength={160} required /></label>
          <label className="procedure-field-wide">Objetivo<textarea value={draft.objective} onChange={(event) => update('objective', event.target.value)} placeholder="Para qué existe este procedimiento" rows={3} maxLength={2000} required /></label>
          <label className="procedure-field-wide">Alcance<textarea value={draft.scope} onChange={(event) => update('scope', event.target.value)} placeholder="Qué cubre y qué queda por fuera" rows={3} maxLength={2000} required /></label>
          <label className="procedure-field-wide">Descripción<textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Pasos, criterios o contexto adicional del procedimiento (opcional)" rows={4} maxLength={10000} /></label>
        </div>
      </section>
      <footer className="procedure-form-footer">
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar procedimiento'}</button>
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

  const availableUsers = users.filter((user) => user.companyId === process.companyId)

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
    const timer = window.setTimeout(() => { void loadProcedures() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProcedures])

  const filtered = procedures.filter((procedure) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || procedure.code.toLowerCase().includes(term) || procedure.name.toLowerCase().includes(term)
    const matchesStatus = !statusFilter || procedure.status === statusFilter
    return matchesSearch && matchesStatus
  })

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setFormError('')
  }

  function startCreate() {
    setEditing(null)
    setDraft(emptyProcedureDraft)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function startEdit(procedure: Procedure) {
    setEditing(procedure)
    setDraft(draftFromProcedure(procedure))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  async function saveProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError('')
    setNotice('')
    const payload = {
      code: draft.code,
      name: draft.name,
      objective: draft.objective,
      scope: draft.scope,
      description: draft.description.trim() || null,
      responsibleId: draft.responsibleId || null,
    }
    try {
      if (editing) {
        await api<{ procedure: Procedure }>(`/processes/${process.id}/procedures/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api<{ procedure: Procedure }>(`/processes/${process.id}/procedures`, { method: 'POST', body: JSON.stringify(payload) })
      }
      await loadProcedures()
      closeForm()
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

  async function changeStatus(procedure: Procedure, to: ProcedureStatus) {
    if (!canWrite) return
    const confirmed = await askConfirm({
      title: procedureStatusLabels[to],
      message: `«${procedure.name}» pasará de «${procedureStatusLabels[procedure.status]}» a «${procedureStatusLabels[to]}».`,
      confirmLabel: 'Continuar',
    })
    if (!confirmed) return
    setFormError('')
    setNotice('')
    try {
      await api<{ procedure: Procedure }>(`/processes/${process.id}/procedures/${procedure.id}/status`, { method: 'POST', body: JSON.stringify({ status: to }) })
      await loadProcedures()
      setNotice(`Procedimiento actualizado a «${procedureStatusLabels[to]}».`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo cambiar el estado del procedimiento.')
    }
  }

  async function toggleHistory(procedure: Procedure) {
    if (historyFor === procedure.id) {
      setHistoryFor(null)
      setHistory([])
      setHistoryError('')
      return
    }
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

  return (
    <div className="process-procedure-page">
      <div className="procedure-page-header">
        <button type="button" className="text-button procedure-back-button" onClick={onBack}>← Volver a la caracterización</button>
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
        <ProcedureForm draft={draft} setDraft={setDraft} users={availableUsers} editing={Boolean(editing)} saving={saving} error={formError} onSubmit={(event) => void saveProcedure(event)} onClose={closeForm} />
      ) : (
        <section className="panel procedure-list-panel">
          <div className="panel-heading procedure-list-heading"><div><p className="detail-label">DOCUMENTOS DEL PROCESO</p><h2>Listado de procedimientos</h2></div><span className="procedure-list-note">Flujo de revisión y aprobación</span></div>
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
                  {expanded && <div className="procedure-detail">
                    <div className="procedure-detail-grid">
                      <div><span>Objetivo</span><p>{procedure.objective}</p></div>
                      <div><span>Alcance</span><p>{procedure.scope}</p></div>
                      <div><span>Descripción</span><p>{procedure.description ?? 'Sin descripción'}</p></div>
                      <div><span>Responsable</span><p>{procedure.responsible?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Estado</span><p><span className={`procedure-status ${procedure.status.toLowerCase()}`}>{procedureStatusLabels[procedure.status]}</span></p></div>
                      <div><span>Versión</span><p>v{procedure.version}</p></div>
                      <div><span>Creado</span><p>{dateFormatter.format(new Date(procedure.createdAt))}</p></div>
                      <div><span>Última actualización</span><p>{dateFormatter.format(new Date(procedure.updatedAt))}</p></div>
                    </div>
                    {canWrite && <div className="procedure-detail-actions">
                      {procedureTransitions[procedure.status].map((transition) => <button type="button" className="button secondary small-button" key={transition.to} onClick={() => void changeStatus(procedure, transition.to)}>{transition.label}</button>)}
                      {procedure.status === 'DRAFT' && <button type="button" className="button secondary small-button" onClick={() => startEdit(procedure)}>Editar</button>}
                      {procedure.status !== 'APPROVED' && <button type="button" className="button danger small-button" onClick={() => void removeProcedure(procedure)}>Eliminar</button>}
                    </div>}
                    <div className="procedure-history-toggle">
                      <button type="button" className="text-button" onClick={() => void toggleHistory(procedure)}>{historyFor === procedure.id ? 'Ocultar historial' : 'Ver historial de versiones'}</button>
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

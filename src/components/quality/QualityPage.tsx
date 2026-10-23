import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
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
  Procedure,
} from '../../types'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { MultiSelect } from '../ui/MultiSelect'
import { askConfirm } from '../ui/useConfirm'
import {
  actionPriorityLabels,
  actionStatusLabels,
  actionTransitions,
  auditKinds,
  auditStatusLabels,
  auditTransitions,
  checklistResultLabels,
  checklistResults,
  draftFromAudit,
  draftFromFinding,
  emptyActionDraft,
  emptyAuditDraft,
  emptyChecklistDraft,
  emptyChecklistItemDraft,
  emptyEvidenceDraft,
  emptyFindingDraft,
  eventLabel,
  findingSeverityLabels,
  findingStatusLabels,
  findingTransitions,
  findingTypeLabels,
  formatBytes,
  isTerminalAudit,
  type ActionDraft,
  type AuditDraft,
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

export function QualityPage({ user, initialAudits = [], initialLoading = true }: { user: { id: string; role: string; companyId?: string | null }; initialAudits?: Audit[]; initialLoading?: boolean }) {
  const canWrite = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const [allUsers, setAllUsers] = useState<QualityUser[]>([])
  const [allProcesses, setAllProcesses] = useState<Process[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [usersResult, processesResult] = await Promise.all([
          api<{ users: QualityUser[] }>('/users'),
          api<{ processes: Process[] }>('/processes'),
        ])
        if (!cancelled) {
          setAllUsers(usersResult.users)
          setAllProcesses(processesResult.processes)
        }
      } catch (requestError) {
        console.error('[quality] failed to load users/processes', requestError)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const processes = useMemo(
    () => (user.role === 'SUPERUSER' ? allProcesses : allProcesses.filter((process) => process.companyId === user.companyId)),
    [allProcesses, user],
  )
  const users = allUsers
  const companyProcesses = processes

  const [audits, setAudits] = useState<Audit[]>(initialAudits)
  const [loading, setLoading] = useState(initialLoading)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Audit | null>(null)
  const [draft, setDraft] = useState<AuditDraft>(emptyAuditDraft)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [procedures, setProcedures] = useState<Procedure[]>([])

  const selected = audits.find((audit) => audit.id === selectedId) ?? null

  const loadAudits = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ audits: Audit[] }>('/audits')
      setAudits(result.audits)
    } catch (requestError) {
      console.error('[quality] failed to load audits', requestError)
      setLoadError(findErrorMessage(requestError, 'No pudimos cargar las auditorías de calidad.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAudits() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAudits])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const ids = processes.map((process) => process.id)
        const results = await Promise.all(ids.map((id) => api<{ procedures: Procedure[] }>(`/processes/${id}/procedures`).catch(() => ({ procedures: [] as Procedure[] }))))
        if (!cancelled) setProcedures(results.flatMap((result) => result.procedures))
      } catch {
        if (!cancelled) setProcedures([])
      }
    })()
    return () => { cancelled = true }
  }, [processes])

  const filtered = audits.filter((audit) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || audit.code.toLowerCase().includes(term) || audit.title.toLowerCase().includes(term) || audit.process.name.toLowerCase().includes(term)
    const matchesStatus = !statusFilter || audit.status === statusFilter
    return matchesSearch && matchesStatus
  })

  function startCreate() {
    setEditing(null)
    setDraft(emptyAuditDraft)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function startEdit(audit: Audit) {
    setEditing(audit)
    setDraft(draftFromAudit(audit))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  async function saveAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError('')
    setNotice('')
    const base = {
      title: draft.title,
      auditType: draft.auditType || undefined,
      scope: draft.scope,
      objectives: draft.objectives.trim() || null,
      criteria: draft.criteria,
      plannedDate: draft.plannedDate || null,
      leadAuditorId: draft.leadAuditorId || null,
      responsibleId: draft.responsibleId || null,
      processIds: draft.processIds,
      procedureIds: draft.procedureIds,
    }
    try {
      if (editing) {
        const { processIds: _p, procedureIds: _pr, ...updatePayload } = base
        void _p
        void _pr
        await api<{ audit: Audit }>(`/audits/${editing.id}`, { method: 'PATCH', body: JSON.stringify(updatePayload) })
        await api(`/audits/${editing.id}/relations`, { method: 'PUT', body: JSON.stringify({ processIds: draft.processIds, procedureIds: draft.procedureIds }) })
      } else {
        if (!draft.processId) {
          setFormError('Selecciona el proceso principal de la auditoría.')
          setSaving(false)
          return
        }
        await api<{ audit: Audit }>('/audits', { method: 'POST', body: JSON.stringify({ ...base, processId: draft.processId }) })
      }
      await loadAudits()
      setShowForm(false)
      setEditing(null)
      setNotice(`Auditoría ${editing ? 'actualizada' : 'creada'} correctamente.`)
    } catch (requestError) {
      setFormError(findErrorMessage(requestError, 'No se pudo guardar la auditoría.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeAudit(audit: Audit) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar auditoría', message: `Se eliminará «${audit.title}» y su historial sin hallazgos. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    try {
      await api(`/audits/${audit.id}`, { method: 'DELETE' })
      if (selectedId === audit.id) setSelectedId(null)
      await loadAudits()
      setNotice('Auditoría eliminada correctamente.')
    } catch (requestError) {
      setFormError(findErrorMessage(requestError, 'No se pudo eliminar la auditoría.'))
    }
  }

  return (
    <div className="quality-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ASEGURAMIENTO DE CALIDAD</p>
          <h1>Auditorías de calidad</h1>
          <p className="muted">Planifica auditorías, evalúa listas de verificación, registra hallazgos con acciones correctivas y conserva la evidencia documental.</p>
        </div>
        {canWrite && !showForm && !selected && (
          <button type="button" className="button primary" onClick={startCreate}>+ Nueva auditoría</button>
        )}
      </div>

      {notice && <div className="notice success" role="status">{notice}</div>}
      {formError && <div className="notice error" role="alert">{formError}</div>}

      {selected ? (
        <AuditDetailView
          audit={selected}
          users={users}
          processes={companyProcesses}
          canWrite={canWrite}
          onChanged={loadAudits}
          onBack={() => setSelectedId(null)}
          onEdit={() => startEdit(selected)}
          onError={setFormError}
          onNotice={setNotice}
        />
      ) : showForm ? (
        <section className="panel quality-audit-form">
          <div className="panel-heading">
            <div>
              <p className="detail-label">{editing ? 'EDITAR AUDITORÍA' : 'NUEVA AUDITORÍA'}</p>
              <h2>{editing ? editing.code : 'Alta de auditoría'}</h2>
            </div>
            <button type="button" className="text-button" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
          <form onSubmit={saveAudit} className="procedure-form">
            <label className="procedure-field-wide">Título de la auditoría
              <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={160} required placeholder="Ej. Auditoría interna de cumplimiento" />
            </label>
            <label>Tipo de auditoría
              <select value={draft.auditType} onChange={(event) => setDraft((current) => ({ ...current, auditType: event.target.value as AuditDraft['auditType'] }))} required>
                <option value="">Selecciona…</option>
                {auditKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            {!editing && (
              <label>Proceso principal
                <select value={draft.processId} onChange={(event) => setDraft((current) => ({ ...current, processId: event.target.value }))} required>
                  <option value="">Selecciona…</option>
                  {companyProcesses.map((process) => <option key={process.id} value={process.id}>{process.code} · {process.name}</option>)}
                </select>
              </label>
            )}
            <label>Fecha planeada
              <input type="date" value={draft.plannedDate} onChange={(event) => setDraft((current) => ({ ...current, plannedDate: event.target.value }))} />
            </label>
            <label>Auditor líder
              <select value={draft.leadAuditorId} onChange={(event) => setDraft((current) => ({ ...current, leadAuditorId: event.target.value }))}>
                <option value="">Sin asignar</option>
                {users.filter((person) => !person.companyId || person.companyId === user.companyId || user.role === 'SUPERUSER').map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
            <label>Responsable
              <select value={draft.responsibleId} onChange={(event) => setDraft((current) => ({ ...current, responsibleId: event.target.value }))}>
                <option value="">Sin asignar</option>
                {users.filter((person) => !person.companyId || person.companyId === user.companyId || user.role === 'SUPERUSER').map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
            <label className="procedure-field-wide">Alcance
              <textarea value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value }))} minLength={3} maxLength={2000} required rows={2} />
            </label>
            <label className="procedure-field-wide">Objetivos
              <textarea value={draft.objectives} onChange={(event) => setDraft((current) => ({ ...current, objectives: event.target.value }))} maxLength={5000} rows={2} />
            </label>
            <label className="procedure-field-wide">Criterios
              <textarea value={draft.criteria} onChange={(event) => setDraft((current) => ({ ...current, criteria: event.target.value }))} minLength={3} maxLength={2000} required rows={2} />
            </label>
            {draft.processId && (
              <MultiSelect
                label="Procesos relacionados"
                options={companyProcesses.filter((process) => process.id !== draft.processId).map((process) => ({ id: process.id, label: `${process.code} · ${process.name}` }))}
                value={draft.processIds}
                onChange={(processIds) => setDraft((current) => ({ ...current, processIds }))}
              />
            )}
            {draft.processId && (
              <MultiSelect
                label="Procedimientos relacionados"
                options={procedures.filter((procedure) => procedure.processId === draft.processId).map((procedure) => ({ id: procedure.id, label: `${procedure.code} · ${procedure.name}` }))}
                value={draft.procedureIds}
                onChange={(procedureIds) => setDraft((current) => ({ ...current, procedureIds }))}
              />
            )}
            <div className="procedure-form-actions procedure-field-wide">
              <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : (editing ? 'Guardar cambios' : 'Crear auditoría')}</button>
              <button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <section className="panel quality-filters">
            <label>Buscar
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, título o proceso…" />
            </label>
            <label>Estado
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">Todos</option>
                {(Object.keys(auditStatusLabels) as AuditStatus[]).map((status) => (
                  <option key={status} value={status}>{auditStatusLabels[status]}</option>
                ))}
              </select>
            </label>
          </section>

          {loading ? (
            <LoadingState text="Cargando auditorías…" />
          ) : loadError ? (
            <div className="notice error" role="alert">{loadError}</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Sin auditorías de calidad"
              text="Crea la primera auditoría para empezar el aseguramiento de calidad de tus procesos."
              action={canWrite ? <button type="button" className="button primary" onClick={startCreate}>Crear auditoría</button> : undefined}
            />
          ) : (
            <div className="quality-audit-list">
              {filtered.map((audit) => {
                const indicators = audit.indicators
                return (
                  <article key={audit.id} className="panel quality-audit-card">
                    <div className="quality-audit-card-header">
                      <div>
                        <p className="detail-label">{audit.code} · {audit.process.code}</p>
                        <h3>{audit.title}</h3>
                        <p className="muted">{audit.process.name}{audit.auditType ? ` · ${audit.auditType}` : ''}</p>
                      </div>
                      <div className="quality-audit-card-actions">
                        <span className={`badge quality-status ${audit.status.toLowerCase()}`}>{auditStatusLabels[audit.status]}</span>
                        <button type="button" className="button secondary" onClick={() => setSelectedId(audit.id)}>Abrir</button>
                        {canWrite && (
                          <>
                            <button type="button" className="text-button" onClick={() => startEdit(audit)}>Editar</button>
                            {!isTerminalAudit(audit) && audit.findings.length === 0 && (
                              <button type="button" className="text-button danger" onClick={() => void removeAudit(audit)}>Eliminar</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {indicators && (
                      <div className="quality-indicators">
                        <span>Hallazgos: <strong>{indicators.findings}</strong> ({indicators.openFindings} abiertos)</span>
                        <span>Checklist: <strong>{indicators.checklistTotal}</strong> ítems{indicators.checklistRequiredPending > 0 ? ` · ${indicators.checklistRequiredPending} obligatorios pendientes` : ''}</span>
                        <span>Acciones obligatorias abiertas: <strong>{indicators.openRequiredActions}</strong></span>
                      </div>
                    )}
                    <p className="muted">Planeada: {formatMaybeDate(audit.plannedDate)} · Líder: {audit.leadAuditor?.name ?? '—'} · Responsable: {audit.responsible?.name ?? '—'}</p>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AuditDetailView({ audit: initial, users, processes, canWrite, onChanged, onBack, onEdit, onError, onNotice }: {
  audit: Audit
  users: QualityUser[]
  processes: Process[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onBack: () => void
  onEdit: () => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [audit, setAudit] = useState(initial)
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [checklistDraft, setChecklistDraft] = useState<ChecklistDraft>({ name: '' })
  const [itemDraft, setItemDraft] = useState<ChecklistItemDraft>(emptyChecklistItemDraft)
  const [itemFor, setItemFor] = useState<{ checklistId: string; item: AuditChecklistItem | null } | null>(null)
  const [findingDraft, setFindingDraft] = useState<FindingDraft>(emptyFindingDraft)
  const [findingFor, setFindingFor] = useState<{ finding: AuditFinding | null } | null>(null)
  const [actionDraft, setActionDraft] = useState<ActionDraft>(emptyActionDraft)
  const [actionFor, setActionFor] = useState<{ findingId: string; action: AuditCorrectiveAction | null } | null>(null)
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(emptyEvidenceDraft)
  const [evidenceFor, setEvidenceFor] = useState<boolean>(false)
  const [uploadFor, setUploadFor] = useState<{ findingId?: string; actionId?: string; itemId?: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)

  // Sincroniza el estado local cuando el padre reemplaza el objeto seleccionado (p. ej. tras
  // recargar la lista); la clave del estado es el id de la auditoría.
  const [auditKey, setAuditKey] = useState(initial.id)
  if (auditKey !== initial.id) {
    setAuditKey(initial.id)
    setAudit(initial)
  }

  const companyUsers = users.filter((person) => !person.companyId || person.companyId === audit.companyId)
  const relatedProcessIds = new Set([audit.processId, ...(audit.relatedProcesses ?? []).map((process) => process.id)])
  const linkedProcedures = (audit.procedures ?? []).map((procedure) => procedure)

  async function reload() {
    const result = await api<{ audit: Audit }>(`/audits/${audit.id}`)
    setAudit(result.audit)
    await onChanged()
  }

  async function changeStatus(to: AuditStatus) {
    if (!canWrite) return
    let summary: string | undefined
    if (to === 'CLOSED') {
      const input = window.prompt('Resumen de cierre de la auditoría (obligatorio):')
      if (input === null) return
      summary = input.trim()
      if (summary.length < 3) {
        onError('El resumen de cierre debe tener al menos 3 caracteres.')
        return
      }
    } else {
      const confirmed = await askConfirm({ title: auditStatusLabels[to], message: `«${audit.title}» pasará a «${auditStatusLabels[to]}».`, confirmLabel: 'Continuar' })
      if (!confirmed) return
    }
    setBusy(true)
    try {
      await api(`/audits/${audit.id}/status`, { method: 'POST', body: JSON.stringify({ status: to, ...(summary ? { summary } : {}) }) })
      await reload()
      onNotice(`Auditoría actualizada a «${auditStatusLabels[to]}».`)
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No se pudo cambiar el estado de la auditoría.'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    setHistoryLoading(true)
    try {
      const result = await api<{ events: AuditEvent[] }>(`/audits/${audit.id}/history?pageSize=50`)
      setHistory(result.events)
    } catch (requestError) {
      onError(findErrorMessage(requestError, 'No pudimos cargar el historial.'))
    } finally {
      setHistoryLoading(false)
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
    const confirmed = await askConfirm({ title: 'Eliminar lista', message: `Se eliminará la lista «${checklist.name}» y sus ítems.`, confirmLabel: 'Eliminar' })
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
    if (!canWrite) return
    let resolution: string | undefined
    if (to === 'RESOLVED') {
      const input = window.prompt('Resolución del hallazgo (obligatoria):')
      if (input === null) return
      resolution = input.trim()
      if (resolution.length < 3) {
        onError('La resolución debe tener al menos 3 caracteres.')
        return
      }
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
    const confirmed = await askConfirm({ title: 'Eliminar hallazgo', message: `Se eliminará «${finding.title}».`, confirmLabel: 'Eliminar' })
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
    if (!canWrite) return
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

  const terminal = isTerminalAudit(audit)
  const readonly = terminal || !canWrite

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
            <button type="button" className="text-button" onClick={() => void toggleHistory()}>{historyOpen ? 'Ocultar historial' : 'Historial'}</button>
          </div>
        </div>
      </div>

      {terminal && <p className="audit-terminal-note">Auditoría {auditStatusLabels[audit.status].toLowerCase()}: las escrituras quedan bloqueadas.</p>}
      {audit.summary && <div className="panel quality-summary"><p className="detail-label">RESUMEN DE CIERRE</p><p>{audit.summary}</p></div>}

      {!terminal && (
        <section className="panel quality-status-bar">
          <p className="detail-label">ESTADO</p>
          <div className="quality-status-actions">
            {auditTransitions[audit.status].map((transition) => (
              <button
                key={transition.to}
                type="button"
                className={`button ${transition.to === 'CANCELLED' ? 'secondary' : 'primary'}`}
                disabled={busy}
                onClick={() => void changeStatus(transition.to)}
              >
                {transition.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {historyOpen && (
        <section className="panel quality-history">
          <p className="detail-label">HISTORIAL</p>
          {historyLoading ? <LoadingState text="Cargando historial…" /> : history.length === 0 ? (
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
      )}

      <section className="panel quality-checklists">
        <div className="panel-heading">
          <div>
            <p className="detail-label">LISTAS DE VERIFICACIÓN</p>
            <h2>Checklists</h2>
          </div>
          {audit.checklistProgress && (
            <p className="muted">{audit.checklistProgress.completed}/{audit.checklistProgress.total} evaluados{audit.checklistProgress.requiredPending > 0 ? ` · ${audit.checklistProgress.requiredPending} obligatorios pendientes` : ''}</p>
          )}
        </div>
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
                  {checklist.items.map((item) => (
                    <div key={item.id} className="quality-item-row">
                      <span>{item.required ? '★ ' : ''}{item.description}</span>
                      <span className="muted">{item.criteria}</span>
                      <span>
                        {readonly ? checklistResultLabels[item.result] : (
                          <select value={item.result} onChange={(event) => void updateItemResult(checklist.id, item, event.target.value as typeof checklistResults[number], item.observations ?? '')}>
                            {checklistResults.map((result) => <option key={result} value={result}>{checklistResultLabels[result]}</option>)}
                          </select>
                        )}
                      </span>
                      <span className="muted">{item.observations ?? '—'}</span>
                      <span>
                        {!readonly && (
                          <>
                            <button type="button" className="text-button" onClick={() => { setItemFor({ checklistId: checklist.id, item }); setItemDraft({ description: item.description, criteria: item.criteria, required: item.required }) }}>Editar</button>
                            <button type="button" className="text-button danger" onClick={() => void removeItem(checklist.id, item)}>×</button>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
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

      <section className="panel quality-findings">
        <div className="panel-heading">
          <div>
            <p className="detail-label">HALLAZGOS</p>
            <h2>No conformidades y observaciones</h2>
          </div>
          {!readonly && (
            <button type="button" className="button secondary" onClick={() => { setFindingFor({ finding: null }); setFindingDraft({ ...emptyFindingDraft, responsibleId: audit.responsible?.id ?? '' }) }}>+ Hallazgo</button>
          )}
        </div>
        {audit.findings.length === 0 ? (
          <p className="muted">Sin hallazgos registrados.</p>
        ) : (
          audit.findings.map((finding) => (
            <article key={finding.id} className="quality-finding">
              <div className="quality-finding-header">
                <div>
                  <h3>{finding.title}</h3>
                  <p className="muted">{findingTypeLabels[finding.type]} · {findingSeverityLabels[finding.severity]} · {findingStatusLabels[finding.status]}</p>
                  {finding.item && <p className="muted">Vinculado al ítem: {finding.item.description}</p>}
                  {finding.process && <p className="muted">Proceso: {finding.process.code} · {finding.process.name}</p>}
                  {finding.procedure && <p className="muted">Procedimiento: {finding.procedure.code} · {finding.procedure.name}</p>}
                </div>
                <div>
                  {!readonly && findingTransitions[finding.status].map((transition) => (
                    <button key={transition.to} type="button" className="text-button" disabled={busy} onClick={() => void changeFindingStatus(finding, transition.to)}>{transition.label}</button>
                  ))}
                  {!readonly && finding.status !== 'VERIFIED' && (
                    <>
                      <button type="button" className="text-button" onClick={() => { setFindingFor({ finding }); setFindingDraft(draftFromFinding(finding)) }}>Editar</button>
                      <button type="button" className="text-button danger" onClick={() => void removeFinding(finding)}>Eliminar</button>
                    </>
                  )}
                </div>
              </div>
              <p>{finding.description}</p>
              {finding.resolution && <p className="muted">Resolución: {finding.resolution}</p>}
              {finding.efficacyVerification && <p className="muted">Verificación de eficacia: {finding.efficacyVerification}</p>}
              {finding.type === 'NONCONFORMITY' && finding.status === 'RESOLVED' && !finding.efficacyVerification && !readonly && (
                <button type="button" className="text-button" onClick={() => { setFindingFor({ finding }); setFindingDraft(draftFromFinding(finding)) }}>Registrar verificación de eficacia</button>
              )}
              <div className="quality-actions">
                <p className="detail-label">ACCIONES CORRECTIVAS</p>
                {!readonly && (
                  <button type="button" className="text-button" onClick={() => { setActionFor({ findingId: finding.id, action: null }); setActionDraft(emptyActionDraft) }}>+ Acción</button>
                )}
                {(finding.actions ?? []).length === 0 ? (
                  <p className="muted">Sin acciones.</p>
                ) : (
                  (finding.actions ?? []).map((action) => (
                    <div key={action.id} className="quality-action">
                      <div>
                        <strong>{action.title}</strong>{action.required ? ' (obligatoria)' : ''}
                        <span className="muted"> · {actionPriorityLabels[action.priority]} · {actionStatusLabels[action.status]}</span>
                        {action.dueDate && <span className="muted"> · vence {formatMaybeDate(action.dueDate)}</span>}
                      </div>
                      <p className="muted">{action.description}</p>
                      {action.progress.length > 0 && (
                        <ul className="quality-progress">
                          {action.progress.map((entry) => (
                            <li key={entry.id}>{entry.note}{entry.percent !== null ? ` (${entry.percent}%)` : ''} <span className="muted">{formatMaybeDate(entry.createdAt)}</span></li>
                          ))}
                        </ul>
                      )}
                      {!readonly && (
                        <div>
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
                    </div>
                  ))
                )}
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
            <label className="procedure-field-wide">Descripción
              <textarea value={findingDraft.description} onChange={(event) => setFindingDraft((current) => ({ ...current, description: event.target.value }))} minLength={1} maxLength={5000} required rows={3} />
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
                <textarea value={findingDraft.efficacyVerification} onChange={(event) => setFindingDraft((current) => ({ ...current, efficacyVerification: event.target.value }))} maxLength={5000} rows={2} />
              </label>
            )}
            <div className="procedure-form-actions procedure-field-wide">
              <button type="submit" className="button primary" disabled={busy}>Guardar</button>
              <button type="button" className="button secondary" onClick={() => setFindingFor(null)}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      {actionFor && (
        <section className="panel quality-inline-panel">
          <p className="detail-label">{actionFor.action ? 'EDITAR ACCIÓN' : 'NUEVA ACCIÓN CORRECTIVA'}</p>
          <form onSubmit={saveAction} className="procedure-form">
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

      <section className="panel quality-evidence">
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
        {audit.evidences.length === 0 && (audit.evidenceFiles ?? []).length === 0 ? (
          <p className="muted">Sin evidencias todavía.</p>
        ) : (
          <>
            <ul className="quality-evidence-list">
              {audit.evidences.map((evidence) => (
                <li key={evidence.id}>
                  <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.name}</a>
                  <span className="muted"> — {evidence.description}</span>
                  {!readonly && <button type="button" className="text-button danger" onClick={() => void removeEvidence(evidence.id)}>×</button>}
                </li>
              ))}
              {(audit.evidenceFiles ?? []).map((file) => (
                <li key={file.id}>
                  <a href={apiUrl(`/audits/${audit.id}/evidence-files/${file.id}`)}>{file.filename}</a>
                  <span className="muted"> — {formatBytes(file.size)} · {file.uploadedBy?.name ?? '—'}</span>
                  {!readonly && <button type="button" className="text-button danger" onClick={() => void removeFile(file.id)}>×</button>}
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

      {evidenceFor && (
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
  )
}

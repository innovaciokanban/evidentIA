import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type {
  Audit,
  AuditStatus,
  Process,
  Procedure,
} from '../../types'
import { EmptyState } from '../ui/EmptyState'
import { KPICard } from '../ui/KPICard'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import { AuditDetailView } from './AuditDetailView'
import { AuditScopeSelect } from './AuditScopeSelect'
import {
  auditKinds,
  auditStatusLabels,
  draftFromAudit,
  emptyAuditDraft,
  isTerminalAudit,
  type AuditDraft,
  type QualityUser,
} from './quality.model'

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

  const qualitySummary = useMemo(() => audits.reduce((summary, audit) => {
    const indicators = audit.indicators
    return {
      active: summary.active + (audit.status === 'PLANNED' || audit.status === 'IN_PROGRESS' ? 1 : 0),
      closed: summary.closed + (audit.status === 'CLOSED' ? 1 : 0),
      openFindings: summary.openFindings + (indicators?.openFindings ?? audit.findings.filter((finding) => finding.status !== 'VERIFIED').length),
      pendingChecklist: summary.pendingChecklist + (indicators?.checklistRequiredPending ?? audit.checklistProgress?.requiredPending ?? 0),
      openActions: summary.openActions + (indicators?.openRequiredActions ?? audit.findings.flatMap((finding) => finding.actions ?? []).filter((action) => action.required && action.status !== 'COMPLETED' && action.status !== 'CANCELLED').length),
    }
  }, { active: 0, closed: 0, openFindings: 0, pendingChecklist: 0, openActions: 0 }), [audits])

  function startCreate() {
    setEditing(null)
    setDraft(emptyAuditDraft)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  async function startEdit(audit: Audit) {
    setFormError('')
    setNotice('')
    try {
      const result = await api<{ audit: Audit }>(`/audits/${audit.id}`)
      setEditing(result.audit)
      setDraft(draftFromAudit(result.audit))
    } catch (requestError) {
      setFormError(findErrorMessage(requestError, 'No se pudo cargar la auditoría para editarla.'))
      return
    }
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
    }
    try {
      if (editing) {
        await api<{ audit: Audit }>(`/audits/${editing.id}`, { method: 'PATCH', body: JSON.stringify(base) })
        await api(`/audits/${editing.id}/relations`, { method: 'PUT', body: JSON.stringify({ processIds: draft.processIds.filter((id) => id !== editing.processId), procedureIds: draft.procedureIds }) })
      } else {
        const anchorProcessId = draft.processIds[0]
        if (!anchorProcessId) {
          setFormError('Selecciona al menos un proceso para el alcance de la auditoría.')
          setSaving(false)
          return
        }
        await api<{ audit: Audit }>('/audits', { method: 'POST', body: JSON.stringify({ ...base, processId: anchorProcessId, processIds: draft.processIds, procedureIds: draft.procedureIds }) })
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
    <div className="quality-page page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUDITORÍAS DE CALIDAD</p>
          <h1>Auditorías de calidad</h1>
          <p className="muted">Planifica auditorías, evalúa listas de verificación, registra hallazgos con acciones correctivas y conserva la evidencia documental.</p>
        </div>
        {canWrite && !showForm && !selected && (
          <button type="button" className="button primary" onClick={startCreate}>+ Nueva auditoría</button>
        )}
      </div>

      {notice && <div className="notice success" role="status">{notice}</div>}
      {formError && <div className="notice error" role="alert">{formError}</div>}

      {showForm ? (
        <section className="panel quality-audit-form">
          <form onSubmit={saveAudit} className="procedure-form">
            <header className="procedure-form-header">
              <div>
                <p className="eyebrow">ASEGURAMIENTO DE CALIDAD</p>
                <h2>{editing ? `Editar ${editing.code}` : 'Nueva auditoría'}</h2>
                <p>Define el alcance, los criterios y las personas responsables antes de iniciar el seguimiento.</p>
              </div>
              <button type="button" className="text-button" onClick={() => setShowForm(false)}>Cancelar</button>
            </header>
            <section className="procedure-form-section">
              <div className="quality-form-section-heading"><span className="quality-form-section-number">01</span><div><strong>Identificación</strong><small>El contexto principal de la auditoría.</small></div></div>
              <div className="procedure-form-grid">
                <label className="procedure-field-wide">Título de la auditoría
                  <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={160} required placeholder="Ej. Auditoría interna de cumplimiento" />
                </label>
                <label>Tipo de auditoría
                  <select value={draft.auditType} onChange={(event) => setDraft((current) => ({ ...current, auditType: event.target.value as AuditDraft['auditType'] }))} required>
                    <option value="">Selecciona…</option>
                    {auditKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                </label>
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
              </div>
            </section>
            <section className="procedure-form-section quality-form-section-divider">
              <div className="quality-form-section-heading"><span className="quality-form-section-number">02</span><div><strong>Marco de revisión</strong><small>Acota qué se revisará y contra qué referencia.</small></div></div>
              <div className="procedure-form-grid">
                <div className="procedure-field-wide">
                  <AuditScopeSelect
                    processes={companyProcesses.map((process) => ({ id: process.id, label: `${process.code} · ${process.name}` }))}
                    procedures={procedures.filter((procedure) => companyProcesses.some((process) => process.id === procedure.processId)).map((procedure) => ({ id: procedure.id, label: `${procedure.code} · ${procedure.name}` }))}
                    processIds={draft.processIds}
                    procedureIds={draft.procedureIds}
                    lockedProcessId={editing?.processId ?? null}
                    onChange={(next) => setDraft((current) => ({ ...current, processIds: next.processIds, procedureIds: next.procedureIds }))}
                  />
                </div>
                <label className="procedure-field-wide">Descripción del alcance
                  <textarea value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value }))} minLength={3} maxLength={2000} required rows={2} />
                </label>
                <label className="procedure-field-wide">Objetivos
                  <textarea value={draft.objectives} onChange={(event) => setDraft((current) => ({ ...current, objectives: event.target.value }))} maxLength={5000} rows={2} />
                </label>
                <label className="procedure-field-wide">Criterios
                  <textarea value={draft.criteria} onChange={(event) => setDraft((current) => ({ ...current, criteria: event.target.value }))} minLength={3} maxLength={2000} required rows={2} />
                </label>
              </div>
            </section>
            <footer className="procedure-form-footer">
              <button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : (editing ? 'Guardar cambios' : 'Crear auditoría')}</button>
            </footer>
          </form>
        </section>
      ) : selected ? (
        <AuditDetailView
          audit={selected}
          users={users}
          processes={companyProcesses}
          canWrite={canWrite}
          onChanged={loadAudits}
          onBack={() => setSelectedId(null)}
          onEdit={() => void startEdit(selected)}
          onError={setFormError}
          onNotice={setNotice}
        />
      ) : (
        <>
          {!loading && !loadError && (
            <section className="metric-grid quality-metrics" aria-label="Resumen de auditorías">
              <KPICard icon="◎" label="Auditorías activas" value={qualitySummary.active} tone="blue" hint={`${qualitySummary.closed} cerradas`} />
              <KPICard icon="△" label="Hallazgos abiertos" value={qualitySummary.openFindings} tone="red" hint="Requieren seguimiento" />
              <KPICard icon="□" label="Checklist pendientes" value={qualitySummary.pendingChecklist} tone="amber" hint="Ítems obligatorios" />
              <KPICard icon="↗" label="Acciones abiertas" value={qualitySummary.openActions} tone="purple" hint="Correctivas obligatorias" />
            </section>
          )}
          <section className="panel">
            <div className="filters quality-filters">
              <div className="quality-filter-heading"><p className="detail-label">CONTROL DE AUDITORÍAS</p><strong>{filtered.length} de {audits.length} visibles</strong></div>
              <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por código, título o proceso…" aria-label="Buscar auditorías" /></div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado">
                <option value="">Todos los estados</option>
                {(Object.keys(auditStatusLabels) as AuditStatus[]).map((status) => (
                  <option key={status} value={status}>{auditStatusLabels[status]}</option>
                ))}
              </select>
            </div>
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
                const checklistTotal = indicators?.checklistTotal ?? audit.checklistProgress?.total ?? 0
                const requiredPending = indicators?.checklistRequiredPending ?? audit.checklistProgress?.requiredPending ?? 0
                const pendingRatio = checklistTotal > 0 ? Math.min(100, Math.round((requiredPending / checklistTotal) * 100)) : 0
                return (
                  <article key={audit.id} className="panel quality-audit-card">
                    <div className="quality-audit-card-header">
                      <div className="quality-audit-card-title">
                        <p className="detail-label">{audit.code}</p>
                        <h3>{audit.title}</h3>
                        <p className="muted">{audit.process.code} · {audit.process.name}{audit.auditType ? ` · ${audit.auditType}` : ''}</p>
                      </div>
                      <div className="quality-audit-card-actions">
                        <span className={`badge quality-status ${audit.status.toLowerCase()}`}>{auditStatusLabels[audit.status]}</span>
                        <div className="quality-audit-card-buttons">
                          <button type="button" className="button secondary small-button" onClick={() => setSelectedId(audit.id)}>Abrir</button>
                          {canWrite && (
                            <>
                              <button type="button" className="text-button" onClick={() => void startEdit(audit)}>Editar</button>
                              {!isTerminalAudit(audit) && audit.findings.length === 0 && (
                                <button type="button" className="text-button danger" onClick={() => void removeAudit(audit)}>Eliminar</button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {indicators && (
                      <div className="quality-indicators">
                        <span className="quality-indicator"><b className="quality-indicator-icon red">!</b><span><strong>{indicators.openFindings}</strong> hallazgos abiertos</span></span>
                        <span className="quality-indicator"><b className="quality-indicator-icon amber">□</b><span><strong>{indicators.checklistRequiredPending}</strong> checklist pendientes</span></span>
                        <span className="quality-indicator"><b className="quality-indicator-icon purple">↗</b><span><strong>{indicators.openRequiredActions}</strong> acciones abiertas</span></span>
                      </div>
                    )}
                    <div className="quality-audit-card-footer">
                      <div className="quality-audit-owner"><span className="avatar tiny">{(audit.responsible?.name ?? audit.leadAuditor?.name ?? '?').slice(0, 1).toUpperCase()}</span><span><small>Responsable</small><strong>{audit.responsible?.name ?? audit.leadAuditor?.name ?? 'Sin asignar'}</strong></span></div>
                      <span className="quality-audit-date">Planeada {formatMaybeDate(audit.plannedDate)}</span>
                      {checklistTotal > 0 && <div className="quality-required-progress" title={`${requiredPending} de ${checklistTotal} ítems obligatorios pendientes`}><span><small>Checklist</small><b>{requiredPending}/{checklistTotal} pendientes</b></span><span className="quality-progress-track"><i style={{ width: `${pendingRatio}%` }} /></span></div>}
                    </div>
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

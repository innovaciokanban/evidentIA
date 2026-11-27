import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type {
  Audit,
  AuditProgram,
  AuditProgramStatus,
  AuditStatus,
  Company,
  Process,
  Procedure,
  Role,
} from '../../types'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import { AuditDetailView } from './AuditDetailView'
import { AuditProgramsPage } from './AuditProgramsPage'
import { AuditScopeSelect } from './AuditScopeSelect'
import { AuditorBankPage } from './AuditorBankPage'
import { activeUserOptions, userOptionLabel } from '../../user-status'
import {
  auditKinds,
  auditExecutionSummary,
  auditStatusLabels,
  draftFromAudit,
  emptyAuditDraft,
  isTerminalAudit,
  type AuditDraft,
  type QualityUser,
} from './quality.model'

const shortDateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
type QualityWorkspaceView = 'summary' | 'programs' | 'audits'

const formatMaybeDate = (value: string | null | undefined) => (value ? shortDateFormatter.format(new Date(value)) : '—')

function findErrorMessage(requestError: unknown, fallback: string): string {
  if (requestError instanceof ApiError) return requestError.message
  return fallback
}

export function QualityPage({ user, initialAudits = [], initialLoading = true }: { user: { id: string; role: Role; companyId?: string | null }; initialAudits?: Audit[]; initialLoading?: boolean }) {
  const canWrite = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const [allUsers, setAllUsers] = useState<QualityUser[]>([])
  const [allProcesses, setAllProcesses] = useState<Process[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(user.role === 'SUPERUSER' ? '' : (user.companyId ?? ''))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [usersResult, processesResult] = await Promise.all([
          api<{ users: QualityUser[] }>('/users'),
          api<{ processes: Process[] }>('/processes'),
        ])
        const companiesResult = user.role === 'SUPERUSER' ? await api<{ companies: Company[] }>('/companies') : { companies: [] }
        if (!cancelled) {
          setAllUsers(usersResult.users)
          setAllProcesses(processesResult.processes)
          setCompanies(companiesResult.companies)
        }
      } catch (requestError) {
        console.error('[quality] failed to load users/processes', requestError)
      }
    })()
    return () => { cancelled = true }
  }, [user.role])

  const companyScope = user.role === 'SUPERUSER' ? selectedCompanyId : (user.companyId ?? '')
  const processes = useMemo(
    () => companyScope ? allProcesses.filter((process) => process.companyId === companyScope) : allProcesses,
    [allProcesses, companyScope],
  )
  const users = useMemo(() => allUsers.filter((person) => person.isActive !== false && (!companyScope || !person.companyId || person.companyId === companyScope)), [allUsers, companyScope])
  const companyProcesses = processes

  const [audits, setAudits] = useState<Audit[]>(initialAudits)
  const [loading, setLoading] = useState(initialLoading)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [programStatusFilter, setProgramStatusFilter] = useState<AuditProgramStatus | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Audit | null>(null)
  const [draft, setDraft] = useState<AuditDraft>(emptyAuditDraft)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspaceView, setWorkspaceView] = useState<QualityWorkspaceView>('summary')
  const [pendingProgramId, setPendingProgramId] = useState<string | null>(null)
  const [programRefreshKey, setProgramRefreshKey] = useState(0)
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [programs, setPrograms] = useState<AuditProgram[]>([])
  const [showAuditorBank, setShowAuditorBank] = useState(false)
  const historicalAuditUsers: QualityUser[] = editing ? [editing.leadAuditor, editing.responsible].filter((person): person is NonNullable<typeof person> => Boolean(person)).map((person) => ({ ...person, companyId: editing.companyId })) : []
  const auditUsers = activeUserOptions<QualityUser>(users, historicalAuditUsers)

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

  const visibleAudits = useMemo(() => companyScope ? audits.filter((audit) => audit.companyId === companyScope) : audits, [audits, companyScope])
  const filtered = visibleAudits.filter((audit) => {
    const term = search.trim().toLowerCase()
    const associatedProgram = programs.find((program) => program.id === audit.auditProgramId)
    const matchesSearch = !term || audit.code.toLowerCase().includes(term) || audit.title.toLowerCase().includes(term) || audit.process.name.toLowerCase().includes(term) || associatedProgram?.name.toLowerCase().includes(term)
    const matchesStatus = !statusFilter || audit.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const qualitySummary = useMemo(() => visibleAudits.reduce((summary, audit) => {
    const indicators = audit.indicators
    const execution = auditExecutionSummary(audit)
    return {
      active: summary.active + (audit.status === 'PLANNED' || audit.status === 'IN_PROGRESS' ? 1 : 0),
      closed: summary.closed + (audit.status === 'CLOSED' ? 1 : 0),
      openFindings: summary.openFindings + (indicators?.openFindings ?? execution.findingsOpen),
      pendingChecklist: summary.pendingChecklist + (indicators?.checklistRequiredPending ?? audit.checklistProgress?.requiredPending ?? execution.itemsRequiredPending),
      openActions: summary.openActions + (indicators?.openRequiredActions ?? execution.actionsRequiredOpen),
    }
  }, { active: 0, closed: 0, openFindings: 0, pendingChecklist: 0, openActions: 0 }), [visibleAudits])

  const auditIndicators = useMemo(() => ({
    scheduled: visibleAudits.filter((audit) => audit.status === 'PLANNED').length,
    inProgress: visibleAudits.filter((audit) => audit.status === 'IN_PROGRESS').length,
    openFindings: qualitySummary.openFindings,
    pendingActions: qualitySummary.openActions,
  }), [qualitySummary.openActions, qualitySummary.openFindings, visibleAudits])

  function startCreate(programId?: string) {
    setEditing(null)
    setDraft(emptyAuditDraft)
    setPendingProgramId(programId ?? null)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function openAudit(auditId: string) {
    setWorkspaceView('audits')
    setSelectedId(auditId)
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
        const created = await api<{ audit: Audit }>('/audits', { method: 'POST', body: JSON.stringify({ ...base, processId: anchorProcessId, processIds: draft.processIds, procedureIds: draft.procedureIds }) })
        if (pendingProgramId) {
          await api(`/audit-programs/${pendingProgramId}/audits`, { method: 'POST', body: JSON.stringify({ auditId: created.audit.id }) })
        }
      }
      await loadAudits()
      setProgramRefreshKey((current) => current + 1)
      setShowForm(false)
      setEditing(null)
      setPendingProgramId(null)
      setNotice(`Auditoría ${editing ? 'actualizada' : 'creada'} correctamente.`)
    } catch (requestError) {
      setFormError(findErrorMessage(requestError, 'No se pudo guardar la auditoría.'))
    } finally {
      setSaving(false)
      setPendingProgramId(null)
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

  if (showAuditorBank) {
    return <AuditorBankPage user={user} companies={companies} companyId={selectedCompanyId} onCompanyChange={(companyId) => setSelectedCompanyId(companyId)} onBack={() => setShowAuditorBank(false)} />
  }

  return (
    <div className="quality-page page">
      <nav className="quality-workspace-tabs" role="tablist" aria-label="Secciones de aseguramiento de calidad">
        <button type="button" role="tab" className={`quality-tab${workspaceView === 'summary' ? ' active' : ''}`} aria-selected={workspaceView === 'summary'} onClick={() => { setSelectedId(null); setWorkspaceView('summary') }}>Resumen</button>
        <button type="button" role="tab" className={`quality-tab${workspaceView === 'programs' ? ' active' : ''}`} aria-selected={workspaceView === 'programs'} onClick={() => { setSelectedId(null); setWorkspaceView('programs') }}>Programas</button>
        <button type="button" role="tab" className={`quality-tab${workspaceView === 'audits' ? ' active' : ''}`} aria-selected={workspaceView === 'audits'} onClick={() => { setSelectedId(null); setWorkspaceView('audits') }}>Auditorías <span>{visibleAudits.length}</span></button>
      </nav>

      {!showForm && !selected && <AuditProgramsPage
          key={workspaceView}
          user={user}
          users={users}
          processes={companyProcesses}
          audits={visibleAudits}
          search={search}
          programStatusFilter={programStatusFilter}
          auditStatusFilter={statusFilter as AuditStatus | ''}
          auditIndicators={auditIndicators}
          companyId={selectedCompanyId}
          companies={companies}
          refreshKey={programRefreshKey}
          view={workspaceView}
          onSearch={setSearch}
          onProgramStatusFilter={setProgramStatusFilter}
          onAuditStatusFilter={setStatusFilter}
          onCompanyChange={(companyId) => { setSelectedCompanyId(companyId); setSelectedId(null) }}
          onProgramsChange={setPrograms}
          onNewAudit={startCreate}
          onOpenAudit={openAudit}
          onNavigate={setWorkspaceView}
          onOpenAuditorBank={() => { setNotice(''); setFormError(''); setShowAuditorBank(true) }}
        />}

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
                    {auditUsers.filter((person) => !person.companyId || !companyScope || person.companyId === companyScope).map((person) => (
                      <option key={person.id} value={person.id}>{userOptionLabel(person)}</option>
                    ))}
                  </select>
                </label>
                <label>Responsable
                  <select value={draft.responsibleId} onChange={(event) => setDraft((current) => ({ ...current, responsibleId: event.target.value }))}>
                    <option value="">Sin asignar</option>
                    {auditUsers.filter((person) => !person.companyId || !companyScope || person.companyId === companyScope).map((person) => (
                      <option key={person.id} value={person.id}>{userOptionLabel(person)}</option>
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
                    procedures={procedures.filter((procedure) => companyProcesses.some((process) => process.id === procedure.processId)).map((procedure) => ({ id: procedure.id, processId: procedure.processId, label: `${procedure.code} · ${procedure.name}` }))}
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
          companyName={companies.find((company) => company.id === selected.companyId)?.name ?? (user.role === 'SUPERUSER' ? selected.companyId : 'Empresa actual')}
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
        workspaceView === 'audits' && !showForm ? (
           <section className="audit-independent-section audit-control-section">
           <div className="audit-independent-heading"><div><p className="eyebrow">SEGUIMIENTO OPERATIVO</p><h2>Control de auditorías</h2><p className="muted">Consulta cada auditoría, su programa asociado y el estado actual del seguimiento.</p></div><span className="audit-independent-count">{filtered.length}</span></div>
           {loading ? <LoadingState text="Cargando auditorías…" /> : loadError ? <div className="notice error" role="alert">{loadError}</div> : filtered.length === 0 ? (
             <EmptyState compact title="Sin auditorías" text="Crea una auditoría desde el menú Crear para iniciar el seguimiento." />
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
                         <p className="audit-program-association">{programs.find((program) => program.id === audit.auditProgramId) ? `Vinculada · ${programs.find((program) => program.id === audit.auditProgramId)?.name}` : 'Independiente · Sin programa asociado'}</p>
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
                      <div className="quality-audit-owner"><span className="avatar tiny">{(audit.responsible?.name ?? audit.leadAuditor?.name ?? '?').slice(0, 1).toUpperCase()}</span><span><small>Responsable</small><strong>{audit.responsible ? userOptionLabel(audit.responsible) : audit.leadAuditor ? userOptionLabel(audit.leadAuditor) : 'Sin asignar'}</strong></span></div>
                      <span className="quality-audit-date">Planeada {formatMaybeDate(audit.plannedDate)}</span>
                      {checklistTotal > 0 && <div className="quality-required-progress" title={`${requiredPending} de ${checklistTotal} ítems obligatorios pendientes`}><span><small>Checklist</small><b>{requiredPending}/{checklistTotal} pendientes</b></span><span className="quality-progress-track"><i style={{ width: `${pendingRatio}%` }} /></span></div>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
         </section>
       ) : null)}
    </div>
  )
}

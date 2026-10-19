import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Audit, AuditEvent, AuditFinding, AuditFindingSeverity, AuditFindingStatus, AuditFindingType, AuditStatus, Process, ProcessChangeItem, ProcessChangeValue, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import {
  auditEventLabels,
  auditStatusLabels,
  auditTransitions,
  draftFromAudit,
  draftFromFinding,
  emptyAuditDraft,
  emptyEvidenceDraft,
  emptyFindingDraft,
  findingSeverityLabels,
  findingStatusLabels,
  findingTransitions,
  findingTypeLabels,
  type AuditDraft,
  type EvidenceDraft,
  type FindingDraft,
} from './ProcessAuditPanel.model'

export type AuditUser = Pick<User, 'id' | 'name'> & { companyId: string | null }

export type { AuditDraft, EvidenceDraft, FindingDraft } from './ProcessAuditPanel.model'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
const shortDateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

const changeValueLabel = (change: ProcessChangeItem, value: ProcessChangeValue) => {
  if (change.field === 'status') return auditStatusLabels[value as AuditStatus] ?? findingStatusLabels[value as AuditFindingStatus] ?? String(value)
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value
}

export function ProcessAuditPanel({ process, users, canWrite, onBack }: { process: Process; users: AuditUser[]; canWrite: boolean; onBack: () => void }) {
  const [audits, setAudits] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Audit | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AuditDraft>(emptyAuditDraft)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [findingDraft, setFindingDraft] = useState<FindingDraft>(emptyFindingDraft)
  const [findingFor, setFindingFor] = useState<{ auditId: string; finding: AuditFinding | null } | null>(null)
  const [findingSaving, setFindingSaving] = useState(false)
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(emptyEvidenceDraft)
  const [evidenceFor, setEvidenceFor] = useState<{ auditId: string; findings: AuditFinding[] } | null>(null)
  const [evidenceSaving, setEvidenceSaving] = useState(false)

  const availableUsers = users.filter((user) => user.companyId === process.companyId)

  const loadAudits = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ audits: Audit[] }>(`/processes/${process.id}/audits`)
      setAudits(result.audits)
    } catch (requestError) {
      console.error('[process-audits] failed to load audits', requestError)
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar las auditorías.')
    } finally {
      setLoading(false)
    }
  }, [process.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAudits() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAudits])

  const filtered = audits.filter((audit) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || audit.code.toLowerCase().includes(term) || audit.title.toLowerCase().includes(term)
    const matchesStatus = !statusFilter || audit.status === statusFilter
    return matchesSearch && matchesStatus
  })

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setFormError('')
  }

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
    const payload = {
      title: draft.title,
      auditType: draft.auditType.trim() || null,
      scope: draft.scope,
      objectives: draft.objectives.trim() || null,
      criteria: draft.criteria,
      plannedDate: draft.plannedDate || null,
      leadAuditorId: draft.leadAuditorId || null,
      responsibleId: draft.responsibleId || null,
    }
    try {
      if (editing) {
        await api<{ audit: Audit }>(`/processes/${process.id}/audits/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api<{ audit: Audit }>(`/processes/${process.id}/audits`, { method: 'POST', body: JSON.stringify(payload) })
      }
      await loadAudits()
      closeForm()
      setNotice(`Auditoría ${editing ? 'actualizada' : 'creada'} correctamente.`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar la auditoría.')
    } finally {
      setSaving(false)
    }
  }

  async function removeAudit(audit: Audit) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar auditoría', message: `Se eliminará «${audit.title}» y su historial sin hallazgos. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}/audits/${audit.id}`, { method: 'DELETE' })
      await loadAudits()
      setNotice('Auditoría eliminada correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar la auditoría.')
    }
  }

  async function changeStatus(audit: Audit, to: AuditStatus) {
    if (!canWrite) return
    // Cerrarse exige resumen: se pide en el mismo diálogo de confirmación.
    let summary: string | undefined
    if (to === 'CLOSED') {
      const input = window.prompt('Resumen de cierre de la auditoría (obligatorio):')
      if (input === null) return
      summary = input.trim()
      if (summary.length < 3) {
        setFormError('El resumen de cierre debe tener al menos 3 caracteres.')
        return
      }
    } else {
      const confirmed = await askConfirm({
        title: auditStatusLabels[to],
        message: `«${audit.title}» pasará de «${auditStatusLabels[audit.status]}» a «${auditStatusLabels[to]}».`,
        confirmLabel: 'Continuar',
      })
      if (!confirmed) return
    }
    setFormError('')
    setNotice('')
    try {
      await api<{ audit: Audit }>(`/processes/${process.id}/audits/${audit.id}/status`, { method: 'POST', body: JSON.stringify({ status: to, ...(summary ? { summary } : {}) }) })
      await loadAudits()
      setNotice(`Auditoría actualizada a «${auditStatusLabels[to]}».`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo cambiar el estado de la auditoría.')
    }
  }

  async function toggleHistory(audit: Audit) {
    if (historyFor === audit.id) {
      setHistoryFor(null)
      setHistory([])
      setHistoryError('')
      return
    }
    setHistoryFor(audit.id)
    setHistory([])
    setHistoryError('')
    setHistoryLoading(true)
    try {
      const result = await api<{ events: AuditEvent[] }>(`/processes/${process.id}/audits/${audit.id}/history?pageSize=50`)
      setHistory(result.events)
    } catch (requestError) {
      setHistoryError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar el historial de la auditoría.')
    } finally {
      setHistoryLoading(false)
    }
  }

  function startFinding(audit: Audit, finding: AuditFinding | null) {
    setFindingFor({ auditId: audit.id, finding })
    setFindingDraft(finding ? draftFromFinding(finding) : { ...emptyFindingDraft, responsibleId: audit.responsible?.id ?? '' })
    setFormError('')
  }

  async function saveFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!findingFor || findingSaving) return
    setFindingSaving(true)
    setFormError('')
    const payload = {
      title: findingDraft.title,
      description: findingDraft.description,
      type: findingDraft.type,
      severity: findingDraft.severity,
      dueDate: findingDraft.dueDate || null,
      responsibleId: findingDraft.responsibleId || null,
    }
    try {
      if (findingFor.finding) {
        await api(`/processes/${process.id}/audits/${findingFor.auditId}/findings/${findingFor.finding.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api(`/processes/${process.id}/audits/${findingFor.auditId}/findings`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setFindingFor(null)
      await loadAudits()
      setNotice(findingFor.finding ? 'Hallazgo actualizado correctamente.' : 'Hallazgo creado correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el hallazgo.')
    } finally {
      setFindingSaving(false)
    }
  }

  async function changeFindingStatus(audit: Audit, finding: AuditFinding, to: AuditFindingStatus) {
    if (!canWrite) return
    let resolution: string | undefined
    if (to === 'RESOLVED') {
      const input = window.prompt('Resolución del hallazgo (obligatoria):')
      if (input === null) return
      resolution = input.trim()
      if (resolution.length < 3) {
        setFormError('La resolución debe tener al menos 3 caracteres.')
        return
      }
    } else {
      const confirmed = await askConfirm({
        title: findingStatusLabels[to],
        message: `«${finding.title}» pasará de «${findingStatusLabels[finding.status]}» a «${findingStatusLabels[to]}».`,
        confirmLabel: 'Continuar',
      })
      if (!confirmed) return
    }
    setFormError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}/audits/${audit.id}/findings/${finding.id}/status`, { method: 'POST', body: JSON.stringify({ status: to, ...(resolution ? { resolution } : {}) }) })
      await loadAudits()
      setNotice(`Hallazgo actualizado a «${findingStatusLabels[to]}».`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo cambiar el estado del hallazgo.')
    }
  }

  async function removeFinding(audit: Audit, finding: AuditFinding) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar hallazgo', message: `Se eliminará el hallazgo «${finding.title}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}/audits/${audit.id}/findings/${finding.id}`, { method: 'DELETE' })
      await loadAudits()
      setNotice('Hallazgo eliminado correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el hallazgo.')
    }
  }

  function startEvidence(audit: Audit) {
    setEvidenceFor({ auditId: audit.id, findings: audit.findings })
    setEvidenceDraft(emptyEvidenceDraft)
    setFormError('')
  }

  async function saveEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!evidenceFor || evidenceSaving) return
    setEvidenceSaving(true)
    setFormError('')
    try {
      await api(`/processes/${process.id}/audits/${evidenceFor.auditId}/evidences`, {
        method: 'POST',
        body: JSON.stringify({
          name: evidenceDraft.name,
          description: evidenceDraft.description,
          url: evidenceDraft.url,
          findingId: evidenceDraft.findingId || null,
        }),
      })
      setEvidenceFor(null)
      await loadAudits()
      setNotice('Evidencia registrada correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo registrar la evidencia.')
    } finally {
      setEvidenceSaving(false)
    }
  }

  async function removeEvidence(audit: Audit, evidenceId: string) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar evidencia', message: 'Se eliminará la evidencia seleccionada. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}/audits/${audit.id}/evidences/${evidenceId}`, { method: 'DELETE' })
      await loadAudits()
      setNotice('Evidencia eliminada correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar la evidencia.')
    }
  }

  const isTerminal = (audit: Audit) => audit.status === 'CLOSED' || audit.status === 'CANCELLED'

  return (
    <div className="process-procedure-page process-audit-page">
      <div className="procedure-page-header">
        <button type="button" className="text-button procedure-back-button" onClick={onBack}>← Volver a la caracterización</button>
        <div className="procedure-page-heading">
          <div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO AUDITORÍAS</p><h1>Auditorías</h1><p className="muted">Planifica, ejecuta y da seguimiento a las auditorías de calidad de este proceso, con hallazgos, evidencias e historial.</p></div>
          {!showForm && canWrite && <button type="button" className="button primary" onClick={startCreate}>+ Nueva auditoría</button>}
        </div>
      </div>

      <section className="panel procedure-process-context">
        <div><span>Proceso</span><strong>{process.name}</strong></div>
        <div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div>
        <div><span>Auditorías</span><strong>{audits.length}</strong></div>
      </section>

      {notice && !showForm && <div className="form-success page-alert" role="status">{notice}</div>}
      {formError && !showForm && <div className="form-error page-alert" role="alert">{formError}</div>}
      {showForm ? (
        <form className="procedure-form panel" onSubmit={(event) => void saveAudit(event)}>
          <header className="procedure-form-header">
            <div>
              <p className="eyebrow">AUDITORÍAS</p>
              <h2>{editing ? 'EDITAR AUDITORÍA' : 'NUEVA AUDITORÍA'}</h2>
              <p>Planifica el alcance, los criterios y los responsables. El código se genera automáticamente de forma única dentro de la empresa.</p>
            </div>
            <button type="button" className="button secondary" onClick={closeForm}>Cancelar</button>
          </header>
          {formError && <div className="form-error procedure-form-error" role="alert">{formError}</div>}
          <section className="procedure-form-section">
            <div className="procedure-form-grid">
              <label className="procedure-field-wide">Título de la auditoría<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Ej. Auditoría interna de cumplimiento" minLength={3} maxLength={160} required /></label>
              <label>Tipo de auditoría<input value={draft.auditType} onChange={(event) => setDraft((current) => ({ ...current, auditType: event.target.value }))} placeholder="Ej. Interna, externa, mixta" maxLength={80} /></label>
              <label>Fecha planificada<input type="date" value={draft.plannedDate} onChange={(event) => setDraft((current) => ({ ...current, plannedDate: event.target.value }))} /></label>
              <label>Auditor líder<select value={draft.leadAuditorId} onChange={(event) => setDraft((current) => ({ ...current, leadAuditorId: event.target.value }))}><option value="">Sin asignar</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
              <label>Responsable del proceso<select value={draft.responsibleId} onChange={(event) => setDraft((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Sin asignar</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
              <label className="procedure-field-wide">Alcance<textarea value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value }))} placeholder="Qué cubre la auditoría y qué queda por fuera" rows={3} maxLength={2000} required /></label>
              <label className="procedure-field-wide">Objetivos<textarea value={draft.objectives} onChange={(event) => setDraft((current) => ({ ...current, objectives: event.target.value }))} placeholder="Qué se busca comprobar o mejorar (opcional)" rows={3} maxLength={2000} /></label>
              <label className="procedure-field-wide">Criterios<textarea value={draft.criteria} onChange={(event) => setDraft((current) => ({ ...current, criteria: event.target.value }))} placeholder="Normas, procedimientos o requisitos contra los que se audita" rows={3} maxLength={2000} required /></label>
            </div>
          </section>
          <footer className="procedure-form-footer">
            <button type="button" className="button secondary" onClick={closeForm}>Cancelar</button>
            <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear auditoría'}</button>
          </footer>
        </form>
      ) : (
        <section className="panel procedure-list-panel">
          <div className="panel-heading procedure-list-heading"><div><p className="detail-label">AUDITORÍAS DEL PROCESO</p><h2>Listado de auditorías</h2></div><span className="procedure-list-note">Seguimiento y evidencia</span></div>
          {audits.length > 0 && (
            <div className="filters">
              <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por código o título..." aria-label="Buscar auditorías por código o título" /></div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado">
                <option value="">Todos los estados</option>
                {(Object.keys(auditStatusLabels) as AuditStatus[]).map((status) => <option key={status} value={status}>{auditStatusLabels[status]}</option>)}
              </select>
            </div>
          )}
          {loadError && <div className="form-error procedure-list-error" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadAudits()}>Reintentar</button></div>}
          {loading ? <div className="inline-loading"><span className="loader" />Cargando auditorías...</div> : audits.length === 0 ? (
            <div className="procedure-empty"><span className="procedure-empty-icon">◌</span><h3>Aún no hay auditorías</h3><p>Planifica la primera auditoría de calidad de este proceso para empezar su seguimiento.</p>{canWrite && <button type="button" className="button secondary" onClick={startCreate}>Crear primera auditoría</button>}</div>
          ) : filtered.length === 0 ? (
            <div className="procedure-empty"><span className="procedure-empty-icon">⌕</span><h3>Sin resultados</h3><p>Ninguna auditoría coincide con la búsqueda o el filtro de estado.</p></div>
          ) : (
            <div className="procedure-table-wrap">
              <div className="procedure-table-head audit-table-head"><span>Código</span><span>Auditoría</span><span>Estado</span><span>Hallazgos</span><span /></div>
              {filtered.map((audit) => {
                const expanded = expandedId === audit.id
                const openFindings = audit.findings.filter((finding) => finding.status !== 'VERIFIED').length
                return <article className={`procedure-row${expanded ? ' expanded' : ''}`} key={audit.id}>
                  <button type="button" className="procedure-row-summary" onClick={() => setExpandedId(expanded ? null : audit.id)} aria-expanded={expanded}>
                    <span className="procedure-code-cell">{audit.code}</span>
                    <span className="procedure-name-cell"><strong>{audit.title}</strong><small>{audit.auditType ? `${audit.auditType} · ` : ''}{audit.scope}</small></span>
                    <span className={`procedure-status audit-status-${audit.status.toLowerCase()}`}>{auditStatusLabels[audit.status]}</span>
                    <span className="procedure-version-cell">{audit.findings.length > 0 ? `${openFindings}/${audit.findings.length}` : '0'}</span>
                    <span className="procedure-expand-icon">{expanded ? '⌃' : '⌄'}</span>
                  </button>
                  {expanded && <div className="procedure-detail">
                    <div className="procedure-detail-grid">
                      <div><span>Título</span><p>{audit.title}</p></div>
                      <div><span>Tipo</span><p>{audit.auditType ?? 'Sin tipo'}</p></div>
                      <div><span>Alcance</span><p>{audit.scope}</p></div>
                      <div><span>Objetivos</span><p>{audit.objectives ?? 'Sin objetivos'}</p></div>
                      <div><span>Criterios</span><p>{audit.criteria}</p></div>
                      <div><span>Auditor líder</span><p>{audit.leadAuditor?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Responsable</span><p>{audit.responsible?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Fecha planificada</span><p>{audit.plannedDate ? shortDateFormatter.format(new Date(audit.plannedDate)) : 'Sin fecha'}</p></div>
                      <div><span>Inicio</span><p>{audit.startDate ? dateFormatter.format(new Date(audit.startDate)) : '—'}</p></div>
                      <div><span>Cierre</span><p>{audit.endDate ? dateFormatter.format(new Date(audit.endDate)) : '—'}</p></div>
                      {audit.summary && <div className="audit-summary-field"><span>Resumen de cierre</span><p>{audit.summary}</p></div>}
                    </div>
                    {canWrite && !isTerminal(audit) && <div className="procedure-detail-actions">
                      {auditTransitions[audit.status].map((transition) => <button type="button" className="button secondary small-button" key={transition.to} onClick={() => void changeStatus(audit, transition.to)}>{transition.label}</button>)}
                      <button type="button" className="button secondary small-button" onClick={() => startEdit(audit)}>Editar</button>
                      {audit.findings.length === 0 && <button type="button" className="button danger small-button" onClick={() => void removeAudit(audit)}>Eliminar</button>}
                    </div>}
                    {isTerminal(audit) && <p className="audit-terminal-note">Auditoría {auditStatusLabels[audit.status].toLowerCase()}: las escrituras quedan bloqueadas.</p>}

                    <div className="audit-subsection">
                      <div className="audit-subsection-heading">
                        <div><p className="detail-label">HALLAZGOS</p><h4>{audit.findings.length} registrados</h4></div>
                        {canWrite && !isTerminal(audit) && <button type="button" className="button secondary small-button" onClick={() => startFinding(audit, null)}>+ Agregar hallazgo</button>}
                      </div>
                      {audit.findings.length === 0 ? (
                        <p className="audit-empty-note">Sin hallazgos registrados.</p>
                      ) : (
                        <div className="audit-finding-list">
                          {audit.findings.map((finding) => (
                            <article className="audit-finding-card" key={finding.id}>
                              <header className="audit-finding-header">
                                <div>
                                  <span className={`audit-badge audit-badge-${finding.severity.toLowerCase()}`}>{findingSeverityLabels[finding.severity]}</span>
                                  <span className={`audit-badge audit-badge-type`}>{findingTypeLabels[finding.type]}</span>
                                  <span className={`audit-badge audit-badge-status-${finding.status.toLowerCase()}`}>{findingStatusLabels[finding.status]}</span>
                                </div>
                                {canWrite && !isTerminal(audit) && finding.status !== 'VERIFIED' && <div className="audit-finding-actions">
                                  {findingTransitions[finding.status].map((transition) => <button type="button" className="button secondary small-button" key={transition.to} onClick={() => void changeFindingStatus(audit, finding, transition.to)}>{transition.label}</button>)}
                                  <button type="button" className="button secondary small-button" onClick={() => startFinding(audit, finding)}>Editar</button>
                                  <button type="button" className="button danger small-button" onClick={() => void removeFinding(audit, finding)}>Eliminar</button>
                                </div>}
                              </header>
                              <h5>{finding.title}</h5>
                              <p className="audit-finding-description">{finding.description}</p>
                              <div className="audit-finding-meta">
                                <span>Responsable: <strong>{finding.responsible?.name ?? 'Sin asignar'}</strong></span>
                                {finding.dueDate && <span>Fecha límite: <strong>{shortDateFormatter.format(new Date(finding.dueDate))}</strong></span>}
                                {finding.resolution && <span>Resolución: <strong>{finding.resolution}</strong></span>}
                                {finding.verifiedBy && <span>Verificado por: <strong>{finding.verifiedBy.name}</strong>{finding.verifiedAt ? ` · ${dateFormatter.format(new Date(finding.verifiedAt))}` : ''}</span>}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="audit-subsection">
                      <div className="audit-subsection-heading">
                        <div><p className="detail-label">EVIDENCIAS</p><h4>{audit.evidences.length} registradas</h4></div>
                        {canWrite && !isTerminal(audit) && <button type="button" className="button secondary small-button" onClick={() => startEvidence(audit)}>+ Agregar evidencia</button>}
                      </div>
                      {audit.evidences.length === 0 ? (
                        <p className="audit-empty-note">Sin evidencias registradas.</p>
                      ) : (
                        <div className="audit-evidence-list">
                          {audit.evidences.map((evidence) => {
                            const linkedFinding = audit.findings.find((finding) => finding.id === evidence.findingId)
                            return <article className="audit-evidence-card" key={evidence.id}>
                              <header>
                                <strong>{evidence.name}</strong>
                                {canWrite && !isTerminal(audit) && <button type="button" className="button danger small-button" onClick={() => void removeEvidence(audit, evidence.id)}>Eliminar</button>}
                              </header>
                              <p>{evidence.description}</p>
                              <p className="audit-evidence-link"><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.url}</a>{linkedFinding && <span className="audit-badge">Hallazgo: {linkedFinding.title}</span>}</p>
                            </article>
                          })}
                        </div>
                      )}
                    </div>

                    <div className="procedure-history-toggle">
                      <button type="button" className="text-button" onClick={() => void toggleHistory(audit)}>{historyFor === audit.id ? 'Ocultar historial' : 'Ver historial de la auditoría'}</button>
                    </div>
                    {historyFor === audit.id && (historyLoading ? (
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
                                <div><h3>{auditEventLabels[entry.eventType]}</h3></div>
                                <time dateTime={entry.occurredAt}>{dateFormatter.format(new Date(entry.occurredAt))}</time>
                              </header>
                              <p className="history-actor">Responsable del cambio: <strong>{entry.actorName ?? entry.actor?.name ?? 'Usuario no disponible'}</strong>{entry.actorEmail && <span> · {entry.actorEmail}</span>}</p>
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

      {findingFor && (
        <form className="procedure-form panel" onSubmit={(event) => void saveFinding(event)}>
          <header className="procedure-form-header">
            <div>
              <p className="eyebrow">HALLAZGOS</p>
              <h2>{findingFor.finding ? 'EDITAR HALLAZGO' : 'NUEVO HALLAZGO'}</h2>
              <p>Registra no conformidades, observaciones u oportunidades detectadas durante la auditoría.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => setFindingFor(null)}>Cancelar</button>
          </header>
          {formError && <div className="form-error procedure-form-error" role="alert">{formError}</div>}
          <section className="procedure-form-section">
            <div className="procedure-form-grid">
              <label className="procedure-field-wide">Título<input value={findingDraft.title} onChange={(event) => setFindingDraft((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={200} required /></label>
              <label className="procedure-field-wide">Descripción<textarea value={findingDraft.description} onChange={(event) => setFindingDraft((current) => ({ ...current, description: event.target.value }))} rows={3} maxLength={5000} required /></label>
              <label>Tipo<select value={findingDraft.type} onChange={(event) => setFindingDraft((current) => ({ ...current, type: event.target.value as AuditFindingType }))}>{(Object.keys(findingTypeLabels) as AuditFindingType[]).map((type) => <option key={type} value={type}>{findingTypeLabels[type]}</option>)}</select></label>
              <label>Severidad<select value={findingDraft.severity} onChange={(event) => setFindingDraft((current) => ({ ...current, severity: event.target.value as AuditFindingSeverity }))}>{(Object.keys(findingSeverityLabels) as AuditFindingSeverity[]).map((severity) => <option key={severity} value={severity}>{findingSeverityLabels[severity]}</option>)}</select></label>
              <label>Fecha límite<input type="date" value={findingDraft.dueDate} onChange={(event) => setFindingDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
              <label>Responsable<select value={findingDraft.responsibleId} onChange={(event) => setFindingDraft((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Sin asignar</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            </div>
          </section>
          <footer className="procedure-form-footer">
            <button type="button" className="button secondary" onClick={() => setFindingFor(null)}>Cancelar</button>
            <button type="submit" className="button primary" disabled={findingSaving}>{findingSaving ? 'Guardando...' : findingFor.finding ? 'Guardar cambios' : 'Crear hallazgo'}</button>
          </footer>
        </form>
      )}

      {evidenceFor && (
        <form className="procedure-form panel" onSubmit={(event) => void saveEvidence(event)}>
          <header className="procedure-form-header">
            <div>
              <p className="eyebrow">EVIDENCIAS</p>
              <h2>NUEVA EVIDENCIA</h2>
              <p>Registra un enlace http(s) a la evidencia documental de la auditoría o de uno de sus hallazgos.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => setEvidenceFor(null)}>Cancelar</button>
          </header>
          {formError && <div className="form-error procedure-form-error" role="alert">{formError}</div>}
          <section className="procedure-form-section">
            <div className="procedure-form-grid">
              <label className="procedure-field-wide">Nombre<input value={evidenceDraft.name} onChange={(event) => setEvidenceDraft((current) => ({ ...current, name: event.target.value }))} minLength={3} maxLength={160} required /></label>
              <label className="procedure-field-wide">Descripción<textarea value={evidenceDraft.description} onChange={(event) => setEvidenceDraft((current) => ({ ...current, description: event.target.value }))} rows={3} maxLength={2000} required /></label>
              <label className="procedure-field-wide">Enlace http(s)<input type="url" value={evidenceDraft.url} onChange={(event) => setEvidenceDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." maxLength={500} required /></label>
              <label>Hallazgo asociado<select value={evidenceDraft.findingId} onChange={(event) => setEvidenceDraft((current) => ({ ...current, findingId: event.target.value }))}><option value="">Auditoría (sin hallazgo)</option>{evidenceFor.findings.filter((finding) => finding.status !== 'VERIFIED').map((finding) => <option key={finding.id} value={finding.id}>{finding.title}</option>)}</select></label>
            </div>
          </section>
          <footer className="procedure-form-footer">
            <button type="button" className="button secondary" onClick={() => setEvidenceFor(null)}>Cancelar</button>
            <button type="submit" className="button primary" disabled={evidenceSaving}>{evidenceSaving ? 'Guardando...' : 'Registrar evidencia'}</button>
          </footer>
        </form>
      )}
    </div>
  )
}

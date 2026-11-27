import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, ApiError } from '../../api'
import type { Audit, AuditProgram, AuditProgramAudit, AuditProgramStatus, AuditStatus, Company, Process, User } from '../../types'
import { EmptyState } from '../ui/EmptyState'
import { KPICard } from '../ui/KPICard'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import {
  auditProgramDraftFromProgram,
  auditProgress,
  auditProgramProgress,
  auditProgramStats,
  auditProgramStatusLabels,
  auditProgramStatusOptions,
  emptyAuditProgramDraft,
  isTerminalAuditProgram,
  type AuditProgramDraft,
} from './audit-program.model'
import { auditExecutionSummary, auditStatusLabels, findingStatusLabels, type QualityUser } from './quality.model'
import { AuditProgramProcessPriorityMatrix } from './AuditProgramProcessPriority'
import { auditProgramLoadErrorMessage } from './audit-program-error'

type ProgramsUser = Pick<User, 'id' | 'role'> & { companyId?: string | null }

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

const datePart = (value: string) => value.slice(0, 10)
const dateValue = (value: string, hour = '12') => new Date(`${datePart(value)}T${hour}:00:00`)
const formatDate = (value: string) => dateFormatter.format(dateValue(value))

const userLabel = (person: Pick<User, 'name'> | null) => person?.name ?? 'Sin asignar'

const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

const chartColors = ['#2563eb', '#d97706', '#16a34a', '#7c3aed', '#94a3b8']

const auditHasChecklist = (audit: Audit): boolean => Boolean(audit.checklistProgress || audit.checklists?.length)

const initialDraftFor = (user: ProgramsUser, companyId?: string): AuditProgramDraft => ({
  ...emptyAuditProgramDraft,
  companyId: companyId ?? user.companyId ?? '',
})

type AuditIndicators = { scheduled: number; inProgress: number; openFindings: number; pendingActions: number }
type QualityWorkspaceView = 'summary' | 'programs' | 'audits'

type AuditProgramsPageProps = {
  user: ProgramsUser
  users: QualityUser[]
  processes?: Process[]
  audits?: Audit[]
  search?: string
  programStatusFilter?: AuditProgramStatus | ''
  auditStatusFilter?: AuditStatus | ''
  auditIndicators?: AuditIndicators
  companyId?: string
  companies?: Company[]
  refreshKey?: number
  onSearch?: (value: string) => void
  onProgramStatusFilter?: (value: AuditProgramStatus | '') => void
  onAuditStatusFilter?: (value: AuditStatus | '') => void
  onCompanyChange?: (value: string) => void
  onProgramsChange?: (programs: AuditProgram[]) => void
  onNewAudit?: (programId?: string) => void
  onOpenAudit?: (auditId: string) => void
  onOpenAuditorBank?: () => void
  onNavigate?: (view: QualityWorkspaceView) => void
  view?: QualityWorkspaceView
}

const auditStatusFilterOptions: Array<{ value: AuditStatus | ''; label: string }> = [
  { value: '', label: 'Auditorías: todos los estados' },
  ...Object.entries(auditStatusLabels).map(([value, label]) => ({ value: value as AuditStatus, label: `Auditorías: ${label}` })),
]

export function AuditProgramsPage({
  user,
  users,
  processes = [],
  audits = [],
  search = '',
  programStatusFilter = '',
  auditStatusFilter = '',
  auditIndicators = { scheduled: 0, inProgress: 0, openFindings: 0, pendingActions: 0 },
  companyId = user.companyId ?? '',
  companies = [],
  refreshKey = 0,
  onSearch = () => undefined,
  onProgramStatusFilter = () => undefined,
  onAuditStatusFilter = () => undefined,
  onCompanyChange = () => undefined,
  onProgramsChange = () => undefined,
  onNewAudit = () => undefined,
  onOpenAudit = () => undefined,
  onOpenAuditorBank = () => undefined,
  onNavigate = () => undefined,
  view = 'programs',
}: AuditProgramsPageProps) {
  const canWrite = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const [programs, setPrograms] = useState<AuditProgram[]>([])
  const [loading, setLoading] = useState(view === 'programs')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AuditProgram | null>(null)
  const [expandedProgramId, setExpandedProgramId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AuditProgramDraft>(initialDraftFor(user))
  const [previewCode, setPreviewCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)

  const loadPrograms = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const query = user.role === 'SUPERUSER' && companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
      const result = await api<{ programs: AuditProgram[] }>(`/audit-programs${query}`)
      setPrograms(result.programs)
      onProgramsChange(result.programs)
    } catch (error) {
      setLoadError(auditProgramLoadErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [companyId, onProgramsChange, user.role])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPrograms() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadPrograms, refreshKey])

  const stats = useMemo(() => auditProgramStats(programs), [programs])
  const selectedProgram = programs.find((program) => program.id === selectedProgramId) ?? null
  const programCompliance = useMemo(() => {
    const totalAudits = programs.reduce((sum, program) => sum + program.auditSummary.total, 0)
    if (totalAudits === 0) return null
    const terminalAudits = programs.reduce((sum, program) => sum + program.auditSummary.terminal, 0)
    return Math.round((terminalAudits / totalAudits) * 100)
  }, [programs])
  const filteredPrograms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return programs.filter((program) => {
      const matchesSearch = !normalizedSearch || program.code.toLowerCase().includes(normalizedSearch) || program.name.toLowerCase().includes(normalizedSearch)
      const matchesStatus = !programStatusFilter || program.status === programStatusFilter
      return matchesSearch && matchesStatus
    })
  }, [programs, programStatusFilter, search])
  const upcomingAudits = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return audits
      .filter((audit) => audit.status === 'PLANNED' && audit.plannedDate && dateValue(audit.plannedDate, '00') >= today)
      .sort((left, right) => dateValue(left.plannedDate ?? '', '00').getTime() - dateValue(right.plannedDate ?? '', '00').getTime())
      .slice(0, 5)
  }, [audits])
  const recentAudits = useMemo(() => [...audits].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()).slice(0, 5), [audits])
  const overdueAudits = useMemo(() => audits.filter((audit) => audit.status === 'PLANNED' && audit.plannedDate && new Date(audit.plannedDate) < new Date()), [audits])
  const auditStatusChart = useMemo(() => [
    { name: auditStatusLabels.PLANNED, value: audits.filter((audit) => audit.status === 'PLANNED').length },
    { name: auditStatusLabels.IN_PROGRESS, value: audits.filter((audit) => audit.status === 'IN_PROGRESS').length },
    { name: auditStatusLabels.CLOSED, value: audits.filter((audit) => audit.status === 'CLOSED').length },
    { name: auditStatusLabels.CANCELLED, value: audits.filter((audit) => audit.status === 'CANCELLED').length },
  ].filter((item) => item.value > 0), [audits])
  const findingStatusChart = useMemo(() => {
    const findings = audits.flatMap((audit) => audit.findings)
    return Object.entries(findingStatusLabels).map(([status, label]) => ({ name: label, value: findings.filter((finding) => finding.status === status).length })).filter((item) => item.value > 0)
  }, [audits])
  const findingTotalCount = useMemo(() => audits.reduce((total, audit) => total + (audit.indicators?.findings ?? auditExecutionSummary(audit).findingsTotal), 0), [audits])

  const activeUsers = useMemo(() => users.filter((person) => person.isActive !== false && (user.role === 'SUPERUSER' ? person.companyId === draft.companyId : person.companyId === user.companyId)), [draft.companyId, user.companyId, user.role, users])
  const selectedCompany = companies.find((company) => company.id === draft.companyId)
  const pageTitle = view === 'programs' ? 'Programas de auditoría' : view === 'audits' ? 'Auditorías' : 'Aseguramiento de la calidad'
  const pageDescription = view === 'programs'
    ? 'Organiza los ciclos de revisión, sus responsables y las auditorías vinculadas.'
    : view === 'audits'
      ? 'Consulta cada expediente y continúa el seguimiento operativo desde un solo lugar.'
      : 'Una vista operativa para leer el estado del plan, priorizar hallazgos y continuar cada auditoría.'

  function scrollToAuditRecords() {
    window.setTimeout(() => document.getElementById('quality-audit-records')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function filterAuditStatus(status: AuditStatus) {
    onNavigate('audits')
    onProgramStatusFilter('')
    onAuditStatusFilter(status)
    if (view === 'programs') scrollToAuditRecords()
  }

  function filterProgramStatus(status: AuditProgramStatus) {
    onNavigate('programs')
    onAuditStatusFilter('')
    onProgramStatusFilter(status)
    scrollToAuditRecords()
  }

  function openFirstAuditMatching(predicate: (audit: Audit) => boolean) {
    onNavigate('audits')
    onProgramStatusFilter('')
    onAuditStatusFilter('')
    const matchingAudit = audits.find(predicate)
    if (matchingAudit) onOpenAudit(matchingAudit.id)
    else scrollToAuditRecords()
  }

  async function openCreate() {
    setEditing(null)
    setExpandedProgramId(null)
    setDraft(initialDraftFor(user, companyId))
    setPreviewCode('')
    setFormError('')
    setNotice('')
    setShowForm(true)
    if (companyId) await loadNextCode(companyId)
  }

  function openProgram(program: AuditProgram) {
    setSelectedProgramId(program.id)
    setExpandedProgramId(null)
    setNotice('')
    setFormError('')
  }

  async function loadNextCode(companyId: string) {
    if (!companyId) {
      setPreviewCode('')
      return
    }
    try {
      const query = user.role === 'SUPERUSER' ? `?companyId=${encodeURIComponent(companyId)}` : ''
      const result = await api<{ code: string }>(`/audit-programs/next-code${query}`)
      setPreviewCode(result.code)
    } catch (error) {
      setFormError(errorMessage(error, 'No se pudo obtener el código automático.'))
    }
  }

  function openEdit(program: AuditProgram) {
    if (!canWrite || isTerminalAuditProgram(program)) return
    setExpandedProgramId(null)
    setEditing(program)
    setDraft(auditProgramDraftFromProgram(program))
    setPreviewCode(program.code)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setEditing(null)
    setFormError('')
  }

  async function saveProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (draft.startDate > draft.endDate) {
      setFormError('La fecha final debe ser igual o posterior a la fecha inicial.')
      return
    }
    if ([draft.name, draft.objective, draft.scope, draft.criteria].some((value) => !value.trim())) {
      setFormError('Completa nombre, objetivo, alcance y criterios.')
      return
    }
    if (user.role === 'SUPERUSER' && !draft.companyId) {
      setFormError('Selecciona la empresa del programa.')
      return
    }
    setSaving(true)
    setFormError('')
    setNotice('')
    const body = {
      ...(editing ? {} : (user.role === 'SUPERUSER' ? { companyId: draft.companyId } : {})),
      name: draft.name.trim(),
      objective: draft.objective.trim(),
      scope: draft.scope.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      responsibleId: draft.responsibleId || null,
      criteria: draft.criteria.trim(),
      resources: draft.resources.trim() || null,
      risks: draft.risks.trim() || null,
      notes: draft.notes.trim() || null,
    }
    try {
      if (editing) {
        await api<{ program: AuditProgram }>(`/audit-programs/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await api<{ program: AuditProgram }>('/audit-programs', { method: 'POST', body: JSON.stringify(body) })
      }
      await loadPrograms()
      setShowForm(false)
      setEditing(null)
      setNotice(`Programa ${editing ? 'actualizado' : 'creado'} correctamente.`)
    } catch (error) {
      setFormError(errorMessage(error, 'No se pudo guardar el programa de auditoría.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeProgram(program: AuditProgram) {
    if (!canWrite || program.status !== 'DRAFT') return
    const confirmed = await askConfirm({ title: 'Eliminar programa', message: `Se eliminará «${program.name}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setDeletingId(program.id)
    setFormError('')
    try {
      await api(`/audit-programs/${program.id}`, { method: 'DELETE' })
      await loadPrograms()
      if (selectedProgramId === program.id) setSelectedProgramId(null)
      setNotice('Programa eliminado correctamente.')
    } catch (error) {
      setFormError(errorMessage(error, 'No se pudo eliminar el programa.'))
    } finally {
      setDeletingId(null)
    }
  }

  function updateDraft(field: keyof AuditProgramDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    if (field === 'companyId' && user.role === 'SUPERUSER' && !editing) void loadNextCode(value)
  }

  if (selectedProgram) {
    return <AuditProgramDetail
      program={selectedProgram}
      audits={audits}
      processes={processes}
      companies={companies}
      canWrite={canWrite}
      notice={notice}
      error={formError}
      onBack={() => setSelectedProgramId(null)}
      onEdit={() => openEdit(selectedProgram)}
      onDelete={() => void removeProgram(selectedProgram)}
      onStatusChange={async (status) => {
        setFormError('')
        setNotice('')
        try {
          await api(`/audit-programs/${selectedProgram.id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
          await loadPrograms()
          setNotice('Estado del programa actualizado correctamente.')
        } catch (error) {
          setFormError(errorMessage(error, 'No se pudo actualizar el estado del programa.'))
        }
      }}
      onOpenAudit={(auditId) => { setSelectedProgramId(null); onOpenAudit(auditId) }}
      onNewAudit={() => onNewAudit(selectedProgram.id)}
    >
      {showForm && <AuditProgramModal draft={draft} editing={editing} previewCode={previewCode} users={activeUsers} companies={companies} selectedCompany={selectedCompany?.name} superuser={user.role === 'SUPERUSER'} saving={saving} error={formError} onChange={updateDraft} onSubmit={saveProgram} onClose={closeForm} />}
    </AuditProgramDetail>
  }

  return (
    <div className="audit-programs-page">
      <div className="page-heading audit-programs-heading">
        <div>
          <p className="eyebrow">ASEGURAMIENTO DE CALIDAD</p>
          <h1>{pageTitle}</h1>
          <p className="muted">{pageDescription}</p>
        </div>
        {!showForm && <div className="audit-program-heading-actions">
           {user.role === 'SUPERUSER' && <label className="audit-program-company-filter"><span>Empresa</span><select value={companyId} onChange={(event) => { setSelectedProgramId(null); onCompanyChange(event.target.value) }} aria-label="Filtrar gestión por empresa"><option value="">Todas las empresas</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>}
           <button type="button" className="button secondary small-button" onClick={onOpenAuditorBank}>Banco de auditores</button>{canWrite && <div className="audit-create-menu"><button type="button" className="button primary" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((current) => !current)}>Crear <span aria-hidden="true">⌄</span></button>{createMenuOpen && <div className="audit-create-menu-list"><button type="button" onClick={() => { setCreateMenuOpen(false); void openCreate() }}>Nuevo programa</button><button type="button" onClick={() => { setCreateMenuOpen(false); onNewAudit() }}>Nueva auditoría</button></div>}</div>}
        </div>}
      </div>

      {notice && <div className="notice success" role="status">{notice}</div>}
      {formError && !showForm && <div className="notice error" role="alert">{formError}</div>}

      {view === 'summary' && !loading && !loadError && <>
        <section className="metric-grid audit-program-metrics quality-overview-kpis" aria-label="Indicadores de aseguramiento">
          <button type="button" className="quality-kpi-action" onClick={() => filterProgramStatus('ACTIVE')} aria-label="Filtrar programas activos"><KPICard icon="◎" label="Programas activos" value={stats.active} tone="green" hint="Ver programas activos" /></button>
          <button type="button" className="quality-kpi-action" onClick={() => filterAuditStatus('PLANNED')} aria-label="Filtrar auditorías programadas"><KPICard icon="◷" label="Auditorías programadas" value={auditIndicators.scheduled} tone="blue" hint="Filtrar auditorías" /></button>
          <button type="button" className="quality-kpi-action" onClick={() => filterAuditStatus('IN_PROGRESS')} aria-label="Filtrar auditorías en curso"><KPICard icon="↻" label="Auditorías en curso" value={auditIndicators.inProgress} tone="amber" hint="Filtrar auditorías" /></button>
          <button type="button" className="quality-kpi-action" onClick={() => openFirstAuditMatching((audit) => audit.findings.some((finding) => finding.status !== 'VERIFIED'))} aria-label="Abrir un expediente con hallazgos abiertos"><KPICard icon="!" label="Hallazgos abiertos" value={auditIndicators.openFindings} tone="red" hint="Abrir expediente" /></button>
          <button type="button" className="quality-kpi-action" onClick={() => openFirstAuditMatching((audit) => audit.findings.some((finding) => finding.actions?.some((action) => action.required && action.status !== 'COMPLETED' && action.status !== 'CANCELLED')))} aria-label="Abrir un expediente con acciones pendientes"><KPICard icon="↗" label="Acciones pendientes" value={auditIndicators.pendingActions} tone="purple" hint="Abrir expediente" /></button>
          {programCompliance !== null && <button type="button" className="quality-kpi-action" onClick={() => filterProgramStatus('COMPLETED')} aria-label="Filtrar programas finalizados"><KPICard icon="✓" label="Cumplimiento de programas" value={programCompliance} tone="blue" hint="Ver programas finalizados" /></button>}
        </section>

        <section className="quality-overview-visuals" aria-label="Resumen visual de calidad">
          <article className="panel quality-overview-chart">
            <div className="quality-overview-section-heading"><div><p className="eyebrow">LECTURA DEL PLAN</p><h2>Estado de las auditorías</h2><p className="muted">Distribución actual de las auditorías visibles.</p></div><strong>{audits.length}</strong></div>
            {auditStatusChart.length === 0 ? <EmptyState compact title="Sin auditorías" text="Crea o vincula una auditoría para ver la distribución." /> : <ResponsiveContainer width="100%" height={190}><PieChart><Pie data={auditStatusChart} dataKey="value" nameKey="name" innerRadius={51} outerRadius={73} paddingAngle={3} stroke="none">{auditStatusChart.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value) => [`${value}`, 'Auditorías']} contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(15, 23, 42, .1)', fontSize: 11 }} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="quality-chart-total">{audits.length}</text><text x="50%" y="59%" textAnchor="middle" dominantBaseline="middle" className="quality-chart-caption">auditorías</text></PieChart></ResponsiveContainer>}
            {auditStatusChart.length > 0 && <ul className="quality-chart-legend">{auditStatusChart.map((entry, index) => <li key={entry.name}><span style={{ background: chartColors[index % chartColors.length] }} />{entry.name}<strong>{entry.value}</strong></li>)}</ul>}
          </article>

          <article className="panel quality-overview-chart">
            <div className="quality-overview-section-heading"><div><p className="eyebrow">TRATAMIENTOS</p><h2>Hallazgos por estado</h2><p className="muted">Solo se muestran estados con datos registrados.</p></div><strong>{findingTotalCount}</strong></div>
            {findingStatusChart.length === 0 ? <EmptyState compact title="Sin hallazgos" text="Los hallazgos aparecerán cuando se registren en una auditoría." /> : <ResponsiveContainer width="100%" height={190}><BarChart data={findingStatusChart} margin={{ left: -18, right: 12, top: 8, bottom: 2 }}><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} width={24} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip cursor={{ fill: '#eff6ff' }} formatter={(value) => [`${value}`, 'Hallazgos']} contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(15, 23, 42, .1)', fontSize: 11 }} /><Bar dataKey="value" fill="#2563eb" radius={[5, 5, 0, 0]} barSize={30} /></BarChart></ResponsiveContainer>}
          </article>

          <article className="panel quality-overview-program-pulse">
            <div className="quality-overview-section-heading"><div><p className="eyebrow">PROGRAMAS</p><h2>Pulso del portafolio</h2><p className="muted">Estado de los programas cargados para el alcance actual.</p></div></div>
            <div className="quality-program-pulse-total"><strong>{stats.total}</strong><span>programas registrados</span>{programCompliance !== null && <b>{programCompliance}% terminales</b>}</div>
            <ul className="quality-program-pulse-list"><li><span className="quality-pulse-dot active" />Activos<strong>{stats.active}</strong></li><li><span className="quality-pulse-dot draft" />Borradores<strong>{stats.draft}</strong></li><li><span className="quality-pulse-dot completed" />Finalizados<strong>{stats.completed}</strong></li><li><span className="quality-pulse-dot cancelled" />Cancelados<strong>{programs.filter((program) => program.status === 'CANCELLED').length}</strong></li></ul>
          </article>
        </section>

        <section className="quality-overview-lower">
          <article className="panel quality-recent-audits"><div className="quality-overview-section-heading"><div><p className="eyebrow">ACTIVIDAD RECIENTE</p><h2>Auditorías recientes</h2><p className="muted">Últimos expedientes actualizados.</p></div><span>{recentAudits.length}</span></div>{recentAudits.length === 0 ? <EmptyState compact title="Sin auditorías recientes" text="Las auditorías aparecerán aquí cuando existan datos." /> : <ul>{recentAudits.map((audit) => { const progress = auditProgress(audit); return <li key={audit.id}><div className="quality-recent-audit-main"><span className="audit-program-code">{audit.code}</span><strong>{audit.title}</strong><small>{audit.process.code} · {audit.process.name}</small></div><span className={`badge quality-status ${audit.status.toLowerCase()}`}>{auditStatusLabels[audit.status]}</span><div className="quality-recent-progress">{progress === null ? <small>{auditHasChecklist(audit) ? 'Checklist registrado' : 'Sin checklist'}</small> : <><strong>{progress}%</strong><span><i style={{ width: `${progress}%` }} /></span></>}</div><button type="button" className="text-button" onClick={() => onOpenAudit(audit.id)}>Abrir</button></li> })}</ul>}</article>

          <article className="panel quality-attention-panel"><div className="quality-overview-section-heading"><div><p className="eyebrow">ATENCIÓN</p><h2>Agenda y alertas</h2><p className="muted">Lo que conviene revisar a continuación.</p></div></div><div className="quality-attention-block"><div className="quality-attention-block-heading"><strong>Próximas auditorías</strong><span>{upcomingAudits.length}</span></div>{upcomingAudits.length === 0 ? <p className="muted">No hay auditorías programadas con fecha futura.</p> : <ul className="quality-agenda-list">{upcomingAudits.slice(0, 3).map((audit) => <li key={audit.id}><span className="quality-agenda-date">{formatDate(audit.plannedDate ?? '')}</span><div><strong>{audit.code}</strong><span>{audit.title}</span></div><button type="button" className="text-button" onClick={() => onOpenAudit(audit.id)}>Abrir</button></li>)}</ul>}</div><div className="quality-alert-list">{auditIndicators.openFindings > 0 && <p><span className="quality-alert-icon red">!</span><span><strong>{auditIndicators.openFindings} hallazgo{auditIndicators.openFindings === 1 ? '' : 's'} abierto{auditIndicators.openFindings === 1 ? '' : 's'}</strong><small>Revisa su tratamiento en los expedientes.</small></span></p>}{auditIndicators.pendingActions > 0 && <p><span className="quality-alert-icon purple">↗</span><span><strong>{auditIndicators.pendingActions} acción{auditIndicators.pendingActions === 1 ? '' : 'es'} pendiente{auditIndicators.pendingActions === 1 ? '' : 's'}</strong><small>Hay tratamientos correctivos por completar.</small></span></p>}{overdueAudits.length > 0 && <p><span className="quality-alert-icon amber">◷</span><span><strong>{overdueAudits.length} auditoría{overdueAudits.length === 1 ? '' : 's'} fuera de fecha</strong><small>Siguen en estado planificado.</small></span></p>}{auditIndicators.openFindings === 0 && auditIndicators.pendingActions === 0 && overdueAudits.length === 0 && <p className="quality-all-clear"><span>✓</span><span><strong>Sin alertas críticas</strong><small>No hay pendientes derivados de los datos disponibles.</small></span></p>}</div></article>
         </section>
       </>}

      {(view === 'programs' || view === 'audits') && <>
      <section id="quality-audit-records" className="panel audit-program-toolbar">
         <div className="audit-program-toolbar-copy"><span className="detail-label">{view === 'audits' ? 'SEGUIMIENTO OPERATIVO' : 'PLANIFICACIÓN'}</span><h2>{view === 'audits' ? 'Expedientes de auditoría' : 'Programas de auditoría'}</h2><p>{view === 'audits' ? `${audits?.length ?? 0} auditorías visibles` : loadError ? 'Programas no disponibles' : `${filteredPrograms.length} programas visibles · ${audits?.length ?? 0} auditorías`}</p></div>
         <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={view === 'audits' ? 'Buscar por código, nombre o programa…' : 'Buscar por código o nombre…'} aria-label={view === 'audits' ? 'Buscar auditorías' : 'Buscar en programas y auditorías'} /></div>
         {view === 'programs' && <select value={programStatusFilter} onChange={(event) => onProgramStatusFilter(event.target.value as AuditProgramStatus | '')} aria-label="Filtrar programas por estado">
           {auditProgramStatusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
         </select>}
         <select value={auditStatusFilter} onChange={(event) => onAuditStatusFilter(event.target.value as AuditStatus | '')} aria-label="Filtrar auditorías por estado">
           {auditStatusFilterOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
         </select>
       </section>

        {view === 'programs' && (loading ? <LoadingState text="Cargando programas de auditoría…" /> : loadError ? <div className="notice error" role="alert"><span>{loadError}</span><button type="button" className="button secondary small-button" onClick={() => void loadPrograms()}>Reintentar</button></div> : filteredPrograms.length === 0 ? (
         programs.length === 0 ? <div className="panel audit-program-empty"><span className="audit-program-empty-icon" aria-hidden="true">+</span><div><h3>Sin programas de auditoría</h3><p>Crea el primer programa para ordenar el calendario de auditorías de tu empresa.</p></div>{canWrite && <button type="button" className="button primary" onClick={() => void openCreate()}>Crear programa</button>}</div> : <EmptyState compact title="No hay coincidencias" text="Prueba con otro código, nombre o estado." />
       ) : (
        <div className="audit-program-grid">
          {filteredPrograms.map((program) => <AuditProgramCard key={program.id} program={program} canWrite={canWrite} deleting={deletingId === program.id} expanded={expandedProgramId === program.id} onToggle={() => setExpandedProgramId((current) => current === program.id ? null : program.id)} onOpenProgram={() => openProgram(program)} onOpenAudit={onOpenAudit} onNewAudit={() => onNewAudit(program.id)} onEdit={() => openEdit(program)} onDelete={() => void removeProgram(program)} />)}
        </div>
       ))}

       {showForm && <AuditProgramModal draft={draft} editing={editing} previewCode={previewCode} users={activeUsers} companies={companies} selectedCompany={selectedCompany?.name} superuser={user.role === 'SUPERUSER'} saving={saving} error={formError} onChange={updateDraft} onSubmit={saveProgram} onClose={closeForm} />}
      </>}
    </div>
  )
}

function AuditProgramCard({ program, canWrite, deleting, expanded, onToggle, onOpenProgram, onOpenAudit, onNewAudit, onEdit, onDelete }: { program: AuditProgram; canWrite: boolean; deleting: boolean; expanded: boolean; onToggle: () => void; onOpenProgram: () => void; onOpenAudit: (auditId: string) => void; onNewAudit: () => void; onEdit: () => void; onDelete: () => void }) {
  const progress = auditProgramProgress(program)
  return <article className="panel audit-program-card">
    <button type="button" className="audit-program-card-top audit-program-card-toggle" onClick={onToggle} aria-expanded={expanded}><div><span className="audit-program-code">{program.code}</span><h3>{program.name}</h3></div><div className="audit-program-card-toggle-side"><span className={`badge audit-program-status ${program.status.toLowerCase()}`}>{auditProgramStatusLabels[program.status]}</span><span className="audit-program-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></div></button>
    <p className="audit-program-objective">{program.objective}</p>
    <div className="audit-program-meta"><span><small>Responsable</small><strong>{userLabel(program.responsible)}</strong></span><span><small>Vigencia</small><strong>{formatDate(program.startDate)} – {formatDate(program.endDate)}</strong></span></div>
    <div className="audit-program-progress"><div><span>Auditorías vinculadas</span><strong>{program.auditSummary.total}</strong></div>{program.auditSummary.total > 0 ? <><div className="audit-program-progress-label"><span>Avance terminal</span><b>{progress}%</b></div><span className="audit-program-progress-track"><i style={{ width: `${progress}%` }} /></span></> : <p>Sin auditorías vinculadas todavía</p>}</div>
    {expanded && <div className="audit-program-expanded"><div className="audit-program-expanded-head"><strong>Auditorías del programa</strong><span>{program.auditSummary.total}</span></div>{program.audits.length === 0 ? <p className="muted">No hay auditorías vinculadas todavía.</p> : <ul>{program.audits.map((audit) => <li key={audit.id}><div><strong>{audit.code}</strong><span>{audit.title}</span></div><span className={`badge quality-status ${audit.status.toLowerCase()}`}>{audit.status}</span><button type="button" className="text-button" onClick={() => onOpenAudit(audit.id)}>Abrir</button></li>)}</ul>}{canWrite && !isTerminalAuditProgram(program) && <button type="button" className="button secondary small-button" onClick={onNewAudit}>+ Agregar auditoría</button>}</div>}
     <footer className="audit-program-card-footer"><button type="button" className="button secondary small-button" onClick={onOpenProgram}>Ver programa</button>{canWrite && <><button type="button" className="text-button" onClick={onEdit} disabled={isTerminalAuditProgram(program)}>Editar</button>{program.status === 'DRAFT' && <button type="button" className="text-button danger" onClick={onDelete} disabled={deleting}>{deleting ? 'Eliminando…' : 'Eliminar'}</button>}</>}</footer>
  </article>
}

type ProgramDetailTab = 'general' | 'prioritization' | 'audits' | 'tracking'
type ProgramStatusChange = Exclude<AuditProgramStatus, 'DRAFT'>

const programTransitions: Record<AuditProgramStatus, AuditProgramStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

const programTransitionLabels: Record<ProgramStatusChange, string> = {
  ACTIVE: 'Activar programa',
  COMPLETED: 'Finalizar programa',
  CANCELLED: 'Cancelar programa',
}

const programStatusActionClass = (status: AuditProgramStatus) => status === 'CANCELLED' ? 'secondary' : 'primary'

function auditProgressLabel(audit: Audit | undefined): string {
  const progress = audit?.checklistProgress
  if (!progress || progress.total === 0) return 'Sin datos'
  return `${Math.round((progress.completed / progress.total) * 100)}%`
}

export function AuditProgramDetail({ program, audits, processes = [], companies, canWrite, notice, error, onBack, onEdit, onDelete, onStatusChange, onOpenAudit, onNewAudit, children }: { program: AuditProgram; audits: Audit[]; processes?: Process[]; companies: Company[]; canWrite: boolean; notice: string; error: string; onBack: () => void; onEdit: () => void; onDelete: () => void; onStatusChange: (status: ProgramStatusChange) => Promise<void>; onOpenAudit: (auditId: string) => void; onNewAudit: () => void; children?: React.ReactNode }) {
  const [tab, setTab] = useState<ProgramDetailTab>('general')
  const [transitioning, setTransitioning] = useState<AuditProgramStatus | null>(null)
  const linkedAudits = program.audits.map((summary): { summary: AuditProgramAudit; detail?: Audit } => ({ summary, detail: audits.find((audit) => audit.id === summary.id) }))
  const companyName = companies.find((company) => company.id === program.companyId)?.name ?? 'Empresa actual'
  const totalAudits = program.auditSummary.total
  const completion = totalAudits > 0 ? Math.round((program.auditSummary.terminal / totalAudits) * 100) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcomingAudits = linkedAudits.filter(({ summary }) => summary.status === 'PLANNED' && summary.plannedDate && dateValue(summary.plannedDate, '00') >= today).sort((left, right) => dateValue(left.summary.plannedDate ?? '', '00').getTime() - dateValue(right.summary.plannedDate ?? '', '00').getTime())
  const transitions = programTransitions[program.status]

  async function changeStatus(status: ProgramStatusChange) {
    setTransitioning(status)
    try {
      await onStatusChange(status)
    } finally {
      setTransitioning(null)
    }
  }

  return <div className="audit-program-detail-page">
    <header className="audit-program-detail-header">
      <button type="button" className="audit-program-back" onClick={onBack}>← Gestión de auditorías</button>
      <div className="audit-program-detail-heading"><div><p className="eyebrow">EXPEDIENTE DEL PROGRAMA</p><div className="audit-program-detail-title-row"><span className="audit-program-code">{program.code}</span><span className={`badge audit-program-status ${program.status.toLowerCase()}`}>{auditProgramStatusLabels[program.status]}</span></div><h1>{program.name}</h1><p className="muted">Programa de auditoría para organizar el ciclo de revisión, sus responsables y el seguimiento operativo.</p></div><div className="audit-program-detail-actions">{canWrite && <button type="button" className="button primary" onClick={onEdit} disabled={isTerminalAuditProgram(program)}>Editar programa</button>}{canWrite && program.status === 'DRAFT' && <button type="button" className="text-button danger" onClick={onDelete}>Eliminar borrador</button>}</div></div>
      <div className="audit-program-detail-meta"><span><small>Empresa</small><strong>{companyName}</strong></span><span><small>Responsable</small><strong>{userLabel(program.responsible)}</strong></span><span><small>Vigencia</small><strong>{formatDate(program.startDate)} – {formatDate(program.endDate)}</strong></span></div>
      {canWrite && transitions.length > 0 && <div className="audit-program-status-actions"><span>Acciones de estado</span>{transitions.map((status) => <button type="button" className={`button ${programStatusActionClass(status)} small-button`} key={status} disabled={transitioning !== null} onClick={() => void changeStatus(status as ProgramStatusChange)}>{transitioning === status ? 'Actualizando…' : programTransitionLabels[status as ProgramStatusChange]}</button>)}</div>}
    </header>

    {notice && <div className="notice success" role="status">{notice}</div>}
    {error && !children && <div className="notice error" role="alert">{error}</div>}

    <section className="audit-program-detail-metrics" aria-label="Indicadores del programa"><DetailMetric label="Auditorías vinculadas" value={totalAudits} /><DetailMetric label="Programadas" value={program.auditSummary.byStatus.PLANNED} /><DetailMetric label="En curso" value={program.auditSummary.byStatus.IN_PROGRESS} /><DetailMetric label="Finalizadas" value={program.auditSummary.byStatus.CLOSED} /><DetailMetric label="Cumplimiento" value={completion === null ? 'Sin datos' : `${completion}%`} subdued={completion === null} /></section>

    <nav className="audit-program-detail-tabs" aria-label="Secciones del expediente" role="tablist">
      {([['general', 'Información general'], ['prioritization', 'Priorización'], ['audits', 'Auditorías'], ['tracking', 'Seguimiento']] as Array<[ProgramDetailTab, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{label}</button>)}
    </nav>

    {tab === 'general' && <section className="audit-program-detail-section" aria-labelledby="audit-program-general-title"><div className="audit-program-section-heading"><div><p className="eyebrow">MARCO DEL PROGRAMA</p><h2 id="audit-program-general-title">Información general</h2></div><span className="audit-program-section-caption">Datos registrados</span></div><div className="audit-program-detail-fields"><DetailField label="Objetivo" value={program.objective} wide /><DetailField label="Alcance" value={program.scope} /><DetailField label="Criterios" value={program.criteria} /><DetailField label="Recursos" value={program.resources} empty="No especificados" /><DetailField label="Riesgos" value={program.risks} empty="No especificados" /><DetailField label="Observaciones" value={program.notes} empty="Sin observaciones" wide /></div></section>}

    {tab === 'prioritization' && <AuditProgramProcessPriorityMatrix programId={program.id} companyId={program.companyId} programStatus={program.status} processes={processes} canWrite={canWrite} />}

    {tab === 'audits' && <section className="audit-program-detail-section" aria-labelledby="audit-program-audits-title"><div className="audit-program-section-heading"><div><p className="eyebrow">TRAZABILIDAD</p><h2 id="audit-program-audits-title">Auditorías vinculadas</h2><p className="muted">Consulta el trabajo asociado a este programa y abre cada expediente para continuar su gestión.</p></div>{canWrite && !isTerminalAuditProgram(program) && <button type="button" className="button primary" onClick={onNewAudit}>Nueva auditoría</button>}</div>{linkedAudits.length === 0 ? <div className="audit-program-detail-empty"><span className="audit-program-empty-icon" aria-hidden="true">+</span><div><strong>Sin auditorías vinculadas</strong><p>Las auditorías creadas desde este programa aparecerán aquí.</p></div>{canWrite && !isTerminalAuditProgram(program) && <button type="button" className="button secondary small-button" onClick={onNewAudit}>Crear auditoría</button>}</div> : <div className="audit-program-detail-audit-list">{linkedAudits.map(({ summary, detail }) => <article className="audit-program-detail-audit" key={summary.id}><div className="audit-program-detail-audit-main"><span className="audit-program-code">{summary.code}</span><h3>{summary.title}</h3><p>{detail?.process ? `${detail.process.code} · ${detail.process.name}` : 'Proceso no disponible'}</p></div><div className="audit-program-detail-audit-fact"><small>Responsable</small><strong>{userLabel(detail?.responsible ?? detail?.leadAuditor ?? null)}</strong></div><div className="audit-program-detail-audit-fact"><small>Fecha</small><strong>{summary.plannedDate ? formatDate(summary.plannedDate) : 'Sin fecha'}</strong></div><div className="audit-program-detail-audit-fact"><small>Avance</small><strong>{auditProgressLabel(detail)}</strong></div><span className={`badge quality-status ${summary.status.toLowerCase()}`}>{auditStatusLabels[summary.status]}</span><button type="button" className="button secondary small-button" onClick={() => onOpenAudit(summary.id)}>Abrir</button></article>)}</div>}</section>}

    {tab === 'tracking' && <section className="audit-program-detail-section" aria-labelledby="audit-program-tracking-title"><div className="audit-program-section-heading"><div><p className="eyebrow">CONTROL OPERATIVO</p><h2 id="audit-program-tracking-title">Seguimiento</h2><p className="muted">Distribución y avance calculados con las auditorías vinculadas actualmente.</p></div></div><div className="audit-program-tracking-grid"><div className="audit-program-tracking-card"><div className="audit-program-tracking-card-heading"><strong>Progreso general</strong><b>{completion === null ? 'Sin datos' : `${completion}%`}</b></div>{completion === null ? <p className="muted">No hay auditorías vinculadas para calcular el cumplimiento.</p> : <><span className="audit-program-progress-track"><i style={{ width: `${completion}%` }} /></span><small>{program.auditSummary.terminal} de {totalAudits} auditorías en estado final</small></>}</div><div className="audit-program-tracking-card"><strong>Distribución por estado</strong><ul className="audit-program-status-distribution"><li><span>Programadas</span><b>{program.auditSummary.byStatus.PLANNED}</b></li><li><span>En curso</span><b>{program.auditSummary.byStatus.IN_PROGRESS}</b></li><li><span>Finalizadas</span><b>{program.auditSummary.byStatus.CLOSED}</b></li><li><span>Canceladas</span><b>{program.auditSummary.byStatus.CANCELLED}</b></li></ul></div></div><div className="audit-program-upcoming-detail"><div className="audit-program-section-heading"><div><p className="eyebrow">AGENDA</p><h3>Próximas auditorías vinculadas</h3></div></div>{upcomingAudits.length === 0 ? <p className="muted">No hay auditorías vinculadas con fecha futura.</p> : <ul>{upcomingAudits.map(({ summary }) => <li key={summary.id}><span><strong>{summary.code}</strong>{summary.title}</span><time dateTime={summary.plannedDate ?? undefined}>{formatDate(summary.plannedDate ?? '')}</time></li>)}</ul>}</div></section>}
    {children}
  </div>
}

function DetailField({ label, value, empty = 'Sin información', wide = false }: { label: string; value: string | null; empty?: string; wide?: boolean }) {
  return <div className={`audit-program-detail-field${wide ? ' wide' : ''}`}><small>{label}</small><p>{value?.trim() || empty}</p></div>
}

function DetailMetric({ label, value, subdued = false }: { label: string; value: number | string; subdued?: boolean }) {
  return <div className="audit-program-detail-metric"><small>{label}</small><strong className={subdued ? 'subdued' : ''}>{value}</strong></div>
}

function AuditProgramModal({ draft, editing, previewCode, users, companies, selectedCompany, superuser, saving, error, onChange, onSubmit, onClose }: { draft: AuditProgramDraft; editing: AuditProgram | null; previewCode: string; users: QualityUser[]; companies: Company[]; selectedCompany?: string; superuser: boolean; saving: boolean; error: string; onChange: (field: keyof AuditProgramDraft, value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const field = (name: keyof AuditProgramDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(name, event.target.value)
  return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal audit-program-modal" onSubmit={onSubmit}><header className="company-modal-header"><div className="company-modal-icon audit-program-modal-icon">◎</div><div className="company-modal-title"><p className="eyebrow">PROGRAMAS DE AUDITORÍA</p><h2>{editing ? `Editar ${editing.code}` : 'Nuevo programa'}</h2><p className="company-modal-subtitle">Define el marco de revisión antes de vincular auditorías al ciclo.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar modal">×</button></header>{error && <div className="form-error" role="alert">{error}</div>}<div className="audit-program-modal-body"><section className="audit-program-modal-section"><div className="audit-program-modal-section-heading"><span>01</span><div><strong>Identificación</strong><small>El código se asigna automáticamente por empresa.</small></div></div><div className="audit-program-form-grid">{superuser && <label>Empresa<select value={draft.companyId} onChange={field('companyId')} required disabled={Boolean(editing)}><option value="">Selecciona una empresa</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>}<label className={superuser ? '' : 'audit-program-field-wide'}>Código<input value={previewCode || (editing?.code ?? 'Se generará al guardar')} readOnly /></label><label className="audit-program-field-wide">Nombre<input value={draft.name} onChange={field('name')} minLength={3} maxLength={160} required placeholder="Ej. Programa de auditorías 2026" /></label></div>{selectedCompany && superuser && <p className="audit-program-company-hint">Empresa seleccionada: {selectedCompany}</p>}</section><section className="audit-program-modal-section"><div className="audit-program-modal-section-heading"><span>02</span><div><strong>Marco del programa</strong><small>Explica qué se revisará y con qué referencia.</small></div></div><div className="audit-program-form-grid"><label className="audit-program-field-wide">Objetivo<textarea value={draft.objective} onChange={field('objective')} minLength={3} maxLength={2000} required rows={2} /></label><label className="audit-program-field-wide">Alcance<textarea value={draft.scope} onChange={field('scope')} minLength={3} maxLength={2000} required rows={2} /></label><label>Criterios<textarea value={draft.criteria} onChange={field('criteria')} minLength={3} maxLength={2000} required rows={3} /></label><label>Recursos<textarea value={draft.resources} onChange={field('resources')} maxLength={5000} rows={3} /></label><label>Riesgos<textarea value={draft.risks} onChange={field('risks')} maxLength={5000} rows={3} /></label><label>Observaciones<textarea value={draft.notes} onChange={field('notes')} maxLength={10000} rows={3} /></label></div></section><section className="audit-program-modal-section"><div className="audit-program-modal-section-heading"><span>03</span><div><strong>Vigencia y responsable</strong><small>El responsable debe estar activo en la empresa.</small></div></div><div className="audit-program-form-grid"><label>Fecha inicial<input type="date" value={draft.startDate} onChange={field('startDate')} required /></label><label>Fecha final<input type="date" value={draft.endDate} onChange={field('endDate')} min={draft.startDate || undefined} required /></label><label className="audit-program-field-wide">Responsable<select value={draft.responsibleId} onChange={field('responsibleId')}><option value="">Sin asignar</option>{users.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label></div></section></div><footer className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear programa'}</button></footer></form></div>
}

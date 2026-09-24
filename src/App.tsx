import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { ActionItem, ActionItemStatus, ActionPlan, ActionPlanStatus, AIAnalysis, Company, CrossOrigin, CrossType, DashboardData, Diagnostic, DiagnosticStatus, Level, Recommendation, RecommendationStatus, Role, StrategicCross, SWOTItem, SWOTType, Ticket, TicketPriority, TicketStatus, User } from './types'
import { Badge } from './components/ui/Badge'
import { KPICard } from './components/ui/KPICard'
import { EmptyState } from './components/ui/EmptyState'
import { LoadingState } from './components/ui/LoadingState'
import { DiagnosticStatusChart } from './components/charts/DiagnosticStatusChart'
import { RecommendationChart } from './components/charts/RecommendationChart'
import logo from './assets/logokanban.png'
import './App.css'

type View = 'dashboard' | 'tickets' | 'companies' | 'diagnostics' | 'swot' | 'recommendations' | 'action-plans' | 'users'
type DiagStage = 'diagnostico' | 'dofa' | 'recomendaciones' | 'planes'
type CompaniesIntent = { kind: 'create-company' } | { kind: 'create-diagnostic' } | { kind: 'open-company'; companyId: string } | { kind: 'open-first-diagnostic' } | { kind: 'open-diagnostic'; companyId: string; diagnosticId: string }
type DetailIntent = { kind: 'create-diagnostic' } | { kind: 'open-first-diagnostic' } | { kind: 'open-diagnostic'; diagnosticId: string }
type TicketDraft = { title: string; description: string; priority: TicketPriority; status: TicketStatus; assignedToId: string }
type CompanyDraft = { name: string; identification: string; industry: string; description: string; adminEnabled: boolean; adminName: string; adminEmail: string; adminPassword: string }
type DiagnosticDraft = { title: string; description: string; status: DiagnosticStatus }
type SWOTDraft = { type: SWOTType; description: string }
type PlanDraft = { title: string; description: string; status: ActionPlanStatus }
type ItemDraft = { title: string; description: string; priority: Level; status: ActionItemStatus; recommendationId: string; responsibleId: string; dueDate: string }
type UserFormRole = 'COMPANY_ADMIN' | 'COMPANY_USER'
type UserDraft = { name: string; email: string; password: string; role: UserFormRole; companyId: string }

const statuses: Array<{ value: TicketStatus; label: string }> = [
  { value: 'OPEN', label: 'Abierto' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'RESOLVED', label: 'Resuelto' },
  { value: 'CLOSED', label: 'Cerrado' },
]
const priorities: Array<{ value: TicketPriority; label: string }> = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },
]

const emptyDraft: TicketDraft = { title: '', description: '', priority: 'MEDIUM', status: 'OPEN', assignedToId: '' }
const emptyCompanyDraft: CompanyDraft = { name: '', identification: '', industry: '', description: '', adminEnabled: false, adminName: '', adminEmail: '', adminPassword: '' }
const emptyDiagnosticDraft: DiagnosticDraft = { title: '', description: '', status: 'DRAFT' }
const emptySWOTDraft: SWOTDraft = { type: 'STRENGTH', description: '' }
const emptyPlanDraft: PlanDraft = { title: '', description: '', status: 'DRAFT' }
const emptyItemDraft: ItemDraft = { title: '', description: '', priority: 'MEDIUM', status: 'PENDING', recommendationId: '', responsibleId: '', dueDate: '' }
const emptyUserDraft: UserDraft = { name: '', email: '', password: '', role: 'COMPANY_USER', companyId: '' }
const formRoleOptions: Array<{ value: UserFormRole; label: string }> = [{ value: 'COMPANY_ADMIN', label: 'Administrador de empresa' }, { value: 'COMPANY_USER', label: 'Usuario de empresa' }]
const roleLabels: Record<Role, string> = { SUPERUSER: 'Superusuario', COMPANY_ADMIN: 'Administrador de empresa', COMPANY_USER: 'Usuario de empresa' }
const diagnosticStatuses: Array<{ value: DiagnosticStatus; label: string }> = [{ value: 'DRAFT', label: 'Borrador' }, { value: 'IN_PROGRESS', label: 'En progreso' }, { value: 'COMPLETED', label: 'Completado' }]
const swotTypes: Array<{ value: SWOTType; label: string; short: string }> = [{ value: 'STRENGTH', label: 'Fortaleza', short: 'FORTALEZAS' }, { value: 'WEAKNESS', label: 'Debilidad', short: 'DEBILIDADES' }, { value: 'OPPORTUNITY', label: 'Oportunidad', short: 'OPORTUNIDADES' }, { value: 'THREAT', label: 'Amenaza', short: 'AMENAZAS' }]
const crossTypeCombos: Record<CrossType, string> = { FO: 'Fortaleza + Oportunidad', DO: 'Debilidad + Oportunidad', FA: 'Fortaleza + Amenaza', DA: 'Debilidad + Amenaza' }
const crossOriginLabels: Record<CrossOrigin, string> = { USER: 'Usuario', AI: 'IA', BOTH: 'Usuario + IA' }
const crossFilterTabs: Array<{ value: CrossType | 'ALL'; label: string }> = [{ value: 'ALL', label: 'Todos' }, { value: 'FO', label: 'FO' }, { value: 'DO', label: 'DO' }, { value: 'FA', label: 'FA' }, { value: 'DA', label: 'DA' }]
const emptyCrossDraft = { strategy: '' }
const crossDragFlyoutStyle: React.CSSProperties = { position: 'fixed', left: 0, top: 0, pointerEvents: 'none' }
const swotTypeLabels = Object.fromEntries(swotTypes.map((item) => [item.value, item.label])) as Record<SWOTType, string>
function crossTypeForPair(a: SWOTType, b: SWOTType): CrossType | null {
  if (a === b) return null
  const pair = [a, b].sort().join(':')
  const matrix: Record<string, CrossType> = { 'OPPORTUNITY:STRENGTH': 'FO', 'STRENGTH:THREAT': 'FA', 'OPPORTUNITY:WEAKNESS': 'DO', 'THREAT:WEAKNESS': 'DA' }
  return matrix[pair] ?? null
}
function isCompatibleCrossPair(a: SWOTType, b: SWOTType): boolean { return crossTypeForPair(a, b) !== null }
function crossPairKey(a: { id: string; type: SWOTType }, b: { id: string; type: SWOTType }): string { const internal = [a, b].find((item) => item.type === 'STRENGTH' || item.type === 'WEAKNESS')!; const external = internal === a ? b : a; return `${internal.id}:${external.id}` }
const levels: Array<{ value: Level; label: string }> = [{ value: 'LOW', label: 'Baja' }, { value: 'MEDIUM', label: 'Media' }, { value: 'HIGH', label: 'Alta' }]
const diagnosticStatusLabel = Object.fromEntries(diagnosticStatuses.map((item) => [item.value, item.label])) as Record<DiagnosticStatus, string>
const actionPlanStatuses: Array<{ value: ActionPlanStatus; label: string }> = [{ value: 'DRAFT', label: 'Borrador' }, { value: 'ACTIVE', label: 'Activo' }, { value: 'COMPLETED', label: 'Completado' }]
const actionItemStatuses: Array<{ value: ActionItemStatus; label: string }> = [{ value: 'PENDING', label: 'Pendiente' }, { value: 'IN_PROGRESS', label: 'En progreso' }, { value: 'COMPLETED', label: 'Completada' }, { value: 'CANCELLED', label: 'Cancelada' }]
const planStatusLabel = Object.fromEntries(actionPlanStatuses.map((item) => [item.value, item.label])) as Record<ActionPlanStatus, string>
const actionItemStatusLabel = Object.fromEntries(actionItemStatuses.map((item) => [item.value, item.label])) as Record<ActionItemStatus, string>
const recommendationStatusLabel = { PENDING: 'Pendiente', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada' } as const
const recPriorityLabel = Object.fromEntries(levels.map((item) => [item.value, item.label])) as Record<Level, string>
const recFilters: Array<{ value: RecommendationStatus | 'all'; label: string }> = [{ value: 'all', label: 'Todas' }, { value: 'PENDING', label: 'Pendientes' }, { value: 'ACCEPTED', label: 'Aceptadas' }, { value: 'REJECTED', label: 'Rechazadas' }]
const boardColumns: Array<{ status: ActionItemStatus; label: string }> = [{ status: 'PENDING', label: 'Pendientes' }, { status: 'IN_PROGRESS', label: 'En progreso' }, { status: 'COMPLETED', label: 'Completadas' }, { status: 'CANCELLED', label: 'Canceladas' }]
const kanbanColumnVisuals: Record<ActionItemStatus, { icon: string; emptyTitle: string; emptyText: string }> = { PENDING: { icon: '◦', emptyTitle: 'Sin pendientes', emptyText: 'Arrastra aquí las acciones por iniciar.' }, IN_PROGRESS: { icon: '↻', emptyTitle: 'Nada en progreso', emptyText: 'Mueve aquí las acciones en curso.' }, COMPLETED: { icon: '✓', emptyTitle: 'Sin completadas', emptyText: 'Las acciones finalizadas aparecerán aquí.' }, CANCELLED: { icon: '×', emptyTitle: 'Sin canceladas', emptyText: 'Las acciones descartadas se archivan aquí.' } }
const diagStageToView: Record<DiagStage, View> = { diagnostico: 'diagnostics', dofa: 'swot', recomendaciones: 'recommendations', planes: 'action-plans' }
const viewToDiagStage: Partial<Record<View, DiagStage>> = { diagnostics: 'diagnostico', swot: 'dofa', recommendations: 'recomendaciones', 'action-plans': 'planes' }

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false))
  }, [])

  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('app:unauthorized', onUnauthorized)
    return () => window.removeEventListener('app:unauthorized', onUnauthorized)
  }, [])

  if (checkingSession) return <div className="screen-center"><span className="loader" />Cargando espacio de trabajo...</div>
  if (!user) return <Login onLogin={setUser} />
  return <Workspace user={user} onLogout={() => setUser(null)} />
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      onLogin(result.user)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <img src={logo} alt="Kanban Consultoría" className="login-logo" />
        <p className="eyebrow">ESPACIO DE TRABAJO</p>
        <h2>Bienvenido de nuevo</h2>
        <p className="muted">Ingresa para continuar con tu operación.</p>
        <form onSubmit={submit}>
          <label>Correo electrónico<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@empresa.com" autoComplete="email" required /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" autoComplete="current-password" minLength={8} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button primary full" disabled={loading}>{loading ? <><span className="button-loader" /> Verificando...</> : 'Entrar al espacio'}</button>
        </form>
        <p className="security-note"><span>✦</span> Sesión protegida y cifrada</p>
      </div>
    </main>
  )
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<View>('dashboard')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [companiesIntent, setCompaniesIntent] = useState<CompaniesIntent | null>(null)
  const consumeCompaniesIntent = useCallback(() => setCompaniesIntent(null), [])
  const [diagnosticActive, setDiagnosticActive] = useState(false)
  const [diagStage, setDiagStage] = useState<DiagStage>('diagnostico')

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    onLogout()
  }

  function navigateToView(targetView: View, intent?: CompaniesIntent) {
    setView(targetView)
    if (intent) setCompaniesIntent(intent)
    setMobileMenu(false)
  }

  function handleQualityNav(key: View) {
    if (diagnosticActive && viewToDiagStage[key]) { setDiagStage(viewToDiagStage[key]); window.scrollTo({ top: 0 }); setMobileMenu(false); return }
    navigateToView(key, qualityViewsIntentMap[key])
  }

  const viewLabels: Record<View, string> = {
    dashboard: 'Resumen',
    companies: 'Empresas',
    diagnostics: 'Análisis estratégico',
    swot: 'Matriz DOFA',
    recommendations: 'Recomendaciones',
    'action-plans': 'Planes de acción',
    tickets: 'Tickets',
    users: 'Usuarios',
  }

  const qualityViews: Array<{ key: View; icon: string; label: string }> = [
    { key: 'companies', icon: '▥', label: 'Empresas' },
    { key: 'diagnostics', icon: '◫', label: 'Análisis estratégico' },
    { key: 'swot', icon: '◈', label: 'Matriz DOFA' },
    { key: 'recommendations', icon: '◆', label: 'Recomendaciones' },
    { key: 'action-plans', icon: '▤', label: 'Planes de acción' },
  ]

  const qualityViewsIntentMap: Record<string, CompaniesIntent> = {
    swot: { kind: 'open-first-diagnostic' },
    recommendations: { kind: 'open-first-diagnostic' },
    'action-plans': { kind: 'open-first-diagnostic' },
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark small"><img src={logo} alt="Kanban Consultoría" /></span><span>Kanban <b>Consultoria</b></span></div>
          <button className="icon-button mobile-only" onClick={() => setMobileMenu(false)} aria-label="Cerrar menú">×</button>
        </div>
        <div className="workspace-chip"><span className="workspace-dot" /><div><small>ESPACIO ACTIVO</small><strong>Operaciones</strong></div><span className="chevron">⌄</span></div>
        <nav className="sidebar-nav">
          <p className="nav-heading">PRINCIPAL</p>
          <button className={`nav-item ${view === 'dashboard' ? 'active' : ''}`} onClick={() => navigateToView('dashboard')}>
            <span className="nav-icon">⌂</span> Dashboard
          </button>

          <p className="nav-heading">GESTIÓN DE CALIDAD</p>
          {qualityViews.map((item) => (
            <button key={item.key} className={`nav-item ${(diagnosticActive ? diagStageToView[diagStage] : view) === item.key ? 'active' : ''}`} onClick={() => handleQualityNav(item.key)}>
              <span className="nav-icon">{item.icon}</span> {item.label}
            </button>
          ))}

          <p className="nav-heading">OPERACIÓN</p>
          <button className={`nav-item ${view === 'tickets' ? 'active' : ''}`} onClick={() => navigateToView('tickets')}>
            <span className="nav-icon">▤</span> Tickets
          </button>

          {(user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN') && (
            <>
              <p className="nav-heading">ADMINISTRACIÓN</p>
              <button className={`nav-item ${view === 'users' ? 'active' : ''}`} onClick={() => navigateToView('users')}>
                <span className="nav-icon">◉</span> Usuarios
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{initials(user.name)}</div>
            <div className="profile-text"><strong>{user.name}</strong><small>{user.role === 'SUPERUSER' ? 'Administrador' : 'Colaborador'}</small></div>
            <button className="icon-button" onClick={logout} aria-label="Cerrar sesión">↗</button>
          </div>
        </div>
      </aside>
      {mobileMenu && <button className="scrim" onClick={() => setMobileMenu(false)} aria-label="Cerrar menú" />}
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menú">☰</button>
          <div className="breadcrumb"><span>Operaciones</span><b>/</b><strong>{viewLabels[diagnosticActive ? diagStageToView[diagStage] : view]}</strong></div>
          <div className="topbar-actions">
            <span className="date-label">{new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date())}</span>
            <span className="notification" title="Notificaciones próximamente">♧<i /></span>
            <div className="avatar top-avatar">{initials(user.name)}</div>
          </div>
        </header>
        {view === 'dashboard' && <Dashboard user={user} onNavigate={navigateToView} />}
        {view === 'tickets' && <Tickets user={user} />}
        {view === 'diagnostics' && <DiagnosticsPage user={user} onDiagnosticActiveChange={setDiagnosticActive} diagStage={diagStage} onDiagStageChange={setDiagStage} />}
        {(view === 'companies' || view === 'swot' || view === 'recommendations' || view === 'action-plans') && (
          <Companies user={user} intent={companiesIntent} onConsumeIntent={consumeCompaniesIntent} diagnosticActive={diagnosticActive} onDiagnosticActiveChange={setDiagnosticActive} diagStage={diagStage} onDiagStageChange={setDiagStage} />
        )}
        {view === 'users' && (user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN') && <Users user={user} />}
      </main>
    </div>
  )
}

function DiagnosticsPage({ user, onDiagnosticActiveChange, diagStage, onDiagStageChange }: { user: User; onDiagnosticActiveChange: (active: boolean) => void; diagStage: DiagStage; onDiagStageChange: (stage: DiagStage) => void }) {
  const canCreate = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Diagnostic | null>(null)
  const [editing, setEditing] = useState<Diagnostic | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [draft, setDraft] = useState<DiagnosticDraft>(emptyDiagnosticDraft)
  const [companyId, setCompanyId] = useState('')

  const loadDiagnostics = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const companiesResult = await api<{ companies: Company[] }>('/companies')
      const accessibleCompanies = companiesResult.companies
      setCompanies(accessibleCompanies)
      setCompanyId((current) => accessibleCompanies.some((company) => company.id === current) ? current : (accessibleCompanies[0]?.id ?? ''))
      const grouped = await Promise.all(accessibleCompanies.map((company) => api<{ diagnostics: Diagnostic[] }>(`/companies/${company.id}/diagnostics`).then((result) => result.diagnostics).catch(() => [] as Diagnostic[])))
      setDiagnostics(grouped.flat())
    } catch { setError('No pudimos cargar los diagnósticos.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => { void loadDiagnostics() }, 0); return () => window.clearTimeout(timer) }, [loadDiagnostics])
  useEffect(() => { onDiagnosticActiveChange(Boolean(selected)) }, [selected, onDiagnosticActiveChange])
  useEffect(() => () => onDiagnosticActiveChange(false), [onDiagnosticActiveChange])

  const filtered = diagnostics.filter((diagnostic) => {
    if (!search) return true
    const term = search.toLowerCase()
    return diagnostic.title.toLowerCase().includes(term) || diagnostic.company.name.toLowerCase().includes(term) || diagnostic.createdBy.name.toLowerCase().includes(term)
  })

  function openDetail(diagnostic: Diagnostic) { setSelected(diagnostic); window.scrollTo({ top: 0 }) }
  function startCreate() { setEditing(null); setDraft(emptyDiagnosticDraft); setFormError(''); setShowForm(true) }
  function startEdit(diagnostic: Diagnostic) { setEditing(diagnostic); setDraft({ title: diagnostic.title, description: diagnostic.description, status: diagnostic.status }); setCompanyId(diagnostic.companyId); setFormError(''); setShowForm(true) }
  async function saveDiagnostic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError('')
    try {
      if (!companyId) { setFormError('Selecciona una empresa para el diagnóstico.'); setSaving(false); return }
      if (editing) {
        const result = await api<{ diagnostic: Diagnostic }>(`/diagnostics/${editing.id}`, { method: 'PATCH', body: JSON.stringify(draft) })
        setDiagnostics((current) => current.map((item) => item.id === result.diagnostic.id ? result.diagnostic : item))
        if (selected && selected.id === result.diagnostic.id) setSelected(result.diagnostic)
      } else {
        const result = await api<{ diagnostic: Diagnostic }>(`/companies/${companyId}/diagnostics`, { method: 'POST', body: JSON.stringify(draft) })
        setDiagnostics((current) => [result.diagnostic, ...current])
      }
      setShowForm(false)
    } catch (requestError) { setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el diagnóstico.') } finally { setSaving(false) }
  }
  async function removeDiagnostic(diagnostic: Diagnostic) {
    if (!window.confirm('¿Eliminar este análisis estratégico y su matriz DOFA?')) return
    try {
      await api(`/diagnostics/${diagnostic.id}`, { method: 'DELETE' })
      setDiagnostics((current) => current.filter((item) => item.id !== diagnostic.id))
      if (selected && selected.id === diagnostic.id) setSelected(null)
    } catch { setError('No se pudo eliminar el diagnóstico.') }
  }

  if (selected) {
    return (
      <>
        <div className="diag-standalone-page">
          <DiagnosticDetail diagnostic={selected} onBack={() => setSelected(null)} onEdit={() => startEdit(selected)} onDelete={() => void removeDiagnostic(selected)} stage={diagStage} onStageChange={onDiagStageChange} />
        </div>
        {showForm && <DiagnosticForm draft={draft} setDraft={setDraft} isEdit={Boolean(editing)} saving={saving} onSubmit={saveDiagnostic} onClose={() => { setShowForm(false); setEditing(null) }} error={formError} companies={canCreate ? companies : []} companyId={companyId} onCompanyIdChange={setCompanyId} />}
      </>
    )
  }

  return (
    <div className="page diagnostics-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GESTIÓN DE CALIDAD</p>
          <h1>Diagnósticos</h1>
          <p className="muted">Consulta y gestiona los diagnósticos de calidad de tus empresas.</p>
        </div>
        {canCreate && <button className="button primary" onClick={startCreate}>+ Nuevo diagnóstico</button>}
      </div>
      {error && <div className="form-error page-alert">{error}</div>}
      <section className="panel diagnostics-panel">
        <div className="filters">
          <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, empresa o creador..." /></div>
        </div>
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title={search ? 'Sin resultados' : 'No encontramos diagnósticos'} text={search ? 'Ningún diagnóstico coincide con tu búsqueda.' : 'Crea el primer diagnóstico para comenzar la evaluación de calidad.'} action={canCreate ? <button className="button secondary" onClick={startCreate}>Crear diagnóstico</button> : undefined} />
        ) : (
          <div className="company-table-wrap">
            <table>
              <thead>
                <tr><th>Diagnóstico</th><th>Empresa</th><th>Estado</th><th>Creador</th><th>Actualizada</th><th /></tr>
              </thead>
              <tbody>
                {filtered.map((diagnostic) => (
                  <tr key={diagnostic.id} onClick={() => openDetail(diagnostic)}>
                    <td><div className="ticket-title"><strong>{diagnostic.title}</strong><small>#{diagnostic.id.slice(-6).toUpperCase()}</small></div></td>
                    <td><span className="industry-chip">{diagnostic.company.name}</span></td>
                    <td><span className={`diagnostic-status ${diagnostic.status.toLowerCase()}`}>{diagnosticStatusLabel[diagnostic.status]}</span></td>
                    <td><div className="assignee"><span className="avatar tiny">{initials(diagnostic.createdBy.name)}</span>{diagnostic.createdBy.name}</div></td>
                    <td className="date-cell">{relativeDate(diagnostic.updatedAt)}</td>
                    <td>
                      <span className="table-actions">
                      <button className="button primary small-button" onClick={(event) => { event.stopPropagation(); openDetail(diagnostic) }}>Ver diagnóstico</button>
                      <button className="row-action" title="Editar" onClick={(event) => { event.stopPropagation(); startEdit(diagnostic) }}>✎</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {showForm && <DiagnosticForm draft={draft} setDraft={setDraft} isEdit={Boolean(editing)} saving={saving} onSubmit={saveDiagnostic} onClose={() => { setShowForm(false); setEditing(null) }} error={formError} companies={canCreate ? companies : []} companyId={companyId} onCompanyIdChange={setCompanyId} />}
    </div>
  )
}

function Users({ user }: { user: User }) {
  const isSuperuser = user.role === 'SUPERUSER'
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<UserDraft>(emptyUserDraft)
  const [editing, setEditing] = useState<User | null>(null)
  const [showForm, setShowForm] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api<{ users: User[] }>('/users')
      setUsers(result.users)
    } catch { setError('No pudimos cargar los usuarios.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => { void loadUsers() }, 0); return () => window.clearTimeout(timer) }, [loadUsers])
  useEffect(() => { if (isSuperuser) api<{ companies: Company[] }>('/companies').then((result) => setCompanies(result.companies)).catch(() => undefined) }, [isSuperuser])

  function openCreate() { setEditing(null); setDraft(emptyUserDraft); setShowForm(true); setError(''); setNotice('') }
  function openEdit(target: User) {
    setEditing(target)
    setDraft({ name: target.name, email: target.email, password: '', role: target.role === 'COMPANY_ADMIN' ? 'COMPANY_ADMIN' : 'COMPANY_USER', companyId: target.companyId ?? '' })
    setShowForm(true); setError(''); setNotice('')
  }
  async function saveUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      if (isSuperuser && !editing && !draft.companyId) {
        setError('Selecciona una empresa para el nuevo usuario.'); setSaving(false); return
      }
      if (isSuperuser && !editing && !draft.password) {
        setError('La contraseña es obligatoria.'); setSaving(false); return
      }
      const basePayload: Record<string, unknown> = { name: draft.name, email: draft.email }
      if (draft.password) basePayload.password = draft.password
      const isEditingSuperuser = isSuperuser && editing?.role === 'SUPERUSER'
      if (isSuperuser && !isEditingSuperuser) {
        basePayload.role = draft.role
        basePayload.companyId = draft.companyId || null
      }
      let result: { user: User }
      if (editing) {
        const edited = await api<{ user: User }>(`/users/${editing.id}`, { method: 'PATCH', body: JSON.stringify(basePayload) })
        setUsers((current) => current.map((item) => item.id === edited.user.id ? edited.user : item))
        result = edited
      } else {
        const created = await api<{ user: User }>('/users', { method: 'POST', body: JSON.stringify({ name: draft.name, email: draft.email, password: draft.password, role: draft.role, ...(isSuperuser ? { companyId: draft.companyId } : {}) }) })
        setUsers((current) => [...current, created.user])
        result = created
      }
      setShowForm(false); setEditing(null); setNotice(`Usuario ${result.user.name} guardado correctamente.`)
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el usuario.') } finally { setSaving(false) }
  }
  async function removeUser(target: User) {
    if (!window.confirm(`¿Eliminar al usuario ${target.name}? Esta acción no se puede deshacer.`)) return
    setError(''); setNotice('')
    try {
      await api(`/users/${target.id}`, { method: 'DELETE' })
      setUsers((current) => current.filter((item) => item.id !== target.id))
      setNotice('Usuario eliminado correctamente.')
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el usuario.') }
  }

  return (
    <div className="page users-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h1>Usuarios</h1>
          <p className="muted">{isSuperuser ? 'Gestiona los usuarios del sistema.' : 'Gestiona los usuarios de tu empresa.'}</p>
        </div>
        <div className="page-actions">
          <button className="button primary" onClick={openCreate}>+ Nuevo usuario</button>
        </div>
      </div>
      {error && <div className="form-error page-alert" role="alert">{error}</div>}
      {notice && <div className="form-success page-alert">{notice}</div>}
      <section className="panel users-panel">
        {loading ? <LoadingState /> : users.length === 0 ? <EmptyState title="Sin usuarios" text="Crea el primer usuario para comenzar." action={<button className="button secondary" onClick={openCreate}>Crear usuario</button>} /> : (
          <div className="company-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => {
                  const editable = isSuperuser ? true : item.role === 'COMPANY_USER'
                  const deletable = isSuperuser ? item.role !== 'SUPERUSER' : item.role === 'COMPANY_USER'
                  return (
                    <tr key={item.id}>
                      <td><div className="assignee"><span className="avatar tiny">{initials(item.name)}</span><strong>{item.name}</strong></div></td>
                      <td>{item.email}</td>
                      <td><span className={`role-chip ${item.role.toLowerCase()}`}>{roleLabels[item.role]}</span></td>
                      <td><div className="row-links">{editable && <button className="row-link" onClick={() => openEdit(item)}>Editar</button>}{deletable && <button className="row-link danger" onClick={() => void removeUser(item)}>Eliminar</button>}</div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {showForm && (
        <UserForm
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          isSuperuser={isSuperuser}
          companies={companies}
          saving={saving}
          onSubmit={(event) => void saveUser(event)}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

function UserForm({ draft, setDraft, editing, isSuperuser, companies, saving, onSubmit, onClose }: { draft: UserDraft; setDraft: React.Dispatch<React.SetStateAction<UserDraft>>; editing: User | null; isSuperuser: boolean; companies: Company[]; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const isNew = !editing
  const roleLocked = !isSuperuser
  const superRoleLocked = isSuperuser && editing?.role === 'SUPERUSER'
  return (
    <div className="drawer-backdrop">
      <form className="drawer" onSubmit={onSubmit}>
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">{isNew ? 'NUEVO USUARIO' : 'EDITAR USUARIO'}</p>
            <h2>{isNew ? 'Crear usuario' : editing?.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>
        <label>Nombre<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Ana López" minLength={2} required /></label>
        <label>Correo electrónico<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="usuario@empresa.com" autoComplete="off" required /></label>
        <label>{isNew ? 'Contraseña' : 'Nueva contraseña'}<input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder={isNew ? 'Mínimo 8 caracteres' : 'Dejar vacío para no cambiar'} minLength={8} required={isNew} autoComplete="new-password" /></label>
        {roleLocked ? (
          <label>Rol<div className="field-readonly"><span className="role-chip company_user">Usuario de empresa</span></div></label>
        ) : superRoleLocked ? (
          <label>Rol<div className="field-readonly"><span className="role-chip superuser">Superusuario</span></div></label>
        ) : (
          <label>Rol<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as UserFormRole })}>{formRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        )}
        {isSuperuser && !superRoleLocked && (
          <label>Empresa{companies.length === 0 ? <div className="field-readonly">Cargando empresas...</div> : <select value={draft.companyId} onChange={(event) => setDraft({ ...draft, companyId: event.target.value })} required><option value="">Selecciona una empresa</option>{companies.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.identification}</option>)}</select>}</label>
        )}
        <div className="drawer-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
          <button className="button primary" disabled={saving}>{saving ? <><span className="button-loader" />Guardando...</> : isNew ? 'Crear usuario' : 'Guardar cambios'}</button>
        </div>
      </form>
    </div>
  )
}

function Dashboard({ user, onNavigate }: { user: User; onNavigate: (view: View, intent?: CompaniesIntent) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<DashboardData>('/dashboard').then(setData).catch(() => setError('No pudimos cargar el resumen. Intenta de nuevo.')) }, [])
  if (error) return <PageError message={error} />
  if (!data) return <LoadingState />
  const { summary } = data
  const greeting = new Date().getHours() < 12 ? 'Buenos días' : new Date().getHours() < 19 ? 'Buenas tardes' : 'Buenas noches'

  const attentionItems: Array<{ type: string; label: string; count: number; tone: string; view: View }> = []
  if (summary.overdueActionItems > 0) attentionItems.push({ type: 'alert', label: 'Acciones vencidas', count: summary.overdueActionItems, tone: 'red', view: 'action-plans' })
  if (summary.inProgressDiagnostics > 0) attentionItems.push({ type: 'progress', label: 'Diagnósticos en curso', count: summary.inProgressDiagnostics, tone: 'amber', view: 'diagnostics' })
  if (summary.pendingRecommendations > 0) attentionItems.push({ type: 'pending', label: 'Recomendaciones pendientes', count: summary.pendingRecommendations, tone: 'purple', view: 'recommendations' })
  if (summary.pendingActionItems > summary.overdueActionItems) attentionItems.push({ type: 'tasks', label: 'Acciones pendientes', count: summary.pendingActionItems - summary.overdueActionItems, tone: 'blue', view: 'action-plans' })

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DASHBOARD EJECUTIVO</p>
          <h1>{greeting}, {firstName(user.name)} <span className="wave">✦</span></h1>
          <p className="muted">Vista consolidada de la gestión de calidad de tu operación.</p>
        </div>
        <div className="page-actions">
          <button className="button secondary" onClick={() => onNavigate('companies', { kind: 'create-company' })}>+ Nueva empresa</button>
          <button className="button primary" onClick={() => onNavigate('diagnostics', { kind: 'open-first-diagnostic' })}>Ver diagnósticos</button>
        </div>
      </div>

      <section className="metric-grid executive-kpis">
        <KPICard icon="▥" label="Empresas" value={summary.totalCompanies} tone="blue" />
        <KPICard icon="◫" label="Diagnósticos" value={summary.totalDiagnostics} tone="purple" />
        <KPICard icon="◆" label="Recomendaciones" value={summary.pendingRecommendations} tone="red" />
        <KPICard icon="▤" label="Planes activos" value={summary.activeActionPlans} tone="green" />
        <KPICard icon="↗" label="Acciones pendientes" value={summary.pendingActionItems} tone="amber" />
        <KPICard icon="!" label="Acciones vencidas" value={summary.overdueActionItems} tone="red" />
      </section>

      <div className="chart-grid">
        <DiagnosticStatusChart draft={summary.draftDiagnostics} inProgress={summary.inProgressDiagnostics} completed={summary.completedDiagnostics} />
        <RecommendationChart recommendations={data.priorityRecommendations} />
      </div>

      {attentionItems.length > 0 && (
        <section className="attention-section">
          <div className="attention-heading">
            <div>
              <p className="detail-label">REQUIERE ATENCIÓN</p>
              <h3>Puntos que necesitan tu revisión</h3>
            </div>
          </div>
          <div className="attention-grid">
            {attentionItems.map((item) => (
              <button key={item.type} className={`attention-card ${item.tone}`} onClick={() => onNavigate(item.view, { kind: 'open-first-diagnostic' })}>
                <span className={`attention-count ${item.tone}`}>{item.count}</span>
                <span className="attention-label">{item.label}</span>
                <span className="attention-arrow">→</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-columns">
        <div className="dashboard-col">
          <div className="panel">
            <div className="panel-heading">
              <div><p className="detail-label">ACTIVIDAD RECIENTE</p><h2>Diagnósticos</h2></div>
              <button className="text-button" onClick={() => onNavigate('diagnostics', { kind: 'open-first-diagnostic' })}>Ver todos →</button>
            </div>
            <div className="quality-list">
              {data.recentDiagnostics.length === 0 ? (
                <div className="empty-state compact"><p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Sin diagnósticos recientes</p></div>
              ) : (
                data.recentDiagnostics.map((d) => (
                  <button key={d.id} className="quality-row" onClick={() => onNavigate('companies', { kind: 'open-diagnostic', companyId: d.company.id, diagnosticId: d.id })}>
                    <span className={`quality-dot ${d.status === 'COMPLETED' ? 'green' : d.status === 'IN_PROGRESS' ? 'amber' : 'blue'}`} />
                    <div><strong>{d.title}</strong><small>{d.company.name}</small></div>
                    <span className="quality-meta">{relativeDate(d.updatedAt)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="dashboard-col">
          <div className="panel">
            <div className="panel-heading">
              <div><p className="detail-label">PRÓXIMAS ACCIONES</p><h2>Seguimiento</h2></div>
              <button className="text-button" onClick={() => onNavigate('action-plans', { kind: 'open-first-diagnostic' })}>Ver todas →</button>
            </div>
            <div className="quality-list">
              {data.upcomingActions.length === 0 ? (
                <div className="empty-state compact"><p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Sin acciones pendientes</p></div>
              ) : (
                data.upcomingActions.map((a) => (
                  <button key={a.id} className="quality-row" onClick={() => onNavigate('companies', { kind: 'open-diagnostic', companyId: a.actionPlan.diagnostic.company.id, diagnosticId: a.actionPlan.diagnostic.id })}>
                    <span className={`quality-dot ${a.status === 'COMPLETED' ? 'green' : a.status === 'IN_PROGRESS' ? 'amber' : a.dueDate && new Date(a.dueDate) < new Date() ? 'red' : 'blue'}`} />
                    <div><strong>{a.title}</strong><small>{a.actionPlan.diagnostic.company.name}</small></div>
                    <span className="quality-meta">{a.dueDate ? relativeDate(a.dueDate) : 'Sin fecha'}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Companies({ user, intent, onConsumeIntent, diagnosticActive, onDiagnosticActiveChange, diagStage, onDiagStageChange }: { user: User; intent: CompaniesIntent | null; onConsumeIntent: () => void; diagnosticActive: boolean; onDiagnosticActiveChange: (active: boolean) => void; diagStage: DiagStage; onDiagStageChange: (stage: DiagStage) => void }) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<Company | null>(null)
  const [draft, setDraft] = useState<CompanyDraft>(emptyCompanyDraft)
  const [detailIntent, setDetailIntent] = useState<DetailIntent | null>(null)
  const consumeDetailIntent = useCallback(() => setDetailIntent(null), [])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const loadCompanies = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      const result = await api<{ companies: Company[] }>(`/companies?${params}`)
      setCompanies(result.companies)
    } catch { setError('No pudimos cargar las empresas.') } finally { setLoading(false) }
  }, [debouncedSearch])
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 350); return () => window.clearTimeout(timer) }, [search])
  useEffect(() => { const timer = window.setTimeout(() => { void loadCompanies() }, 0); return () => window.clearTimeout(timer) }, [loadCompanies])

  const applyIntent = useCallback((available: Company[], pending: CompaniesIntent | null) => {
    if (!pending) return
    setDetailIntent(null)
    if (pending.kind === 'create-company') { setSelected(null); setDraft(emptyCompanyDraft); setShowForm(true); onConsumeIntent(); return }
    const target = pending.kind === 'open-company' || pending.kind === 'open-diagnostic' ? available.find((item) => item.id === pending.companyId) : available[0]
    if (!target) { onConsumeIntent(); return }
    setSelected(target); setShowForm(false)
    if (pending.kind === 'create-diagnostic') setDetailIntent({ kind: 'create-diagnostic' })
    if (pending.kind === 'open-first-diagnostic') setDetailIntent({ kind: 'open-first-diagnostic' })
    if (pending.kind === 'open-diagnostic') setDetailIntent({ kind: 'open-diagnostic', diagnosticId: pending.diagnosticId })
    onConsumeIntent()
  }, [onConsumeIntent])
  useEffect(() => { if (!intent || companies.length === 0 || loading) return; const timer = window.setTimeout(() => { applyIntent(companies, intent) }, 0); return () => window.clearTimeout(timer) }, [intent, companies, loading, applyIntent])

  function startCreate() { setSelected(null); setDraft(emptyCompanyDraft); setShowForm(true) }
  function startEdit(companyToEdit: Company) { setSelected(companyToEdit); setDraft({ name: companyToEdit.name, identification: companyToEdit.identification, industry: companyToEdit.industry, description: companyToEdit.description, adminEnabled: false, adminName: '', adminEmail: '', adminPassword: '' }); setShowForm(true) }
  async function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const basePayload = { name: draft.name, identification: draft.identification, industry: draft.industry, description: draft.description }
      const payload = !selected && draft.adminEnabled
        ? { ...basePayload, admin: { name: draft.adminName, email: draft.adminEmail, password: draft.adminPassword } }
        : basePayload
      const result = selected ? await api<{ company: Company }>(`/companies/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api<{ company: Company }>('/companies', { method: 'POST', body: JSON.stringify(payload) })
      setShowForm(false); setSelected(result.company); await loadCompanies()
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar la empresa.') } finally { setSaving(false) }
  }
  async function removeCompany(companyToRemove: Company) { if (!window.confirm('¿Eliminar esta empresa?')) return; try { await api(`/companies/${companyToRemove.id}`, { method: 'DELETE' }); setSelected(null); await loadCompanies() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar la empresa.') } }

  return <div className="page companies-page">{!diagnosticActive && <><div className="page-heading"><div><p className="eyebrow">GESTIÓN DE CLIENTES</p><h1>Empresas</h1><p className="muted">Consulta y organiza las empresas a tu cargo.</p></div>{user.role === 'SUPERUSER' && <button className="button primary" onClick={startCreate}>+ Crear empresa</button>}</div>{error && <div className="form-error page-alert">{error}</div>}<section className="panel companies-panel"><div className="filters"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, identificación o industria..." /></div></div>{loading ? <LoadingState /> : companies.length === 0 ? <EmptyState title={search ? 'Sin resultados' : 'No encontramos empresas'} text={search ? 'Ninguna empresa coincide con tu búsqueda.' : 'Crea la primera empresa para comenzar.'} action={user.role === 'SUPERUSER' ? <button className="button secondary" onClick={startCreate}>Crear empresa</button> : undefined} /> : <div className="company-table-wrap"><table><thead><tr><th>Empresa</th><th>Identificación</th><th>Industria</th><th>Administrador</th><th>Actualizada</th><th /></tr></thead><tbody>{companies.map((companyToShow) => <tr key={companyToShow.id} className={selected?.id === companyToShow.id ? 'selected-row' : ''} onClick={() => setSelected(companyToShow)}><td><div className="ticket-title"><strong>{companyToShow.name}</strong><small>#{companyToShow.id.slice(-6).toUpperCase()}</small></div></td><td>{companyToShow.identification}</td><td><span className="industry-chip">{companyToShow.industry}</span></td><td>{companyToShow.admin ? <div className="assignee"><span className="avatar tiny">{initials(companyToShow.admin.name)}</span>{companyToShow.admin.name}</div> : <span className="unassigned">Sin administrador</span>}</td><td className="date-cell">{relativeDate(companyToShow.updatedAt)}</td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); startEdit(companyToShow) }}>⋯</button></td></tr>)}</tbody></table></div>}</section></>}{selected && !showForm && <CompanyDetail company={selected} onEdit={() => startEdit(selected)} onDelete={() => removeCompany(selected)} onClose={() => setSelected(null)} detailIntent={detailIntent} onConsumeDetailIntent={consumeDetailIntent} onDiagnosticActiveChange={onDiagnosticActiveChange} diagStage={diagStage} onDiagStageChange={onDiagStageChange} />}{showForm && <CompanyForm draft={draft} setDraft={setDraft} isEdit={Boolean(selected)} saving={saving} onSubmit={saveCompany} onClose={() => setShowForm(false)} />}</div>
}

function CompanyForm({ draft, setDraft, isEdit, saving, onSubmit, onClose }: { draft: CompanyDraft; setDraft: React.Dispatch<React.SetStateAction<CompanyDraft>>; isEdit: boolean; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">▥</div><div className="company-modal-title"><p className="eyebrow">{isEdit ? 'EDITAR EMPRESA' : 'NUEVA EMPRESA'}</p><h2>{isEdit ? 'Actualizar empresa' : 'Crear empresa'}</h2><p className="company-modal-subtitle">Registra la información de la empresa en el sistema</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Nombre de la empresa<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Acme Consultores" minLength={2} required /></label><div className="form-grid"><label>Identificación<input value={draft.identification} onChange={(event) => setDraft({ ...draft, identification: event.target.value })} placeholder="NIT o identificación" minLength={3} required /></label><label>Industria<input value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })} placeholder="Ej. Tecnología" minLength={2} required /></label></div><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Añade contexto sobre la empresa..." rows={6} minLength={3} required /></label>{!isEdit && <div className="admin-create-section"><label className="admin-create-toggle"><input type="checkbox" checked={draft.adminEnabled} onChange={(event) => setDraft({ ...draft, adminEnabled: event.target.checked })} /><span className="admin-create-check" aria-hidden="true">✓</span><div className="admin-create-copy"><strong>Crear administrador para esta empresa</strong><small>Se creará un usuario administrador con rol de COMPANY_ADMIN.</small></div></label>{draft.adminEnabled && <div className="admin-fields"><div className="form-grid"><label>Nombre del administrador<input value={draft.adminName} onChange={(event) => setDraft({ ...draft, adminName: event.target.value })} placeholder="Ej. Ana López" minLength={2} required /></label><label>Correo del administrador<input type="email" value={draft.adminEmail} onChange={(event) => setDraft({ ...draft, adminEmail: event.target.value })} placeholder="admin@empresa.com" autoComplete="off" required /></label></div><label>Contraseña inicial<input type="password" value={draft.adminPassword} onChange={(event) => setDraft({ ...draft, adminPassword: event.target.value })} placeholder="Mínimo 8 caracteres" minLength={8} autoComplete="new-password" required /></label></div>}</div>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear empresa'}</button></div></form></div> }

function CompanyDetail({ company: companyToShow, onEdit, onDelete, onClose, detailIntent, onConsumeDetailIntent, onDiagnosticActiveChange, diagStage, onDiagStageChange }: { company: Company; onEdit: () => void; onDelete: () => void; onClose: () => void; detailIntent: DetailIntent | null; onConsumeDetailIntent: () => void; onDiagnosticActiveChange: (active: boolean) => void; diagStage: DiagStage; onDiagStageChange: (stage: DiagStage) => void }) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [selectedDiagnostic, setSelectedDiagnostic] = useState<Diagnostic | null>(null)
  const [diagnosticDraft, setDiagnosticDraft] = useState<DiagnosticDraft>(emptyDiagnosticDraft)
  const [showDiagnosticForm, setShowDiagnosticForm] = useState(false)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true)
  const [diagnosticError, setDiagnosticError] = useState('')
  const [savingDiagnostic, setSavingDiagnostic] = useState(false)

  const loadDiagnostics = useCallback(async () => {
    setLoadingDiagnostics(true); setDiagnosticError('')
    try {
      const result = await api<{ diagnostics: Diagnostic[] }>(`/companies/${companyToShow.id}/diagnostics`)
      setDiagnostics(result.diagnostics)
    } catch { setDiagnosticError('No pudimos cargar los diagnósticos.') } finally { setLoadingDiagnostics(false) }
  }, [companyToShow.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadDiagnostics() }, 0); return () => window.clearTimeout(timer) }, [loadDiagnostics])
  useEffect(() => { if (!detailIntent) return; const timer = window.setTimeout(() => { if (detailIntent.kind === 'create-diagnostic') { setSelectedDiagnostic(null); setDiagnosticDraft(emptyDiagnosticDraft); setShowDiagnosticForm(true); onConsumeDetailIntent(); return } if ((detailIntent.kind === 'open-first-diagnostic' || detailIntent.kind === 'open-diagnostic') && !loadingDiagnostics && diagnostics.length > 0) { const target = detailIntent.kind === 'open-diagnostic' ? diagnostics.find((item) => item.id === detailIntent.diagnosticId) : diagnostics[0]; if (target) setSelectedDiagnostic(target); onConsumeDetailIntent() } }, 0); return () => window.clearTimeout(timer) }, [detailIntent, diagnostics, loadingDiagnostics, onConsumeDetailIntent])
  useEffect(() => { onDiagnosticActiveChange(Boolean(selectedDiagnostic)) }, [selectedDiagnostic, onDiagnosticActiveChange])

  function startDiagnosticCreate() { setSelectedDiagnostic(null); setDiagnosticDraft(emptyDiagnosticDraft); setShowDiagnosticForm(true) }
  function startDiagnosticEdit(diagnosticToEdit: Diagnostic) { setDiagnosticDraft({ title: diagnosticToEdit.title, description: diagnosticToEdit.description, status: diagnosticToEdit.status }); setShowDiagnosticForm(true) }
  async function saveDiagnostic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingDiagnostic(true); setDiagnosticError('')
    try {
      const result = selectedDiagnostic ? await api<{ diagnostic: Diagnostic }>(`/diagnostics/${selectedDiagnostic.id}`, { method: 'PATCH', body: JSON.stringify(diagnosticDraft) }) : await api<{ diagnostic: Diagnostic }>(`/companies/${companyToShow.id}/diagnostics`, { method: 'POST', body: JSON.stringify(diagnosticDraft) })
      setDiagnostics((current) => selectedDiagnostic ? current.map((item) => item.id === result.diagnostic.id ? result.diagnostic : item) : [result.diagnostic, ...current])
      setSelectedDiagnostic(result.diagnostic); setShowDiagnosticForm(false)
    } catch (requestError) { setDiagnosticError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el diagnóstico.') } finally { setSavingDiagnostic(false) }
  }
  async function removeDiagnostic() { if (!selectedDiagnostic || !window.confirm('¿Eliminar este análisis estratégico y su matriz DOFA?')) return; try { await api(`/diagnostics/${selectedDiagnostic.id}`, { method: 'DELETE' }); setSelectedDiagnostic(null); await loadDiagnostics() } catch { setDiagnosticError('No se pudo eliminar el diagnóstico.') } }

  return <>{selectedDiagnostic ? <div className="diag-standalone-page"><DiagnosticDetail diagnostic={selectedDiagnostic} onBack={() => setSelectedDiagnostic(null)} onEdit={() => startDiagnosticEdit(selectedDiagnostic)} onDelete={removeDiagnostic} stage={diagStage} onStageChange={onDiagStageChange} /></div> : <><div className="drawer-backdrop"><aside className="drawer detail-drawer"><div className="drawer-heading"><div><p className="eyebrow">DETALLE DE EMPRESA</p><h2>{companyToShow.name}</h2><small>#{companyToShow.id.slice(-6).toUpperCase()}</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="company-detail-label"><span className="industry-chip">{companyToShow.industry}</span><strong>{companyToShow.identification}</strong></div><div className="detail-section"><p className="detail-label">Descripción</p><p className="detail-description">{companyToShow.description}</p></div><div className="detail-meta"><div><span>Administrador</span><strong>{companyToShow.admin?.name ?? 'Sin asignar'}</strong></div><div><span>Creada</span><strong>{relativeDate(companyToShow.createdAt)}</strong></div><div><span>Última actualización</span><strong>{relativeDate(companyToShow.updatedAt)}</strong></div></div><div className="drawer-actions"><button className="button secondary" onClick={onEdit}>Editar</button><button className="button danger" onClick={onDelete}>Eliminar</button></div><div className="diagnostics-section"><div className="section-heading"><div><p className="detail-label">Evaluación</p><h3>Diagnósticos</h3></div><button className="button primary small-button" onClick={startDiagnosticCreate}>+ Nuevo</button></div>{diagnosticError && <div className="form-error">{diagnosticError}</div>}{loadingDiagnostics ? <div className="inline-loading"><span className="loader" />Cargando diagnósticos...</div> : diagnostics.length === 0 ? <EmptyState compact title="Sin diagnósticos" text="Crea el primer diagnóstico de esta empresa." action={<button className="button secondary" onClick={startDiagnosticCreate}>Crear diagnóstico</button>} /> : <div className="diagnostic-list">{diagnostics.map((item) => <button className="diagnostic-row" key={item.id} onClick={() => setSelectedDiagnostic(item)}><span className="diagnostic-icon">◈</span><span className="diagnostic-row-content"><strong>{item.title}</strong><small>{diagnosticStatusLabel[item.status]} · {relativeDate(item.updatedAt)}</small></span><span>›</span></button>)}</div>}</div></aside></div></>}{showDiagnosticForm && <DiagnosticForm draft={diagnosticDraft} setDraft={setDiagnosticDraft} isEdit={Boolean(selectedDiagnostic)} saving={savingDiagnostic} onSubmit={saveDiagnostic} onClose={() => setShowDiagnosticForm(false)} />}</>
}

function DiagnosticForm({ draft, setDraft, isEdit, saving, onSubmit, onClose, companies, companyId, onCompanyIdChange, error }: { draft: DiagnosticDraft; setDraft: React.Dispatch<React.SetStateAction<DiagnosticDraft>>; isEdit: boolean; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void; companies?: Company[]; companyId?: string; onCompanyIdChange?: (id: string) => void; error?: string }) {
  return (
    <div className="drawer-backdrop centered-backdrop">
      <form className="drawer centered-modal company-modal" onSubmit={onSubmit}>
        <div className="company-modal-header">
          <div className="company-modal-icon">◫</div>
          <div className="company-modal-title">
            <p className="eyebrow">{isEdit ? 'EDITAR ANÁLISIS ESTRATÉGICO' : 'NUEVO ANÁLISIS ESTRATÉGICO'}</p>
            <h2>{isEdit ? 'Actualizar análisis estratégico' : 'Crear análisis estratégico'}</h2>
            <p className="company-modal-subtitle">Registra la información del análisis estratégico para esta empresa</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        {!isEdit && companies && companies.length > 0 && <label>Empresa<select value={companyId} onChange={(event) => onCompanyIdChange?.(event.target.value)} required>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
        <label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ej. Diagnóstico operativo 2026" minLength={3} required /></label>
        <label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Describe el alcance de la evaluación..." rows={7} minLength={3} required /></label>
        <label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as DiagnosticStatus })}>{diagnosticStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <div className="drawer-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
          <button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear análisis estratégico'}</button>
        </div>
      </form>
    </div>
  )
}

function DiagnosticDetailBase({ diagnostic }: { diagnostic: Diagnostic }) {
  const [items, setItems] = useState<SWOTItem[]>(diagnostic.swotAnalysis?.items ?? [])
  const [itemDraft, setItemDraft] = useState<SWOTDraft>(emptySWOTDraft)
  const [editingItem, setEditingItem] = useState<SWOTItem | null>(null)
  const [showItemForm, setShowItemForm] = useState(false)
  const [savingItem, setSavingItem] = useState(false)
  const [itemError, setItemError] = useState('')
  const [crosses, setCrosses] = useState<StrategicCross[]>([])
  const [loadingCrosses, setLoadingCrosses] = useState(true)
  const [crossError, setCrossError] = useState('')
  const [crossFormError, setCrossFormError] = useState('')
  const [crossFilter, setCrossFilter] = useState<CrossType | 'ALL'>('ALL')
  const [dragCross, setDragCross] = useState<{ itemId: string; type: SWOTType } | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropDeniedId, setDropDeniedId] = useState<string | null>(null)
  const [pointerDrag, setPointerDrag] = useState<{ itemId: string; pointerId: number; startX: number; startY: number } | null>(null)
  const dragFlyoutRef = useRef<HTMLDivElement | null>(null)
  const dragPosRef = useRef<{ x: number; y: number } | null>(null)
  const [crossModal, setCrossModal] = useState<{ cross: StrategicCross } | null>(null)
  const [crossDraft, setCrossDraft] = useState<{ strategy: string }>(emptyCrossDraft)
  const [savingCross, setSavingCross] = useState(false)
  const [pendingCross, setPendingCross] = useState<{ factor1: SWOTItem | null; factor2: SWOTItem | null; strategy: string } | null>(null)
  const pendingCrossRef = useRef<HTMLDivElement | null>(null)
  const loadCrosses = useCallback(async () => {
    try { const result = await api<{ crosses: StrategicCross[] }>(`/diagnostics/${diagnostic.id}/crosses`); setCrosses(result.crosses) } catch { setCrossError('No pudimos cargar los cruces.') } finally { setLoadingCrosses(false) }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadCrosses() }, 0); return () => window.clearTimeout(timer) }, [loadCrosses])
  useEffect(() => { if (!pendingCross) return; const timer = window.setTimeout(() => { pendingCrossRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 30); return () => window.clearTimeout(timer) }, [pendingCross])
  function startItemCreate(type: SWOTType) { setEditingItem(null); setItemDraft({ ...emptySWOTDraft, type }); setShowItemForm(true); setItemError('') }
  function startItemEdit(item: SWOTItem) { setEditingItem(item); setItemDraft({ type: item.type, description: item.description }); setShowItemForm(true); setItemError('') }
  async function saveItem(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSavingItem(true); setItemError(''); try { const payload = editingItem ? { description: itemDraft.description } : { type: itemDraft.type, description: itemDraft.description }; const result = editingItem ? await api<{ item: SWOTItem }>(`/swot/items/${editingItem.id}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api<{ item: SWOTItem }>(`/diagnostics/${diagnostic.id}/swot/items`, { method: 'POST', body: JSON.stringify(payload) }); setItems((current) => editingItem ? current.map((item) => item.id === result.item.id ? result.item : item) : [...current, result.item]); setEditingItem(null); setShowItemForm(false); setItemDraft(emptySWOTDraft) } catch (requestError) { setItemError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el factor.') } finally { setSavingItem(false) } }
  async function removeItem(item: SWOTItem) { if (!window.confirm('¿Eliminar este factor?')) return; try { await api(`/swot/items/${item.id}`, { method: 'DELETE' }); setItems((current) => current.filter((currentItem) => currentItem.id !== item.id)) } catch { setItemError('No se pudo eliminar el factor.') } }
  function startPendingCross(factor1: SWOTItem | null, factor2: SWOTItem | null) { setCrossError(''); setCrossFormError(''); setPendingCross((current) => (current?.strategy.trim() ? current : { factor1, factor2, strategy: '' })) }
  function cancelPendingCross() { setPendingCross(null); setCrossFormError(''); setCrossError('') }
  function openEditCross(cross: StrategicCross) { setCrossError(''); setCrossFormError(''); setCrossDraft({ strategy: cross.strategy ?? '' }); setCrossModal({ cross }) }
  function closeCrossModal() { setCrossModal(null); setCrossDraft(emptyCrossDraft); setDropTargetId(null); setDropDeniedId(null) }
  async function saveCross(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!crossModal) return
    setSavingCross(true); setCrossFormError('')
    try {
      const result = await api<{ cross: StrategicCross }>(`/crosses/${crossModal.cross.id}`, { method: 'PATCH', body: JSON.stringify({ strategy: crossDraft.strategy }) })
      setCrosses((current) => current.map((item) => item.id === result.cross.id ? result.cross : item))
      closeCrossModal()
    } catch (requestError) {
      setCrossFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el cruce.')
    } finally { setSavingCross(false) }
  }
  async function createCross(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pendingCross) return
    setSavingCross(true); setCrossFormError('')
    try {
      const factor1 = pendingCross.factor1
      const factor2 = pendingCross.factor2
      if (!factor1 || !factor2) { setSavingCross(false); setCrossFormError('Selecciona dos factores para el cruce.'); return }
      if (factor1.id === factor2.id) { setSavingCross(false); setCrossFormError('Selecciona dos factores distintos para el cruce.'); return }
      const internal = factor1.type === 'STRENGTH' || factor1.type === 'WEAKNESS' ? factor1 : factor2
      const external = internal.id === factor1.id ? factor2 : factor1
      if (!isCompatibleCrossPair(internal.type, external.type)) { setSavingCross(false); setCrossFormError('Estos factores no forman un cruce válido (FO, DO, FA o DA).'); return }
      if (crosses.some((cross) => crossPairKey(cross.factor1, cross.factor2) === crossPairKey(internal, external))) { setSavingCross(false); setCrossFormError('Este cruce ya existe para este diagnóstico.'); return }
      const strategy = pendingCross.strategy.trim()
      const payload: Record<string, string> = { factor1Id: internal.id, factor2Id: external.id }
      if (strategy) payload.strategy = strategy
      await api<{ cross: StrategicCross }>(`/diagnostics/${diagnostic.id}/crosses`, { method: 'POST', body: JSON.stringify(payload) })
      setPendingCross(null)
      await loadCrosses()
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) setCrossFormError('Este cruce ya existe para este diagnóstico.')
      else if (requestError instanceof ApiError && requestError.status === 400) setCrossFormError('Los datos del cruce no son válidos. Revisa que la estrategia tenga al menos 3 caracteres y que ambos factores pertenezcan al diagnóstico.')
      else setCrossFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el cruce.')
    } finally { setSavingCross(false) }
  }
  async function removeCross(cross: StrategicCross) { if (!window.confirm('¿Estás seguro de eliminar este cruce?')) return; try { await api(`/crosses/${cross.id}`, { method: 'DELETE' }); setCrosses((current) => current.filter((item) => item.id !== cross.id)) } catch { setCrossError('No se pudo eliminar el cruce.') } }
  function crossPointerDown(item: SWOTItem, event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a')) return
    dragPosRef.current = { x: event.clientX, y: event.clientY }
    if (dragFlyoutRef.current) dragFlyoutRef.current.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 16}px)`
    setPointerDrag({ itemId: item.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY })
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* puntero no capturable */ }
  }
  function crossPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    dragPosRef.current = { x: event.clientX, y: event.clientY }
    if (dragFlyoutRef.current) dragFlyoutRef.current.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 16}px)`
    if (!dragCross) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      const source = items.find((item) => item.id === drag.itemId)
      if (!source) { setPointerDrag(null); return }
      setDragCross({ itemId: source.id, type: source.type })
      return
    }
    if (event.pointerType === 'mouse') event.preventDefault()
    const sourceEl = document.elementFromPoint(event.clientX, event.clientY)
    const card = sourceEl instanceof Element ? sourceEl.closest('[data-swot-item-id]') : null
    const targetId = card instanceof HTMLElement ? card.dataset.swotItemId : null
    if (!targetId || targetId === dragCross.itemId) { setDropTargetId(null); setDropDeniedId(null); return }
    const target = items.find((item) => item.id === targetId)
    if (!target) { setDropTargetId(null); setDropDeniedId(null); return }
    if (crossTypeForPair(dragCross.type, target.type)) { setDropTargetId(targetId); setDropDeniedId(null) }
    else { setDropDeniedId(targetId); setDropTargetId(null) }
  }
  function crossPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    const source = dragCross
    const probe = dragPosRef.current ?? { x: event.clientX, y: event.clientY }
    setPointerDrag(null); setDragCross(null); setDropTargetId(null); setDropDeniedId(null)
    if (!source) return
    const sourceEl = document.elementFromPoint(probe.x, probe.y)
    const card = sourceEl instanceof Element ? sourceEl.closest('[data-swot-item-id]') : null
    const targetId = card instanceof HTMLElement ? card.dataset.swotItemId : null
    if (!targetId || targetId === source.itemId) return
    const factor1 = items.find((item) => item.id === source.itemId)
    const factor2 = items.find((item) => item.id === targetId)
    if (!factor1 || !factor2 || !crossTypeForPair(factor1.type, factor2.type)) return
    startPendingCross(factor1, factor2)
  }
  function crossPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDrag
    if (drag && event.pointerId === drag.pointerId) { setPointerDrag(null); setDragCross(null); setDropTargetId(null); setDropDeniedId(null) }
  }
  const dropTargetItem = dropTargetId ? items.find((item) => item.id === dropTargetId) ?? null : null
  const pendingCrossType = dragCross && dropTargetItem ? crossTypeForPair(dragCross.type, dropTargetItem.type) : null
  const dropHintText = pendingCrossType ? `Soltar para crear cruce ${pendingCrossType}` : dropDeniedId ? 'Esta combinación no forma un cruce válido' : 'Mantén presionado y arrastra sobre otro factor para crear un cruce estratégico'
  const pendingFormType = pendingCross && pendingCross.factor1 && pendingCross.factor2 ? crossTypeForPair(pendingCross.factor1.type, pendingCross.factor2.type) : null
  const pendingCrossF1Id = pendingCross?.factor1?.id ?? ''
  const pendingCrossF2Id = pendingCross?.factor2?.id ?? ''
  const internalCrossOptions = items.filter((item) => item.type === 'STRENGTH' || item.type === 'WEAKNESS')
  const externalCrossOptions = items.filter((item) => item.type === 'OPPORTUNITY' || item.type === 'THREAT')
  return <section className="diag-card diag-section dofa-section"><div className="diag-section-head"><span className="diag-step-chip">2</span><div><h3>Matriz DOFA</h3><p>Fortalezas, debilidades, oportunidades y amenazas del diagnóstico.</p></div></div><div className="swot-kpis"><span className="swot-kpi"><b>{items.length}</b>Factores</span><span className="swot-kpi"><b>{crosses.length}</b>Cruces</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'STRENGTH').length}</b>Fortalezas</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'WEAKNESS').length}</b>Debilidades</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'OPPORTUNITY').length}</b>Oportunidades</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'THREAT').length}</b>Amenazas</span></div>{itemError && <div className="form-error">{itemError}</div>}{dragCross && <div className={`cross-drag-hint${pendingCrossType ? ' go' : ''}${dropDeniedId ? ' no' : ''}`}>{dropHintText}</div>}<div ref={dragFlyoutRef} className={`swot-drag-flyout${dragCross ? ' visible' : ''}`} style={crossDragFlyoutStyle}>{dragCross ? (pendingCrossType ? `Crear cruce ${pendingCrossType}` : 'Suelta sobre un factor compatible') : ''}</div><div className={`swot-grid${dragCross ? ' drag-active' : ''}`}>{swotTypes.map((type) => <section className={`swot-quadrant ${type.value.toLowerCase()}`} key={type.value}><div className="swot-quadrant-heading"><div><span className="swot-symbol">{type.value === 'STRENGTH' ? '+' : type.value === 'WEAKNESS' ? '−' : type.value === 'OPPORTUNITY' ? '↗' : '!'}</span><h3>{type.short}</h3><span className="swot-count">{items.filter((item) => item.type === type.value).length}</span></div></div><div className="swot-items">{items.filter((item) => item.type === type.value).map((item) => <div className={`swot-item${dragCross?.itemId === item.id ? ' dragging' : ''}${dragCross && dragCross.itemId !== item.id && isCompatibleCrossPair(dragCross.type, item.type) ? ' swot-valid' : ''}${dragCross && dragCross.itemId !== item.id && !isCompatibleCrossPair(dragCross.type, item.type) ? ' swot-dim' : ''}${dropTargetId === item.id ? ' drop-target' : ''}${dropDeniedId === item.id ? ' drop-denied' : ''}`} key={item.id} data-swot-item-id={item.id} onPointerDown={(event) => crossPointerDown(item, event)} onPointerMove={crossPointerMove} onPointerUp={crossPointerUp} onPointerCancel={crossPointerCancel}><span className="swot-grip" aria-hidden="true">⋮⋮</span><p>{item.description}</p><div className="swot-actions"><button className="swot-edit" onClick={() => startItemEdit(item)}>Editar</button><button className="swot-edit delete-link" onClick={() => void removeItem(item)}>Eliminar</button></div></div>)}</div>{items.filter((item) => item.type === type.value).length === 0 && <p className="swot-empty">Sin factores todavía</p>}<button className="swot-add" onClick={() => startItemCreate(type.value)}>+ Agregar {type.label.toLowerCase()}</button></section>)}</div><section className="diag-card diag-section crosses-section"><div className="diag-section-head"><span className="diag-step-chip crosses-chip">⌁</span><div><h3>CRUCES ESTRATÉGICOS</h3><p>Convierte los factores DOFA en estrategias accionables.</p></div><div className="crosses-head-actions"><span className="cross-count">{crosses.length} cruces</span><button className="button secondary small-button" onClick={() => startPendingCross(null, null)}>+ Crear cruce</button></div></div>{pendingCross && <div className="cross-new-form" ref={pendingCrossRef}><form onSubmit={createCross}><div className="cross-new-head"><span className="cross-new-badge">NUEVO CRUCE</span>{pendingFormType && <span className={`cross-type-chip ${pendingFormType.toLowerCase()}`}>{pendingFormType}</span>}<span className="cross-new-note">Se crea al instante con origen Usuario</span></div><div className="cross-new-factors">{pendingCross.factor1 ? <label>Factor 1<input type="text" value={`${swotTypeLabels[pendingCross.factor1.type]}: ${pendingCross.factor1.description}`} readOnly /></label> : <label>Factor 1 (interno)<select value={pendingCrossF1Id} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value) ?? null; setPendingCross((current) => current ? { ...current, factor1: item } : current) }}>{internalCrossOptions.length === 0 && <option value="">Sin factores internos</option>}{internalCrossOptions.map((item) => <option key={item.id} value={item.id}>{swotTypeLabels[item.type]}: {item.description}</option>)}</select></label>}{pendingCross.factor2 ? <label>Factor 2<input type="text" value={`${swotTypeLabels[pendingCross.factor2.type]}: ${pendingCross.factor2.description}`} readOnly /></label> : <label>Factor 2 (externo)<select value={pendingCrossF2Id} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value) ?? null; setPendingCross((current) => current ? { ...current, factor2: item } : current) }}>{externalCrossOptions.length === 0 && <option value="">Sin factores externos</option>}{externalCrossOptions.map((item) => <option key={item.id} value={item.id}>{swotTypeLabels[item.type]}: {item.description}</option>)}</select></label>}</div><label>Estrategia<textarea value={pendingCross.strategy} onChange={(event) => setPendingCross((current) => current ? { ...current, strategy: event.target.value } : current)} placeholder="Estrategia propuesta (opcional)..." rows={2} /></label>{crossFormError && <div className="form-error" role="alert">{crossFormError}</div>}<div className="cross-new-actions"><button type="button" className="button secondary small-button" onClick={cancelPendingCross}>Cancelar</button><button className="button primary" disabled={savingCross}>{savingCross ? 'Creando...' : 'Crear cruce'}</button></div></form></div>}{crossError && <div className="form-error">{crossError}</div>}<div className="crosses-tabs">{crossFilterTabs.map((tab) => <button type="button" key={tab.value} className={`cross-filter-tab${crossFilter === tab.value ? ' active' : ''}`} onClick={() => setCrossFilter(tab.value)}>{tab.label}</button>)}</div>{loadingCrosses ? <div className="inline-loading"><span className="loader" />Cargando cruces...</div> : crosses.length === 0 ? <EmptyState compact title="Sin cruces" text="Arrastra un factor sobre otro compatible para crear el primer cruce estratégico." /> : crossFilter !== 'ALL' && crosses.filter((cross) => cross.crossType === crossFilter).length === 0 ? <EmptyState compact title="Sin cruces de este tipo" text="Prueba otro filtro o crea un nuevo cruce." /> : <div className="crosses-list">{crosses.filter((cross) => crossFilter === 'ALL' || cross.crossType === crossFilter).map((cross) => <article className="cross-card" key={cross.id}><div className="cross-card-head"><span className={`cross-type-chip ${cross.crossType.toLowerCase()}`}>{cross.crossType}</span><span className="cross-combo">{crossTypeCombos[cross.crossType]}</span><span className="cross-origin">{crossOriginLabels[cross.origin]}</span><span className="cross-created">#{cross.id.slice(-6).toUpperCase()}</span></div><p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[cross.factor1.type]}</span>{cross.factor1.description}</p><p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[cross.factor2.type]}</span>{cross.factor2.description}</p>{cross.strategy && <p className="cross-strategy"><b>Estrategia:</b> {cross.strategy}</p>}<div className="cross-actions"><button className="button secondary small-button" onClick={() => openEditCross(cross)}>Editar</button><button className="button danger small-button" onClick={() => void removeCross(cross)}>Eliminar</button></div></article>)}</div>}</section>{crossModal && <CrossModal cross={crossModal.cross} draft={crossDraft} setDraft={setCrossDraft} saving={savingCross} error={crossFormError} onSubmit={saveCross} onClose={closeCrossModal} />}{showItemForm && <SWOTItemForm draft={itemDraft} setDraft={setItemDraft} isEdit={Boolean(editingItem)} saving={savingItem} onSubmit={saveItem} onClose={() => { setEditingItem(null); setShowItemForm(false); setItemDraft(emptySWOTDraft) }} />}<div className="swot-summary"><div className="swot-summary-head"><p className="detail-label">RESUMEN DE LA MATRIZ</p></div><div className="swot-summary-grid">{swotTypes.map((type) => <div className={`swot-summary-card ${type.value.toLowerCase()}`} key={type.value}><span className="swot-summary-icon">{type.value === 'STRENGTH' ? '+' : type.value === 'WEAKNESS' ? '−' : type.value === 'OPPORTUNITY' ? '↗' : '!'}</span><div><strong>{items.filter((item) => item.type === type.value).length}</strong><span>{type.label}s</span></div></div>)}<div className="swot-summary-card crosses"><span className="swot-summary-icon">×2</span><div><strong>{crosses.length}</strong><span>cruces</span></div></div></div></div></section>
}

function CrossModal({ cross, draft, setDraft, saving, error, onSubmit, onClose }: { cross: StrategicCross; draft: { strategy: string }; setDraft: React.Dispatch<React.SetStateAction<{ strategy: string }>>; saving: boolean; error: string; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const crossType = cross.crossType
  return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal cross-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon cross-modal-icon">{crossType}</div><div className="company-modal-title"><p className="eyebrow">MATRIZ DOFA</p><h2>Editar cruce</h2><p className="company-modal-subtitle">Actualiza la estrategia del cruce.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><div className="cross-type-detect"><span className="cross-type-chip large">{crossType}</span><div className="cross-type-copy"><p className="detail-label">Tipo de cruce</p><strong>{crossTypeCombos[crossType]}</strong></div><span className="factor-type-badge">FO / DO / FA / DA</span></div><label>Factor 1<input type="text" value={`${swotTypeLabels[cross.factor1.type]}: ${cross.factor1.description}`} readOnly /></label><label>Factor 2<input type="text" value={`${swotTypeLabels[cross.factor2.type]}: ${cross.factor2.description}`} readOnly /></label><label>Estrategia<textarea value={draft.strategy} onChange={(event) => setDraft({ ...draft, strategy: event.target.value })} placeholder="Estrategia del cruce..." rows={3} minLength={3} required /></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div>
}

function SWOTItemForm({ draft, setDraft, isEdit, saving, onSubmit, onClose }: { draft: SWOTDraft; setDraft: React.Dispatch<React.SetStateAction<SWOTDraft>>; isEdit: boolean; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { const detected = swotTypes.find((item) => item.value === draft.type); const detectedSymbol = draft.type === 'STRENGTH' ? '+' : draft.type === 'WEAKNESS' ? '−' : draft.type === 'OPPORTUNITY' ? '↗' : '!'; return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className={`company-modal-icon factor-type-icon ${draft.type.toLowerCase()}`}>{detectedSymbol}</div><div className="company-modal-title"><p className="eyebrow">MATRIZ DOFA</p><h2>{isEdit ? 'Editar factor' : 'Agregar factor'}</h2><p className="company-modal-subtitle">{isEdit ? 'Modifica la información del factor.' : 'Detectado automáticamente'}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div>{!isEdit && <div className="factor-type-detect"><span className={`swot-symbol factor-type-icon ${draft.type.toLowerCase()}`}>{detectedSymbol}</span><div className="factor-type-copy"><p className="detail-label">Tipo detectado</p><strong>{detected?.label}</strong></div><span className="factor-type-badge">Detectado automáticamente</span></div>}{isEdit && <label>Tipo<input type="text" value={detected?.label ?? ''} readOnly /></label>}<label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Describe el factor..." rows={3} minLength={3} required /></label><div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar factor' : 'Agregar factor'}</button></div></form></div> }

function Tickets({ user }: { user: User }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [draft, setDraft] = useState<TicketDraft>(emptyDraft)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  const loadTickets = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (statusFilter) params.set('status', statusFilter)
      if (priorityFilter) params.set('priority', priorityFilter)
      const result = await api<{ tickets: Ticket[] }>(`/tickets?${params}`)
      setTickets(result.tickets)
    } catch { setError('No pudimos cargar los tickets.') } finally { setLoading(false) }
  }, [debouncedSearch, statusFilter, priorityFilter])
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 350); return () => window.clearTimeout(timer) }, [search])
  useEffect(() => { const timer = window.setTimeout(() => { void loadTickets() }, 0); return () => window.clearTimeout(timer) }, [loadTickets])
  useEffect(() => { api<{ users: User[] }>('/users').then((result) => setUsers(result.users)).catch(() => undefined) }, [])

  function startCreate() { setSelected(null); setDraft(emptyDraft); setShowForm(true) }
  function startEdit(ticket: Ticket) { setSelected(ticket); setDraft({ title: ticket.title, description: ticket.description, priority: ticket.priority, status: ticket.status, assignedToId: ticket.assignedTo?.id ?? '' }); setShowForm(true) }
  async function saveTicket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const { assignedToId, ...draftWithoutAssignment } = draft
      const payload = user.role === 'SUPERUSER' ? { ...draft, assignedToId: assignedToId || null } : draftWithoutAssignment
      const result = selected ? await api<{ ticket: Ticket }>(`/tickets/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api<{ ticket: Ticket }>('/tickets', { method: 'POST', body: JSON.stringify(payload) })
      setShowForm(false); setSelected(result.ticket); await loadTickets()
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el ticket.') } finally { setSaving(false) }
  }
  async function removeTicket(ticket: Ticket) { if (!window.confirm('¿Eliminar este ticket?')) return; try { await api(`/tickets/${ticket.id}`, { method: 'DELETE' }); setSelected(null); await loadTickets() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el ticket.') } }

  return <div className="page tickets-page"><div className="page-heading"><div><p className="eyebrow">GESTIÓN OPERATIVA</p><h1>Tickets</h1><p className="muted">Gestiona solicitudes y mantén el trabajo en movimiento.</p></div><button className="button primary" onClick={startCreate}>+ Crear ticket</button></div>{error && <div className="form-error page-alert">{error}</div>}<section className="panel tickets-panel"><div className="filters"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tickets..." /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">Todas las prioridades</option>{priorities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>{loading ? <LoadingState /> : tickets.length === 0 ? <EmptyState title={search || statusFilter || priorityFilter ? 'Sin resultados' : 'No encontramos tickets'} text={search || statusFilter || priorityFilter ? 'Ningún ticket coincide con tu búsqueda o filtros.' : 'Crea el primer ticket para comenzar.'} action={<button className="button secondary" onClick={startCreate}>Crear ticket</button>} /> : <div className="ticket-table-wrap"><table><thead><tr><th>Ticket</th><th>Estado</th><th>Prioridad</th><th>Responsable</th><th>Actualizado</th><th /></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id} className={selected?.id === ticket.id ? 'selected-row' : ''} onClick={() => setSelected(ticket)}><td><div className="ticket-title"><strong>{ticket.title}</strong><small>#{ticket.id.slice(-6).toUpperCase()}</small>{ticket.actionItemId && <small className="ticket-origin">Origen: plan de acción</small>}</div></td><td><Badge type="status" value={ticket.status} /></td><td><Badge type="priority" value={ticket.priority} /></td><td>{ticket.assignedTo ? <div className="assignee"><span className="avatar tiny">{initials(ticket.assignedTo.name)}</span>{ticket.assignedTo.name}</div> : <span className="unassigned">Sin asignar</span>}</td><td className="date-cell">{relativeDate(ticket.updatedAt)}</td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); startEdit(ticket) }}>⋯</button></td></tr>)}</tbody></table></div>}</section>{selected && !showForm && <TicketDetail ticket={selected} user={user} onEdit={() => startEdit(selected)} onDelete={() => removeTicket(selected)} onClose={() => setSelected(null)} />}{showForm && <TicketForm draft={draft} setDraft={setDraft} users={users} isEdit={Boolean(selected)} saving={saving} canAssign={user.role === 'SUPERUSER'} onSubmit={saveTicket} onClose={() => setShowForm(false)} />}</div>
}

function TicketForm({ draft, setDraft, users, isEdit, saving, canAssign, onSubmit, onClose }: { draft: TicketDraft; setDraft: React.Dispatch<React.SetStateAction<TicketDraft>>; users: User[]; isEdit: boolean; saving: boolean; canAssign: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal ticket-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">▤</div><div className="company-modal-title"><p className="eyebrow">{isEdit ? 'EDITAR TICKET' : 'GESTIÓN DE TICKETS'}</p><h2>{isEdit ? 'Actualizar solicitud' : 'Crear ticket'}</h2><p className="company-modal-subtitle">{isEdit ? 'Modifica la información de la solicitud.' : 'Registra una nueva tarea o incidencia para darle seguimiento'}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Describe brevemente la solicitud" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Añade el contexto necesario..." rows={6} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TicketPriority })}>{priorities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TicketStatus })}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>{canAssign && <label>Asignar a<select value={draft.assignedToId} onChange={(event) => setDraft({ ...draft, assignedToId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear ticket'}</button></div></form></div> }

function TicketDetail({ ticket, user, onEdit, onDelete, onClose }: { ticket: Ticket; user: User; onEdit: () => void; onDelete: () => void; onClose: () => void }) { return <div className="drawer-backdrop"><aside className="drawer detail-drawer"><div className="drawer-heading"><div><p className="eyebrow">DETALLE DEL TICKET</p><h2>{ticket.title}</h2><small>#{ticket.id.slice(-6).toUpperCase()}</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="detail-badges"><Badge type="status" value={ticket.status} /><Badge type="priority" value={ticket.priority} /></div><div className="detail-section"><p className="detail-label">Descripción</p><p className="detail-description">{ticket.description}</p></div><div className="detail-meta"><div><span>Creado por</span><strong>{ticket.createdBy.name}</strong></div><div><span>Asignado a</span><strong>{ticket.assignedTo?.name ?? 'Sin asignar'}</strong></div><div><span>Origen</span><strong>{ticket.actionItemId ? 'Plan de acción' : 'Solicitud directa'}</strong></div><div><span>Fechas</span><strong>{ticket.dueDate ? `Vence ${relativeDate(ticket.dueDate)}` : 'Sin fecha límite'}</strong></div><div><span>Última actualización</span><strong>{relativeDate(ticket.updatedAt)}</strong></div></div><div className="drawer-actions"><button className="button secondary" onClick={onEdit}>Editar</button>{(user.role === 'SUPERUSER' || ticket.createdBy.id === user.id) && <button className="button danger" onClick={onDelete}>Eliminar</button>}</div></aside></div> }

function PageError({ message }: { message: string }) { return <div className="page"><div className="error-state"><div>!</div><h2>Algo salió mal</h2><p>{message}</p></div></div> }
function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() }
function firstName(name: string) { return name.split(' ')[0] }
function relativeDate(date: string) { const value = new Date(date); const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const target = new Date(value.getFullYear(), value.getMonth(), value.getDate()); const days = Math.round((target.getTime() - today.getTime()) / 86400000); if (days === 0) return 'Hoy'; if (days === -1) return 'Ayer'; if (days === 1) return 'Mañana'; if (days < 0 && days > -7) return `Hace ${Math.abs(days)} días`; if (days > 1 && days < 7) return `En ${days} días`; return value.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) }

function DiagnosticDetail({ diagnostic, onBack, onEdit, onDelete, stage, onStageChange }: { diagnostic: Diagnostic; onBack: () => void; onEdit: () => void; onDelete: () => void; stage: DiagStage; onStageChange: (stage: DiagStage) => void }) {
  const diagStage = stage
  function setDiagStage(next: DiagStage) { onStageChange(next) }
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const loadAnalysis = useCallback(async () => {
    setAnalysisLoading(true)
    try { const result = await api<{ analysis: AIAnalysis }>(`/diagnostics/${diagnostic.id}/ai-analysis`); setAnalysis(result.analysis) } catch (error) { if (!(error instanceof ApiError && error.status === 404)) setAnalysisError('No se pudo cargar el análisis guardado.') } finally { setAnalysisLoading(false) }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadAnalysis() }, 0); return () => window.clearTimeout(timer) }, [loadAnalysis])
  async function runAnalysis() { if (processing) return; setProcessing(true); setAnalysisError(''); try { const result = await api<{ analysis: AIAnalysis }>(`/diagnostics/${diagnostic.id}/ai-analysis`, { method: 'POST' }); setAnalysis(result.analysis) } catch (error) { setAnalysisError(error instanceof ApiError && error.status === 503 ? 'El análisis IA no está configurado todavía. Añade OPENAI_API_KEY en el backend.' : error instanceof ApiError ? error.message : 'No se pudo generar el análisis IA.') } finally { setProcessing(false) } }
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [importing, setImporting] = useState(false)
  const [recError, setRecError] = useState('')
  const [createActionFor, setCreateActionFor] = useState<Recommendation | null>(null)
  const loadRecommendations = useCallback(async () => {
    try { const result = await api<{ recommendations: Recommendation[] }>(`/diagnostics/${diagnostic.id}/recommendations`); setRecommendations(result.recommendations) } catch { setRecError('No pudimos cargar las recomendaciones.') }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadRecommendations() }, 0); return () => window.clearTimeout(timer) }, [loadRecommendations])
  async function importRecommendations() { if (importing) return; setImporting(true); setRecError(''); try { await api(`/diagnostics/${diagnostic.id}/recommendations/import`, { method: 'POST' }); await loadRecommendations() } catch (requestError) { setRecError(requestError instanceof ApiError ? requestError.message : 'No se pudo importar.') } finally { setImporting(false) } }
  async function setRecommendationStatus(recommendation: Recommendation, status: RecommendationStatus) { setRecError(''); try { const result = await api<{ recommendation: Recommendation }>(`/recommendations/${recommendation.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setRecommendations((current) => current.map((item) => item.id === result.recommendation.id ? result.recommendation : item)); if (status === 'ACCEPTED') { setCreateActionFor(result.recommendation); setDiagStage('planes') } } catch (requestError) { setRecError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar.') } }
  const swotItemCount = diagnostic.swotAnalysis?.items.length ?? 0
  const diagSteps = [
    { label: 'Análisis estratégico', done: diagnostic.status !== 'DRAFT' },
    { label: 'Matriz DOFA', done: swotItemCount > 0 },
    { label: 'Recomendaciones', done: recommendations.length > 0 },
    { label: 'Plan de acción', done: diagnostic.status === 'COMPLETED' },
  ]
  const diagCurrent = diagSteps.findIndex((step) => !step.done)
  const diagModules: Array<{ key: DiagStage; label: string }> = [{ key: 'diagnostico', label: 'Análisis estratégico' }, { key: 'dofa', label: 'Matriz DOFA' }, { key: 'recomendaciones', label: 'Recomendaciones' }, { key: 'planes', label: 'Plan de acción' }]
  const diagStageSteps: Record<DiagStage, number[]> = { diagnostico: [0], dofa: [1], recomendaciones: [2], planes: [3] }
  function navigateToStep(index: number) { const next = diagModules[index]?.key; if (next) setDiagStage(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return (
    <div className="diag-page">
      <header className="diag-hero">
        <p className="diag-breadcrumb"><span>ANÁLISIS ESTRATÉGICO</span><span className="diag-breadcrumb-sep">·</span><strong>{diagnostic.company.name}</strong></p>
        <div className="diag-hero-row">
          <div className="diag-hero-titleblock">
            <span className="diag-hero-icon">◫</span>
            <div>
              <h1>Análisis estratégico</h1>
              <p className="diag-hero-subtitle">{diagnostic.title}</p>
              <p className="diag-hero-meta">Actualizado {relativeDate(diagnostic.updatedAt)} · Creado por {diagnostic.createdBy.name}</p>
            </div>
          </div>
          <div className="diag-hero-actions">
            <button className="button secondary" onClick={onBack}>← Volver</button>
            <span className={`diagnostic-status ${diagnostic.status.toLowerCase()}`}>{diagnosticStatusLabel[diagnostic.status]}</span>
            <button className="button danger" onClick={onDelete}>Eliminar</button>
          </div>
        </div>
      </header>
      <ol className="diag-stepper">{diagSteps.map((step, index) => { const isDone = step.done; const isCurrent = !step.done && index === diagCurrent; const isViewing = diagStageSteps[diagStage].includes(index); return <li key={step.label} className={`${isDone ? 'done' : isCurrent ? 'current' : ''}${isViewing ? ' viewing' : ''}`}><button type="button" className="diag-step-btn" onClick={() => navigateToStep(index)}><span className="diag-step-dot">{isDone ? '✓' : index + 1}</span><span className="diag-step-label">{step.label}</span></button></li> })}</ol>
      <section className={`diag-stage${diagStage === 'diagnostico' ? ' active' : ''}`}>
        <section className="diag-card diag-info-card">
          <div className="diag-card-head"><h3>INFORMACIÓN GENERAL</h3><button className="button secondary small-button" onClick={onEdit}>Editar</button></div>
          <div className="diag-meta-grid">
            <div><span>Empresa</span><strong>{diagnostic.company.name}</strong></div>
            <div><span>Creado por</span><strong>{diagnostic.createdBy.name}</strong></div>
            <div><span>Estado</span><strong>{diagnosticStatusLabel[diagnostic.status]}</strong></div>
            <div><span>Fecha de creación</span><strong>{new Date(diagnostic.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
            <div><span>Última actualización</span><strong>{new Date(diagnostic.updatedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
          </div>
        </section>
        <section className="diag-card diag-section">
          <div className="diag-section-head"><span className="diag-step-chip">1</span><div><h3>Análisis estratégico</h3><p>Información de contexto y alcance del análisis estratégico.</p></div><span className={`diagnostic-status ${diagnostic.status.toLowerCase()}`}>{diagnosticStatusLabel[diagnostic.status]}</span></div>
          <p className="diag-section-text">{diagnostic.description}</p>
        </section>
        <div className="diag-next"><button className="button primary" onClick={() => setDiagStage('dofa')}>Siguiente: Matriz DOFA →</button></div>
      </section>
      <section className={`diag-stage${diagStage === 'dofa' ? ' active' : ''}`}>
        <div className="ai-assistant">
          <div className="ai-assistant-head"><span className="ai-assistant-icon">✦</span><div><p className="detail-label">ANÁLISIS ESTRATÉGICO CON CHECKY</p><h3>Asistente estratégico</h3></div><span className="ai-badge">IA</span></div>
          <p className="ai-assistant-desc">La IA analiza los factores y cruces estratégicos para identificar oportunidades, riesgos y estrategias.</p>
          <ul className="ai-assistant-list"><li>Factores de la matriz</li><li>Cruces del usuario</li><li>Patrones estratégicos</li></ul>
          <div className="ai-assistant-cta">{analysisError && <div className="form-error">{analysisError}</div>}<button className="button primary" onClick={() => void runAnalysis()} disabled={processing}>{processing ? <><span className="button-loader" />Procesando...</> : analysis ? 'Regenerar análisis' : 'Analizar con IA'}</button></div>
        </div>
        <DiagnosticDetailBase diagnostic={diagnostic} />
        {analysis && <AIAnalysisPanel analysis={analysis} loading={analysisLoading} items={diagnostic.swotAnalysis?.items ?? []} onNavigateToRecommendations={() => setDiagStage('recomendaciones')} />}
        {!analysis && analysisLoading && <div className="diag-card ai-loading"><span className="loader" />Buscando análisis guardado...</div>}
        <div className="diag-next"><button className="button primary" onClick={() => setDiagStage('recomendaciones')}>Siguiente: Recomendaciones →</button></div>
      </section>
      <section className={`diag-stage${diagStage === 'recomendaciones' ? ' active' : ''}`}>
        <div className="diag-actionbar">
          <div className="diag-actionbar-info"><p className="detail-label">GESTIÓN</p><span>Prioriza las recomendaciones y conviértelas en acciones del plan.</span></div>
        </div>
        {recError && <div className="form-error">{recError}</div>}
        <RecommendationsPanel analysis={analysis} recommendations={recommendations} onImport={importRecommendations} onSetStatus={setRecommendationStatus} onRequestCreateAction={(recommendation) => { setDiagStage('planes'); setCreateActionFor(recommendation) }} importing={importing} />
        <div className="diag-next"><button className="button primary" onClick={() => setDiagStage('planes')}>Siguiente: Plan de acción →</button></div>
      </section>
      <section className={`diag-stage${diagStage === 'planes' ? ' active' : ''}`}>
        <ActionPlansPanel diagnostic={diagnostic} recommendations={recommendations} createActionFor={createActionFor} onCreateActionClose={() => setCreateActionFor(null)} />
      </section>
    </div>
  )
}

function RecommendationsPanel({ analysis, recommendations, onImport, onSetStatus, onRequestCreateAction, importing }: { analysis: AIAnalysis | null; recommendations: Recommendation[]; onImport: () => Promise<void>; onSetStatus: (recommendation: Recommendation, status: RecommendationStatus) => Promise<void>; onRequestCreateAction: (recommendation: Recommendation) => void; importing: boolean }) {
  const aiRecommendations = analysis?.recommendations ?? []
  const [filter, setFilter] = useState<RecommendationStatus | 'all'>('all')
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)
  const cards = aiRecommendations.map((ai) => ({ ai, rec: recommendations.find((item) => item.title === ai.title) ?? null }))
  const statusCounts = (value: RecommendationStatus | 'all') => value === 'all' ? cards.length : cards.filter((card) => card.rec?.status === value).length
  const visibleCards = cards.filter((card) => filter === 'all' || card.rec?.status === filter)
  function toggleCard(title: string) { setOpenIds((current) => { const next = new Set(current); if (next.has(title)) next.delete(title); else next.add(title); return next }) }
  async function applyStatus(rec: Recommendation, status: RecommendationStatus) {
    setBusyId(rec.id)
    try {
      await onSetStatus(rec, status)
      setFlashId(rec.id)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlashId(null), 1400)
    } finally { setBusyId(null) }
  }
  return (
    <section className="ai-analysis-panel recommendations-panel">
      <div className="rec-panel-head">
        <span className="rec-panel-icon">✦</span>
        <div className="rec-panel-copy">
          <p className="detail-label">GESTIÓN · RECOMENDACIONES</p>
          <h3>Recomendaciones IA</h3>
          <p className="ai-panel-subtitle">Recomendaciones priorizadas para abordar los hallazgos.</p>
          <span className="rec-ai-note">✦ Generadas por Checky · Análisis estratégico</span>
        </div>
        <span className="ai-badge">IA</span>
      </div>
      {!analysis ? <EmptyState compact title="Sin análisis IA" text="Genera primero el análisis con IA para importar recomendaciones." /> : aiRecommendations.length === 0 ? <EmptyState compact title="Sin recomendaciones" text="El análisis IA no incluyó recomendaciones." /> : (
        <>
          <div className="rec-stats">
            <span className="rec-stat"><b>{statusCounts('all')}</b><small>Total</small></span>
            <span className="rec-stat pending"><b>{statusCounts('PENDING')}</b><small>Pendientes</small></span>
            <span className="rec-stat accepted"><b>{statusCounts('ACCEPTED')}</b><small>Aceptadas</small></span>
            <span className="rec-stat rejected"><b>{statusCounts('REJECTED')}</b><small>Rechazadas</small></span>
          </div>
          <div className="rec-filters" aria-label="Filtrar recomendaciones">
            {recFilters.map((option) => <button key={option.value} type="button" className={`rec-filter${filter === option.value ? ' active' : ''}`} onClick={() => setFilter(option.value)}>{option.label}<span className="rec-filter-count">{statusCounts(option.value)}</span></button>)}
          </div>
          {visibleCards.length === 0 ? <EmptyState compact title="Sin resultados" text="Ninguna recomendación coincide con este filtro." /> : <div className="rec-list">{visibleCards.map(({ ai, rec }) => { const open = openIds.has(ai.title); const busy = busyId === rec?.id; return (
            <article key={ai.title} className={`ai-recommendation rec-card${open ? ' open' : ''}${busy ? ' busy' : ''}${flashId === rec?.id ? ' flash' : ''}`}>
              <div className="rec-card-head">
                <span className={`rec-priority ${ai.priority.toLowerCase()}`} title={`Prioridad ${recPriorityLabel[ai.priority].toLowerCase()}`}>{recPriorityLabel[ai.priority]}</span>
                <div className="rec-card-badges">{rec ? <span className={`rec-status ${rec.status.toLowerCase()}`}>{recommendationStatusLabel[rec.status]}</span> : <span className="rec-status unimported">Por importar</span>}</div>
              </div>
              <h4 className="rec-card-title">{ai.title}</h4>
              <p className="rec-card-desc">{ai.description}</p>
              <button type="button" className="rec-toggle" aria-expanded={open} onClick={() => toggleCard(ai.title)}><span className="rec-toggle-icon">▾</span>{open ? 'Ocultar análisis' : 'Ver análisis completo'}</button>
              <div className="rec-details"><div className="rec-details-inner"><div className="rec-details-divider" /><div className="rec-detail-block"><span className="rec-detail-label">Objetivo</span><p>{ai.description}</p></div><div className="rec-detail-block"><span className="rec-detail-label">Impacto esperado</span><p>{ai.expectedImpact}</p></div><div className="rec-detail-block"><span className="rec-detail-label">Acción sugerida</span><p>{ai.suggestedAction}</p></div></div></div>
              <div className="rec-card-actions">
                <span className="rec-ai-tag">✦ Generada por Checky</span>
                <div className="rec-actions">
                  {rec ? (rec.status === 'ACCEPTED' ? <button type="button" className="button primary small-button" onClick={() => onRequestCreateAction(rec)}>Crear acción →</button> : rec.status === 'PENDING' ? <><button type="button" className="button secondary small-button" onClick={() => void applyStatus(rec, 'REJECTED')} disabled={busy}>Rechazar</button><button type="button" className="button primary small-button" onClick={() => void applyStatus(rec, 'ACCEPTED')} disabled={busy}>{busy ? <><span className="button-loader" />Procesando...</> : 'Aceptar'}</button></> : null) : <button type="button" className="button primary small-button" onClick={() => void onImport()} disabled={importing}>{importing ? <><span className="button-loader" />Importando...</> : 'Importar'}</button>}
                </div>
              </div>
            </article>
          ) })}</div>}
        </>
      )}
    </section>
  )
}

function ActionPlansPanel({ diagnostic, recommendations, createActionFor, onCreateActionClose }: { diagnostic: Diagnostic; recommendations: Recommendation[]; createActionFor: Recommendation | null; onCreateActionClose: () => void }) {
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingPlan, setSavingPlan] = useState(false)
  const [savingItem, setSavingItem] = useState(false)
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [planDraft, setPlanDraft] = useState<PlanDraft>(emptyPlanDraft)
  const [itemFormFor, setItemFormFor] = useState<string | null>(null)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft)
  const [planEditDraft, setPlanEditDraft] = useState<PlanDraft>(emptyPlanDraft)
  const [editingPlan, setEditingPlan] = useState<ActionPlan | null>(null)
  const [savingPlanEdit, setSavingPlanEdit] = useState(false)
  const [itemEditDraft, setItemEditDraft] = useState<ItemDraft>(emptyItemDraft)
  const [editingItem, setEditingItem] = useState<ActionItem | null>(null)
  const [savingItemEdit, setSavingItemEdit] = useState(false)
  const [dragState, setDragState] = useState<{ itemId: string; fromStatus: ActionItemStatus } | null>(null)
  const [dropTarget, setDropTarget] = useState<ActionItemStatus | null>(null)
  const [recActionPlanId, setRecActionPlanId] = useState('')
  const [recActionDraft, setRecActionDraft] = useState<ItemDraft>(emptyItemDraft)
  const [recActionError, setRecActionError] = useState('')
  const [savingRecAction, setSavingRecAction] = useState(false)
  const [modalPlanDraft, setModalPlanDraft] = useState<PlanDraft>(emptyPlanDraft)
  const [creatingModalPlan, setCreatingModalPlan] = useState(false)
  const loadPlans = useCallback(async () => {
    setLoading(true); setError('')
    try { const result = await api<{ actionPlans: ActionPlan[] }>(`/diagnostics/${diagnostic.id}/action-plans`); setPlans(result.actionPlans) } catch { setError('No pudimos cargar los planes de acción.') } finally { setLoading(false) }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadPlans() }, 0); return () => window.clearTimeout(timer) }, [loadPlans])
  useEffect(() => { api<{ users: User[] }>('/users').then((result) => setUsers(result.users)).catch(() => undefined) }, [])
  useEffect(() => { if (createActionFor) { setRecActionDraft({ ...emptyItemDraft, recommendationId: createActionFor.id }); setModalPlanDraft(emptyPlanDraft); setRecActionPlanId(''); setRecActionError('') } }, [createActionFor])
  async function savePlan(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSavingPlan(true); setError(''); try { await api(`/diagnostics/${diagnostic.id}/action-plans`, { method: 'POST', body: JSON.stringify(planDraft) }); setShowPlanForm(false); setPlanDraft(emptyPlanDraft); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo crear el plan.') } finally { setSavingPlan(false) } }
  async function saveItem(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!itemFormFor) return; setSavingItem(true); setError(''); try { const payload = { ...itemDraft, recommendationId: itemDraft.recommendationId || null, responsibleId: itemDraft.responsibleId || null, dueDate: itemDraft.dueDate || null }; await api(`/action-plans/${itemFormFor}/items`, { method: 'POST', body: JSON.stringify(payload) }); setItemFormFor(null); setItemDraft(emptyItemDraft); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo agregar la acción.') } finally { setSavingItem(false) } }
  async function updateItem(item: ActionItem, patch: { status?: ActionItemStatus; responsibleId?: string | null; priority?: Level }) { setError(''); try { const payload = patch.responsibleId !== undefined ? { ...patch, responsibleId: patch.responsibleId || null } : patch; await api(`/action-items/${item.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar la acción.') } }
  function onCardDragStart(item: ActionItem) { setError(''); setDragState({ itemId: item.id, fromStatus: item.status }) }
  function onCardDragEnd() { setDragState(null); setDropTarget(null) }
  function onColumnDragOver(event: React.DragEvent<HTMLDivElement>, status: ActionItemStatus) { if (!dragState) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(status) }
  function onColumnDragLeave(event: React.DragEvent<HTMLDivElement>, status: ActionItemStatus) { if (dropTarget === status && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) { setDropTarget(null) } }
  function onColumnDrop(event: React.DragEvent<HTMLDivElement>, status: ActionItemStatus) { event.preventDefault(); const current = dragState; setDragState(null); setDropTarget(null); if (!current || current.fromStatus === status) return; const item = plans.flatMap((entry) => entry.items).find((entry) => entry.id === current.itemId); if (item) void updateItem(item, { status }) }
  async function removeItem(item: ActionItem) { if (!window.confirm('¿Eliminar esta acción?')) return; try { await api(`/action-items/${item.id}`, { method: 'DELETE' }); await loadPlans() } catch { setError('No se pudo eliminar la acción.') } }
  async function updatePlan(plan: ActionPlan, status: ActionPlanStatus) { setError(''); try { await api(`/action-plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar el plan.') } }
  function startPlanEdit(plan: ActionPlan) { setPlanEditDraft({ title: plan.title, description: plan.description, status: plan.status }); setEditingPlan(plan) }
  async function savePlanEdit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!editingPlan) return; setSavingPlanEdit(true); setError(''); try { await api(`/action-plans/${editingPlan.id}`, { method: 'PATCH', body: JSON.stringify({ title: planEditDraft.title, description: planEditDraft.description, status: planEditDraft.status }) }); setEditingPlan(null); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar el plan.') } finally { setSavingPlanEdit(false) } }
  async function removePlan(plan: ActionPlan) { if (!window.confirm('¿Eliminar este plan de acción y sus actividades?')) return; try { await api(`/action-plans/${plan.id}`, { method: 'DELETE' }); await loadPlans() } catch { setError('No se pudo eliminar el plan.') } }
  function startItemEdit(item: ActionItem) { setEditingItem(item); setItemEditDraft({ title: item.title, description: item.description, priority: item.priority, status: item.status, recommendationId: item.recommendationId ?? '', responsibleId: item.responsibleId ?? '', dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '' }) }
  async function saveItemEdit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!editingItem) return; setSavingItemEdit(true); setError(''); try { const payload = { title: itemEditDraft.title, description: itemEditDraft.description, priority: itemEditDraft.priority, status: itemEditDraft.status, responsibleId: itemEditDraft.responsibleId || null, dueDate: itemEditDraft.dueDate || null }; await api(`/action-items/${editingItem.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); setEditingItem(null); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar la acción.') } finally { setSavingItemEdit(false) } }
  async function saveRecAction(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!createActionFor || !recActionPlanId || savingRecAction) return; setSavingRecAction(true); setRecActionError(''); try { const payload = { ...recActionDraft, recommendationId: createActionFor.id, responsibleId: recActionDraft.responsibleId || null, dueDate: recActionDraft.dueDate || null }; await api(`/action-plans/${recActionPlanId}/items`, { method: 'POST', body: JSON.stringify(payload) }); onCreateActionClose(); await loadPlans() } catch (requestError) { setRecActionError(requestError instanceof ApiError ? requestError.message : 'No se pudo crear la acción.') } finally { setSavingRecAction(false) } }
  async function createPlanFromModal(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (creatingModalPlan) return; setCreatingModalPlan(true); setRecActionError(''); try { const result = await api<{ actionPlan: ActionPlan }>(`/diagnostics/${diagnostic.id}/action-plans`, { method: 'POST', body: JSON.stringify(modalPlanDraft) }); setRecActionPlanId(result.actionPlan.id); setModalPlanDraft(emptyPlanDraft); await loadPlans() } catch (requestError) { setRecActionError(requestError instanceof ApiError ? requestError.message : 'No se pudo crear el plan.') } finally { setCreatingModalPlan(false) } }
return <section className="ai-analysis-panel plans-panel"><div className="ai-panel-heading"><div className="ai-panel-heading-main"><span className="diag-step-chip">5</span><div><p className="detail-label">EJECUCIÓN</p><h3>Planes de Acción</h3><p className="ai-panel-subtitle">Organiza la ejecución de las recomendaciones.</p></div></div><button className="button primary small-button" onClick={() => { setPlanDraft(emptyPlanDraft); setShowPlanForm(!showPlanForm) }}>{showPlanForm ? 'Cerrar' : '+ Nuevo plan'}</button></div>{error && <div className="form-error">{error}</div>}{showPlanForm && <form className="factor-form plan-form" onSubmit={savePlan}><div className="factor-form-heading"><h3>Nuevo plan de acción</h3><button type="button" className="icon-button" onClick={() => setShowPlanForm(false)}>×</button></div><label>Título<input value={planDraft.title} onChange={(event) => setPlanDraft({ ...planDraft, title: event.target.value })} placeholder="Ej. Plan de mejora 2026" minLength={3} required /></label><label>Descripción<textarea value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} rows={3} minLength={3} required /></label><div className="drawer-actions"><button type="button" className="button secondary" onClick={() => setShowPlanForm(false)}>Cancelar</button><button className="button primary" disabled={savingPlan}>{savingPlan ? 'Creando...' : 'Crear plan'}</button></div></form>}{loading ? <div className="ai-loading"><span className="loader" />Cargando planes...</div> : plans.length === 0 ? <EmptyState compact title="Sin planes de acción" text="Crea el primer plan para organizar la ejecución." /> : <><div className="plan-kpis">{[{ label: 'Planes activos', value: plans.filter((entry) => entry.status === 'ACTIVE').length, tone: 'active', icon: '▤' }, { label: 'Acciones totales', value: plans.reduce((sum, entry) => sum + entry.items.length, 0), tone: 'total', icon: '◫' }, { label: 'Completadas', value: plans.reduce((sum, entry) => sum + entry.items.filter((item) => item.status === 'COMPLETED').length, 0), tone: 'completed', icon: '✓' }, { label: 'En progreso', value: plans.reduce((sum, entry) => sum + entry.items.filter((item) => item.status === 'IN_PROGRESS').length, 0), tone: 'progress', icon: '↻' }].map((kpi) => <div className={`plan-kpi${kpi.tone ? ` ${kpi.tone}` : ''}`} key={kpi.label}><span className="plan-kpi-icon" aria-hidden="true">{kpi.icon}</span><div><strong>{kpi.value}</strong><small>{kpi.label}</small></div></div>)}</div><div className="plans-list">{plans.map((plan) => <article className="plan-card" key={plan.id}><header className="plan-card-head"><div className="plan-card-main"><div className="plan-title-row"><h4>{plan.title}</h4><span className={`plan-pill ${plan.status.toLowerCase()}`}>{planStatusLabel[plan.status]}</span></div><p className="plan-description">{plan.description}</p><small className="plan-createdby">Creado por {plan.createdBy.name}</small></div><div className="plan-actions"><label className="plan-status-field"><span className="plan-status-label">Estado</span><select value={plan.status} onChange={(event) => void updatePlan(plan, event.target.value as ActionPlanStatus)} aria-label="Estado del plan">{actionPlanStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="plan-actions-buttons"><button className="button secondary small-button" onClick={() => startPlanEdit(plan)}>Editar</button><button className="button danger small-button" onClick={() => void removePlan(plan)}>Eliminar</button></div></div></header>{itemFormFor === plan.id && <form className="factor-form item-form" onSubmit={saveItem}><div className="factor-form-heading"><h3>Nueva acción</h3><button type="button" className="icon-button" onClick={() => setItemFormFor(null)}>×</button></div><label>Título<input value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} placeholder="¿Qué se hará?" minLength={3} required /></label><label>Descripción<textarea value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} rows={2} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={itemDraft.priority} onChange={(event) => setItemDraft({ ...itemDraft, priority: event.target.value as Level })}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Recomendación<select value={itemDraft.recommendationId} onChange={(event) => setItemDraft({ ...itemDraft, recommendationId: event.target.value })}><option value="">Sin relacionar</option>{recommendations.filter((item) => item.status !== 'REJECTED').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div><div className="form-grid"><label>Responsable<select value={itemDraft.responsibleId} onChange={(event) => setItemDraft({ ...itemDraft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Fecha límite<input type="date" value={itemDraft.dueDate} onChange={(event) => setItemDraft({ ...itemDraft, dueDate: event.target.value })} /></label></div><div className="drawer-actions"><button type="button" className="button secondary" onClick={() => setItemFormFor(null)}>Cancelar</button><button className="button primary" disabled={savingItem}>{savingItem ? 'Agregando...' : 'Agregar acción'}</button></div></form>}<div className="plan-board">{boardColumns.map((column) => { const columnItems = plan.items.filter((item) => item.status === column.status); return <div className={`kanban-column ${column.status.toLowerCase()}${dragState ? ' drop-enabled' : ''}${dropTarget === column.status ? ' drop-target' : ''}`} key={column.status} onDragOver={(event) => onColumnDragOver(event, column.status)} onDragLeave={(event) => onColumnDragLeave(event, column.status)} onDrop={(event) => onColumnDrop(event, column.status)}><div className="kanban-column-header"><span className="kanban-column-name"><span className={`kanban-column-icon ${column.status.toLowerCase()}`} aria-hidden="true">{kanbanColumnVisuals[column.status].icon}</span><span className="kanban-column-title">{column.label}</span></span><span className="kanban-column-count">{columnItems.length}</span></div>{dragState && dropTarget === column.status && <div className="kanban-drop-hint">Soltar aquí</div>}{columnItems.length === 0 ? <div className="kanban-column-empty"><span className={`kanban-empty-icon ${column.status.toLowerCase()}`} aria-hidden="true">{kanbanColumnVisuals[column.status].icon}</span><strong>{kanbanColumnVisuals[column.status].emptyTitle}</strong><small>{kanbanColumnVisuals[column.status].emptyText}</small></div> : columnItems.map((item) => <KanbanActionCard key={item.id} item={item} isDragging={dragState?.itemId === item.id} onDragStart={onCardDragStart} onDragEnd={onCardDragEnd} onChangeStatus={(entry, status) => void updateItem(entry, { status })} onEdit={startItemEdit} onRemove={(entry) => void removeItem(entry)} />)}</div> })}</div><footer className="plan-card-footer"><button className="text-button" onClick={() => { setItemDraft(emptyItemDraft); setItemFormFor(itemFormFor === plan.id ? null : plan.id) }}>{itemFormFor === plan.id ? 'Cerrar formulario' : '+ Agregar acción'}</button></footer></article>)}</div></>}{editingPlan && <PlanEditForm draft={planEditDraft} setDraft={setPlanEditDraft} saving={savingPlanEdit} onSubmit={savePlanEdit} onClose={() => setEditingPlan(null)} />}{editingItem && <ActionItemEditForm draft={itemEditDraft} setDraft={setItemEditDraft} users={users} saving={savingItemEdit} onSubmit={saveItemEdit} onClose={() => setEditingItem(null)} />}{createActionFor && <ActionFromRecommendationForm recommendation={createActionFor} plans={plans} users={users} planId={recActionPlanId} onPlanIdChange={setRecActionPlanId} draft={recActionDraft} onDraftChange={setRecActionDraft} planDraft={modalPlanDraft} onPlanDraftChange={setModalPlanDraft} error={recActionError} saving={savingRecAction} creatingPlan={creatingModalPlan} onSubmit={saveRecAction} onPlanCreate={createPlanFromModal} onClose={onCreateActionClose} />}</section> }

function KanbanActionCard({ item, isDragging, onDragStart, onDragEnd, onChangeStatus, onEdit, onRemove }: { item: ActionItem; isDragging: boolean; onDragStart: (item: ActionItem) => void; onDragEnd: () => void; onChangeStatus: (item: ActionItem, status: ActionItemStatus) => void; onEdit: (item: ActionItem) => void; onRemove: (item: ActionItem) => void }) {
  const [expanded, setExpanded] = useState(false)
  const longDescription = item.description.length > 110
  return <article className={`kanban-card${isDragging ? ' dragging' : ''}`} draggable onDragStart={() => onDragStart(item)} onDragEnd={onDragEnd}><div className="kanban-card-head"><strong className="kanban-card-title">{item.title}</strong><div className="kanban-card-controls"><button type="button" className="text-button" onClick={() => onEdit(item)}>Editar</button><button type="button" className="row-action" onClick={() => onRemove(item)} aria-label="Eliminar">×</button></div></div><div className="kanban-card-status"><span className={`kanban-status-badge ${item.status.toLowerCase()}`}>{actionItemStatusLabel[item.status]}</span><select value={item.status} onChange={(event) => onChangeStatus(item, event.target.value as ActionItemStatus)} aria-label="Estado de la acción">{actionItemStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></div><p className={`kanban-card-description${expanded ? ' expanded' : ''}`}>{item.description}</p>{longDescription && <button type="button" className="kanban-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Ver menos' : 'Ver más'}</button>}<div className="kanban-meta-row"><span className={`level-pill ${item.priority.toLowerCase()}`}>P. {recPriorityLabel[item.priority]}</span>{item.responsible && <span className="assignee"><span className="avatar tiny">{initials(item.responsible.name)}</span>{item.responsible.name}</span>}{item.dueDate && <span className="kanban-meta-cell kanban-due">Vence {relativeDate(item.dueDate)}</span>}</div><div className="kanban-card-foot"><div className="kanban-foot-row"><span className="kanban-meta-cell kanban-origin">Origen: {item.recommendation ? 'recomendación' : 'plan de acción'}</span>{item.ticket && <span className="kanban-meta-cell kanban-ticket">Ticket #{item.ticket.id.slice(-6).toUpperCase()}</span>}</div>{item.recommendation && <span className="kanban-rec" title={item.recommendation.title}>{item.recommendation.title}</span>}</div></article>
}
function PlanEditForm({ draft, setDraft, saving, onSubmit, onClose }: { draft: PlanDraft; setDraft: React.Dispatch<React.SetStateAction<PlanDraft>>; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">▤</div><div className="company-modal-title"><p className="eyebrow">PLAN DE ACCIÓN</p><h2>Editar plan</h2><p className="company-modal-subtitle">Actualiza la información del plan de acción.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ej. Plan de mejora 2026" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} minLength={3} required /></label><div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div> }

function ActionItemEditForm({ draft, setDraft, users, saving, onSubmit, onClose }: { draft: ItemDraft; setDraft: React.Dispatch<React.SetStateAction<ItemDraft>>; users: User[]; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">✓</div><div className="company-modal-title"><p className="eyebrow">ACTIVIDAD</p><h2>Editar acción</h2><p className="company-modal-subtitle">Actualiza la información y el responsable de la actividad.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="¿Qué se hará?" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Level })}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ActionItemStatus })}>{actionItemStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><div className="form-grid"><label>Responsable<select value={draft.responsibleId} onChange={(event) => setDraft({ ...draft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Fecha límite<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label></div><div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div> }

function ActionFromRecommendationForm({ recommendation, plans, users, planId, onPlanIdChange, draft, onDraftChange, planDraft, onPlanDraftChange, error, saving, creatingPlan, onSubmit, onPlanCreate, onClose }: { recommendation: Recommendation; plans: ActionPlan[]; users: User[]; planId: string; onPlanIdChange: (value: string) => void; draft: ItemDraft; onDraftChange: React.Dispatch<React.SetStateAction<ItemDraft>>; planDraft: PlanDraft; onPlanDraftChange: React.Dispatch<React.SetStateAction<PlanDraft>>; error: string; saving: boolean; creatingPlan: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onPlanCreate: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">⚑</div><div className="company-modal-title"><p className="eyebrow">RECOMENDACIÓN</p><h2>Crear acción</h2><p className="company-modal-subtitle">Convierte esta recomendación en una acción del plan de acción.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Recomendación relacionada<input type="text" value={recommendation.title} readOnly /></label>{plans.length === 0 ? <div className="modal-plan-empty"><p>No tienes planes de acción para este diagnóstico.</p><form className="factor-form plan-form" onSubmit={onPlanCreate}><div className="factor-form-heading"><h3>Nuevo plan</h3></div><label>Título<input value={planDraft.title} onChange={(event) => onPlanDraftChange({ ...planDraft, title: event.target.value })} placeholder="Ej. Plan de mejora 2026" minLength={3} required /></label><label>Descripción<textarea value={planDraft.description} onChange={(event) => onPlanDraftChange({ ...planDraft, description: event.target.value })} rows={2} minLength={3} required /></label><button className="button primary" disabled={creatingPlan}>{creatingPlan ? 'Creando plan...' : '+ Crear plan'}</button></form></div> : <label>Plan de acción<select value={planId} onChange={(event) => onPlanIdChange(event.target.value)} required><option value="">Selecciona un plan</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}<label>Título<input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder="¿Qué se hará?" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} rows={2} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={draft.priority} onChange={(event) => onDraftChange({ ...draft, priority: event.target.value as Level })}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Responsable<select value={draft.responsibleId} onChange={(event) => onDraftChange({ ...draft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Fecha límite<input type="date" value={draft.dueDate} onChange={(event) => onDraftChange({ ...draft, dueDate: event.target.value })} /></label>{error && <div className="form-error">{error}</div>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving || creatingPlan || !planId}>{saving ? 'Creando...' : 'Crear acción'}</button></div></form></div> }

function AiKpis({ items, crossCount }: { items: SWOTItem[]; crossCount?: number }) {
  const kpis = [
    { label: 'Fortalezas', value: items.filter((item) => item.type === 'STRENGTH').length, icon: '＋', tone: 'strength' },
    { label: 'Debilidades', value: items.filter((item) => item.type === 'WEAKNESS').length, icon: '－', tone: 'weakness' },
    { label: 'Oportunidades', value: items.filter((item) => item.type === 'OPPORTUNITY').length, icon: '↗', tone: 'opportunity' },
    { label: 'Amenazas', value: items.filter((item) => item.type === 'THREAT').length, icon: '⚠', tone: 'threat' },
    ...(crossCount !== undefined ? [{ label: 'Cruces estratégicos', value: crossCount, icon: '◫', tone: 'strategy' }] : []),
  ]
  return <div className="ai-kpis">{kpis.map((kpi) => <div className={`ai-kpi ${kpi.tone}`} key={kpi.label}><span className="ai-kpi-icon" aria-hidden="true">{kpi.icon}</span><div><strong>{kpi.value}</strong><span>{kpi.label}</span></div></div>)}</div>
}

function AiExecSummary({ text }: { text: string }) { return <article className="ai-exec-summary"><span className="ai-exec-icon" aria-hidden="true">✦</span><div><h4>Resumen ejecutivo</h4><p>{text}</p></div></article> }

function AiDiagnosis({ text }: { text: string }) { return <article className="ai-diagnosis"><span className="ai-diagnosis-icon" aria-hidden="true">◫</span><div><h4>Diagnóstico</h4><p>{text}</p></div></article> }

function AiFindings({ findings }: { findings: Array<{ basis: 'FACT' | 'INFERENCE'; finding: string }> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  return <section className="ai-section ai-findings"><h4>Hallazgos</h4>{findings.length === 0 ? <p className="ai-empty">Sin hallazgos.</p> : <div className="ai-findings-list">{findings.map((item, index) => { const isOpen = openIndex === index; return <article className={`ai-finding${isOpen ? ' open' : ''}`} key={`${item.finding}-${index}`}><button type="button" className="ai-finding-head" aria-expanded={isOpen} onClick={() => setOpenIndex(isOpen ? null : index)}><span className="ai-finding-num">{String(index + 1).padStart(2, '0')}</span><span className="ai-finding-content"><span className={`ai-finding-tag ${item.basis === 'FACT' ? 'fact' : 'inference'}`}>{item.basis === 'FACT' ? 'Hecho' : 'Inferencia'}</span><p>{item.finding}</p></span><span className="ai-finding-chevron" aria-hidden="true">▾</span></button></article> })}</div>}</section>
}

function AiStrategyTabs({ strategies }: { strategies: Array<{ key: 'FO' | 'DO' | 'FA' | 'DA'; label: string; tone: string; items: string[] }> }) {
  const [active, setActive] = useState<string>(strategies[0]?.key ?? 'FO')
  const current = strategies.find((entry) => entry.key === active) ?? strategies[0]
  return <section className="ai-section ai-strategy"><div className="ai-strategy-head"><h4>Matriz estratégica</h4><span className="ai-strategy-hint">Estrategias por combinación de factores</span></div><div className="ai-strategy-tabs" role="tablist">{strategies.map((entry) => <button type="button" role="tab" aria-selected={active === entry.key} className={`ai-strategy-tab ${entry.tone}${active === entry.key ? ' active' : ''}`} key={entry.key} onClick={() => setActive(entry.key)}><span className="ai-strategy-tab-icon" aria-hidden="true">{entry.key}</span><span>{entry.label}</span><small>{entry.items.length}</small></button>)}</div>{current && <div className="ai-strategy-panel" role="tabpanel">{current.items.length ? current.items.map((item, index) => <div className="ai-strategy-item" key={`${current.key}-${item}-${index}`}><span className="ai-strategy-item-check" aria-hidden="true">✓</span><p>{item}</p></div>) : <p className="ai-empty">Sin estrategias generadas para esta combinación.</p>}</div>}</section>
}

function AiPrioritySection({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return <article className={`ai-priority-card ${tone}`}><div className="ai-priority-head"><h4>{title}</h4><span className="ai-priority-count">{items.length}</span></div>{items.length ? <ul className="ai-priority-list">{items.map((item, index) => <li key={`${title}-${item}-${index}`}>{item}</li>)}</ul> : <p className="ai-empty">Sin elementos.</p>}</article>
}

function AIAnalysisPanel({ analysis, loading, items = [], crossCount, onNavigateToRecommendations }: { analysis: AIAnalysis; loading: boolean; items?: SWOTItem[]; crossCount?: number; onNavigateToRecommendations?: () => void }) {
  return <section className="ai-analysis-panel"><div className="ai-panel-heading"><div className="ai-panel-heading-main"><span className="diag-step-chip">3</span><div><p className="detail-label">ESTRATEGIA</p><h3>Análisis con IA</h3><p className="ai-panel-subtitle">Lectura estratégica generada con IA a partir de la DOFA.</p></div></div><span className="ai-badge">IA</span></div>{loading && <div className="ai-loading"><span className="loader" />Actualizando análisis...</div>}<AiKpis items={items} crossCount={crossCount} /><AiExecSummary text={analysis.executiveSummary} /><AiDiagnosis text={analysis.diagnosis} /><AiFindings findings={analysis.keyFindings} /><AiStrategyTabs strategies={[{ key: 'FO', label: 'Estrategias FO', tone: 'fo', items: analysis.foStrategies }, { key: 'DO', label: 'Estrategias DO', tone: 'do', items: analysis.doStrategies }, { key: 'FA', label: 'Estrategias FA', tone: 'fa', items: analysis.faStrategies }, { key: 'DA', label: 'Estrategias DA', tone: 'da', items: analysis.daStrategies }]} /><div className="ai-priority-grid"><AiPrioritySection title="Riesgos prioritarios" tone="risk" items={analysis.priorityRisks} /><AiPrioritySection title="Oportunidades prioritarias" tone="opportunity" items={analysis.priorityOpportunities} /></div><div className="ai-recommendations"><h4>Recomendaciones</h4>{analysis.recommendations.map((recommendation) => <article className="ai-recommendation" key={recommendation.title}><div><strong>{recommendation.title}</strong><span className={`level-pill ${recommendation.priority.toLowerCase()}`}>{recommendation.priority === 'HIGH' ? 'Alta' : recommendation.priority === 'MEDIUM' ? 'Media' : 'Baja'}</span></div><p>{recommendation.description}</p><small><b>Impacto esperado:</b> {recommendation.expectedImpact}</small><small><b>Acción sugerida:</b> {recommendation.suggestedAction}</small></article>)}</div>{onNavigateToRecommendations && <article className="ai-next-card"><div className="ai-next-copy"><span className="ai-next-icon" aria-hidden="true">→</span><div><h4>¿Qué sigue?</h4><p>Convierte estas estrategias y recomendaciones en un plan de acción.</p></div></div><button type="button" className="button primary" onClick={onNavigateToRecommendations}>Ver recomendaciones →</button></article>}</section>
}

export default App

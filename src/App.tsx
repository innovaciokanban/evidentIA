import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { ActionItem, ActionItemStatus, ActionPlan, ActionPlanStatus, AIAnalysis, AIFinding, CheckyCategory, CheckyFindingBasis, CheckyMessage, CheckySession, CheckySuggestionStatus, Company, CrossOrigin, CrossType, CrossWeightingCriteria, CrossWeightingCriterion, DashboardData, Diagnostic, DiagnosticStatus, DiagnosticStrategy, Level, Recommendation, RecommendationStatus, Role, StrategicCross, StrategyBand, StrategySource, StrategyWeighting, StrategyWeightingResponse, SWOTItem, SWOTType, Ticket, TicketPriority, TicketStatus, User, WeightableStrategySource, WeightingLevel } from './types'
import { Badge } from './components/ui/Badge'
import { KPICard } from './components/ui/KPICard'
import { EmptyState } from './components/ui/EmptyState'
import { LoadingState } from './components/ui/LoadingState'
import { askConfirm, ConfirmHost } from './components/ui/useConfirm'
import { DiagnosticStatusChart } from './components/charts/DiagnosticStatusChart'
import { RecommendationChart } from './components/charts/RecommendationChart'
import { ProcessesPage } from './components/processes/ProcessesPage'
import { WorkflowIcon } from './components/processes/ProcessIcons'
import logo from './assets/logokanban.png'
import checkyImage from './assets/Aprobado por checky.png'
import './App.css'

type View = 'dashboard' | 'tickets' | 'companies' | 'diagnostics' | 'processes' | 'swot' | 'recommendations' | 'action-plans' | 'users'

type DiagStage = 'diagnostico' | 'dofa' | 'recomendaciones' | 'planes'

type CompaniesIntent = { kind: 'create-company' } | { kind: 'create-diagnostic' } | { kind: 'open-company'; companyId: string } | { kind: 'open-first-diagnostic' } | { kind: 'open-diagnostic'; companyId: string; diagnosticId: string }

type DetailIntent = { kind: 'create-diagnostic' } | { kind: 'open-first-diagnostic' } | { kind: 'open-diagnostic'; diagnosticId: string }

type TicketDraft = { title: string; description: string; priority: TicketPriority; status: TicketStatus; assignedToId: string }

type CompanyDraft = { name: string; identification: string; industry: string; description: string; adminEnabled: boolean; adminName: string; adminEmail: string; adminPassword: string }

type DiagnosticDraft = { title: string; description: string; status: DiagnosticStatus }

type SWOTDraft = { type: SWOTType; description: string }

type PlanDraft = { title: string; description: string; status: ActionPlanStatus }

type ItemDraft = { title: string; description: string; priority: Level; status: ActionItemStatus; recommendationId: string; responsibleId: string; dueDate: string }
type StrategyTaskDraft = { title: string; responsibleId: string; dueDate: string }

type UserFormRole = 'COMPANY_ADMIN' | 'COMPANY_USER'

type UserDraft = { name: string; email: string; password: string; role: UserFormRole; companyId: string }

const statuses: Array<{ value: TicketStatus; label: string }> = [
  { value: 'OPEN', label: 'Abierto' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'RESOLVED', label: 'Resuelto' },
  { value: 'CLOSED', label: 'Cerrado' },]

const priorities: Array<{ value: TicketPriority; label: string }> = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },]

const emptyDraft: TicketDraft = { title: '', description: '', priority: 'MEDIUM', status: 'OPEN', assignedToId: '' }

const emptyCompanyDraft: CompanyDraft = { name: '', identification: '', industry: '', description: '', adminEnabled: false, adminName: '', adminEmail: '', adminPassword: '' }

const emptyDiagnosticDraft: DiagnosticDraft = { title: '', description: '', status: 'DRAFT' }

const emptySWOTDraft: SWOTDraft = { type: 'STRENGTH', description: '' }

const emptyPlanDraft: PlanDraft = { title: '', description: '', status: 'DRAFT' }

const emptyItemDraft: ItemDraft = { title: '', description: '', priority: 'MEDIUM', status: 'PENDING', recommendationId: '', responsibleId: '', dueDate: '' }
const emptyStrategyTaskDraft: StrategyTaskDraft = { title: '', responsibleId: '', dueDate: '' }

const emptyUserDraft: UserDraft = { name: '', email: '', password: '', role: 'COMPANY_USER', companyId: '' }

const formRoleOptions: Array<{ value: UserFormRole; label: string }> = [{ value: 'COMPANY_ADMIN', label: 'Administrador de empresa' }, { value: 'COMPANY_USER', label: 'Usuario de empresa' }]

const roleLabels: Record<Role, string> = { SUPERUSER: 'Superusuario', COMPANY_ADMIN: 'Administrador de empresa', COMPANY_USER: 'Usuario de empresa' }

const diagnosticStatuses: Array<{ value: DiagnosticStatus; label: string }> = [{ value: 'DRAFT', label: 'Borrador' }, { value: 'IN_PROGRESS', label: 'En progreso' }, { value: 'COMPLETED', label: 'Completado' }]

const swotTypes: Array<{ value: SWOTType; label: string; short: string }> = [{ value: 'STRENGTH', label: 'Fortaleza', short: 'FORTALEZAS' }, { value: 'WEAKNESS', label: 'Debilidad', short: 'DEBILIDADES' }, { value: 'OPPORTUNITY', label: 'Oportunidad', short: 'OPORTUNIDADES' }, { value: 'THREAT', label: 'Amenaza', short: 'AMENAZAS' }]

const crossTypeCombos: Record<CrossType, string> = { FO: 'Fortaleza + Oportunidad', DO: 'Debilidad + Oportunidad', FA: 'Fortaleza + Amenaza', DA: 'Debilidad + Amenaza' }

const crossOriginLabels: Record<CrossOrigin, string> = { USER: 'Usuario', AI: 'IA', BOTH: 'Usuario + IA' }
/** Mismo vocabulario que las prioridades de un ticket, para que la palabra no cambie segun la pantalla. */
const crossPriorityLabels: Record<Level, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' }

const crossFilterTabs: Array<{ value: CrossType | 'ALL'; label: string }> = [{ value: 'ALL', label: 'Todos' }, { value: 'FO', label: 'FO' }, { value: 'DO', label: 'DO' }, { value: 'FA', label: 'FA' }, { value: 'DA', label: 'DA' }]

const emptyCrossDraft = { strategy: '' }

const crossDragFlyoutStyle: React.CSSProperties = { position: 'fixed', left: 0, top: 0, pointerEvents: 'none' }

const crossOriginIcons: Record<CrossOrigin, string> = { USER: '👤', AI: '✨', BOTH: '👤✨' }

/**
 * Regla unica de origen para el flujo. `BOTH` es un par que el usuario ya habia creado y que la IA
 * volvio a proponer sobre el, asi que cuenta como cruce del usuario y nunca como uno generado por la
 * IA. Las dos pantallas del flujo derivan de aqui, de modo que ningun cruce puede aparecer dos veces
 * ni quedar fuera de las dos.
 */
const isUserCross = (cross: StrategicCross) => cross.origin === 'USER' || cross.origin === 'BOTH'

const weightingLevels: Array<{ value: WeightingLevel; label: string; short: string }> = [
  { value: 'MUY_BAJO', label: 'Muy bajo', short: '1' },
  { value: 'BAJO', label: 'Bajo', short: '2' },
  { value: 'MEDIO', label: 'Medio', short: '3' },
  { value: 'ALTO', label: 'Alto', short: '4' },
  { value: 'MUY_ALTO', label: 'Muy alto', short: '5' },]// Los pesos y las bandas son solo informacion para la persona que evalua: el ponderado siempre lo
// calcula el backend, aqui no se replica ninguna formula ni se estiman puntuaciones.

const weightingCriteriaMeta: Array<{ key: CrossWeightingCriterion; label: string; weight: string; hint: string }> = [
  { key: 'impactoEstrategico', label: 'Impacto estrategico', weight: '20%', hint: 'Que tanto mueve la estrategia el objetivo del análisis estratégico.' },
  { key: 'viabilidad', label: 'Viabilidad', weight: '25%', hint: 'Cuanto se puede sostener con los recursos actuales.' },
  { key: 'urgencia', label: 'Urgencia / Oportunidad', weight: '20%', hint: 'Que tan rapido hay que actuar o que ventana se pierde.' },
  { key: 'sinergiaInterna', label: 'Sinergia interna', weight: '15%', hint: 'Cuanto se apoya en las fortalezas que ya existen.' },
  { key: 'impactoReputacional', label: 'Impacto reputacional', weight: '20%', hint: 'Como afecta la percepcion de la empresa.' },]

const neutralWeightingCriteria: CrossWeightingCriteria = { impactoEstrategico: 'MEDIO', viabilidad: 'MEDIO', urgencia: 'MEDIO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' }

const weightingBands: Array<{ min: number; label: string; tone: string }> = [
  { min: 4, label: 'Inmediata', tone: 'immediate' },
  { min: 3, label: 'Corto plazo', tone: 'short' },
  { min: 2, label: 'Mediano plazo', tone: 'medium' },
  { min: 1, label: 'Largo plazo', tone: 'long' },]

const swotTypeLabels = Object.fromEntries(swotTypes.map((item) => [item.value, item.label])) as Record<SWOTType, string>

/** Las etapas intermedias se muestran sobre la vista de la matriz DOFA, que es la que las abre. */
type StrategicScreen = 'checky' | 'ponderacion'

/** Etapas del análisis estratégico, en el único orden en el que se recorren. */
type FlowStep = 'diagnostico' | 'dofa' | StrategicScreen

/**
 * Unico recorrido del análisis. El indicador del detalle y los chips numerados de cada bloque salen de
 * aqui, de modo que ninguna pantalla puede anunciar una etapa que el indicador no tiene ni repetirla.
 *
 * El análisis estratégico con IA no aparece como etapa propia: Checky lo orquesta dentro de su propia
 * pantalla, que es donde se lee, y así el usuario ejecuta un análisis y no dos.
 *
 * Las secciones de recomendaciones y planes de acción quedan deliberadamente fuera: no son una etapa
 * del análisis estratégico, asi que no aparecen en el indicador. Se siguen alcanzando desde el
 * contenido del propio análisis y desde las rutas que ya existen.
 */
const diagFlow: Array<{ key: FlowStep; label: string }> = [
  { key: 'diagnostico', label: 'Análisis estratégico' },
  { key: 'dofa', label: 'Matriz DOFA' },
  { key: 'checky', label: 'Checky' },
  { key: 'ponderacion', label: 'Ponderación' },
]

/** Numero de etapa que anuncia el indicador. Solo lo consumen los bloques que llevan chip numerado. */
const flowStepNumber = (key: FlowStep) => diagFlow.findIndex((step) => step.key === key) + 1

function crossTypeForPair(a: SWOTType, b: SWOTType): CrossType | null {
  if (a === b) return null
  const pair = [a, b].sort().join(':')
  const matrix: Record<string, CrossType> = { 'OPPORTUNITY:STRENGTH': 'FO', 'STRENGTH:THREAT': 'FA', 'OPPORTUNITY:WEAKNESS': 'DO', 'THREAT:WEAKNESS': 'DA' }
  return matrix[pair] ?? null}

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
  return <Workspace user={user} onLogout={() => setUser(null)} />}

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
  )}

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
    processes: 'Gestión por Procesos',
    swot: 'Matriz DOFA',
    recommendations: 'Recomendaciones',
    'action-plans': 'Planes de acción',
    tickets: 'Tickets',
    users: 'Usuarios',
  }
  // El menu anuncia solo los dos puntos de entrada. Las cinco etapas viven en un unico indicador
  // dentro del detalle, y las secciones de recomendaciones y planes de accion siguen alcanzables
  // desde el contenido del propio analisis y desde las rutas que ya existen.
  const qualityViews: Array<{ key: View; icon: string; label: string }> = [
    { key: 'companies', icon: '▥', label: 'Empresas' },
    { key: 'diagnostics', icon: '◫', label: 'Análisis estratégico' },
  ]
  const qualityViewsIntentMap: Record<string, CompaniesIntent> = {
    swot: { kind: 'open-first-diagnostic' },
    recommendations: { kind: 'open-first-diagnostic' },
    'action-plans': { kind: 'open-first-diagnostic' },
  }
  // Las vistas que ocupa el modulo de analisis son las que mapea cada una de sus etapas, de modo que
  // la lista no se desincroniza del mapa de navegacion.
  const analysisViews: View[] = Object.values(diagStageToView)
  // Al quedar una sola entrada para el analisis, esa entrada se marca activa durante todo el recorrido:
  // las cinco etapas del indicador mas las secciones de recomendaciones y planes de accion.
  const isQualityActive = (key: View) => key === 'diagnostics'
    ? diagnosticActive || analysisViews.includes(view)
    : view === key && !diagnosticActive
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark"><img src={logo} alt="Kanban Consultoría" /></span><span>Kanban <b>Consultoria</b></span></div>
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
            <button key={item.key} className={`nav-item ${isQualityActive(item.key) ? 'active' : ''}`} onClick={() => handleQualityNav(item.key)}>
              <span className="nav-icon">{item.icon}</span> {item.label}
            </button>
          ))}
          <button className={`nav-item ${view === 'processes' ? 'active' : ''}`} onClick={() => navigateToView('processes')}>
            <span className="nav-icon"><WorkflowIcon /></span> Gestión por Procesos
          </button>
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
          <div className="breadcrumb"><span>Operaciones</span><b>/</b><strong>{viewLabels[diagnosticActive ? 'diagnostics' : view]}</strong></div>
          <div className="topbar-actions">
            <span className="date-label">{new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date())}</span>
            <div className="avatar top-avatar">{initials(user.name)}</div>
          </div>
        </header>
        {view === 'dashboard' && <Dashboard user={user} onNavigate={navigateToView} />}
        {view === 'tickets' && <Tickets user={user} />}
        {view === 'diagnostics' && <DiagnosticsPage user={user} onDiagnosticActiveChange={setDiagnosticActive} diagStage={diagStage} onDiagStageChange={setDiagStage} />}
        {view === 'processes' && <ProcessesPage user={user} />}
        {(view === 'companies' || view === 'swot' || view === 'recommendations' || view === 'action-plans') && (
          <Companies user={user} intent={companiesIntent} onConsumeIntent={consumeCompaniesIntent} diagnosticActive={diagnosticActive} onDiagnosticActiveChange={setDiagnosticActive} diagStage={diagStage} onDiagStageChange={setDiagStage} />
        )}
        {view === 'users' && (user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN') && <Users user={user} />}
      </main>
      <ConfirmHost />
    </div>
  )}

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
  const [loadError, setLoadError] = useState('')
  const loadDiagnostics = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const companiesResult = await api<{ companies: Company[] }>('/companies')
      const accessibleCompanies = companiesResult.companies
      setCompanies(accessibleCompanies)
      setCompanyId((current) => accessibleCompanies.some((company) => company.id === current) ? current : (accessibleCompanies[0]?.id ?? ''))
      const grouped = await Promise.all(accessibleCompanies.map((company) => api<{ diagnostics: Diagnostic[] }>(`/companies/${company.id}/diagnostics`).then((result) => result.diagnostics).catch(() => [] as Diagnostic[])))
      setDiagnostics(grouped.flat())
    } catch { setLoadError('No pudimos cargar los análisis estratégicos.') } finally { setLoading(false) }
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
      if (!companyId) { setFormError('Selecciona una empresa para el análisis estratégico.'); setSaving(false); return }
      if (editing) {
        const result = await api<{ diagnostic: Diagnostic }>(`/diagnostics/${editing.id}`, { method: 'PATCH', body: JSON.stringify(draft) })
        setDiagnostics((current) => current.map((item) => item.id === result.diagnostic.id ? result.diagnostic : item))
        if (selected && selected.id === result.diagnostic.id) setSelected(result.diagnostic)
      } else {
        const result = await api<{ diagnostic: Diagnostic }>(`/companies/${companyId}/diagnostics`, { method: 'POST', body: JSON.stringify(draft) })
        setDiagnostics((current) => [result.diagnostic, ...current])
      }
      setShowForm(false)
    } catch (requestError) { setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el análisis estratégico.') } finally { setSaving(false) }
  }
  async function removeDiagnostic(diagnostic: Diagnostic) {
    const confirmed = await askConfirm({ title: 'Eliminar análisis estratégico', message: `Se eliminará «${diagnostic.title}» junto con su matriz DOFA, sus recomendaciones y sus planes de acción. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    try {
      await api(`/diagnostics/${diagnostic.id}`, { method: 'DELETE' })
      setDiagnostics((current) => current.filter((item) => item.id !== diagnostic.id))
      if (selected && selected.id === diagnostic.id) setSelected(null)
    } catch { setError('No se pudo eliminar el análisis estratégico.') }
  }
  if (selected) {
    return (
      <>
        <div className="diag-standalone-page">
          <DiagnosticDetail diagnostic={selected} user={user} onBack={() => setSelected(null)} onEdit={() => startEdit(selected)} onDelete={() => void removeDiagnostic(selected)} stage={diagStage} onStageChange={onDiagStageChange} />
        </div>
        {showForm && <DiagnosticForm draft={draft} setDraft={setDraft} isEdit={Boolean(editing)} saving={saving} onSubmit={saveDiagnostic} onClose={() => { setShowForm(false); setEditing(null) }} error={formError} companies={canCreate ? companies : []} companyId={companyId} onCompanyIdChange={setCompanyId} />}
      </>
    )
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GESTIÓN DE CALIDAD</p>
          <h1>Análisis estratégicos</h1>
          <p className="muted">Consulta y gestiona los análisis estratégicos de calidad de tus empresas.</p>
        </div>
        {canCreate && <button className="button primary" onClick={startCreate}>+ Nuevo análisis estratégico</button>}
      </div>
      {error && <div className="form-error page-alert" role="alert">{error}</div>}
      {loadError && <ErrorBanner message={loadError} onRetry={() => void loadDiagnostics()} />}
      <section className="panel">
        <div className="filters">
          <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, empresa o creador..." /></div>
        </div>
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title={search ? 'Sin resultados' : 'No encontramos análisis estratégicos'} text={search ? 'Ningún análisis estratégico coincide con tu búsqueda.' : 'Crea el primer análisis estratégico para comenzar la evaluación de calidad.'} action={canCreate ? <button className="button secondary" onClick={startCreate}>Crear análisis estratégico</button> : undefined} />
        ) : (
          <div className="company-table-wrap">
            <table>
              <thead>
                <tr><th>Análisis estratégico</th><th>Empresa</th><th>Estado</th><th>Creador</th><th>Actualizada</th><th /></tr>
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
                      <button className="button primary small-button" onClick={(event) => { event.stopPropagation(); openDetail(diagnostic) }}>Ver análisis estratégico</button>
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
  )}

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
  const [loadError, setLoadError] = useState('')
  const loadUsers = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const result = await api<{ users: User[] }>('/users')
      setUsers(result.users)
    } catch { setLoadError('No pudimos cargar los usuarios.') } finally { setLoading(false) }
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
    const confirmed = await askConfirm({ title: 'Eliminar usuario', message: `Se eliminará el acceso de ${target.name}. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setError(''); setNotice('')
    try {
      await api(`/users/${target.id}`, { method: 'DELETE' })
      setUsers((current) => current.filter((item) => item.id !== target.id))
      setNotice('Usuario eliminado correctamente.')
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el usuario.') }
  }
  return (
    <div className="page">
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
      {loadError && <ErrorBanner message={loadError} onRetry={() => void loadUsers()} />}
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
  )}

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
  )}

function Dashboard({ user, onNavigate }: { user: User; onNavigate: (view: View, intent?: CompaniesIntent) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // El resumen se recarga con un callback para que el estado de error ofrezca un reintento de verdad
  // en lugar de dejar a la persona en una pantalla sin salida.
  const loadDashboard = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api<DashboardData>('/dashboard')) } catch { setError('No pudimos cargar el resumen.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => { void loadDashboard() }, 0); return () => window.clearTimeout(timer) }, [loadDashboard])
  if (error) return <PageError message={error} onRetry={() => void loadDashboard()} />
  if (loading || !data) return <LoadingState />
  const { summary } = data
  const greeting = new Date().getHours() < 12 ? 'Buenos días' : new Date().getHours() < 19 ? 'Buenas tardes' : 'Buenas noches'
  const attentionItems: Array<{ type: string; label: string; count: number; tone: string; view: View }> = []
  if (summary.overdueActionItems > 0) attentionItems.push({ type: 'alert', label: 'Acciones vencidas', count: summary.overdueActionItems, tone: 'red', view: 'action-plans' })
  if (summary.inProgressDiagnostics > 0) attentionItems.push({ type: 'progress', label: 'Análisis estratégicos en curso', count: summary.inProgressDiagnostics, tone: 'amber', view: 'diagnostics' })
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
          <button className="button primary" onClick={() => onNavigate('diagnostics', { kind: 'open-first-diagnostic' })}>Ver análisis estratégicos</button>
        </div>
      </div>
      <section className="metric-grid executive-kpis">
        <KPICard icon="▥" label="Empresas" value={summary.totalCompanies} tone="blue" />
        <KPICard icon="◫" label="Análisis estratégicos" value={summary.totalDiagnostics} tone="purple" />
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
              <div><p className="detail-label">ACTIVIDAD RECIENTE</p><h2>Análisis estratégicos</h2></div>
              <button className="text-button" onClick={() => onNavigate('diagnostics', { kind: 'open-first-diagnostic' })}>Ver todos →</button>
            </div>
            <div className="quality-list">
              {data.recentDiagnostics.length === 0 ? (
                <div className="empty-state compact"><p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Sin análisis estratégicos recientes</p></div>
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
  )}

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
  const [loadError, setLoadError] = useState('')
  const loadCompanies = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      const result = await api<{ companies: Company[] }>(`/companies?${params}`)
      setCompanies(result.companies)
    } catch { setLoadError('No pudimos cargar las empresas.') } finally { setLoading(false) }
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
  async function removeCompany(companyToRemove: Company) { const confirmed = await askConfirm({ title: 'Eliminar empresa', message: `Se eliminará «${companyToRemove.name}» con todos sus análisis estratégicos y planes de acción. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/companies/${companyToRemove.id}`, { method: 'DELETE' }); setSelected(null); await loadCompanies() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar la empresa.') } }
  return <div className="page">{!diagnosticActive && <><div className="page-heading"><div><p className="eyebrow">GESTIÓN DE CLIENTES</p><h1>Empresas</h1><p className="muted">Consulta y organiza las empresas a tu cargo.</p></div>{user.role === 'SUPERUSER' && <button className="button primary" onClick={startCreate}>+ Crear empresa</button>}</div>{error && <div className="form-error page-alert" role="alert">{error}</div>}{loadError && <ErrorBanner message={loadError} onRetry={() => void loadCompanies()} />}<section className="panel companies-panel"><div className="filters"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, identificación o industria..." /></div></div>{loading ? <LoadingState /> : companies.length === 0 ? <EmptyState title={search ? 'Sin resultados' : 'No encontramos empresas'} text={search ? 'Ninguna empresa coincide con tu búsqueda.' : 'Crea la primera empresa para comenzar.'} action={user.role === 'SUPERUSER' ? <button className="button secondary" onClick={startCreate}>Crear empresa</button> : undefined} /> : <div className="company-table-wrap"><table><thead><tr><th>Empresa</th><th>Identificación</th><th>Industria</th><th>Administrador</th><th>Actualizada</th><th /></tr></thead><tbody>{companies.map((companyToShow) => <tr key={companyToShow.id} className={selected?.id === companyToShow.id ? 'selected-row' : ''} onClick={() => setSelected(companyToShow)}><td><div className="ticket-title"><strong>{companyToShow.name}</strong><small>#{companyToShow.id.slice(-6).toUpperCase()}</small></div></td><td>{companyToShow.identification}</td><td><span className="industry-chip">{companyToShow.industry}</span></td><td>{companyToShow.admin ? <div className="assignee"><span className="avatar tiny">{initials(companyToShow.admin.name)}</span>{companyToShow.admin.name}</div> : <span className="unassigned">Sin administrador</span>}</td><td className="date-cell">{relativeDate(companyToShow.updatedAt)}</td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); startEdit(companyToShow) }}>⋯</button></td></tr>)}</tbody></table></div>}</section></>}{selected && !showForm && <CompanyDetail company={selected} user={user} onEdit={() => startEdit(selected)} onDelete={() => removeCompany(selected)} onClose={() => setSelected(null)} detailIntent={detailIntent} onConsumeDetailIntent={consumeDetailIntent} onDiagnosticActiveChange={onDiagnosticActiveChange} diagStage={diagStage} onDiagStageChange={onDiagStageChange} />}{showForm && <CompanyForm draft={draft} setDraft={setDraft} isEdit={Boolean(selected)} saving={saving} onSubmit={saveCompany} onClose={() => setShowForm(false)} />}</div>}

function CompanyForm({ draft, setDraft, isEdit, saving, onSubmit, onClose }: { draft: CompanyDraft; setDraft: React.Dispatch<React.SetStateAction<CompanyDraft>>; isEdit: boolean; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">▥</div><div className="company-modal-title"><p className="eyebrow">{isEdit ? 'EDITAR EMPRESA' : 'NUEVA EMPRESA'}</p><h2>{isEdit ? 'Actualizar empresa' : 'Crear empresa'}</h2><p className="company-modal-subtitle">Registra la información de la empresa en el sistema</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Nombre de la empresa<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Acme Consultores" minLength={2} required /></label><div className="form-grid"><label>Identificación<input value={draft.identification} onChange={(event) => setDraft({ ...draft, identification: event.target.value })} placeholder="NIT o identificación" minLength={3} required /></label><label>Industria<input value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })} placeholder="Ej. Tecnología" minLength={2} required /></label></div><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Añade contexto sobre la empresa..." rows={6} minLength={3} required /></label>{!isEdit && <div className="admin-create-section"><label className="admin-create-toggle"><input type="checkbox" checked={draft.adminEnabled} onChange={(event) => setDraft({ ...draft, adminEnabled: event.target.checked })} /><span className="admin-create-check" aria-hidden="true">✓</span><div className="admin-create-copy"><strong>Crear administrador para esta empresa</strong><small>Se creará un usuario administrador con rol de COMPANY_ADMIN.</small></div></label>{draft.adminEnabled && <div className="admin-fields"><div className="form-grid"><label>Nombre del administrador<input value={draft.adminName} onChange={(event) => setDraft({ ...draft, adminName: event.target.value })} placeholder="Ej. Ana López" minLength={2} required /></label><label>Correo del administrador<input type="email" value={draft.adminEmail} onChange={(event) => setDraft({ ...draft, adminEmail: event.target.value })} placeholder="admin@empresa.com" autoComplete="off" required /></label></div><label>Contraseña inicial<input type="password" value={draft.adminPassword} onChange={(event) => setDraft({ ...draft, adminPassword: event.target.value })} placeholder="Mínimo 8 caracteres" minLength={8} autoComplete="new-password" required /></label></div>}</div>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear empresa'}</button></div></form></div> }

function CompanyDetail({ company: companyToShow, user, onEdit, onDelete, onClose, detailIntent, onConsumeDetailIntent, onDiagnosticActiveChange, diagStage, onDiagStageChange }: { company: Company; user: User; onEdit: () => void; onDelete: () => void; onClose: () => void; detailIntent: DetailIntent | null; onConsumeDetailIntent: () => void; onDiagnosticActiveChange: (active: boolean) => void; diagStage: DiagStage; onDiagStageChange: (stage: DiagStage) => void }) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [selectedDiagnostic, setSelectedDiagnostic] = useState<Diagnostic | null>(null)
  const [diagnosticDraft, setDiagnosticDraft] = useState<DiagnosticDraft>(emptyDiagnosticDraft)
  const [showDiagnosticForm, setShowDiagnosticForm] = useState(false)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true)
  const [diagnosticError, setDiagnosticError] = useState('')
  const [diagnosticLoadError, setDiagnosticLoadError] = useState('')
  const [savingDiagnostic, setSavingDiagnostic] = useState(false)
  const loadDiagnostics = useCallback(async () => {
    setLoadingDiagnostics(true); setDiagnosticLoadError('')
    try {
      const result = await api<{ diagnostics: Diagnostic[] }>(`/companies/${companyToShow.id}/diagnostics`)
      setDiagnostics(result.diagnostics)
    } catch { setDiagnosticLoadError('No pudimos cargar los análisis estratégicos.') } finally { setLoadingDiagnostics(false) }
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
    } catch (requestError) { setDiagnosticError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el análisis estratégico.') } finally { setSavingDiagnostic(false) }
  }
  async function removeDiagnostic() { if (!selectedDiagnostic) return; const confirmed = await askConfirm({ title: 'Eliminar análisis estratégico', message: `Se eliminará «${selectedDiagnostic.title}» junto con su matriz DOFA, sus recomendaciones y sus planes de acción. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/diagnostics/${selectedDiagnostic.id}`, { method: 'DELETE' }); setSelectedDiagnostic(null); await loadDiagnostics() } catch { setDiagnosticError('No se pudo eliminar el análisis estratégico.') } }
  return <>{selectedDiagnostic ? <div className="diag-standalone-page"><DiagnosticDetail diagnostic={selectedDiagnostic} user={user} onBack={() => setSelectedDiagnostic(null)} onEdit={() => startDiagnosticEdit(selectedDiagnostic)} onDelete={removeDiagnostic} stage={diagStage} onStageChange={onDiagStageChange} /></div> : <><div className="drawer-backdrop"><aside className="drawer detail-drawer"><div className="drawer-heading"><div><p className="eyebrow">DETALLE DE EMPRESA</p><h2>{companyToShow.name}</h2><small>#{companyToShow.id.slice(-6).toUpperCase()}</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="company-detail-label"><span className="industry-chip">{companyToShow.industry}</span><strong>{companyToShow.identification}</strong></div><div className="detail-section"><p className="detail-label">Descripción</p><p className="detail-description">{companyToShow.description}</p></div><div className="detail-meta"><div><span>Administrador</span><strong>{companyToShow.admin?.name ?? 'Sin asignar'}</strong></div><div><span>Creada</span><strong>{relativeDate(companyToShow.createdAt)}</strong></div><div><span>Última actualización</span><strong>{relativeDate(companyToShow.updatedAt)}</strong></div></div><div className="drawer-actions"><button className="button secondary" onClick={onEdit}>Editar</button><button className="button danger" onClick={onDelete}>Eliminar</button></div><div className="diagnostics-section"><div className="section-heading"><div><p className="detail-label">Evaluación</p><h3>Análisis estratégicos</h3></div><button className="button primary small-button" onClick={startDiagnosticCreate}>+ Nuevo</button></div>{diagnosticError && <div className="form-error" role="alert">{diagnosticError}</div>}{diagnosticLoadError && <ErrorBanner message={diagnosticLoadError} onRetry={() => void loadDiagnostics()} />}{loadingDiagnostics ? <div className="inline-loading"><span className="loader" />Cargando análisis estratégicos...</div> : diagnostics.length === 0 ? <EmptyState compact title="Sin análisis estratégicos" text="Crea el primer análisis estratégico de esta empresa." action={<button className="button secondary" onClick={startDiagnosticCreate}>Crear análisis estratégico</button>} /> : <div className="diagnostic-list">{diagnostics.map((item) => <button className="diagnostic-row" key={item.id} onClick={() => setSelectedDiagnostic(item)}><span className="diagnostic-icon">◈</span><span className="diagnostic-row-content"><strong>{item.title}</strong><small>{diagnosticStatusLabel[item.status]} · {relativeDate(item.updatedAt)}</small></span><span>›</span></button>)}</div>}</div></aside></div></>}{showDiagnosticForm && <DiagnosticForm draft={diagnosticDraft} setDraft={setDiagnosticDraft} isEdit={Boolean(selectedDiagnostic)} saving={savingDiagnostic} onSubmit={saveDiagnostic} onClose={() => setShowDiagnosticForm(false)} />}</>}

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
        <label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ej. Análisis estratégico 2026" minLength={3} required /></label>
        <label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Describe el alcance de la evaluación..." rows={7} minLength={3} required /></label>
        <label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as DiagnosticStatus })}>{diagnosticStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <div className="drawer-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
          <button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear análisis estratégico'}</button>
        </div>
      </form>
    </div>
  )}

function DiagnosticDetailBase({ diagnostic, crosses, setCrosses, loadingCrosses, crossError, setCrossError, loadCrosses }: { diagnostic: Diagnostic; crosses: StrategicCross[]; setCrosses: React.Dispatch<React.SetStateAction<StrategicCross[]>>; loadingCrosses: boolean; crossError: string; setCrossError: (value: string) => void; loadCrosses: () => Promise<void> }) {
  const [items, setItems] = useState<SWOTItem[]>(diagnostic.swotAnalysis?.items ?? [])
  const [itemDraft, setItemDraft] = useState<SWOTDraft>(emptySWOTDraft)
  const [editingItem, setEditingItem] = useState<SWOTItem | null>(null)
  const [showItemForm, setShowItemForm] = useState(false)
  const [savingItem, setSavingItem] = useState(false)
  const [itemError, setItemError] = useState('')
  const [crossFormError, setCrossFormError] = useState('')
  const [crossFilter, setCrossFilter] = useState<CrossType | 'ALL'>('ALL')
  const [generatingCrosses, setGeneratingCrosses] = useState(false)
  const [generateCrossError, setGenerateCrossError] = useState('')
  const [openCrossId, setOpenCrossId] = useState<string | null>(null)
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
  useEffect(() => { if (!pendingCross) return; const timer = window.setTimeout(() => { pendingCrossRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 30); return () => window.clearTimeout(timer) }, [pendingCross])
  function startItemCreate(type: SWOTType) { setEditingItem(null); setItemDraft({ ...emptySWOTDraft, type }); setShowItemForm(true); setItemError('') }
  function startItemEdit(item: SWOTItem) { setEditingItem(item); setItemDraft({ type: item.type, description: item.description }); setShowItemForm(true); setItemError('') }
  async function saveItem(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSavingItem(true); setItemError(''); try { const payload = editingItem ? { description: itemDraft.description } : { type: itemDraft.type, description: itemDraft.description }; const result = editingItem ? await api<{ item: SWOTItem }>(`/swot/items/${editingItem.id}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api<{ item: SWOTItem }>(`/diagnostics/${diagnostic.id}/swot/items`, { method: 'POST', body: JSON.stringify(payload) }); setItems((current) => editingItem ? current.map((item) => item.id === result.item.id ? result.item : item) : [...current, result.item]); setEditingItem(null); setShowItemForm(false); setItemDraft(emptySWOTDraft) } catch (requestError) { setItemError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el factor.') } finally { setSavingItem(false) } }
  async function removeItem(item: SWOTItem) { const relatedCrosses = crosses.filter((cross) => cross.factor1.id === item.id || cross.factor2.id === item.id); const cascadeWarning = relatedCrosses.length === 0 ? '' : relatedCrosses.length === 1 ? ' También se eliminará el cruce estratégico asociado y la ponderación de ese cruce.' : ` También se eliminarán sus ${relatedCrosses.length} cruces estratégicos asociados y las ponderaciones de esos cruces.`; const confirmed = await askConfirm({ title: 'Eliminar factor', message: `Se eliminará «${item.description}» de la matriz DOFA.${cascadeWarning} Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/swot/items/${item.id}`, { method: 'DELETE' }); setItems((current) => current.filter((currentItem) => currentItem.id !== item.id)) } catch { setItemError('No se pudo eliminar el factor.') } }
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
      if (crosses.some((cross) => crossPairKey(cross.factor1, cross.factor2) === crossPairKey(internal, external))) { setSavingCross(false); setCrossFormError('Este cruce ya existe para este análisis estratégico.'); return }
      const strategy = pendingCross.strategy.trim()
      const payload: Record<string, string> = { factor1Id: internal.id, factor2Id: external.id }
      if (strategy) payload.strategy = strategy
      await api<{ cross: StrategicCross }>(`/diagnostics/${diagnostic.id}/crosses`, { method: 'POST', body: JSON.stringify(payload) })
      setPendingCross(null)
      await loadCrosses()
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) setCrossFormError('Este cruce ya existe para este análisis estratégico.')
      else if (requestError instanceof ApiError && requestError.status === 400) setCrossFormError('Los datos del cruce no son válidos. Revisa que la estrategia tenga al menos 3 caracteres y que ambos factores pertenezcan al análisis estratégico.')
      else setCrossFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el cruce.')
    } finally { setSavingCross(false) }
  }
  async function generateCrosses() {
    if (generatingCrosses) return
    setGeneratingCrosses(true); setGenerateCrossError('')
    try {
      const result = await api<{ crosses: StrategicCross[] }>(`/diagnostics/${diagnostic.id}/crosses/generate`, { method: 'POST' })
      setCrosses(result.crosses)
    } catch (requestError) {
      setGenerateCrossError(requestError instanceof ApiError ? requestError.message : 'No se pudieron generar cruces con la IA.')
    } finally { setGeneratingCrosses(false) }
  }
  async function removeCross(cross: StrategicCross) { const confirmed = await askConfirm({ title: 'Eliminar cruce', message: 'Se eliminará el cruce y su estrategia asociada de la matriz DOFA. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/crosses/${cross.id}`, { method: 'DELETE' }); setCrosses((current) => current.filter((item) => item.id !== cross.id)) } catch { setCrossError('No se pudo eliminar el cruce.') } }
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
  // El reparto por origen no vive aquí: la sección de cruces de abajo agrupa los dos grupos sobre esta
  // misma lista de StrategicCross, así que no hay dos fuentes ni dos lugares donde contarlos.
  return <section className="diag-card diag-section"><div className="diag-section-head"><span className="diag-step-chip">{flowStepNumber('dofa')}</span><div><h3>Matriz DOFA</h3><p>Fortalezas, debilidades, oportunidades y amenazas del análisis estratégico.</p></div></div><div className="swot-kpis"><span className="swot-kpi"><b>{items.length}</b>Factores</span><span className="swot-kpi"><b>{crosses.length}</b>Cruces</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'STRENGTH').length}</b>Fortalezas</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'WEAKNESS').length}</b>Debilidades</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'OPPORTUNITY').length}</b>Oportunidades</span><span className="swot-kpi"><b>{items.filter((item) => item.type === 'THREAT').length}</b>Amenazas</span></div>{itemError && <div className="form-error">{itemError}</div>}{dragCross && <div className={`cross-drag-hint${pendingCrossType ? ' go' : ''}${dropDeniedId ? ' no' : ''}`}>{dropHintText}</div>}<div ref={dragFlyoutRef} className={`swot-drag-flyout${dragCross ? ' visible' : ''}`} style={crossDragFlyoutStyle}>{dragCross ? (pendingCrossType ? `Crear cruce ${pendingCrossType}` : 'Suelta sobre un factor compatible') : ''}</div><div className={`swot-grid${dragCross ? ' drag-active' : ''}`}>{swotTypes.map((type) => <section className={`swot-quadrant ${type.value.toLowerCase()}`} key={type.value}><div className="swot-quadrant-heading"><div><span className="swot-symbol">{type.value === 'STRENGTH' ? '+' : type.value === 'WEAKNESS' ? '−' : type.value === 'OPPORTUNITY' ? '↗' : '!'}</span><h3>{type.short}</h3><span className="swot-count">{items.filter((item) => item.type === type.value).length}</span></div></div><div className="swot-items">{items.filter((item) => item.type === type.value).map((item) => <div className={`swot-item${dragCross?.itemId === item.id ? ' dragging' : ''}${dragCross && dragCross.itemId !== item.id && isCompatibleCrossPair(dragCross.type, item.type) ? ' swot-valid' : ''}${dragCross && dragCross.itemId !== item.id && !isCompatibleCrossPair(dragCross.type, item.type) ? ' swot-dim' : ''}${dropTargetId === item.id ? ' drop-target' : ''}${dropDeniedId === item.id ? ' drop-denied' : ''}`} key={item.id} data-swot-item-id={item.id} onPointerDown={(event) => crossPointerDown(item, event)} onPointerMove={crossPointerMove} onPointerUp={crossPointerUp} onPointerCancel={crossPointerCancel}><span className="swot-grip" aria-hidden="true">⋮⋮</span><p>{item.description}</p><div className="swot-actions"><button className="swot-edit" onClick={() => startItemEdit(item)}>Editar</button><button className="swot-edit delete-link" onClick={() => void removeItem(item)} disabled={loadingCrosses}>Eliminar</button></div></div>)}</div>{items.filter((item) => item.type === type.value).length === 0 && <p className="swot-empty">Sin factores todavía</p>}<button className="swot-add" onClick={() => startItemCreate(type.value)}>+ Agregar {type.label.toLowerCase()}</button></section>)}</div><section className="diag-card diag-section crosses-section"><div className="diag-section-head"><span className="diag-step-chip crosses-chip">⌁</span><div><h3>CRUCES ESTRATÉGICOS</h3><p>Los que creaste combinando factores en la matriz y los que propuso la IA. Cada cruce aparece una sola vez, con su origen.</p></div><div className="crosses-head-actions"><button type="button" className="button primary small-button" onClick={() => void generateCrosses()} disabled={generatingCrosses}>{generatingCrosses ? <><span className="button-loader" />Generando...</> : 'Generar con IA'}</button><button className="button secondary small-button" onClick={() => startPendingCross(null, null)}>+ Crear cruce</button></div></div>{pendingCross && <div className="cross-new-form" ref={pendingCrossRef}><form onSubmit={createCross}><div className="cross-new-head"><span className="cross-new-badge">NUEVO CRUCE</span>{pendingFormType && <span className={`cross-type-chip ${pendingFormType.toLowerCase()}`}>{pendingFormType}</span>}<span className="cross-new-note">Se crea al instante con origen Usuario</span></div><div className="cross-new-factors">{pendingCross.factor1 ? <label>Factor 1<input type="text" value={`${swotTypeLabels[pendingCross.factor1.type]}: ${pendingCross.factor1.description}`} readOnly /></label> : <label>Factor 1 (interno)<select value={pendingCrossF1Id} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value) ?? null; setPendingCross((current) => current ? { ...current, factor1: item } : current) }}>{internalCrossOptions.length === 0 && <option value="">Sin factores internos</option>}{internalCrossOptions.map((item) => <option key={item.id} value={item.id}>{swotTypeLabels[item.type]}: {item.description}</option>)}</select></label>}{pendingCross.factor2 ? <label>Factor 2<input type="text" value={`${swotTypeLabels[pendingCross.factor2.type]}: ${pendingCross.factor2.description}`} readOnly /></label> : <label>Factor 2 (externo)<select value={pendingCrossF2Id} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value) ?? null; setPendingCross((current) => current ? { ...current, factor2: item } : current) }}>{externalCrossOptions.length === 0 && <option value="">Sin factores externos</option>}{externalCrossOptions.map((item) => <option key={item.id} value={item.id}>{swotTypeLabels[item.type]}: {item.description}</option>)}</select></label>}</div><label>Estrategia<textarea value={pendingCross.strategy} onChange={(event) => setPendingCross((current) => current ? { ...current, strategy: event.target.value } : current)} placeholder="Estrategia propuesta (opcional)..." rows={2} /></label>{crossFormError && <div className="form-error" role="alert">{crossFormError}</div>}<div className="cross-new-actions"><button type="button" className="button secondary small-button" onClick={cancelPendingCross}>Cancelar</button><button className="button primary" disabled={savingCross}>{savingCross ? 'Creando...' : 'Crear cruce'}</button></div></form></div>}<CrossesIndex crosses={crosses} filter={crossFilter} onFilter={setCrossFilter} loading={loadingCrosses} error={crossError} generateError={generateCrossError} generating={generatingCrosses} openCrossId={openCrossId} onToggleOpen={setOpenCrossId} onEdit={openEditCross} onDelete={removeCross} /></section>{crossModal && <CrossModal cross={crossModal.cross} draft={crossDraft} setDraft={setCrossDraft} saving={savingCross} error={crossFormError} onSubmit={saveCross} onClose={closeCrossModal} />}{showItemForm && <SWOTItemForm draft={itemDraft} setDraft={setItemDraft} isEdit={Boolean(editingItem)} saving={savingItem} onSubmit={saveItem} onClose={() => { setEditingItem(null); setShowItemForm(false); setItemDraft(emptySWOTDraft) }} />}</section>}

function CrossModal({ cross, draft, setDraft, saving, error, onSubmit, onClose }: { cross: StrategicCross; draft: { strategy: string }; setDraft: React.Dispatch<React.SetStateAction<{ strategy: string }>>; saving: boolean; error: string; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const crossType = cross.crossType
  return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal cross-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon cross-modal-icon">{crossType}</div><div className="company-modal-title"><p className="eyebrow">MATRIZ DOFA</p><h2>Editar cruce</h2><p className="company-modal-subtitle">Actualiza la estrategia del cruce.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><div className="cross-type-detect"><span className="cross-type-chip large">{crossType}</span><div className="cross-type-copy"><p className="detail-label">Tipo de cruce</p><strong>{crossTypeCombos[crossType]}</strong></div><span className="factor-type-badge">FO / DO / FA / DA</span></div><label>Factor 1<input type="text" value={`${swotTypeLabels[cross.factor1.type]}: ${cross.factor1.description}`} readOnly /></label><label>Factor 2<input type="text" value={`${swotTypeLabels[cross.factor2.type]}: ${cross.factor2.description}`} readOnly /></label><label>Estrategia<textarea value={draft.strategy} onChange={(event) => setDraft({ ...draft, strategy: event.target.value })} placeholder="Estrategia del cruce..." rows={3} minLength={3} required /></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div>}

const priorityBandRanges: Record<string, string> = { immediate: '4.00 – 5.00', short: '3.00 – 3.99', medium: '2.00 – 2.99', long: '1.00 – 1.99' }
/* ============================================
   PONDERACIÓN DE ESTRATEGIAS CONSOLIDADAS (IA, CRUCES Y CHECKY)
   ============================================ */

/**
 * Índice de cruces: los que creó la persona y los que propuso la IA, cada uno una sola vez.
 *
 * `isUserCross` ya cubre USER y BOTH, así que BOTH cae en el grupo del usuario y conserva su badge
 * "Usuario + IA" de `crossOriginLabels`; el servidor además promueve a BOTH el cruce que la IA propone
 * sobre un par que ya existía, de modo que ese cruce nunca se muestra dos veces. Los KPIs se derivan
 * siempre de la lista completa y no del filtro: el filtro es una decisión de lectura, no un recorte
 * de los datos, así que un conteo nunca puede depender de qué se esté mirando.
 */
function CrossesIndex({ crosses, filter, onFilter, loading, error, generateError, generating, openCrossId, onToggleOpen, onEdit, onDelete }: {
  crosses: StrategicCross[]
  filter: CrossType | 'ALL'
  onFilter: (value: CrossType | 'ALL') => void
  loading: boolean
  error: string
  generateError: string
  generating: boolean
  openCrossId: string | null
  onToggleOpen: (crossId: string) => void
  onEdit: (cross: StrategicCross) => void
  onDelete: (cross: StrategicCross) => void
}) {
  const userCrosses = crosses.filter(isUserCross)
  const aiCrosses = crosses.filter((cross) => !isUserCross(cross))
  const countByType: Record<CrossType, number> = { FO: 0, DO: 0, FA: 0, DA: 0 }
  for (const cross of crosses) countByType[cross.crossType] += 1
  const matches = (cross: StrategicCross) => filter === 'ALL' || cross.crossType === filter
  const groups = [
    { key: 'user', title: 'Cruces creados por el usuario', note: 'Los que combinaste en la matriz. Puedes editarlos o eliminarlos.', items: userCrosses.filter(matches) },
    { key: 'ai', title: 'Cruces sugeridos por IA', note: 'Los que propuso la IA a partir de los mismos factores. Se actualizan al volver a generarlos.', items: aiCrosses.filter(matches) },
  ]
  const visibleGroups = groups.filter((group) => group.items.length > 0)
  const typeFilters = crossFilterTabs.filter((tab) => tab.value !== 'ALL')
  return (
    <>
      <div className="crosses-kpis">
        <div className="crosses-kpi-lead">
          <strong>{crosses.length}</strong>
          <span>Total de cruces</span>
        </div>
        <div className="crosses-kpi-origin">
          <span className="crosses-kpi-cell"><b>{userCrosses.length}</b>Del usuario</span>
          <span className="crosses-kpi-cell"><b>{aiCrosses.length}</b>Sugeridos por IA</span>
        </div>
        <div className="crosses-kpi-types">
          {typeFilters.map((tab) => {
            const value = tab.value as CrossType
            return <button type="button" key={value} className={`crosses-kpi-type ${value.toLowerCase()}${filter === value ? ' active' : ''}`} onClick={() => onFilter(filter === value ? 'ALL' : value)} aria-pressed={filter === value}><b>{countByType[value]}</b><span>{value}</span></button>
          })}
        </div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {generateError && <div className="form-error" role="alert">{generateError}</div>}
      {loading
        ? <div className="inline-loading"><span className="loader" />Cargando cruces...</div>
        : <div className="crosses-tabs">{crossFilterTabs.map((tab) => <button type="button" key={tab.value} className={`cross-filter-tab${filter === tab.value ? ' active' : ''}`} onClick={() => onFilter(tab.value)} aria-pressed={filter === tab.value}>{tab.label}</button>)}</div>}
      {loading ? null : crosses.length === 0
        ? <EmptyState compact title="Todavía no hay cruces" text={generating ? 'La IA está buscando combinaciones entre tus factores.' : 'Combina dos factores en la matriz o pídele a la IA que proponga cruces para ellos.'} />
        : visibleGroups.length === 0
          ? <EmptyState compact title={`Sin cruces de tipo ${filter}`} text="Prueba otro filtro o genera cruces nuevos con la IA." />
          : <div className="crosses-groups">{visibleGroups.map((group) => (
              <section className="crosses-group" key={group.key} aria-label={group.title}>
                <div className="crosses-group-head">
                  <h4>{group.title}</h4>
                  <span className="cross-count">{group.items.length}</span>
                  <p>{group.note}</p>
                </div>
                <div className="crosses-list">
                  {group.items.map((cross) => (
                    <CrossCard key={cross.id} cross={cross} open={openCrossId === cross.id} onToggle={() => onToggleOpen(cross.id)} onEdit={onEdit} onDelete={onDelete} />
                  ))}
                </div>
              </section>
            ))}</div>}
    </>
  )
}

/**
 * La tarjeta es la misma en los dos grupos. El origen decide si la persona puede tocarla: `isUserCross`
 * cubre USER y BOTH, que también son suyos, y lo que propuso la IA queda en solo lectura. "Ver cruce"
 * no abre una vista aparte: despliega dentro de la tarjeta los datos que el cruce ya traía y la
 * tarjeta no mostraba, es decir la lectura de la IA cuando existe, y la prioridad y las fechas siempre.
 */
function CrossCard({ cross, open, onToggle, onEdit, onDelete }: { cross: StrategicCross; open: boolean; onToggle: () => void; onEdit: (cross: StrategicCross) => void; onDelete: (cross: StrategicCross) => void }) {
  const editable = isUserCross(cross)
  const analysis = cross.aiAnalysis
  const priority = cross.priority ?? analysis?.priority ?? null
  const dateFormat: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  return (
    <article className={`cross-card${open ? ' open' : ''}`} data-cross-id={cross.id}>
      <div className="cross-card-head">
        <span className={`cross-type-chip ${cross.crossType.toLowerCase()}`}>{cross.crossType}</span>
        <span className="cross-combo">{crossTypeCombos[cross.crossType]}</span>
        <span className={`cross-origin ${cross.origin.toLowerCase()}`}><span aria-hidden="true">{crossOriginIcons[cross.origin]}</span> {crossOriginLabels[cross.origin]}</span>
        <span className="cross-created">#{cross.id.slice(-6).toUpperCase()}</span>
      </div>
      <p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[cross.factor1.type]}</span>{cross.factor1.description}</p>
      <p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[cross.factor2.type]}</span>{cross.factor2.description}</p>
      {cross.strategy
        ? <p className="cross-strategy"><b>Estrategia:</b> {cross.strategy}</p>
        : <p className="cross-strategy empty"><b>Estrategia:</b> Sin estrategia escrita en este cruce.</p>}
      <div className="cross-actions">
        <button type="button" className="cross-view-toggle" onClick={onToggle} aria-expanded={open}>{open ? 'Ocultar detalle' : 'Ver cruce'}</button>
        {editable && <button type="button" className="button secondary small-button" onClick={() => onEdit(cross)}>Editar</button>}
        {editable && <button type="button" className="button danger small-button" onClick={() => onDelete(cross)}>Eliminar</button>}
      </div>
      {open && (
        <div className="cross-detail">
          <dl className="cross-detail-meta">
            <div><dt>Origen</dt><dd>{crossOriginLabels[cross.origin]}</dd></div>
            <div><dt>Prioridad</dt><dd>{priority ? crossPriorityLabels[priority] : 'Sin valorar'}</dd></div>
            <div><dt>Creado</dt><dd>{new Date(cross.createdAt).toLocaleDateString('es-CO', dateFormat)}</dd></div>
            <div><dt>Actualizado</dt><dd>{new Date(cross.updatedAt).toLocaleDateString('es-CO', dateFormat)}</dd></div>
          </dl>
          {analysis
            ? <>
                <p className="cross-detail-note"><b>Por qué importa.</b> {analysis.relevance}</p>
                <p className="cross-detail-note"><b>Impacto esperado.</b> {analysis.expectedImpact}</p>
                {analysis.risks.length > 0 && <div className="cross-detail-block"><h5>Riesgos</h5><ul>{analysis.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}
                {analysis.opportunities.length > 0 && <div className="cross-detail-block"><h5>Oportunidades</h5><ul>{analysis.opportunities.map((opportunity) => <li key={opportunity}>{opportunity}</li>)}</ul></div>}
                {analysis.recommendation && <p className="cross-detail-note"><b>Recomendación de la IA.</b> {analysis.recommendation}</p>}
              </>
            : <p className="cross-detail-note">Creaste este cruce a mano, así que todavía no tiene lectura de la IA. Al generar cruces con la IA puede aparecer.</p>}
        </div>
      )}
    </article>
  )
}

const strategySourceVisuals: Record<StrategySource, { label: string; icon: string; tone: string }> = {
  AI_ANALYSIS: { label: 'Análisis IA', icon: '✨', tone: 'ai' },
  CHECKY: { label: 'Checky', icon: '✦', tone: 'checky' },
  STRATEGIC_CROSS: { label: 'Cruce DOFA', icon: '◈', tone: 'cross' },
}

const serverBandTones: Record<StrategyBand, string> = { INMEDIATA: 'immediate', CORTO_PLAZO: 'short', MEDIANO_PLAZO: 'medium', LARGO_PLAZO: 'long' }

/** La banda la clasifica el backend: aquí solo se traduce a su tono visual, nunca se recalcula. */
function bandMeta(band: StrategyBand | null) {
  if (!band) return null
  const tone = serverBandTones[band]
  return weightingBands.find((item) => item.tone === tone) ?? null
}

/** Los cinco niveles de la ponderación, tal como los guarda el backend para las tres fuentes. */
function criteriaOfStrategy(weighting: StrategyWeighting): CrossWeightingCriteria {
  return { impactoEstrategico: weighting.impactoEstrategico, viabilidad: weighting.viabilidad, urgencia: weighting.urgencia, sinergiaInterna: weighting.sinergiaInterna, impactoReputacional: weighting.impactoReputacional }
}

const sameCriteria = (a: CrossWeightingCriteria, b: CrossWeightingCriteria) => weightingCriteriaMeta.every((criterion) => a[criterion.key] === b[criterion.key])

/**
 * Ancla con la que el backend reconoce una estrategia: SHA-256 de su texto normalizado. Debe
 * coincidir con la normalización del servidor (recortar, colapsar espacios, minúsculas) porque la
 * ruta vuelve a validarla contra la consolidación real: si el hash no cuadra responde 404 y no
 * guarda nada, así que un desajuste falla visiblemente en vez de escribir un valor equivocado.
 */
const normalizeStrategyText = (description: string) => description.trim().replace(/\s+/g, ' ').toLowerCase()

async function strategySourceRef(description: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador no puede calcular el ancla de la estrategia: abre la aplicación en HTTPS o en localhost.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeStrategyText(description)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Una sola carga de GET /diagnostics/:id/strategies alimenta la pantalla completa: trae las
// estrategias de IA, los cruces y las sugerencias de Checky, cada una con la ponderación que el
// servidor ya guardó. weightingLevels es el valor de la escala que envía el propio backend.
function useDiagnosticStrategies(diagnosticId: string) {
  const [strategies, setStrategies] = useState<DiagnosticStrategy[]>([])
  const [levelScores, setLevelScores] = useState<Record<WeightingLevel, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const loadStrategies = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ strategies: DiagnosticStrategy[]; weightingLevels: Record<WeightingLevel, number> }>(`/diagnostics/${diagnosticId}/strategies?acceptedOnly=true`)
      setStrategies(result.strategies)
      setLevelScores(result.weightingLevels)
    } catch (error) {
      setLoadError(error instanceof ApiError && error.status === 404 ? 'Este análisis estratégico no existe o no te pertenece.' : 'No pudimos cargar las estrategias del análisis estratégico.')
    } finally {
      setLoading(false)
    }
  }, [diagnosticId])
  useEffect(() => { const timer = window.setTimeout(() => { void loadStrategies() }, 0); return () => window.clearTimeout(timer) }, [loadStrategies])
  return { strategies, setStrategies, levelScores, loading, loadError, reload: loadStrategies }
}

function valuationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Esta estrategia pertenece a otra fuente. Recarga la pantalla e inténtalo de nuevo.'
    if (error.status === 403) return 'Tu rol no tiene permiso para valorar estrategias.'
    if (error.status === 404) return 'La estrategia ya no está en la lista. Recarga la pantalla.'
    return error.message
  }
  if (error instanceof Error && error.message.includes('ancla')) return error.message
  return 'No se pudo guardar la valoración.'
}

function StrategyValuationCard({ strategy, draft, levelScores, state, error, canValue, onChange, onSave, onCreateTasks }: { strategy: DiagnosticStrategy; draft: CrossWeightingCriteria; levelScores: Record<WeightingLevel, number> | null; state: 'idle' | 'saving' | 'saved' | 'error'; error: string; canValue: boolean; onChange: (criteria: CrossWeightingCriteria) => void; onSave: () => void; onCreateTasks: (strategy: DiagnosticStrategy) => void }) {
  const [open, setOpen] = useState(false)
  const source = strategySourceVisuals[strategy.source]
  const band = bandMeta(strategy.weightingBand)
  // Solo IA y Checky se valoran desde aquí: los cruces conservan su propio flujo en la matriz DOFA.
  const weightable = strategy.source === 'AI_ANALYSIS' || strategy.source === 'CHECKY'
  const editable = weightable && canValue && state !== 'saving'
  const baseline = strategy.weighting ? criteriaOfStrategy(strategy.weighting) : neutralWeightingCriteria
  const dirty = !sameCriteria(draft, baseline)
  // El ponderado y la banda se muestran siempre como los devuelve el backend; la barra solo
  // representa ese número, no lo calcula.
  const scorePercent = strategy.weighting ? Math.min(100, Math.max(0, (strategy.weighting.weightedScore / 5) * 100)) : 0
  const tone = band?.tone ?? 'pending'
  const detailId = `swz-detail-${strategy.id}`
  return (
    <article className={`swz-card ${tone}${strategy.weighting ? ' weighed' : ' unweighed'}${open ? ' open' : ''}`} data-strategy-id={strategy.id}>
      <header className="swz-card-head">
        <span className={`swz-source ${source.tone}`} title={`Origen: ${source.label}`}><span aria-hidden="true">{source.icon}</span> {source.label}</span>
        {strategy.crossType && <span className={`cross-type-chip ${strategy.crossType.toLowerCase()}`}>{strategy.crossType}</span>}
        {strategy.crossType && <span className="cross-combo">{crossTypeCombos[strategy.crossType]}</span>}
        {strategy.origin && <span className="cross-origin"><span aria-hidden="true">{crossOriginIcons[strategy.origin]}</span> {crossOriginLabels[strategy.origin]}</span>}
        {band
          ? <span className={`weighting-band ${band.tone}`}>{band.label}</span>
          : <span className="weighting-band neutral">Sin valoración</span>}
        <span className={`swz-score${strategy.weighting ? '' : ' pending'}`}>
          <span className="swz-score-value">{strategy.weighting ? strategy.weighting.weightedScore.toFixed(2) : '—'}</span>
          <span className="weighting-score-max">/5</span>
        </span>
      </header>
      <div className="swz-strategy">
        <strong>{strategy.title}</strong>
        <p>{strategy.description}</p>
      </div>
      {(strategy.factor1 || strategy.factor2) && (
        <div className="swz-factors">
          <p className="detail-label">FACTORES RELACIONADOS</p>
          {strategy.factor1 && <p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[strategy.factor1.type]}</span>{strategy.factor1.description}</p>}
          {strategy.factor2 && <p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[strategy.factor2.type]}</span>{strategy.factor2.description}</p>}
        </div>
      )}
      <div className="priority-meter">
        <div className="priority-meter-track" role="img" aria-label={strategy.weighting ? `Ponderado ${strategy.weighting.weightedScore.toFixed(2)} de 5` : 'Sin valorar'}>
          <span className="priority-meter-fill" style={{ width: `${scorePercent}%` }} />
        </div>
      </div>
      <div className="weighting-criteria">
        {weightingCriteriaMeta.map((criterion) => {
          const level = draft[criterion.key]
          const levelMeta = weightingLevels.find((item) => item.value === level)
          const levelValue = levelScores?.[level] ?? Number(levelMeta?.short ?? 3)
          return (
            <div className="weighting-criterion" key={criterion.key}>
              <div className="weighting-criterion-copy">
                <span className="weighting-criterion-label">{criterion.label}</span>
                <span className="weighting-criterion-hint">{criterion.hint}</span>
              </div>
              <div className="weighting-criterion-control">
                <span className="weighting-weight" title={`Peso de este criterio: ${criterion.weight}`}>{criterion.weight}</span>
                <select
                  value={level}
                  disabled={!editable}
                  aria-label={`${criterion.label} de ${strategy.title}`}
                  onChange={(event) => onChange({ ...draft, [criterion.key]: event.target.value as WeightingLevel })}
                >
                  {weightingLevels.map((item) => <option value={item.value} key={item.value}>{item.label} ({item.short})</option>)}
                </select>
              </div>
              <div className="swz-level-bar" role="img" aria-label={`${criterion.label}: ${levelMeta?.label ?? level}`}><span style={{ width: `${(levelValue / 5) * 100}%` }} /></div>
            </div>
          )
        })}
      </div>
      {!weightable && <p className="weighting-no-strategy">Este cruce se valora en la Matriz DOFA, donde ya tiene su propia ponderación.</p>}
      {weightable && !canValue && <p className="weighting-no-strategy">Tu rol puede consultar estas valoraciones, pero no guardarlas.</p>}
      <div className="weighting-foot">
        <span className={`weighting-status ${state}`}>
          {state === 'saving' && <><span className="loader" />Guardando...</>}
          {state === 'saved' && <><span className="weighting-status-dot" aria-hidden="true">✓</span>Guardado</>}
          {state === 'error' && error}
          {state === 'idle' && !weightable && 'Ponderación del cruce'}
          {state === 'idle' && weightable && !canValue && 'Solo lectura'}
          {state === 'idle' && weightable && canValue && dirty && 'Cambios sin guardar'}
          {state === 'idle' && weightable && canValue && !dirty && strategy.weighting && `Valorado · ${band?.label ?? 'sin banda'}`}
          {state === 'idle' && weightable && canValue && !dirty && !strategy.weighting && 'Sin valorar'}
        </span>
        {weightable && canValue && (
          <button type="button" className="button primary small-button" onClick={onSave} disabled={state === 'saving' || !dirty}>
            {state === 'saving' ? <><span className="button-loader" />Guardando...</> : 'Guardar valoración'}
          </button>
        )}
        {strategy.weighting && canValue && <button type="button" className="button secondary small-button" onClick={() => onCreateTasks(strategy)}>{strategy.taskPlan?.items.length ? `Gestionar tareas (${strategy.taskPlan.items.length})` : 'Crear tareas'}</button>}
        <button type="button" className="priority-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((current) => !current)}>
          {open ? 'Ocultar detalle' : 'Ver detalle'}
          <span className="priority-chevron" aria-hidden="true">▾</span>
        </button>
      </div>
      {open && (
        <div className="priority-detail" id={detailId}>
          <p className="detail-label">ESTRATEGIA COMPLETA</p>
          <p className="priority-strategy">{strategy.description}</p>
          {strategy.weighting && (() => {
            const saved = criteriaOfStrategy(strategy.weighting)
            return (
              <>
                <p className="detail-label">CRITERIOS VALORADOS</p>
                <div className="priority-criteria">
                  {weightingCriteriaMeta.map((criterion) => {
                    const level = saved[criterion.key]
                    const levelMeta = weightingLevels.find((item) => item.value === level)
                    const levelValue = levelScores?.[level] ?? Number(levelMeta?.short ?? 3)
                    return (
                      <div className="priority-criterion" key={criterion.key}>
                        <div className="priority-criterion-head">
                          <span className="priority-criterion-label">{criterion.label}</span>
                          <span className="priority-weight" title={`Peso de este criterio en el ponderado: ${criterion.weight}`}>{criterion.weight}</span>
                        </div>
                        <div className="priority-criterion-bar" role="img" aria-label={`${criterion.label}: ${levelMeta?.label ?? level} de 5`}>
                          <span className="priority-criterion-fill" style={{ width: `${(levelValue / 5) * 100}%` }} />
                        </div>
                        <span className="priority-criterion-value">{levelMeta?.label ?? level} <b>{levelMeta?.short}</b></span>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
          {strategy.factor1 || strategy.factor2
            ? <><p className="detail-label">FACTORES RELACIONADOS</p>{strategy.factor1 && <p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[strategy.factor1.type]}</span>{strategy.factor1.description}</p>}{strategy.factor2 && <p className="cross-pair"><span className="cross-factor-chip">{swotTypeLabels[strategy.factor2.type]}</span>{strategy.factor2.description}</p>}</>
            : <p className="cross-pair">Viene directo del análisis, sin factores de un cruce.</p>}
          {strategy.weighting && <p className="priority-updated">Ponderado {strategy.weighting.weightedScore.toFixed(2)} de 5 · {band?.label ?? 'sin banda'}</p>}
        </div>
      )}
    </article>
  )
}

function StrategyTasksModal({ strategy, drafts, users, error, saving, onDraftsChange, onAdd, onRemove, onSubmit, onClose }: { strategy: DiagnosticStrategy; drafts: StrategyTaskDraft[]; users: User[]; error: string; saving: boolean; onDraftsChange: React.Dispatch<React.SetStateAction<StrategyTaskDraft[]>>; onAdd: () => void; onRemove: (index: number) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <div className="drawer-backdrop centered-backdrop">
      <form className="drawer centered-modal company-modal" onSubmit={onSubmit}>
        <div className="company-modal-header">
          <div className="company-modal-icon">✓</div>
          <div className="company-modal-title"><p className="eyebrow">EJECUCIÓN</p><h2>Crear tareas para cumplir la estrategia</h2><p className="company-modal-subtitle">Define las actividades que convertirán esta estrategia en cumplimiento.</p></div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>
        <div className="detail-section">
          <p className="detail-label">ESTRATEGIA SELECCIONADA</p>
          <strong>{strategy.title}</strong>
          <p className="detail-description">{strategy.description}</p>
        </div>
        {strategy.taskPlan && strategy.taskPlan.items.length > 0 && <div className="detail-section"><p className="detail-label">TAREAS YA CREADAS</p>{strategy.taskPlan.items.map((item) => <p className="cross-pair" key={item.id}><strong>{item.title}</strong> · {item.responsible?.name ?? 'Sin responsable'} · {item.dueDate ? new Date(item.dueDate).toLocaleDateString('es-CO') : 'Sin fecha'}</p>)}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="strategy-task-list">
          {drafts.map((task, index) => <div className="strategy-task-row" key={index}>
            <label>Descripción de la tarea<input value={task.title} onChange={(event) => onDraftsChange((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="Ej. Implementar el procedimiento aprobado" minLength={3} required /></label>
            <div className="form-grid">
              <label>Responsable<select value={task.responsibleId} onChange={(event) => onDraftsChange((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, responsibleId: event.target.value } : item))} required><option value="">Selecciona un responsable</option>{users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>
              <label>Fecha de entrega<input type="date" value={task.dueDate} onChange={(event) => onDraftsChange((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value } : item))} required /></label>
            </div>
            <button type="button" className="text-button" onClick={() => onRemove(index)}>Eliminar tarea</button>
          </div>)}
        </div>
        <button type="button" className="button secondary small-button" onClick={onAdd}>+ Agregar tarea</button>
        <div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving || drafts.length === 0}>{saving ? <><span className="button-loader" />Creando...</> : 'Crear tareas'}</button></div>
      </form>
    </div>
  )
}

function StrategyWeightingScreen({ diagnostic, canValue }: { diagnostic: Diagnostic; canValue: boolean }) {
  const { strategies, setStrategies, levelScores, loading, loadError, reload } = useDiagnosticStrategies(diagnostic.id)
  const [drafts, setDrafts] = useState<Record<string, CrossWeightingCriteria>>({})
  const [states, setStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<User[]>([])
  const [taskStrategy, setTaskStrategy] = useState<DiagnosticStrategy | null>(null)
  const [taskDrafts, setTaskDrafts] = useState<StrategyTaskDraft[]>([{ ...emptyStrategyTaskDraft }])
  const [taskError, setTaskError] = useState('')
  const [taskNotice, setTaskNotice] = useState('')
  const [savingTasks, setSavingTasks] = useState(false)
  // Los selectores siempre muestran lo que devolvió el servidor; lo local solo existe mientras se edita.
  useEffect(() => { setDrafts(Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy.weighting ? criteriaOfStrategy(strategy.weighting) : neutralWeightingCriteria]))) }, [strategies])
  useEffect(() => { api<{ users: User[] }>('/users').then((result) => setUsers(result.users)).catch(() => undefined) }, [])
  const accepted = strategies
  const valued = useMemo(() => accepted.filter((strategy) => strategy.weighting), [accepted])
  const unweighted = useMemo(() => accepted.filter((strategy) => !strategy.weighting), [accepted])
  // Cada valorada va al grupo de la banda que le dio el backend, sin recalcularla aquí.
  const groups = useMemo(() => weightingBands.map((band) => ({
    band,
    items: valued.filter((strategy) => bandMeta(strategy.weightingBand)?.tone === band.tone).sort((a, b) => (b.weighting?.weightedScore ?? 0) - (a.weighting?.weightedScore ?? 0)),
  })), [valued])
  const bySource = useMemo(() => (Object.keys(strategySourceVisuals) as StrategySource[])
    .map((source) => ({ source, total: accepted.filter((strategy) => strategy.source === source).length, valued: accepted.filter((strategy) => strategy.source === source && strategy.weighting).length }))
    .filter((entry) => entry.total > 0), [accepted])
  async function saveValuation(strategy: DiagnosticStrategy, criteria: CrossWeightingCriteria) {
    if (states[strategy.id] === 'saving' || !canValue) return
    setStates((current) => ({ ...current, [strategy.id]: 'saving' }))
    setErrors((current) => { const next = { ...current }; delete next[strategy.id]; return next })
    try {
      // Solo viajan los cinco niveles, el origen y su ancla: el ponderado y la banda los responde el backend.
      const sourceRef = await strategySourceRef(strategy.description)
      const result = await api<{ weighting: StrategyWeightingResponse }>(`/diagnostics/${diagnostic.id}/strategies/weighting`, { method: 'PUT', body: JSON.stringify({ source: strategy.source as WeightableStrategySource, sourceRef, ...criteria }) })
      setStrategies((current) => current.map((item) => item.id === strategy.id ? { ...item, weighting: result.weighting, weightedScore: result.weighting.weightedScore, weightingBand: result.weighting.weightingBand } : item))
      setStates((current) => ({ ...current, [strategy.id]: 'saved' }))
    } catch (error) {
      setErrors((current) => ({ ...current, [strategy.id]: valuationErrorMessage(error) }))
      setStates((current) => ({ ...current, [strategy.id]: 'error' }))
    }
  }
  function openTaskModal(strategy: DiagnosticStrategy) {
    if (!strategy.weighting) return
    setTaskStrategy(strategy)
    setTaskDrafts([{ ...emptyStrategyTaskDraft }])
    setTaskError('')
    setTaskNotice('')
  }
  function addTaskDraft() { setTaskDrafts((current) => [...current, { ...emptyStrategyTaskDraft }]) }
  function removeTaskDraft(index: number) { setTaskDrafts((current) => current.filter((_, currentIndex) => currentIndex !== index)) }
  async function createStrategyTasks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!taskStrategy || savingTasks) return
    if (taskDrafts.some((task) => !task.title.trim() || !task.responsibleId || !task.dueDate)) {
      setTaskError('Cada tarea necesita descripción, responsable y fecha de entrega.')
      return
    }
    setSavingTasks(true)
    setTaskError('')
    try {
      const result = await api<{ createdCount: number; skippedTasks: string[] }>(`/diagnostics/${diagnostic.id}/strategy-tasks`, { method: 'POST', body: JSON.stringify({ strategyId: taskStrategy.id, tasks: taskDrafts }) })
      const created = result.createdCount > 0 ? `Se crearon ${result.createdCount} ${result.createdCount === 1 ? 'tarea' : 'tareas'} y sus tickets.` : 'No se crearon tareas nuevas.'
      const skipped = result.skippedTasks.length > 0 ? ` ${result.skippedTasks.length} ya existían y no se duplicaron.` : ''
      setTaskNotice(`${created}${skipped}`)
      setTaskStrategy(null)
      setTaskDrafts([{ ...emptyStrategyTaskDraft }])
      await reload()
    } catch (requestError) {
      setTaskError(requestError instanceof ApiError ? requestError.message : 'No se pudieron crear las tareas.')
    } finally {
      setSavingTasks(false)
    }
  }
  function cardProps(strategy: DiagnosticStrategy) {
    return {
      strategy,
      draft: drafts[strategy.id] ?? neutralWeightingCriteria,
      levelScores,
      state: states[strategy.id] ?? 'idle',
      error: errors[strategy.id] ?? '',
      canValue,
      onChange: (criteria: CrossWeightingCriteria) => { setDrafts((current) => ({ ...current, [strategy.id]: criteria })); setStates((current) => ({ ...current, [strategy.id]: 'idle' })) },
      onSave: () => void saveValuation(strategy, drafts[strategy.id] ?? neutralWeightingCriteria),
      onCreateTasks: openTaskModal,
    }
  }
  const progress = accepted.length > 0 ? Math.round((valued.length / accepted.length) * 100) : 0
  return (
    <section className="diag-card diag-section swz-section">
      <div className="diag-section-head">
        <span className="diag-step-chip weighting-chip" aria-hidden="true">⚖</span>
        <div><h3>PONDERACIÓN DE ESTRATEGIAS</h3><p>Valora con cinco criterios las estrategias que aceptaste explícitamente en Checky.</p></div>
        <div className="crosses-head-actions">
          <button type="button" className="button secondary small-button" onClick={() => void reload()} disabled={loading}>↻ Actualizar</button>
          <span className="cross-count">{valued.length}/{accepted.length} ponderadas</span>
        </div>
      </div>
      {taskNotice && <div className="form-success page-alert" role="status">{taskNotice}</div>}
      <div className="weighting-scale">
        <span className="detail-label">ESCALA</span>
        <div className="weighting-scale-levels">{weightingLevels.map((level) => <span className="weighting-scale-level" key={level.value}><b>{levelScores?.[level.value] ?? level.short}</b>{level.label}</span>)}</div>
        <span className="weighting-scale-note">Ponderado de 1 a 5 y banda calculados por el servidor</span>
      </div>
      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {loading ? <div className="inline-loading"><span className="loader" />Cargando estrategias...</div> : accepted.length === 0 ? (
        <EmptyState icon="◎" title="No hay estrategias aceptadas para ponderar" text="Acepta una sugerencia en Checky para habilitarla aquí." />
      ) : (
        <>
          <div className="swz-summary">
            <div className="swz-summary-card total"><span className="swz-summary-icon" aria-hidden="true">◎</span><div><span>Estrategias aceptadas</span><strong>{accepted.length}</strong></div></div>
            <div className="swz-summary-card valued"><span className="swz-summary-icon" aria-hidden="true">✓</span><div><span>Ponderadas</span><strong>{valued.length}</strong></div></div>
            <div className="swz-summary-card progress"><span className="swz-summary-icon" aria-hidden="true">⚖</span><div><span>Avance</span><strong>{progress}%</strong></div><div className="swz-progress"><span style={{ width: `${progress}%` }} /></div></div>
          </div>
          <div className="swz-sources">
            {bySource.map((entry) => {
              const visual = strategySourceVisuals[entry.source]
              return <span className={`swz-source ${visual.tone}`} key={entry.source}><span aria-hidden="true">{visual.icon}</span> {visual.label}<b>{entry.valued}/{entry.total}</b></span>
            })}
          </div>
          <div className="swz-counters">
            {groups.map(({ band, items }) => <span className={`swz-counter ${band.tone}`} key={band.tone}><b>{items.length}</b><span>{band.label}</span><small>{priorityBandRanges[band.tone]}</small></span>)}
          </div>
          <div className="priority-groups swz-groups">
            {groups.filter((group) => group.items.length > 0).map(({ band, items }) => (
              <section className={`priority-group ${band.tone}`} key={band.tone} aria-label={`Estrategias de ${band.label}`}>
                <header className="priority-group-head">
                  <h4>{band.label}</h4>
                  <span className="priority-group-range">{priorityBandRanges[band.tone]}</span>
                  <span className="priority-group-count">{items.length}</span>
                </header>
                <div className="priority-group-body">{items.map((strategy) => <StrategyValuationCard key={strategy.id} {...cardProps(strategy)} />)}</div>
              </section>
            ))}
            {unweighted.length > 0 && (
              <section className="priority-group neutral" aria-label="Estrategias aceptadas sin valoración">
                <header className="priority-group-head">
                  <h4>Estrategias aceptadas</h4>
                  <span className="priority-group-range">Sin valoración</span>
                  <span className="priority-group-count">{unweighted.length}</span>
                </header>
                <div className="priority-group-body">{unweighted.map((strategy) => <StrategyValuationCard key={strategy.id} {...cardProps(strategy)} />)}</div>
              </section>
            )}
          </div>
        </>
      )}
      {taskStrategy && <StrategyTasksModal strategy={taskStrategy} drafts={taskDrafts} users={users} error={taskError} saving={savingTasks} onDraftsChange={setTaskDrafts} onAdd={addTaskDraft} onRemove={removeTaskDraft} onSubmit={createStrategyTasks} onClose={() => { setTaskStrategy(null); setTaskError('') }} />}
    </section>
  )
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
  const [loadError, setLoadError] = useState('')
  const loadTickets = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (statusFilter) params.set('status', statusFilter)
      if (priorityFilter) params.set('priority', priorityFilter)
      const result = await api<{ tickets: Ticket[] }>(`/tickets?${params}`)
      setTickets(result.tickets)
    } catch { setLoadError('No pudimos cargar los tickets.') } finally { setLoading(false) }
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
  async function removeTicket(ticket: Ticket) { const confirmed = await askConfirm({ title: 'Eliminar ticket', message: `Se eliminará «${ticket.title}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/tickets/${ticket.id}`, { method: 'DELETE' }); setSelected(null); await loadTickets() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el ticket.') } }
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">GESTIÓN OPERATIVA</p><h1>Tickets</h1><p className="muted">Gestiona solicitudes y mantén el trabajo en movimiento.</p></div><button className="button primary" onClick={startCreate}>+ Crear ticket</button></div>{error && <div className="form-error page-alert" role="alert">{error}</div>}{loadError && <ErrorBanner message={loadError} onRetry={() => void loadTickets()} />}<section className="panel"><div className="filters"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tickets..." /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">Todas las prioridades</option>{priorities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>{loading ? <LoadingState /> : tickets.length === 0 ? <EmptyState title={search || statusFilter || priorityFilter ? 'Sin resultados' : 'No encontramos tickets'} text={search || statusFilter || priorityFilter ? 'Ningún ticket coincide con tu búsqueda o filtros.' : 'Crea el primer ticket para comenzar.'} action={<button className="button secondary" onClick={startCreate}>Crear ticket</button>} /> : <div className="ticket-table-wrap"><table><thead><tr><th>Ticket</th><th>Estado</th><th>Prioridad</th><th>Responsable</th><th>Actualizado</th><th /></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id} className={selected?.id === ticket.id ? 'selected-row' : ''} onClick={() => setSelected(ticket)}><td><div className="ticket-title"><strong>{ticket.title}</strong><small>#{ticket.id.slice(-6).toUpperCase()}</small>{ticket.actionItemId && <small className="ticket-origin">Origen: plan de acción</small>}</div></td><td><Badge type="status" value={ticket.status} /></td><td><Badge type="priority" value={ticket.priority} /></td><td>{ticket.assignedTo ? <div className="assignee"><span className="avatar tiny">{initials(ticket.assignedTo.name)}</span>{ticket.assignedTo.name}</div> : <span className="unassigned">Sin asignar</span>}</td><td className="date-cell">{relativeDate(ticket.updatedAt)}</td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); startEdit(ticket) }}>⋯</button></td></tr>)}</tbody></table></div>}</section>{selected && !showForm && <TicketDetail ticket={selected} user={user} onEdit={() => startEdit(selected)} onDelete={() => removeTicket(selected)} onClose={() => setSelected(null)} />}{showForm && <TicketForm draft={draft} setDraft={setDraft} users={users} isEdit={Boolean(selected)} saving={saving} canAssign={user.role === 'SUPERUSER'} onSubmit={saveTicket} onClose={() => setShowForm(false)} />}</div>}

function TicketForm({ draft, setDraft, users, isEdit, saving, canAssign, onSubmit, onClose }: { draft: TicketDraft; setDraft: React.Dispatch<React.SetStateAction<TicketDraft>>; users: User[]; isEdit: boolean; saving: boolean; canAssign: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal ticket-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">▤</div><div className="company-modal-title"><p className="eyebrow">{isEdit ? 'EDITAR TICKET' : 'GESTIÓN DE TICKETS'}</p><h2>{isEdit ? 'Actualizar solicitud' : 'Crear ticket'}</h2><p className="company-modal-subtitle">{isEdit ? 'Modifica la información de la solicitud.' : 'Registra una nueva tarea o incidencia para darle seguimiento'}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Describe brevemente la solicitud" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Añade el contexto necesario..." rows={6} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TicketPriority })}>{priorities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TicketStatus })}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>{canAssign && <label>Asignar a<select value={draft.assignedToId} onChange={(event) => setDraft({ ...draft, assignedToId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear ticket'}</button></div></form></div> }

function TicketDetail({ ticket, user, onEdit, onDelete, onClose }: { ticket: Ticket; user: User; onEdit: () => void; onDelete: () => void; onClose: () => void }) { return <div className="drawer-backdrop"><aside className="drawer detail-drawer"><div className="drawer-heading"><div><p className="eyebrow">DETALLE DEL TICKET</p><h2>{ticket.title}</h2><small>#{ticket.id.slice(-6).toUpperCase()}</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="detail-badges"><Badge type="status" value={ticket.status} /><Badge type="priority" value={ticket.priority} /></div><div className="detail-section"><p className="detail-label">Descripción</p><p className="detail-description">{ticket.description}</p></div>{ticket.actionItem?.actionPlan.strategyTitle && <div className="detail-section"><p className="detail-label">ESTRATEGIA DE ORIGEN</p><strong>{ticket.actionItem.actionPlan.strategyTitle}</strong>{ticket.actionItem.actionPlan.strategyDescription && <p className="detail-description">{ticket.actionItem.actionPlan.strategyDescription}</p>}</div>}<div className="detail-meta"><div><span>Creado por</span><strong>{ticket.createdBy.name}</strong></div><div><span>Asignado a</span><strong>{ticket.assignedTo?.name ?? 'Sin asignar'}</strong></div><div><span>Origen</span><strong>{ticket.actionItemId ? 'Plan de acción' : 'Solicitud directa'}</strong></div><div><span>Fechas</span><strong>{ticket.dueDate ? `Vence ${relativeDate(ticket.dueDate)}` : 'Sin fecha límite'}</strong></div><div><span>Última actualización</span><strong>{relativeDate(ticket.updatedAt)}</strong></div></div><div className="drawer-actions"><button className="button secondary" onClick={onEdit}>Editar</button>{(user.role === 'SUPERUSER' || ticket.createdBy.id === user.id) && <button className="button danger" onClick={onDelete}>Eliminar</button>}</div></aside></div> }

function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="page"><div className="error-state"><div>!</div><h2>Algo salió mal</h2><p>{message}</p>{onRetry && <button className="button primary" onClick={onRetry}>Reintentar</button>}</div></div> }

/** Banner de error de carga con reintento real: el boton vuelve a pedir los datos, no solo los esconde. */
function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="form-error page-alert alert-retry" role="alert">
      <span>{message}</span>
      <button type="button" className="button secondary small-button" onClick={onRetry}>Reintentar</button>
    </div>
  )
}

function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() }

function firstName(name: string) { return name.split(' ')[0] }

function relativeDate(date: string) { const value = new Date(date); const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const target = new Date(value.getFullYear(), value.getMonth(), value.getDate()); const days = Math.round((target.getTime() - today.getTime()) / 86400000); if (days === 0) return 'Hoy'; if (days === -1) return 'Ayer'; if (days === 1) return 'Mañana'; if (days < 0 && days > -7) return `Hace ${Math.abs(days)} días`; if (days > 1 && days < 7) return `En ${days} días`; return value.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) }

function DiagnosticDetail({ diagnostic, user, onBack, onEdit, onDelete, stage, onStageChange }: { diagnostic: Diagnostic; user: User; onBack: () => void; onEdit: () => void; onDelete: () => void; stage: DiagStage; onStageChange: (stage: DiagStage) => void }) {
  const diagStage = stage
  // Mismas reglas que el resto de rutas de escritura: el backend solo deja valorar a superusuarios
  // y administradores de empresa, así que la pantalla no ofrece un botón que vaya a fallar.
  const canValue = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  // Pantallas intermedias del recorrido. Cuelgan de la matriz DOFA, que es la vista que las abre, asi
  // que la etapa vigente se compone de la etapa mas la subpantalla: si no hay ninguna abierta, la
  // propia matriz DOFA. Es el mismo valor que usan el indicador y los botones de "volver".
  const [subScreen, setSubScreen] = useState<StrategicScreen | null>(null)
  function setDiagStage(next: DiagStage) { setSubScreen(null); onStageChange(next) }
  // La etapa vigente es la unica que decide que pantalla se muestra. Cuando el analisis esta en una
  // seccion que no pertenece al recorrido (recomendaciones o planes de accion) no hay ninguna.
  const activeFlow: FlowStep | null = diagStage === 'diagnostico' ? 'diagnostico' : diagStage === 'dofa' ? subScreen ?? 'dofa' : null
  const activeIndex = activeFlow ? diagFlow.findIndex((step) => step.key === activeFlow) : -1
  // Un solo recorrido: elegir una etapa del indicador deja el analisis en esa etapa y cierra la
  // subpantalla anterior, en vez de abrir un segundo indicador dentro de la matriz DOFA.
  function goToFlowStep(key: FlowStep) {
    if (key === 'diagnostico' || key === 'dofa') setDiagStage(key)
    else { setSubScreen(key); onStageChange('dofa') }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [analysisError, setAnalysisError] = useState('')
  const loadAnalysis = useCallback(async () => {
    setAnalysisLoading(true)
    setAnalysis(null)
    // El error se borra antes de pedir, no después: así un fallo anterior no sobrevive al cambio de
    // diagnóstico ni impide que un reintento lo limpie y lo muestre limpio.
    setAnalysisError('')
    try {
      // `analysis: null` es la respuesta normal de un diagnóstico que aún no tiene lectura estratégica,
      // y no se pinta nada raro: la pantalla de Checky queda lista para que el usuario pulse
      // "Analizar con Checky". El 404 se reservó para el diagnóstico que no existe o no es de esta
      // empresa, que sí es un problema, así que lo que llega al catch es siempre algo que contar.
      const result = await api<{ analysis: AIAnalysis | null }>(`/diagnostics/${diagnostic.id}/ai-analysis`)
      setAnalysis(result.analysis)
    } catch (error) {
      setAnalysisError(error instanceof ApiError && error.status === 404 ? 'No se pudo encontrar este diagnóstico.' : 'No se pudo cargar el análisis guardado.')
    } finally {
      setAnalysisLoading(false)
    }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadAnalysis() }, 0); return () => window.clearTimeout(timer) }, [loadAnalysis])
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [importing, setImporting] = useState(false)
  const [recError, setRecError] = useState('')
  const [createActionFor, setCreateActionFor] = useState<Recommendation | null>(null)
  const [crossesVersion, setCrossesVersion] = useState(0)
  const refreshCrosses = useCallback(() => setCrossesVersion((current) => current + 1), [])
  // Los cruces se cargan una sola vez aqui y se reparten a la matriz DOFA y a la seccion de cruces
  // del analisis IA, de modo que las dos pantallas nunca muestran listas distintas. `crossesVersion`
  // es lo que Checky incrementa cuando materializa un cruce, para que las dos se actualicen.
  const [crosses, setCrosses] = useState<StrategicCross[]>([])
  const [loadingCrosses, setLoadingCrosses] = useState(true)
  const [crossError, setCrossError] = useState('')
  const loadCrosses = useCallback(async () => {
    setLoadingCrosses(true)
    try { const result = await api<{ crosses: StrategicCross[] }>(`/diagnostics/${diagnostic.id}/crosses`); setCrosses(result.crosses); setCrossError('') } catch { setCrossError('No pudimos cargar los cruces.') } finally { setLoadingCrosses(false) }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadCrosses() }, 0); return () => window.clearTimeout(timer) }, [loadCrosses, crossesVersion])
  const loadRecommendations = useCallback(async () => {
    try { const result = await api<{ recommendations: Recommendation[] }>(`/diagnostics/${diagnostic.id}/recommendations`); setRecommendations(result.recommendations) } catch { setRecError('No pudimos cargar las recomendaciones.') }
  }, [diagnostic.id])
  useEffect(() => { const timer = window.setTimeout(() => { void loadRecommendations() }, 0); return () => window.clearTimeout(timer) }, [loadRecommendations])
  async function importRecommendations() { if (importing) return; setImporting(true); setRecError(''); try { await api(`/diagnostics/${diagnostic.id}/recommendations/import`, { method: 'POST' }); await loadRecommendations() } catch (requestError) { setRecError(requestError instanceof ApiError ? requestError.message : 'No se pudo importar.') } finally { setImporting(false) } }
  async function setRecommendationStatus(recommendation: Recommendation, status: RecommendationStatus) { setRecError(''); try { const result = await api<{ recommendation: Recommendation }>(`/recommendations/${recommendation.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setRecommendations((current) => current.map((item) => item.id === result.recommendation.id ? result.recommendation : item)); if (status === 'ACCEPTED') { setCreateActionFor(result.recommendation); setDiagStage('planes') } } catch (requestError) { setRecError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar.') } }
  const swotItemCount = diagnostic.swotAnalysis?.items.length ?? 0
  // El avance real de cada etapa se lee de los datos que ya estan cargados, y las dos ultimas se
  // marcan como completadas al haberlas superado, que es el criterio que ya usaba el indicador
  // interior. Asi ninguna etapa pierde su estado al navegar.
  const isFlowDone = (key: FlowStep, index: number) => {
    if (key === 'diagnostico') return diagnostic.status !== 'DRAFT'
    if (key === 'dofa') return swotItemCount > 0
    return index < activeIndex
  }
  // El indicador deja volver a cualquier etapa ya alcanzada y avanzar solo a la siguiente, que es
  // justo lo que ofrecen los botones del final de cada pantalla: saltarse mas de una sigue sin ser
  // posible. Desde una seccion ajena al recorrido se habilita el tramo inicial, porque el analisis
  // guardado es lo que marca hasta donde se puede llegar.
  const furthestIndex = activeIndex >= 0 ? activeIndex : analysis ? 3 : 2
  const isFlowReachable = (index: number) => index <= furthestIndex + 1
  return (
    <div className="diag-page">
      {(activeFlow === 'checky' || activeFlow === 'ponderacion') && <img className="checky-floating-avatar" src={checkyImage} alt="" aria-hidden="true" />}
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
      <ol className="diag-stepper">{diagFlow.map((step, index) => {
        const isDone = isFlowDone(step.key, index)
        const isCurrent = step.key === activeFlow
        const isReachable = isFlowReachable(index)
        return <li key={step.key} className={`${isDone ? 'done' : isCurrent ? 'current' : ''}${isCurrent ? ' viewing' : ''}`}><button type="button" className="diag-step-btn" disabled={!isReachable} onClick={() => goToFlowStep(step.key)}><span className="diag-step-dot">{isDone ? '✓' : index + 1}</span><span className="diag-step-label">{step.label}</span></button></li>
      })}</ol>
      <section className={`diag-stage${activeFlow === 'diagnostico' ? ' active' : ''}`}>
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
          <div className="diag-section-head"><span className="diag-step-chip">{flowStepNumber('diagnostico')}</span><div><h3>Análisis estratégico</h3><p>Información de contexto y alcance del análisis estratégico.</p></div><span className={`diagnostic-status ${diagnostic.status.toLowerCase()}`}>{diagnosticStatusLabel[diagnostic.status]}</span></div>
          <p className="diag-section-text">{diagnostic.description}</p>
        </section>
        <div className="diag-next"><button className="button primary" onClick={() => goToFlowStep('dofa')}>Siguiente: Matriz DOFA →</button></div>
      </section>
      <section className={`diag-stage${activeFlow === 'dofa' ? ' active' : ''}`}>
        <DiagnosticDetailBase diagnostic={diagnostic} crosses={crosses} setCrosses={setCrosses} loadingCrosses={loadingCrosses} crossError={crossError} setCrossError={setCrossError} loadCrosses={loadCrosses} />
        <div className="diag-next">
          {/* No hay una etapa de análisis entre la matriz y Checky: Checky genera la lectura estratégica
              la primera vez que se le consulta, así que el botón solo abre su pantalla. */}
          <button className="button primary" onClick={() => goToFlowStep('checky')}>Ver análisis →</button>
        </div>
      </section>
      {activeFlow === 'checky' && (
        <section className="diag-stage active">
          
          <CheckyPanel diagnostic={diagnostic} items={diagnostic.swotAnalysis?.items ?? []} analysis={analysis} analysisLoading={analysisLoading} analysisError={analysisError} onCrossCreated={refreshCrosses} onConsulted={loadAnalysis} />
          <div className="diag-nav">
            <button className="button secondary" onClick={() => goToFlowStep('dofa')}>← Volver a Matriz DOFA</button>
            <button className="button primary" onClick={() => goToFlowStep('ponderacion')}>Ponderar estrategias →</button>
          </div>
        </section>
      )}
      {activeFlow === 'ponderacion' && (
        <section className="diag-stage active">
          
          <StrategyWeightingScreen diagnostic={diagnostic} canValue={canValue} />
          <div className="diag-nav">
            <button className="button secondary" onClick={() => goToFlowStep('checky')}>← Volver a Checky</button>
          </div>
        </section>
      )}
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
  )}

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
          <span className="rec-ai-note">✦ Generadas por el análisis con IA</span>
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
              <div className="rec-details"><div className="rec-details-divider" /><div className="rec-detail-block"><span className="rec-detail-label">Objetivo</span><p>{ai.description}</p></div><div className="rec-detail-block"><span className="rec-detail-label">Impacto esperado</span><p>{ai.expectedImpact}</p></div><div className="rec-detail-block"><span className="rec-detail-label">Acción sugerida</span><p>{ai.suggestedAction}</p></div></div>
              <div className="rec-card-actions">
                <span className="rec-ai-tag">✦ Generada por el análisis con IA</span>
                <div className="rec-actions">
                  {rec ? (rec.status === 'ACCEPTED' ? <button type="button" className="button primary small-button" onClick={() => onRequestCreateAction(rec)}>Crear acción →</button> : rec.status === 'PENDING' ? <><button type="button" className="button secondary small-button" onClick={() => void applyStatus(rec, 'REJECTED')} disabled={busy}>Rechazar</button><button type="button" className="button primary small-button" onClick={() => void applyStatus(rec, 'ACCEPTED')} disabled={busy}>{busy ? <><span className="button-loader" />Procesando...</> : 'Aceptar'}</button></> : null) : <button type="button" className="button primary small-button" onClick={() => void onImport()} disabled={importing}>{importing ? <><span className="button-loader" />Importando...</> : 'Importar'}</button>}
                </div>
              </div>
            </article>
          ) })}</div>}
        </>
      )}
    </section>
  )}

function ActionPlansPanel({ diagnostic, recommendations, createActionFor, onCreateActionClose }: { diagnostic: Diagnostic; recommendations: Recommendation[]; createActionFor: Recommendation | null; onCreateActionClose: () => void }) {
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
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
    setLoading(true); setLoadError('')
    try { const result = await api<{ actionPlans: ActionPlan[] }>(`/diagnostics/${diagnostic.id}/action-plans`); setPlans(result.actionPlans) } catch { setLoadError('No pudimos cargar los planes de acción.') } finally { setLoading(false) }
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
  async function removeItem(item: ActionItem) { const ticketWarning = item.ticket ? ` También se eliminará el ticket #${item.ticket.id.slice(-6).toUpperCase()} asociado a esta acción.` : ''; const confirmed = await askConfirm({ title: 'Eliminar acción', message: `Se eliminará «${item.title}» del plan de acción.${ticketWarning} Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/action-items/${item.id}`, { method: 'DELETE' }); await loadPlans() } catch { setError('No se pudo eliminar la acción.') } }
  async function updatePlan(plan: ActionPlan, status: ActionPlanStatus) { setError(''); try { await api(`/action-plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar el plan.') } }
  function startPlanEdit(plan: ActionPlan) { setPlanEditDraft({ title: plan.title, description: plan.description, status: plan.status }); setEditingPlan(plan) }
  async function savePlanEdit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!editingPlan) return; setSavingPlanEdit(true); setError(''); try { await api(`/action-plans/${editingPlan.id}`, { method: 'PATCH', body: JSON.stringify({ title: planEditDraft.title, description: planEditDraft.description, status: planEditDraft.status }) }); setEditingPlan(null); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar el plan.') } finally { setSavingPlanEdit(false) } }
  async function removePlan(plan: ActionPlan) { const confirmed = await askConfirm({ title: 'Eliminar plan de acción', message: `Se eliminará «${plan.title}» con todas sus actividades. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' }); if (!confirmed) return; try { await api(`/action-plans/${plan.id}`, { method: 'DELETE' }); await loadPlans() } catch { setError('No se pudo eliminar el plan.') } }
  function startItemEdit(item: ActionItem) { setEditingItem(item); setItemEditDraft({ title: item.title, description: item.description, priority: item.priority, status: item.status, recommendationId: item.recommendationId ?? '', responsibleId: item.responsibleId ?? '', dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '' }) }
  async function saveItemEdit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!editingItem) return; setSavingItemEdit(true); setError(''); try { const payload = { title: itemEditDraft.title, description: itemEditDraft.description, priority: itemEditDraft.priority, status: itemEditDraft.status, responsibleId: itemEditDraft.responsibleId || null, dueDate: itemEditDraft.dueDate || null }; await api(`/action-items/${editingItem.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); setEditingItem(null); await loadPlans() } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'No se pudo actualizar la acción.') } finally { setSavingItemEdit(false) } }
  async function saveRecAction(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!createActionFor || !recActionPlanId || savingRecAction) return; setSavingRecAction(true); setRecActionError(''); try { const payload = { ...recActionDraft, recommendationId: createActionFor.id, responsibleId: recActionDraft.responsibleId || null, dueDate: recActionDraft.dueDate || null }; await api(`/action-plans/${recActionPlanId}/items`, { method: 'POST', body: JSON.stringify(payload) }); onCreateActionClose(); await loadPlans() } catch (requestError) { setRecActionError(requestError instanceof ApiError ? requestError.message : 'No se pudo crear la acción.') } finally { setSavingRecAction(false) } }
  async function createPlanFromModal(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (creatingModalPlan) return; setCreatingModalPlan(true); setRecActionError(''); try { const result = await api<{ actionPlan: ActionPlan }>(`/diagnostics/${diagnostic.id}/action-plans`, { method: 'POST', body: JSON.stringify(modalPlanDraft) }); setRecActionPlanId(result.actionPlan.id); setModalPlanDraft(emptyPlanDraft); await loadPlans() } catch (requestError) { setRecActionError(requestError instanceof ApiError ? requestError.message : 'No se pudo crear el plan.') } finally { setCreatingModalPlan(false) } }return <section className="ai-analysis-panel plans-panel"><div className="ai-panel-heading"><div className="ai-panel-heading-main"><div><p className="detail-label">EJECUCIÓN</p><h3>Planes de Acción</h3><p className="ai-panel-subtitle">Organiza la ejecución de las recomendaciones.</p></div></div><button className="button primary small-button" onClick={() => { setPlanDraft(emptyPlanDraft); setShowPlanForm(!showPlanForm) }}>{showPlanForm ? 'Cerrar' : '+ Nuevo plan'}</button></div>{error && <div className="form-error" role="alert">{error}</div>}{loadError && <ErrorBanner message={loadError} onRetry={() => void loadPlans()} />}{showPlanForm && <form className="factor-form plan-form" onSubmit={savePlan}><div className="factor-form-heading"><h3>Nuevo plan de acción</h3><button type="button" className="icon-button" onClick={() => setShowPlanForm(false)}>×</button></div><label>Título<input value={planDraft.title} onChange={(event) => setPlanDraft({ ...planDraft, title: event.target.value })} placeholder="Ej. Plan de mejora 2026" minLength={3} required /></label><label>Descripción<textarea value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} rows={3} minLength={3} required /></label><div className="drawer-actions"><button type="button" className="button secondary" onClick={() => setShowPlanForm(false)}>Cancelar</button><button className="button primary" disabled={savingPlan}>{savingPlan ? 'Creando...' : 'Crear plan'}</button></div></form>}{loading ? <div className="ai-loading"><span className="loader" />Cargando planes...</div> : plans.length === 0 ? <EmptyState compact title="Sin planes de acción" text="Crea el primer plan para organizar la ejecución." /> : <><div className="plan-kpis">{[{ label: 'Planes activos', value: plans.filter((entry) => entry.status === 'ACTIVE').length, tone: 'active', icon: '▤' }, { label: 'Acciones totales', value: plans.reduce((sum, entry) => sum + entry.items.length, 0), tone: 'total', icon: '◫' }, { label: 'Completadas', value: plans.reduce((sum, entry) => sum + entry.items.filter((item) => item.status === 'COMPLETED').length, 0), tone: 'completed', icon: '✓' }, { label: 'En progreso', value: plans.reduce((sum, entry) => sum + entry.items.filter((item) => item.status === 'IN_PROGRESS').length, 0), tone: 'progress', icon: '↻' }].map((kpi) => <div className={`plan-kpi${kpi.tone ? ` ${kpi.tone}` : ''}`} key={kpi.label}><span className="plan-kpi-icon" aria-hidden="true">{kpi.icon}</span><div><strong>{kpi.value}</strong><small>{kpi.label}</small></div></div>)}</div><div className="plans-list">{plans.map((plan) => <article className="plan-card" key={plan.id}><header className="plan-card-head"><div className="plan-card-main"><div className="plan-title-row"><h4>{plan.title}</h4><span className={`plan-pill ${plan.status.toLowerCase()}`}>{planStatusLabel[plan.status]}</span></div><p className="plan-description">{plan.description}</p><small className="plan-createdby">Creado por {plan.createdBy.name}</small></div><div className="plan-actions"><label className="plan-status-field"><span className="plan-status-label">Estado</span><select value={plan.status} onChange={(event) => void updatePlan(plan, event.target.value as ActionPlanStatus)} aria-label="Estado del plan">{actionPlanStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="plan-actions-buttons"><button className="button secondary small-button" onClick={() => startPlanEdit(plan)}>Editar</button><button className="button danger small-button" onClick={() => void removePlan(plan)}>Eliminar</button></div></div></header>{itemFormFor === plan.id && <form className="factor-form" onSubmit={saveItem}><div className="factor-form-heading"><h3>Nueva acción</h3><button type="button" className="icon-button" onClick={() => setItemFormFor(null)}>×</button></div><label>Título<input value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} placeholder="¿Qué se hará?" minLength={3} required /></label><label>Descripción<textarea value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} rows={2} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={itemDraft.priority} onChange={(event) => setItemDraft({ ...itemDraft, priority: event.target.value as Level })}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Recomendación<select value={itemDraft.recommendationId} onChange={(event) => setItemDraft({ ...itemDraft, recommendationId: event.target.value })}><option value="">Sin relacionar</option>{recommendations.filter((item) => item.status !== 'REJECTED').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div><div className="form-grid"><label>Responsable<select value={itemDraft.responsibleId} onChange={(event) => setItemDraft({ ...itemDraft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Fecha límite<input type="date" value={itemDraft.dueDate} onChange={(event) => setItemDraft({ ...itemDraft, dueDate: event.target.value })} /></label></div><div className="drawer-actions"><button type="button" className="button secondary" onClick={() => setItemFormFor(null)}>Cancelar</button><button className="button primary" disabled={savingItem}>{savingItem ? 'Agregando...' : 'Agregar acción'}</button></div></form>}<div className="plan-board">{boardColumns.map((column) => { const columnItems = plan.items.filter((item) => item.status === column.status); return <div className={`kanban-column ${column.status.toLowerCase()}${dragState ? ' drop-enabled' : ''}${dropTarget === column.status ? ' drop-target' : ''}`} key={column.status} onDragOver={(event) => onColumnDragOver(event, column.status)} onDragLeave={(event) => onColumnDragLeave(event, column.status)} onDrop={(event) => onColumnDrop(event, column.status)}><div className="kanban-column-header"><span className="kanban-column-name"><span className={`kanban-column-icon ${column.status.toLowerCase()}`} aria-hidden="true">{kanbanColumnVisuals[column.status].icon}</span><span className="kanban-column-title">{column.label}</span></span><span className="kanban-column-count">{columnItems.length}</span></div>{dragState && dropTarget === column.status && <div className="kanban-drop-hint">Soltar aquí</div>}{columnItems.length === 0 ? <div className="kanban-column-empty"><span className={`kanban-empty-icon ${column.status.toLowerCase()}`} aria-hidden="true">{kanbanColumnVisuals[column.status].icon}</span><strong>{kanbanColumnVisuals[column.status].emptyTitle}</strong><small>{kanbanColumnVisuals[column.status].emptyText}</small></div> : columnItems.map((item) => <KanbanActionCard key={item.id} item={item} isDragging={dragState?.itemId === item.id} onDragStart={onCardDragStart} onDragEnd={onCardDragEnd} onChangeStatus={(entry, status) => void updateItem(entry, { status })} onEdit={startItemEdit} onRemove={(entry) => void removeItem(entry)} />)}</div> })}</div><footer className="plan-card-footer"><button className="text-button" onClick={() => { setItemDraft(emptyItemDraft); setItemFormFor(itemFormFor === plan.id ? null : plan.id) }}>{itemFormFor === plan.id ? 'Cerrar formulario' : '+ Agregar acción'}</button></footer></article>)}</div></>}{editingPlan && <PlanEditForm draft={planEditDraft} setDraft={setPlanEditDraft} saving={savingPlanEdit} onSubmit={savePlanEdit} onClose={() => setEditingPlan(null)} />}{editingItem && <ActionItemEditForm draft={itemEditDraft} setDraft={setItemEditDraft} users={users} saving={savingItemEdit} onSubmit={saveItemEdit} onClose={() => setEditingItem(null)} />}{createActionFor && <ActionFromRecommendationForm recommendation={createActionFor} plans={plans} users={users} planId={recActionPlanId} onPlanIdChange={setRecActionPlanId} draft={recActionDraft} onDraftChange={setRecActionDraft} planDraft={modalPlanDraft} onPlanDraftChange={setModalPlanDraft} error={recActionError} saving={savingRecAction} creatingPlan={creatingModalPlan} onSubmit={saveRecAction} onPlanCreate={createPlanFromModal} onClose={onCreateActionClose} />}</section> }

function KanbanActionCard({ item, isDragging, onDragStart, onDragEnd, onChangeStatus, onEdit, onRemove }: { item: ActionItem; isDragging: boolean; onDragStart: (item: ActionItem) => void; onDragEnd: () => void; onChangeStatus: (item: ActionItem, status: ActionItemStatus) => void; onEdit: (item: ActionItem) => void; onRemove: (item: ActionItem) => void }) {
  const [expanded, setExpanded] = useState(false)
  const longDescription = item.description.length > 110
  return <article className={`kanban-card${isDragging ? ' dragging' : ''}`} draggable onDragStart={() => onDragStart(item)} onDragEnd={onDragEnd}><div className="kanban-card-head"><strong className="kanban-card-title">{item.title}</strong><div className="kanban-card-controls"><button type="button" className="text-button" onClick={() => onEdit(item)}>Editar</button><button type="button" className="row-action" onClick={() => onRemove(item)} aria-label="Eliminar">×</button></div></div><div className="kanban-card-status"><span className={`kanban-status-badge ${item.status.toLowerCase()}`}>{actionItemStatusLabel[item.status]}</span><select value={item.status} onChange={(event) => onChangeStatus(item, event.target.value as ActionItemStatus)} aria-label="Estado de la acción">{actionItemStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></div><p className={`kanban-card-description${expanded ? ' expanded' : ''}`}>{item.description}</p>{longDescription && <button type="button" className="kanban-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Ver menos' : 'Ver más'}</button>}<div className="kanban-meta-row"><span className={`level-pill ${item.priority.toLowerCase()}`}>P. {recPriorityLabel[item.priority]}</span>{item.responsible && <span className="assignee"><span className="avatar tiny">{initials(item.responsible.name)}</span>{item.responsible.name}</span>}{item.dueDate && <span className="kanban-meta-cell kanban-due">Vence {relativeDate(item.dueDate)}</span>}</div><div className="kanban-card-foot"><div className="kanban-foot-row"><span className="kanban-meta-cell kanban-origin">Origen: {item.recommendation ? 'recomendación' : 'plan de acción'}</span>{item.ticket && <span className="kanban-meta-cell kanban-ticket">Ticket #{item.ticket.id.slice(-6).toUpperCase()}</span>}</div>{item.recommendation && <span className="kanban-rec" title={item.recommendation.title}>{item.recommendation.title}</span>}</div></article>}

function PlanEditForm({ draft, setDraft, saving, onSubmit, onClose }: { draft: PlanDraft; setDraft: React.Dispatch<React.SetStateAction<PlanDraft>>; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">▤</div><div className="company-modal-title"><p className="eyebrow">PLAN DE ACCIÓN</p><h2>Editar plan</h2><p className="company-modal-subtitle">Actualiza la información del plan de acción.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ej. Plan de mejora 2026" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} minLength={3} required /></label><div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div> }

function ActionItemEditForm({ draft, setDraft, users, saving, onSubmit, onClose }: { draft: ItemDraft; setDraft: React.Dispatch<React.SetStateAction<ItemDraft>>; users: User[]; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">✓</div><div className="company-modal-title"><p className="eyebrow">ACTIVIDAD</p><h2>Editar acción</h2><p className="company-modal-subtitle">Actualiza la información y el responsable de la actividad.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="¿Qué se hará?" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Level })}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ActionItemStatus })}>{actionItemStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><div className="form-grid"><label>Responsable<select value={draft.responsibleId} onChange={(event) => setDraft({ ...draft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Fecha límite<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label></div><div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div> }

function ActionFromRecommendationForm({ recommendation, plans, users, planId, onPlanIdChange, draft, onDraftChange, planDraft, onPlanDraftChange, error, saving, creatingPlan, onSubmit, onPlanCreate, onClose }: { recommendation: Recommendation; plans: ActionPlan[]; users: User[]; planId: string; onPlanIdChange: (value: string) => void; draft: ItemDraft; onDraftChange: React.Dispatch<React.SetStateAction<ItemDraft>>; planDraft: PlanDraft; onPlanDraftChange: React.Dispatch<React.SetStateAction<PlanDraft>>; error: string; saving: boolean; creatingPlan: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onPlanCreate: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal" onSubmit={onSubmit}><div className="company-modal-header"><div className="company-modal-icon">⚑</div><div className="company-modal-title"><p className="eyebrow">RECOMENDACIÓN</p><h2>Crear acción</h2><p className="company-modal-subtitle">Convierte esta recomendación en una acción del plan de acción.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>Recomendación relacionada<input type="text" value={recommendation.title} readOnly /></label>{plans.length === 0 ? <div className="modal-plan-empty"><p>No tienes planes de acción para este análisis estratégico.</p><form className="factor-form plan-form" onSubmit={onPlanCreate}><div className="factor-form-heading"><h3>Nuevo plan</h3></div><label>Título<input value={planDraft.title} onChange={(event) => onPlanDraftChange({ ...planDraft, title: event.target.value })} placeholder="Ej. Plan de mejora 2026" minLength={3} required /></label><label>Descripción<textarea value={planDraft.description} onChange={(event) => onPlanDraftChange({ ...planDraft, description: event.target.value })} rows={2} minLength={3} required /></label><button className="button primary" disabled={creatingPlan}>{creatingPlan ? 'Creando plan...' : '+ Crear plan'}</button></form></div> : <label>Plan de acción<select value={planId} onChange={(event) => onPlanIdChange(event.target.value)} required><option value="">Selecciona un plan</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}<label>Título<input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder="¿Qué se hará?" minLength={3} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} rows={2} minLength={3} required /></label><div className="form-grid"><label>Prioridad<select value={draft.priority} onChange={(event) => onDraftChange({ ...draft, priority: event.target.value as Level })}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Responsable<select value={draft.responsibleId} onChange={(event) => onDraftChange({ ...draft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Fecha límite<input type="date" value={draft.dueDate} onChange={(event) => onDraftChange({ ...draft, dueDate: event.target.value })} /></label>{error && <div className="form-error">{error}</div>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving || creatingPlan || !planId}>{saving ? 'Creando...' : 'Crear acción'}</button></div></form></div> }

function aiDofaCounts(items: SWOTItem[]) {
  return swotTypes.map((type) => ({ key: type.value, label: type.label, count: items.filter((item) => item.type === type.value).length }))
}

/** Barra proporcional: reparte solo la cantidad real de factores de cada cuadrante. */
function AiDofaBalance({ items }: { items: SWOTItem[] }) {
  const counts = aiDofaCounts(items)
  const total = counts.reduce((sum, entry) => sum + entry.count, 0)
  if (!total) return null
  return <div className="ai-doqa"><div className="ai-doqa-head"><b>Matriz DOFA</b><span>{total} factores</span></div><div className="ai-doqa-bar">{counts.map((entry) => <i className={entry.key.toLowerCase()} key={entry.key} style={{ flexGrow: entry.count }} title={`${entry.label}: ${entry.count}`} />)}</div><ul className="ai-doqa-legend">{counts.map((entry) => <li className={entry.key.toLowerCase()} key={entry.key}><strong>{entry.count}</strong> {entry.label}</li>)}</ul></div>
}

/** Cada hallazgo trae su origen en `basis`: un hecho se apoya en los datos del diagnóstico y una
 *  inferencia es la lectura que la IA hace sobre ellos. La tarjeta lo dice con palabras; el color
 *  solo refuerza. Aquí no se inventa ni se reordena nada: se muestran los hallazgos tal como llegan. */
const aiBasisCopy: Record<AIFinding['basis'], { label: string; note: string }> = {
  FACT: { label: 'Hecho', note: 'Apoyado en los datos del análisis.' },
  INFERENCE: { label: 'Inferencia', note: 'Interpretación de la IA sobre esos datos.' },
}

function AiDiagnosis({ summary, text: _text, items }: { summary: string; text: string; items: SWOTItem[] }) {
  const readableSummary = checkyReadable(summary.trim(), buildCheckyFactorCodes(items))
  return (
    <article className="ai-diagnosis">
      <header className="ai-card-head">
        <span className="ai-diagnosis-icon" aria-hidden="true">◫</span>
        <div className="ai-card-headings">
          <h4>Análisis estratégico</h4>
          <p className="ai-card-subtitle">Lectura estratégica de la situación actual</p>
        </div>
        <span className="ai-generated-badge">Checky</span>
      </header>
      {readableSummary && <div className="ai-reading">
        <p><strong>Resumen ejecutivo:</strong> {readableSummary}</p>
      </div>}
      <AiDofaBalance items={items} />
    </article>
  )
}

/** Divide el texto de la inferencia en un resumen breve y su resto, sin alterar el contenido. */
function splitInference(text: string, limit = 120): { brief: string; rest: string } {
  const clean = text.trim()
  if (clean.length <= limit) return { brief: clean, rest: '' }
  const cut = clean.lastIndexOf(' ', limit)
  const head = clean.slice(0, cut > 70 ? cut : limit)
  return { brief: `${head}…`, rest: clean.slice(head.length).trim() }
}

/** De dónde sale la inferencia, con las palabras del factor y no con su id.
 *
 *  Reutiliza el bloque de evidencia que ya usa Checky en lugar de inventar otro: mismo aspecto, misma
 *  forma de navegar al factor y mismo texto de ayuda cuando el factor ya no está. Lo único que cambia
 *  es la etiqueta, "Derivada de:", porque aquí no son hallazgos de Checky sino conclusiones del
 *  análisis. `evidence` llega ya resuelta desde el servidor contra la matriz vigente, así que no hay
 *  forma de que aquí aparezca un id suelto. */
function AiFindingEvidence({ finding }: { finding: AIFinding }) {
  const [hint, setHint] = useState('')
  // `evidence` y `evidenceIds` llegan alineados: el servidor solo deja los ids que resuelve en la
  // matriz actual, y la etiqueta sale de ahí. El id se conserva únicamente para poder llevar la
  // lectura hasta el factor en la DOFA; nunca se muestra.
  const refs = useMemo<CheckyFactorRef[]>(() => finding.evidence.reduce<CheckyFactorRef[]>((list, evidence, index) => {
    const id = finding.evidenceIds[index]
    if (id) list.push({ kind: 'factor', id, label: `${swotTypeLabels[evidence.type]}: ${evidence.description}`, type: evidence.type })
    return list
  }, []), [finding])
  if (refs.length === 0) return (
    <div className="checky-evidence">
      <span className="checky-evidence-label">Derivada de:</span>
      <p className="checky-evidence-empty">No se encontró evidencia trazable en la matriz actual.</p>
    </div>
  )
  return (
    <div className="checky-evidence">
      <span className="checky-evidence-label">Derivada de:</span>
      <ul>
        {refs.map((ref) => (
          <li key={ref.id}>
            <button type="button" className={`checky-evidence-chip ${ref.kind}`} onClick={() => setHint(navigateToCheckyEvidence(ref).hint)}>
              <span className="checky-evidence-icon" aria-hidden="true">◻</span>
              <span className="checky-evidence-text">{ref.label}</span>
              <span className="checky-evidence-go" aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
      {hint && <p className="checky-evidence-hint">{hint}</p>}
    </div>
  )
}

function AiFindingCard({ entry }: { entry: AIFinding }) {
  const [open, setOpen] = useState(false)
  const basis = entry.basis
  const { brief, rest } = splitInference(entry.finding)
  const interpretation = entry.interpretation?.trim() ?? ''
  const expandable = rest.length > 0
  return (
    <article className={`ai-finding ${basis.toLowerCase()}${open ? ' open' : ''}`}>
      <p className="detail-label">Conclusión principal</p>
      <div className="ai-finding-head">
        <span className={`ai-finding-tag ${basis.toLowerCase()}`}>{aiBasisCopy[basis].label}</span>
        <p className="ai-finding-summary">{brief}</p>
        {expandable && <button type="button" className="link-toggle ai-finding-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Ocultar' : 'Ver completo'}<span className="ai-finding-chevron" aria-hidden="true">▾</span></button>}
      </div>
      <AiFindingEvidence finding={entry} />
      <div className="ai-finding-interpretation">
        <p className="detail-label">Interpretación:</p>
        <p className="ai-finding-detail">{interpretation || 'No disponible en esta lectura; actualiza el análisis con Checky para regenerarla.'}</p>
      </div>
      {expandable && <div className="ai-finding-body"><div><p className="ai-finding-detail">{rest}</p></div></div>}
    </article>
  )
}

function AiFindingGroup({ basis, findings, heading }: { basis: AIFinding['basis']; findings: AIFinding[]; heading?: string }) {
  if (findings.length === 0) return null
  const copy = aiBasisCopy[basis]
  return (
    <section className={`ai-group ${basis.toLowerCase()}`} aria-label={copy.label}>
      <div className="ai-group-head">
        <h4>{heading ?? copy.label}</h4>
        <span className="ai-group-count">{findings.length}</span>
        <p>{copy.note}</p>
      </div>
      <div className="ai-group-list">
        {findings.map((item, index) => <AiFindingCard key={`${item.finding}-${index}`} entry={item} />)}
      </div>
    </section>
  )
}

/** Aquí solo se leen las inferencias. Los elementos que la IA marca como FACT son la lectura
 *  cuantitativa de la DOFA y de la ponderación, datos que ya tienen su propia sección: repetidos
 *  aquí solo devolvían la lista de factores. El payload sigue trayendo ambos y no se toca; lo que
 *  cambia es qué se pinta. */
function AiFindings({ findings }: { findings: AIFinding[] }) {
  const inferences = findings.filter((item) => item.basis === 'INFERENCE')
  if (inferences.length === 0) return <p className="ai-empty">Sin inferencias en este análisis.</p>
  return (
    <div className="ai-findings">
      <div className="checky-inline-identity">
        <img src={checkyImage} alt="" aria-hidden="true" />
        <span>Inferencias identificadas por Checky</span>
      </div>
      <AiFindingGroup basis="INFERENCE" findings={inferences} heading="Inferencias estratégicas" />
    </div>
  )
}

type CheckyStatus = 'idle' | 'loading' | 'success' | 'error' | 'insufficientData'

type CheckyFactorRef = { kind: 'factor'; id: string; label: string; type: SWOTType }

type CheckyCrossRef = { kind: 'cross'; id: string; label: string; crossType: CrossType; short: string }

type CheckyUnknownRef = { kind: 'unknown'; id: string; label: string }

type CheckyEvidenceRef = CheckyFactorRef | CheckyCrossRef | CheckyUnknownRef

const checkyCategoryOrder: CheckyCategory[] = ['REVIEW_ASPECTS', 'MISSING_CROSSES', 'UNRELATED_FACTORS', 'STRENGTHEN_STRATEGIES', 'STRATEGIC_RISKS', 'MISSED_OPPORTUNITIES', 'INFO_TO_COMPLEMENT', 'NEXT_STEPS']

type CheckyCategoryVisual = { label: string; icon: string; tone: string; relevance: Level }/** `relevance` es una lectura derivada de la categoría, no una prioridad asignada por la IA: el contrato de Checky no incluye ese campo. */

const checkyCategoryVisuals: Record<CheckyCategory, CheckyCategoryVisual> = {
  REVIEW_ASPECTS: { label: 'Aspectos a revisar', icon: '◎', tone: 'review', relevance: 'HIGH' },
  MISSING_CROSSES: { label: 'Cruces potenciales', icon: '◇', tone: 'missing', relevance: 'HIGH' },
  UNRELATED_FACTORS: { label: 'Factores poco relacionados', icon: '⊘', tone: 'unrelated', relevance: 'MEDIUM' },
  STRENGTHEN_STRATEGIES: { label: 'Estrategias a fortalecer', icon: '↑', tone: 'strategy', relevance: 'MEDIUM' },
  STRATEGIC_RISKS: { label: 'Riesgos estratégicos', icon: '!', tone: 'risk', relevance: 'HIGH' },
  MISSED_OPPORTUNITIES: { label: 'Oportunidades no aprovechadas', icon: '↗', tone: 'opportunity', relevance: 'MEDIUM' },
  INFO_TO_COMPLEMENT: { label: 'Información a validar', icon: '?', tone: 'info', relevance: 'LOW' },
  NEXT_STEPS: { label: 'Próximos pasos', icon: '→', tone: 'next', relevance: 'MEDIUM' },}

const checkyStatusVisuals: Record<CheckySuggestionStatus, { label: string; icon: string }> = {
  PENDING: { label: 'Pendiente', icon: '○' },
  ACCEPTED: { label: 'Aceptada', icon: '✓' },
  REJECTED: { label: 'Rechazada', icon: '✕' },}

const checkyBasisCopy: Record<CheckyFindingBasis, { text: string; hint: string }> = {
  FACT: { text: 'Basado directamente en información registrada.', hint: 'El hallazgo se apoya en datos que ya existen en el análisis estratégico.' },
  INFERENCE: { text: 'Inferencia realizada por Checky a partir de los datos disponibles.', hint: 'El hallazgo es una lectura razonada, no un dato registrado.' },}

const checkyDefaultQuestion = 'Revisa mi análisis estratégico completo (factores, cruces y estrategias) e identifica los aspectos que debería considerar antes de avanzar.'/** El servidor guarda cada hallazgo como `${title}\n${detail}`; lo recuperamos sin inventar nada. */

function splitCheckyContent(content: string): { title: string; detail: string } {
  const [first = '', ...rest] = content.split('\n')
  return { title: first.trim(), detail: rest.join('\n').trim() }}

function checkyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return 'Checky no está configurado todavía. Añade OPENAI_API_KEY en el backend.'
    if (error.status === 429) return 'Alcanzaste el límite de consultas de Checky. Inténtalo de nuevo más tarde.'
    if (error.status === 502) return 'Checky no pudo completar la revisión en este momento. Inténtalo de nuevo.'
    if (error.status === 403) return 'Tu rol no tiene permiso para consultar a Checky en este análisis estratégico.'
    return error.message
  }
  return 'No se pudo completar la consulta a Checky.'}

function checkyEvidenceRefs(evidenceIds: string[], items: SWOTItem[], crosses: StrategicCross[]): CheckyEvidenceRef[] {
  return evidenceIds.map((id) => {
    const item = items.find((candidate) => candidate.id === id)
    if (item) return { kind: 'factor', id, label: `${swotTypeLabels[item.type]}: ${item.description}`, type: item.type }
    const cross = crosses.find((candidate) => candidate.id === id)
    if (cross) {
      // El id corto queda como dato técnico en el `title` para quien necesite localizarlo, pero lo
      // que se lee es la combinación: "Debilidad: X + Oportunidad: Y" dice más que "Cruce DO · #A1B2C3".
      const label = `${swotTypeLabels[cross.factor1.type]}: ${cross.factor1.description} + ${swotTypeLabels[cross.factor2.type]}: ${cross.factor2.description}`
      return { kind: 'cross', id, label, crossType: cross.crossType, short: `#${cross.id.slice(-6).toUpperCase()}` }
    }
    return { kind: 'unknown', id, label: 'Referencia no disponible' }
  })}

function flashCheckyTarget(target: Element | null) {
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target.classList.remove('checky-evidence-flash')
  window.requestAnimationFrame(() => target.classList.add('checky-evidence-flash'))
  window.setTimeout(() => target.classList.remove('checky-evidence-flash'), 1800)}

function navigateToCheckyEvidence(ref: CheckyEvidenceRef): { ok: boolean; hint: string } {
  if (ref.kind === 'factor') {
    const target = document.querySelector(`[data-swot-item-id="${ref.id}"]`)
    flashCheckyTarget(target)
    return { ok: Boolean(target), hint: target ? '' : 'No se encontró el factor en la matriz. Es posible que se haya eliminado después de la consulta.' }
  }
  if (ref.kind === 'cross') {
    const target = document.querySelector(`[data-cross-id="${ref.id}"]`)
    if (target) { flashCheckyTarget(target); return { ok: true, hint: '' } }
    flashCheckyTarget(document.querySelector('.crosses-section'))
    return { ok: false, hint: 'El cruce está en la sección de cruces, pero puede estar oculto por el filtro de tipo activo.' }
  }
  return { ok: false, hint: 'No se encontró el elemento en la matriz actual.' }}/** Ordena interno (STRENGTH/WEAKNESS) primero, igual que el servidor y que la creación de cruces de la app. */

function orderCheckyFactors(factors: CheckyFactorRef[]): CheckyFactorRef[] {
  if (factors.length < 2) return factors
  const internal = factors.find((factor) => factor.type === 'STRENGTH' || factor.type === 'WEAKNESS')
  const external = factors.find((factor) => factor.type === 'OPPORTUNITY' || factor.type === 'THREAT')
  return internal && external ? [internal, external] : factors.slice(0, 2)}

/**
 * Checky escribe su prosa con las abreviaturas de la matriz (W4, O3, FO…) porque es como el modelo
 * nombró los factores, pero a quien no conoce la DOFA no le dicen nada. Aquí se reescribe solo la
 * capa visible: el texto del modelo se conserva intacto en la base y lo que se cambia es qué se
 * muestra. Cada código se cambia por el nombre completo del factor cuando se puede resolver, y si
 * no se puede, se retira en lugar de dejarlo suelto.
 *
 * `factorByCode` se construye con el mismo orden que usa la matriz (por tipo y fecha), de modo que
 * W4 es la cuarta debilidad registrada. Es una convención de lectura, no un dato del contrato: si
 * una abreviatura no resuelve a un factor real, no se inventa a cuál se refiere.
 */
const checkyCodeToken = /\b([FSWOT])(\d{1,3})\b/gi

/** ¿El texto trae abreviaturas de factor? Se prueba con una copia sin estado para no depender del
 *  `lastIndex` que comparte con el reemplazo global. */
function checkyHasCode(text: string): boolean {
  return /\b[FSWOT]\d{1,3}\b/i.test(text)
}

function buildCheckyFactorCodes(items: SWOTItem[]): Map<string, SWOTItem> {
  const byCode = new Map<string, SWOTItem>()
  for (const type of swotTypes) {
    const bucket = items.filter((item) => item.type === type.value)
    bucket.forEach((item, index) => {
      // F y S son la misma cuadrante: la abreviatura cambia, el factor no.
      for (const letter of type.value === 'STRENGTH' ? ['F', 'S'] : [swotTypeShortLetters[type.value]]) {
        byCode.set(`${letter}${index + 1}`, item)
      }
    })
  }
  return byCode
}

const swotTypeShortLetters: Record<SWOTType, string> = { STRENGTH: 'F', WEAKNESS: 'W', OPPORTUNITY: 'O', THREAT: 'T' }

/** El tipo de cruce ya se muestra como badge en la tarjeta, así que en la prosa sobra. */
const checkyCrossTypeToken = /\b(DO|FO|FA|DA)\b/g
/** Marcador para un código que no se pudo resolver, para poder borrar también su separador. */
const checkyDropped = '\u0001'
/**
 * Identificadores internos. El prompt pide de forma explícita "qué factores relaciona y con qué ids",
 * así que Checky escribe ids reales en su prosa; son trazabilidad, no texto para el usuario. Cubre
 * cuid2 de Prisma, UUID, refs `ai:<id>:FO:0` y el hash sha256 con el que se cita una estrategia.
 */
const checkyInternalId =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|cm[a-z]{2,}[0-9]{6,}|ai:[A-Za-z0-9]+:[A-Z]{1,3}:\d+|strategyRef\.?strat:?[0-9a-f]*|strat:[0-9a-f]+|[0-9a-f]{40,64})\b/gi

/**
 * Sustituye abreviaturas por la descripción real del factor y retira identificadores y códigos que no
 * tienen lectura para el usuario. Un código que no resuelve a un factor del diagnóstico no se
 * inventa: se marca para poder borrar también el separador que lo unía, de modo que "W7-O9"
 * desaparezca entero y no deje un guion colgando en medio de la frase.
 */
function expandCheckyCodes(text: string, byCode: Map<string, SWOTItem>): string {
  return text
    .replace(checkyCodeToken, (_match, letter: string, digits: string) => {
      const item = byCode.get(`${letter.toUpperCase()}${digits}`)
      return item ? item.description : checkyDropped
    })
    .replace(checkyInternalId, '')
    .replace(checkyCrossTypeToken, '')
    .replace(new RegExp(`\\s*[-–—+/]\\s*${checkyDropped}`, 'g'), checkyDropped)
    .replace(new RegExp(`${checkyDropped}\\s*[-–—+/]\\s*`, 'g'), checkyDropped)
    .replace(new RegExp(`${checkyDropped}\\s+[yeo]\\s+${checkyDropped}`, 'gi'), checkyDropped)
    .replace(new RegExp(`${checkyDropped}[\\s,;:.()+]*`, 'g'), '')
    .replace(new RegExp(checkyDropped, 'g'), '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*\+\s*(?=$|[.,;:)]|\s*$)/g, '')
    // Una etiqueta que se quedó sin nada detrás: "Factores:" al final de la frase.
    .replace(/\b(?:factores?|tipos? de cruce|evidencias?|referencias?)\s*:\s*(?=[.,;:]|\s*$)/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[\s,;:]+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Checky precede su prosa con referencias: "Factores: W4 (id) + O3 (id)", "Tipo de cruce: DO",
 * "Evidencia: 2 factores". "Tipo de cruce", "evidencia" y "referencias" son metadatos que no
 * aportan nada —el tipo va como badge junto a "Debilidad + Oportunidad" y la evidencia se ve en la
 * lista de la propia tarjeta—, así que se quitan aunque estén en mitad de una frase. "Relevancia:",
 * "Dirección:" y "Factores:" sí se conservan: son frases y deben leerse.
 */
const checkyMetadataLine = /^\s*(?:tipo de cruce|evidencias?|referencias?)\s*:/i
const checkyInlineMetadata = /(^|[.;:\s])(?:tipo de cruce|evidencias?|referencias?)\s*:[^.;\n]*[.;]?/gi
/** Una línea que es solo la enumeración de factores; detrás puede venir una frase que sí explica. */
const checkyFactorsPrefix = /^\s*factores?\s*:[^.]*?\b[FSWOT]\d{1,3}\b[^.]*\.?/i

function stripCheckyTechnicalLines(text: string): string {
  return text
    .replace(checkyInlineMetadata, (_match, lead = '') => (lead.trim() ? lead : ' '))
    .split('\n')
    .flatMap((line) => {
      if (checkyMetadataLine.test(line)) return []
      if (!checkyFactorsPrefix.test(line)) return [line]
      const rest = line.replace(checkyFactorsPrefix, '').trim()
      // Si detrás de la enumeración no queda ni una palabra, la línea era solo una lista de
      // referencias y se va. "W4 + O3" desaparece; "W4 + O3. La documentación no escala." se queda
      // con la frase, porque los paréntesis que la acompañan ya son texto legible.
      const substantive = rest.replace(/\b[FSWOT]\d{1,3}\b/gi, '').replace(/[+\-–—/,.:;()\s]/g, '')
      return substantive.length >= 3 ? [rest] : []
    })
    .join('\n')
}

/** Texto de Checky listo para leer: sin códigos, sin ids internos y sin líneas de solo referencia. */
function checkyReadable(text: string, byCode: Map<string, SWOTItem>): string {
  return expandCheckyCodes(stripCheckyTechnicalLines(text), byCode).trim()
}

/** La etiqueta de un factor ya trae "Debilidad: Falta de documentación". Aquí solo el texto, porque
 *  el nombre de la cuadrante se muestra aparte como etiqueta y repetirlo sería leerlo dos veces. */
function checkyFactorText(ref: CheckyFactorRef): string {
  const separator = ref.label.indexOf(': ')
  return separator === -1 ? ref.label : ref.label.slice(separator + 2)
}

/**
 * Índice de abreviaturas → factor real, en el mismo orden en que la matriz los muestra. Se calcula
 * una vez por panel y se pasa a las tarjetas: es lectura, no dato, y por eso vive en la capa de UI.
 */
function useCheckyFactorCodes(items: SWOTItem[]): Map<string, SWOTItem> {
  return useMemo(() => buildCheckyFactorCodes(items), [items])
}

/**
 * Encabezado del cruce. Si el modelo ya escribió una frase con verbo de acción se respeta; si el
 * título vino cargado de abreviaturas, se cambia por la estrategia sugerida, que sí describe la
 * acción, y en último caso por una frase armada con los dos factores reales. Todos los caminos
 * pasan por el saneador: un título sin abreviaturas tampoco está libre de ids sueltos.
 */
function checkyCrossHeadline(finding: CheckyMessage, factors: CheckyFactorRef[], byCode: Map<string, SWOTItem>): string {
  const { title } = splitCheckyContent(finding.content)
  if (title && !checkyHasCode(title)) return checkyReadable(title, byCode) || title
  const strategyTitle = finding.suggestedStrategyTitle
  if (strategyTitle) return checkyReadable(strategyTitle, byCode) || strategyTitle
  const [first, second] = factors
  if (first && second) return `Relacionar ${swotTypeLabels[first.type].toLowerCase()} con ${swotTypeLabels[second.type].toLowerCase()}`
  return 'Cruce propuesto por Checky'
}
/** Extrae la estrategia solo si el propio detalle la delimita; nunca la inventa. */

function CheckyBasisBadge({ basis }: { basis: CheckyFindingBasis }) {
  const copy = checkyBasisCopy[basis]
  return (
    <span className={`checky-basis ${basis === 'FACT' ? 'fact' : 'inference'}`} title={copy.hint}>
      <span className="checky-basis-dot" aria-hidden="true" />
      {basis}
      <span className="checky-basis-copy">{copy.text}</span>
    </span>
  )}

function CheckyStatusBadge({ status }: { status: CheckySuggestionStatus }) {
  const visual = checkyStatusVisuals[status]
  return <span className={`checky-status ${status.toLowerCase()}`}><span aria-hidden="true">{visual.icon}</span>{visual.label}</span>}

function CheckyDecisionActions({ status, busy, onAccept, onReject, acceptedMessage }: { status: CheckySuggestionStatus; busy: boolean; onAccept: () => void; onReject: () => void; acceptedMessage?: string }) {
  if (status === 'ACCEPTED') return acceptedMessage
    ? <div className="checky-accepted-confirm"><img src={checkyImage} alt="" aria-hidden="true" /><p className="checky-decided accepted"><span aria-hidden="true">✓</span> {acceptedMessage}</p></div>
    : <p className="checky-decided accepted"><span aria-hidden="true">✓</span> Sugerencia aceptada</p>
  if (status === 'REJECTED') return <p className="checky-decided rejected"><span aria-hidden="true">✕</span> Sugerencia descartada</p>
  return (
    <div className="checky-actions">
      <button type="button" className="button secondary small-button" onClick={onReject} disabled={busy}>Rechazar</button>
      <button type="button" className="button primary small-button" onClick={onAccept} disabled={busy}>Aceptar sugerencia</button>
    </div>
  )}

function CheckyEvidence({ refs }: { refs: CheckyEvidenceRef[] }) {
  const [hint, setHint] = useState('')
  if (refs.length === 0) return <p className="checky-evidence-empty">Checky no encontró evidencia trazable para este hallazgo.</p>
  return (
    <div className="checky-evidence">
      <span className="checky-evidence-label">Evidencia</span>
      <ul>
        {refs.map((ref) => (
          <li key={ref.id}>
            <button type="button" className={`checky-evidence-chip ${ref.kind}`} onClick={() => setHint(navigateToCheckyEvidence(ref).hint)}>
              <span className="checky-evidence-icon" aria-hidden="true">{ref.kind === 'factor' ? '◻' : ref.kind === 'cross' ? '◫' : '?'}</span>
              <span className="checky-evidence-text">{ref.label}</span>
              <span className="checky-evidence-go" aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
      {hint && <p className="checky-evidence-hint">{hint}</p>}
    </div>
  )}

function CheckyMissingCrossCard({ finding, refs, byCode, status, busy, onAccept, onReject }: { finding: CheckyMessage; refs: CheckyEvidenceRef[]; byCode: Map<string, SWOTItem>; status: CheckySuggestionStatus; busy: boolean; onAccept: () => void; onReject: () => void }) {
  const [open, setOpen] = useState(false)
  const [acceptedFlash, setAcceptedFlash] = useState(false)
  useEffect(() => {
    if (status !== 'ACCEPTED') {
      setAcceptedFlash(false)
      return
    }
    setAcceptedFlash(true)
    const timer = window.setTimeout(() => setAcceptedFlash(false), 2600)
    return () => window.clearTimeout(timer)
  }, [status])
  const { detail } = splitCheckyContent(finding.content)
  const factors = orderCheckyFactors(refs.filter((ref): ref is CheckyFactorRef => ref.kind === 'factor'))
  const crossType = factors.length === 2 ? crossTypeForPair(factors[0].type, factors[1].type) : null
  // La estrategia llega estructurada desde el backend: no se deduce del texto del hallazgo.
  const strategyTitle = finding.suggestedStrategyTitle ? checkyReadable(finding.suggestedStrategyTitle, byCode) : ''
  const strategyDescription = finding.suggestedStrategyDescription ? checkyReadable(finding.suggestedStrategyDescription, byCode) : ''
  return (
    <article className="checky-card checky-card-cross">
      <header className="checky-card-head">
        <span className="checky-card-icon" aria-hidden="true">💡</span>
        <div>
          <p className="checky-card-kicker">Posible cruce no explorado</p>
          <h4>{checkyCrossHeadline(finding, factors, byCode)}</h4>
        </div>
      </header>
      <div className="checky-cross-pair">
        {factors.length === 2
          ? <>
              <div className="checky-cross-factor">
                <span className={`checky-cross-role ${factors[0].type.toLowerCase()}`}>{swotTypeLabels[factors[0].type]}</span>
                <p>{checkyFactorText(factors[0])}</p>
              </div>
              <span className="checky-cross-plus" aria-hidden="true">+</span>
              <div className="checky-cross-factor">
                <span className={`checky-cross-role ${factors[1].type.toLowerCase()}`}>{swotTypeLabels[factors[1].type]}</span>
                <p>{checkyFactorText(factors[1])}</p>
              </div>
            </>
          : <p className="checky-cross-unknown">Checky no propuso una pareja DOFA válida, así que no se puede decir qué factores combina.</p>}
      </div>
      {crossType && (
        <p className="checky-cross-meaning">
          <span className={`cross-type-chip large ${crossType.toLowerCase()}`} title="Código de la combinación en la matriz DOFA">{crossType}</span>
          <span>{crossTypeCombos[crossType]}</span>
        </p>
      )}
      {detail && <><p className="checky-cross-question">¿Por qué podría ser relevante?</p><p className="checky-card-detail">{checkyReadable(detail, byCode)}</p></>}
      {strategyTitle && strategyDescription && (<div className="checky-cross-strategy"><div className="checky-strategy-identity"><img src={checkyImage} alt="" aria-hidden="true" /><p className="checky-cross-question"><span aria-hidden="true">🎯</span> Estrategia sugerida por Checky</p></div><p className="checky-strategy-title">{strategyTitle}</p><p className="checky-card-detail">{checkyReadable(strategyDescription, byCode)}</p></div>)}
      <p className="checky-cross-note">Al aceptar, el cruce se crea en la matriz DOFA con origen IA y esta sugerencia queda aceptada. Si lo rechazas, no se crea nada.</p>
      <div className="checky-card-foot">
        <button type="button" className="checky-review-btn" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? 'Ocultar evidencia' : 'Revisar'} <span aria-hidden="true">▾</span></button>
        <CheckyBasisBadge basis={finding.basis ?? 'INFERENCE'} />
        <CheckyStatusBadge status={status} />
      </div>
      {open && <CheckyEvidence refs={refs} />}
      <CheckyDecisionActions status={status} busy={busy} onAccept={onAccept} onReject={onReject} acceptedMessage={acceptedFlash ? 'Checky confirmó la estrategia. Continúa a Ponderación.' : undefined} />
    </article>
  )}

function CheckyFindingCard({ finding, refs, byCode, status, busy, onAccept, onReject }: { finding: CheckyMessage; refs: CheckyEvidenceRef[]; byCode: Map<string, SWOTItem>; status: CheckySuggestionStatus; busy: boolean; onAccept: () => void; onReject: () => void }) {
  const [open, setOpen] = useState(false)
  const { title, detail } = splitCheckyContent(finding.content)
  return (
    <article className="checky-card">
      <header className="checky-card-head">
        <div>
          <h4>{checkyReadable(title, byCode)}</h4>
          <div className="checky-card-badges">
            <span className={`level-pill ${checkyCategoryVisuals[finding.category!].relevance.toLowerCase()}`} title="Relevancia derivada de la categoría del hallazgo">Relevancia {checkyCategoryVisuals[finding.category!].relevance === 'HIGH' ? 'alta' : checkyCategoryVisuals[finding.category!].relevance === 'MEDIUM' ? 'media' : 'baja'}</span>
            <CheckyStatusBadge status={status} />
          </div>
        </div>
      </header>
      <p className="checky-card-detail">{checkyReadable(detail, byCode)}</p>
      <div className="checky-card-foot">
        <button type="button" className="checky-review-btn" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? 'Ocultar evidencia' : 'Revisar'} <span aria-hidden="true">▾</span></button>
        <CheckyBasisBadge basis={finding.basis ?? 'INFERENCE'} />
      </div>
      {open && <CheckyEvidence refs={refs} />}
      <CheckyDecisionActions status={status} busy={busy} onAccept={onAccept} onReject={onReject} />
    </article>
  )}

function CheckyPanel({ diagnostic, items, analysis, analysisLoading, analysisError, onCrossCreated, onConsulted }: { diagnostic: Diagnostic; items: SWOTItem[]; analysis: AIAnalysis | null; analysisLoading: boolean; analysisError: string; onCrossCreated: () => Promise<void> | void; onConsulted: () => Promise<void> | void }) {
  const [status, setStatus] = useState<CheckyStatus>('idle')
  const [error, setError] = useState('')
  const [session, setSession] = useState<CheckySession | null>(null)
  const [messages, setMessages] = useState<CheckyMessage[]>([])
  const [crosses, setCrosses] = useState<StrategicCross[]>([])
  const [busy, setBusy] = useState(false)
  const [checkyHydrated, setCheckyHydrated] = useState(false)
  const autoConsultForDiagnostic = useRef<string | null>(null)
  useEffect(() => {
    setStatus('idle')
    setError('')
    setSession(null)
    setMessages([])
    setCrosses([])
    setBusy(false)
    setCheckyHydrated(false)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [list, crossResult] = await Promise.all([
            api<{ sessions: CheckySession[] }>(`/diagnostics/${diagnostic.id}/checky/sessions`),
            api<{ crosses: StrategicCross[] }>(`/diagnostics/${diagnostic.id}/crosses`),
          ])
          setCrosses(crossResult.crosses)
          const latest = list.sessions[0]
          if (!latest) return
          const detail = await api<{ session: CheckySession; messages: CheckyMessage[] }>(`/checky/sessions/${latest.id}`)
          setSession(detail.session)
          setMessages(detail.messages)
          if (detail.messages.some((message) => message.role === 'CHECKY')) {
            const restoredReply = detail.messages.find((message) => message.role === 'CHECKY' && message.category === null)
            setStatus(restoredReply?.insufficientData ? 'insufficientData' : 'success')
          }
        } catch { /* la sección arranca en idle sin bloquear el diagnóstico */ }
        finally {
          setCheckyHydrated(true)
        }
      })()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [diagnostic.id])
  async function consult(options: { automatic?: boolean } = {}) {
    if (busy) return
    if (!options.automatic) autoConsultForDiagnostic.current = diagnostic.id
    setBusy(true)
    setError('')
    setStatus('loading')
    try {
      const created = await api<{ session: CheckySession }>(`/diagnostics/${diagnostic.id}/checky/sessions`, { method: 'POST', body: JSON.stringify({ title: 'Revisión de Checky' }) })
      setSession(created.session)
      const result = await api<{ reply: CheckyMessage; messages: CheckyMessage[] }>(`/checky/sessions/${created.session.id}/messages`, { method: 'POST', body: JSON.stringify({ content: checkyDefaultQuestion }) })
      setMessages(result.messages)
      setStatus(result.reply.insufficientData ? 'insufficientData' : 'success')
      // Checky genera la lectura estratégica del diagnóstico si no había ninguna, o si la que había
      // describe una versión anterior de la matriz DOFA, así que la pantalla de arriba tiene que
      // releerla en cuanto termina la consulta.
      await onConsulted()
    } catch (requestError) {
      setError(checkyErrorMessage(requestError))
      setStatus('error')
    } finally {
      setBusy(false)
    }
  }
  const consultRef = useRef(consult)
  consultRef.current = consult
  useEffect(() => {
    if (!checkyHydrated || analysisLoading || analysisError || busy) return
    if (analysis && !analysis.stale) return
    if (autoConsultForDiagnostic.current === diagnostic.id) return
    autoConsultForDiagnostic.current = diagnostic.id
    void consultRef.current({ automatic: true })
  }, [analysis, analysisError, analysisLoading, busy, checkyHydrated, diagnostic.id])
  async function decide(message: CheckyMessage, next: CheckySuggestionStatus) {
    if (!session || busy) return
    setBusy(true)
    setError('')
    try {
      // A missing cross is the only decision that materializes data, so it goes through its own
      // endpoint: the server creates the StrategicCross and only then marks the suggestion accepted.
      if (next === 'ACCEPTED' && message.category === 'MISSING_CROSSES') {
        const result = await api<{ suggestion: CheckyMessage; cross: StrategicCross }>(`/checky/suggestions/${message.id}/accept`, { method: 'POST' })
        setMessages((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item))
        setCrosses((current) => [result.cross, ...current.filter((item) => item.id !== result.cross.id)])
        await onCrossCreated()
        return
      }
      const result = await api<{ message: CheckyMessage }>(`/checky/sessions/${session.id}/messages/${message.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
      setMessages((current) => current.map((item) => item.id === result.message.id ? result.message : item))
    } catch (requestError) {
      setError(checkyErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }
  const factorCodes = useCheckyFactorCodes(items)
  const suggestions = messages.filter((message) => message.role === 'CHECKY' && message.category !== null)
  const groups = checkyCategoryOrder
    .map((category) => ({ category, visual: checkyCategoryVisuals[category], items: suggestions.filter((message) => message.category === category) }))
    .filter((group) => group.items.length > 0)
    .sort((left, right) => Number(right.category === 'MISSING_CROSSES') - Number(left.category === 'MISSING_CROSSES'))
  const hasResults = suggestions.length > 0
  const loading = status === 'loading'
  return (
    <section className="checky-panel" aria-busy={loading}>
      <header className="checky-head">
        <img className="checky-avatar" src={checkyImage} alt="Checky" />
        <div className="checky-headings">
          <h3>✨ Checky</h3>
          <p className="checky-role">Asistente estratégico</p>
          <p className="checky-intro">He revisado tus factores, cruces y estrategias para identificar aspectos que podrías considerar antes de avanzar.</p>
        </div>
        <button type="button" className="button primary checky-cta" onClick={() => void consult()} disabled={busy}>
          {loading ? <><span className="button-loader" />Analizando...</> : 'Analizar con Checky'}
        </button>
      </header>
      {loading && <div className="checky-loading"><span className="loader" />Checky está revisando tu análisis estratégico...</div>}
      {status === 'error' && <div className="form-error checky-error" role="alert">{error}</div>}
      {error && status !== 'error' && <div className="form-error checky-error" role="alert">{error}</div>}
      {!analysis && analysisLoading && <div className="diag-card ai-loading"><span className="loader" />Buscando análisis guardado...</div>}
      {analysisError && <div className="form-error" role="alert">{analysisError}</div>}
      {analysis?.stale && (
        <div className="form-error page-alert alert-retry" role="alert">
          <span>Esta lectura estratégica corresponde a una versión anterior de la matriz DOFA.</span>
          <button type="button" className="button secondary" onClick={() => void consult()}>Actualizar análisis con Checky →</button>
        </div>
      )}
      {analysis && (
        <section className="ai-analysis-panel">
          <AiDiagnosis summary={analysis.executiveSummary} text={analysis.diagnosis} items={items} />
          <AiFindings findings={analysis.keyFindings} />
        </section>
      )}
      {status === 'idle' && !hasResults && (
        <p className="checky-idle">Pulsa <strong>Analizar con Checky</strong> para que revise tu análisis estratégico completo. Checky solo analiza y propone: no crea cruces, planes ni tickets, salvo cuando aceptas una sugerencia de cruce potencial.</p>
      )}
      {hasResults && (
        <div className="checky-groups">
          {groups.map((group) => (
            <section className={`checky-group ${group.visual.tone}`} key={group.category}>
              <header className="checky-group-head">
                <span className="checky-group-icon" aria-hidden="true">{group.visual.icon}</span>
                <h4>{group.category === 'MISSING_CROSSES' ? 'Cruces y estrategias de Checky' : group.visual.label}</h4>
                <span className="checky-group-count">{group.items.length}</span>
              </header>
              <div className="checky-group-body">
                {group.items.map((finding) => {
                  const refs = checkyEvidenceRefs(finding.evidenceIds, items, crosses)
                  const onAccept = () => void decide(finding, 'ACCEPTED')
                  const onReject = () => void decide(finding, 'REJECTED')
                  return finding.category === 'MISSING_CROSSES'
                    ? <CheckyMissingCrossCard key={finding.id} finding={finding} refs={refs} byCode={factorCodes} status={finding.status ?? 'PENDING'} busy={busy} onAccept={onAccept} onReject={onReject} />
                    : <CheckyFindingCard key={finding.id} finding={finding} refs={refs} byCode={factorCodes} status={finding.status ?? 'PENDING'} busy={busy} onAccept={onAccept} onReject={onReject} />
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {hasResults && (
        <footer className="checky-legend">
          <span className="checky-legend-item"><CheckyBasisBadge basis="FACT" /></span>
          <span className="checky-legend-item"><CheckyBasisBadge basis="INFERENCE" /></span>
          <p>Las decisiones solo cambian el estado de la sugerencia. Checky no crea cruces, recomendaciones, planes ni tickets.</p>
        </footer>
      )}
    </section>
  )}

export default App

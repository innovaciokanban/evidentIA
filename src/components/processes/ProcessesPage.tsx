import { Fragment, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { KPICard } from '../ui/KPICard'
import { LoadingState } from '../ui/LoadingState'
import { AddProcessCard, ProcessCard, type ProcessCategory, type ProcessStatus } from './ProcessCard'
import { ProcessForm, type ProcessDraft, type ProcessUser } from './ProcessForm'
import { ArrowDownIcon, ArrowRightIcon, BriefcaseIcon, SupportIcon, TargetIcon } from './ProcessIcons'
import { api, ApiError } from '../../api'
import type { Company, Process, ProcessType, User } from '../../types'

const categoryOf: Record<ProcessType, ProcessCategory> = { STRATEGIC: 'estrategico', MISSIONAL: 'misional', SUPPORT: 'apoyo' }
const visualStatusOf: Record<Process['status'], ProcessStatus> = { ACTIVE: 'active', INACTIVE: 'paused' }

type ProcessBand = {
  key: ProcessCategory
  type: ProcessType
  title: string
  role: string
  description: string
  icon: ReactNode
}

const bands: ProcessBand[] = [
  { key: 'estrategico', type: 'STRATEGIC', title: 'Estratégicos', role: 'Dirección', description: 'Procesos que orientan y dirigen la organización.', icon: <TargetIcon size={17} /> },
  { key: 'misional', type: 'MISSIONAL', title: 'Misionales', role: 'Generación de valor', description: 'Procesos que generan valor directamente para el cliente.', icon: <BriefcaseIcon size={17} /> },
  { key: 'apoyo', type: 'SUPPORT', title: 'Apoyo', role: 'Soporte', description: 'Procesos que proporcionan recursos y soporte a la organización.', icon: <SupportIcon size={17} /> },
]

const emptyProcessDraft: ProcessDraft = {
  name: '',
  type: 'MISSIONAL',
  objective: '',
  description: '',
  code: '',
  responsibleId: '',
  companyId: '',
}

export function ProcessesPage({ user }: { user: User }) {
  const canCreate = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const [processes, setProcesses] = useState<Process[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [users, setUsers] = useState<ProcessUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<ProcessDraft>(emptyProcessDraft)

  const loadProcesses = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ processes: Process[] }>('/processes')
      setProcesses(result.processes)
    } catch {
      setLoadError('No pudimos cargar los procesos.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCompanies = useCallback(async () => {
    try {
      const result = await api<{ companies: Company[] }>('/companies')
      setCompanies(result.companies)
      setDraft((current) => ({ ...current, companyId: current.companyId || user.companyId || result.companies[0]?.id || '' }))
    } catch {
      // Sin empresas el formulario lo dirá al guardar; la lista de procesos sí se carga aparte.
    }
  }, [user.companyId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProcesses()
      void loadCompanies()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProcesses, loadCompanies])

  /** El directorio de usuarios solo hace falta al abrir el formulario. */
  async function ensureUsers() {
    if (users.length > 0) return
    try {
      const result = await api<{ users: ProcessUser[] }>('/users')
      setUsers(result.users)
    } catch {
      // El responsable es opcional: no se bloquea el alta por no poder listar usuarios.
    }
  }

  function startCreate(type: ProcessType = 'MISSIONAL') {
    if (!canCreate) return
    setFormError('')
    setDraft({ ...emptyProcessDraft, type, companyId: draft.companyId || user.companyId || companies[0]?.id || '' })
    setShowForm(true)
    void ensureUsers()
  }

  async function saveProcess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setFormError('')
    if (!draft.companyId) {
      setFormError('Selecciona una empresa para el proceso.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: draft.name,
        type: draft.type,
        objective: draft.objective,
        description: draft.description.trim() || undefined,
        code: draft.code.trim() || undefined,
        responsibleId: draft.responsibleId || null,
        companyId: draft.companyId,
      }
      const result = await api<{ process: Process }>('/processes', { method: 'POST', body: JSON.stringify(payload) })
      setProcesses((current) => [result.process, ...current])
      setShowForm(false)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el proceso.')
    } finally {
      setSaving(false)
    }
  }

  const grouped: Record<ProcessCategory, Process[]> = { estrategico: [], misional: [], apoyo: [] }
  for (const process of processes) grouped[categoryOf[process.type]].push(process)

  const summary = [
    { key: 'total', icon: '▤', label: 'Procesos', value: processes.length, tone: 'blue', hint: 'Total de procesos' },
    { key: 'estrategico', icon: '◈', label: 'Estratégicos', value: grouped.estrategico.length, tone: 'navy', hint: 'Procesos de dirección' },
    { key: 'misional', icon: '◉', label: 'Misionales', value: grouped.misional.length, tone: 'green', hint: 'Procesos que generan valor' },
    { key: 'apoyo', icon: '◇', label: 'Apoyo', value: grouped.apoyo.length, tone: 'slate', hint: 'Procesos de soporte' },
  ]

  return (
    <div className="page processes-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GESTIÓN DE CALIDAD</p>
          <h1>Gestión por procesos</h1>
          <p className="muted">Gestiona, caracteriza y mejora los procesos de tu organización.</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="button primary"
            disabled={!canCreate}
            onClick={() => startCreate()}
            title={canCreate ? undefined : 'Solo administradores pueden crear procesos.'}
          >
            + Nuevo proceso
          </button>
        </div>
      </div>

      <section className="metric-grid">
        {summary.map((item) => (
          <KPICard key={item.key} icon={item.icon} label={item.label} value={item.value} tone={item.tone} hint={item.hint} />
        ))}
      </section>

      {loadError && (
        <div className="form-error page-alert alert-retry" role="alert">
          <span>{loadError}</span>
          <button type="button" className="button secondary small-button" onClick={() => void loadProcesses()}>Reintentar</button>
        </div>
      )}

      <section className="panel process-map">
        <div className="panel-heading process-map-heading">
          <div>
            <p className="detail-label">MAPA DE PROCESOS</p>
            <h2>Visualiza cómo se estructura y relaciona la operación de la organización.</h2>
          </div>
        </div>
        {loading ? (
          <LoadingState text="Cargando procesos..." />
        ) : (
          <div className="process-map-body">
            {bands.map((band, index) => (
              <Fragment key={band.key}>
                <section className={`process-band ${band.key}`}>
                  <header className="process-band-head">
                    <span className="process-band-icon">{band.icon}</span>
                    <div className="process-band-copy">
                      <div className="process-band-title">
                        <h3>{band.title}</h3>
                        <span className="process-band-role">{band.role}</span>
                      </div>
                      <p>{band.description}</p>
                    </div>
                  </header>
                  <div className="process-band-flow">
                    {grouped[band.key].map((process, processIndex) => (
                      <Fragment key={process.id}>
                        {processIndex > 0 && <span className="process-arrow"><ArrowRightIcon size={16} /></span>}
                        <ProcessCard
                          name={process.name}
                          description={process.description || process.objective}
                          category={band.key}
                          indicators={0}
                          risks={0}
                          status={visualStatusOf[process.status]}
                          responsible={process.responsible?.name ?? null}
                        />
                      </Fragment>
                    ))}
                    <AddProcessCard
                      onClick={canCreate ? () => startCreate(band.type) : undefined}
                      disabled={!canCreate}
                      title={canCreate ? undefined : 'Solo administradores pueden crear procesos.'}
                    />
                  </div>
                </section>
                {index < bands.length - 1 && (
                  <div className="process-flow-link" aria-hidden="true">
                    <span className="process-flow-line" />
                    <span className="process-flow-arrow"><ArrowDownIcon size={15} /></span>
                    <span className="process-flow-line" />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <ProcessForm
          draft={draft}
          setDraft={setDraft}
          users={users}
          companies={companies}
          saving={saving}
          error={formError}
          onSubmit={(event) => void saveProcess(event)}
          onClose={() => { setShowForm(false); setFormError('') }}
        />
      )}
    </div>
  )
}

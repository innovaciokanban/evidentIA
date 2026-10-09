import { Fragment, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { KPICard } from '../ui/KPICard'
import { LoadingState } from '../ui/LoadingState'
import { AddProcessCard, ProcessCard, type ProcessCategory, type ProcessStatus } from './ProcessCard'
import { ProcessForm, type ProcessDraft, type ProcessUser } from './ProcessForm'
import { ProcessKpiPanel } from './ProcessKpiPanel'
import { ProcessRiskPanel } from './ProcessRiskPanel'
import { ArrowDownIcon, ArrowRightIcon, BriefcaseIcon, SupportIcon, TargetIcon } from './ProcessIcons'
import { api, ApiError } from '../../api'
import type { Company, Process, ProcessType, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'

export const categoryOf: Record<ProcessType, ProcessCategory> = { STRATEGIC: 'estrategico', MISSIONAL: 'misional', SUPPORT: 'apoyo' }
const visualStatusOf: Record<Process['status'], ProcessStatus> = { ACTIVE: 'active', INACTIVE: 'paused' }

export function groupProcesses(processes: Process[]): Record<ProcessCategory, Process[]> {
  const grouped: Record<ProcessCategory, Process[]> = { estrategico: [], misional: [], apoyo: [] }
  for (const process of processes) grouped[categoryOf[process.type]].push(process)
  return grouped
}

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
  version: '1.0',
  frequency: '',
  organizationalArea: '',
  supervision: '',
  executionType: '',
  status: 'ACTIVE',
  updatedAt: null,
  thirdPartyProvided: false,
  critical: false,
  affectsAccounting: false,
  personalData: false,
}

const draftFromProcess = (process: Process): ProcessDraft => ({
  name: process.name,
  type: process.type,
  objective: process.objective,
  description: process.description ?? '',
  code: process.code ?? '',
  responsibleId: process.responsible?.id ?? '',
  companyId: process.companyId,
  version: process.version ?? '',
  frequency: process.frequency ?? '',
  organizationalArea: process.organizationalArea ?? '',
  supervision: process.supervision ?? '',
  executionType: process.executionType ?? '',
  status: process.status,
  updatedAt: process.updatedAt,
  thirdPartyProvided: process.thirdPartyProvided,
  critical: process.critical,
  affectsAccounting: process.affectsAccounting,
  personalData: process.personalData,
})

export function ProcessesPage({ user }: { user: User }) {
  const canCreate = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const [processes, setProcesses] = useState<Process[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [users, setUsers] = useState<ProcessUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showKpis, setShowKpis] = useState(false)
  const [showRisks, setShowRisks] = useState(false)
  const [editing, setEditing] = useState<Process | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [draft, setDraft] = useState<ProcessDraft>(emptyProcessDraft)

  const loadProcesses = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ processes: Process[] }>('/processes')
      setProcesses(result.processes)
      return true
    } catch (requestError) {
      console.error('[processes] failed to load processes', requestError)
      setLoadError('No pudimos cargar los procesos.')
      return false
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

  function startCreate(type: ProcessType) {
    if (!canCreate) return
    setFormError('')
    setNotice('')
    setEditing(null)
    setReadOnly(false)
    setShowKpis(false)
    setShowRisks(false)
    setDraft({ ...emptyProcessDraft, type, companyId: draft.companyId || user.companyId || companies[0]?.id || '' })
    setShowForm(true)
    void ensureUsers()
  }

  function startEdit(process: Process) {
    if (!canCreate) return
    setFormError('')
    setNotice('')
    setEditing(process)
    setReadOnly(false)
    setShowKpis(false)
    setShowRisks(false)
    setDraft(draftFromProcess(process))
    setShowForm(true)
    void ensureUsers()
  }

  function openProcess(process: Process) {
    if (canCreate) {
      startEdit(process)
      return
    }
    setFormError('')
    setNotice('')
    setEditing(process)
    setReadOnly(true)
    setDraft(draftFromProcess(process))
    setShowForm(true)
  }

  function openKpis(process: Process) {
    setFormError('')
    setNotice('')
    setEditing(process)
    setShowForm(false)
    setShowKpis(true)
    setShowRisks(false)
  }

  function openRisks(process: Process) {
    setFormError('')
    setNotice('')
    setEditing(process)
    setShowForm(false)
    setShowKpis(false)
    setShowRisks(true)
  }

  function returnToCharacterization() {
    setShowKpis(false)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setShowKpis(false)
    setShowRisks(false)
    setEditing(null)
    setReadOnly(false)
    setFormError('')
  }

  async function saveProcess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setFormError('')
    setNotice('')
    if (!draft.companyId) {
      setFormError('Selecciona una empresa para el proceso.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: draft.name,
        objective: draft.objective,
        description: draft.description.trim() || null,
        responsibleId: draft.responsibleId || null,
        version: draft.version.trim() || null,
        frequency: draft.frequency.trim() || null,
        organizationalArea: draft.organizationalArea.trim() || null,
        supervision: draft.supervision.trim() || null,
        executionType: draft.executionType.trim() || null,
        status: draft.status,
        thirdPartyProvided: draft.thirdPartyProvided,
        critical: draft.critical,
        affectsAccounting: draft.affectsAccounting,
        personalData: draft.personalData,
      }
      const wasEditing = Boolean(editing)
      let savedProcess: Process
      if (editing) {
        const result = await api<{ process: Process }>(`/processes/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        savedProcess = result.process
      } else {
        const result = await api<{ process: Process }>('/processes', { method: 'POST', body: JSON.stringify({ ...payload, type: draft.type, category: categoryOf[draft.type], companyId: draft.companyId }) })
        savedProcess = result.process
      }
      if (wasEditing) {
        closeForm()
      } else {
        // Keep the new process open after its first save so SIPOC can use its real processId.
        setEditing(savedProcess)
        setReadOnly(false)
        setDraft(draftFromProcess(savedProcess))
        setShowForm(true)
        void ensureUsers()
      }
      const reloaded = await loadProcesses()
      setNotice(reloaded ? `Proceso ${wasEditing ? 'actualizado' : 'creado'} correctamente.` : 'El proceso se guardó, pero no pudimos actualizar el mapa.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el proceso.')
    } finally {
      setSaving(false)
    }
  }

  async function removeProcess(process: Process) {
    if (!canCreate) return
    const confirmed = await askConfirm({ title: 'Eliminar proceso', message: `Se eliminará «${process.name}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    setNotice('')
    try {
      await api(`/processes/${process.id}`, { method: 'DELETE' })
      const reloaded = await loadProcesses()
      setNotice(reloaded ? 'Proceso eliminado correctamente.' : 'El proceso se eliminó, pero no pudimos actualizar el mapa.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el proceso.')
    }
  }

  const grouped = groupProcesses(processes)

  const summary = [
    { key: 'total', icon: '▤', label: 'Procesos', value: processes.length, tone: 'blue', hint: 'Total de procesos' },
    { key: 'estrategico', icon: '◈', label: 'Estratégicos', value: grouped.estrategico.length, tone: 'navy', hint: 'Procesos de dirección' },
    { key: 'misional', icon: '◉', label: 'Misionales', value: grouped.misional.length, tone: 'green', hint: 'Procesos que generan valor' },
    { key: 'apoyo', icon: '◇', label: 'Apoyo', value: grouped.apoyo.length, tone: 'slate', hint: 'Procesos de soporte' },
  ]

  return (
    <div className="page processes-page">
       {!showKpis && !showRisks && <div className="page-heading">
         <div>
           <p className="eyebrow">GESTIÓN DE CALIDAD</p>
           <h1>Gestión por procesos</h1>
           <p className="muted">Gestiona, caracteriza y mejora los procesos de tu organización.</p>
         </div>
        </div>}

        {notice && !showForm && !showKpis && !showRisks && <div className="form-success page-alert" role="status">{notice}</div>}
        {showRisks && editing ? (
          <ProcessRiskPanel process={editing} canWrite={canCreate} onBack={() => { setShowRisks(false); setShowForm(true) }} />
        ) : showKpis && editing ? (
          <ProcessKpiPanel process={editing} users={users} canWrite={canCreate} onBack={returnToCharacterization} />
        ) : showForm ? (
          <ProcessForm
           draft={draft}
           setDraft={setDraft}
           users={users}
           companies={companies}
           editing={Boolean(editing)}
           readOnly={readOnly}
            saving={saving}
            error={formError}
            onSubmit={(event) => void saveProcess(event)}
            onClose={closeForm}
            onOpenKpis={editing ? () => openKpis(editing) : undefined}
            onOpenRisks={editing ? () => openRisks(editing) : undefined}
            processId={editing?.id}
         />
       ) : <>
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
                          code={process.code}
                          objective={process.objective}
                          description={process.description || ''}
                          category={band.key}
                          status={visualStatusOf[process.status]}
                          responsible={process.responsible?.name ?? null}
                          onOpen={() => openProcess(process)}
                          onDelete={canCreate ? () => void removeProcess(process) : undefined}
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
       </>}
    </div>
  )
}

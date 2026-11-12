import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { Company, ProcessKpi, ProcessState, ProcessType, User } from '../../types'
import { activeUserOptions, userOptionLabel } from '../../user-status'
import { ProcessSipocSection } from './ProcessSipocSection'
import { EmbeddedKpiSection, type EmbeddedKpiEntry } from './EmbeddedKpiSection'
import type { KpiUser } from './process-kpi.model'

export type ProcessDraft = {
  name: string
  type: ProcessType
  objective: string
  description: string
  code: string
  responsibleId: string
  companyId: string
  version: string
  frequency: string
  organizationalArea: string
  supervision: string
  executionType: string
  status: ProcessState
  updatedAt: string | null
  thirdPartyProvided: boolean
  critical: boolean
  affectsAccounting: boolean
  personalData: boolean
  kpis?: EmbeddedKpiEntry[]
  kpiUnlinkIds?: string[]
}

const processTypeOptions: { value: ProcessType; label: string }[] = [
  { value: 'STRATEGIC', label: 'Estratégico' },
  { value: 'MISSIONAL', label: 'Misional' },
  { value: 'SUPPORT', label: 'Apoyo' },
]

const frequencyOptions = ['Diaria', 'Semanal', 'Mensual', 'Trimestral', 'Semestral', 'Anual', 'Eventual']
const executionTypeOptions = ['Interna', 'Externa', 'Mixta']

export type ProcessUser = Pick<User, 'id' | 'name' | 'isActive'> & { companyId: string | null }

type ProcessFormProps = {
  draft: ProcessDraft
  setDraft: Dispatch<SetStateAction<ProcessDraft>>
  users: ProcessUser[]
  historicalResponsible?: ProcessUser | null
  companies: Company[]
  editing: boolean
  readOnly: boolean
  saving: boolean
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onOpenKpis?: () => void
  onOpenRisks?: () => void
  onOpenChangeHistory?: () => void
  onOpenProcedures?: () => void
  processId?: string
  availableKpis?: ProcessKpi[]
  onCompanyChange?: (companyId: string) => void
}

const dateLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value))
  : 'Se asignará al guardar'

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return (
    <button type="button" className={`characterization-toggle ${value ? 'active' : ''}`} role="switch" aria-checked={value} onClick={onChange}>
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span className="toggle-label">{label}</span>
      <strong>{value ? 'Activo' : 'Inactivo'}</strong>
    </button>
  )
}

export function ProcessForm({ draft, setDraft, users, historicalResponsible, companies, editing, readOnly, saving, error, onSubmit, onClose, onOpenKpis, onOpenRisks, onOpenChangeHistory, onOpenProcedures, processId, availableKpis = [], onCompanyChange }: ProcessFormProps) {
  // El servidor vuelve a validar esta relación; aquí evitamos ofrecer responsables de otra empresa.
  const availableUsers = activeUserOptions(users.filter((user) => !draft.companyId || user.companyId === draft.companyId), historicalResponsible ? [historicalResponsible] : [])
  const selectedCompany = companies.find((company) => company.id === draft.companyId)
  const update = <K extends keyof ProcessDraft>(field: K, value: ProcessDraft[K]) => setDraft((current) => ({ ...current, [field]: value }))

  return (
    <form className="process-characterization panel" onSubmit={onSubmit}>
      <header className="characterization-header">
        <div className="characterization-heading">
          <span className="characterization-mark">▤</span>
          <div>
            <p className="eyebrow">GESTIÓN POR PROCESOS</p>
            <h2>{readOnly ? 'VER PROCESO' : editing ? 'EDITAR PROCESO' : 'NUEVO PROCESO'}</h2>
            <p>Completa la ficha para documentar cómo opera este proceso en la organización.</p>
          </div>
        </div>
        <div className="characterization-actions">
          <button type="button" className="button secondary" onClick={onClose}>{readOnly ? 'Volver al mapa' : 'Cancelar'}</button>
          {!readOnly && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar proceso'}</button>}
        </div>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      {editing && (
        <section className="characterization-section process-modules-section">
          <div className="characterization-section-heading">
            <div><p className="detail-label">TRAZABILIDAD Y CONTROL</p><h3>MÓDULOS DEL PROCESO</h3></div>
            <span className="characterization-helper">Selecciona un módulo para continuar</span>
          </div>
          <div className="process-module-grid">
            <button type="button" className="process-module-card interactive" onClick={onOpenProcedures} disabled={!onOpenProcedures}><span className="process-module-icon">▤</span><span><strong>Procedimiento</strong><small>Documentación operativa</small></span><span className="process-module-arrow">→</span></button>
            <button type="button" className="process-module-card interactive" onClick={onOpenKpis} disabled={!onOpenKpis}><span className="process-module-icon">◫</span><span><strong>KPI</strong><small>Indicadores del proceso</small></span><span className="process-module-arrow">→</span></button>
            <button type="button" className="process-module-card interactive" onClick={onOpenRisks} disabled={!onOpenRisks}><span className="process-module-icon">!</span><span><strong>Riesgos</strong><small>Identificación y control</small></span><span className="process-module-arrow">→</span></button>
            <button type="button" className="process-module-card interactive" onClick={onOpenChangeHistory} disabled={!onOpenChangeHistory}><span className="process-module-icon">↺</span><span><strong>Control de cambios</strong><small>Historial y trazabilidad</small></span><span className="process-module-arrow">→</span></button>
          </div>
        </section>
      )}

      <fieldset disabled={readOnly} className="characterization-fields">
      <section className="characterization-section">
        <div className="characterization-section-heading">
          <div><p className="detail-label">FICHA PRINCIPAL</p><h3>CARACTERIZACIÓN DEL PROCESO</h3></div>
          <span className={`characterization-status ${draft.status.toLowerCase()}`}>{draft.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</span>
        </div>
      </section>

      <section className="characterization-section objective-section">
        <div className="characterization-section-heading"><div><p className="detail-label">PROPÓSITO Y ALCANCE</p><h3>OBJETIVO / DESCRIPCIÓN</h3></div></div>
        <div className="characterization-copy-grid">
          <label>Objetivo<textarea value={draft.objective} onChange={(event) => update('objective', event.target.value)} placeholder="¿Qué logra este proceso?" rows={5} minLength={3} maxLength={2000} required /></label>
          <label>Descripción<textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Alcance, entradas o consideraciones del proceso..." rows={5} maxLength={5000} /></label>
        </div>
      </section>

      <section className="characterization-section">
        <div className="characterization-grid">
          <div className="characterization-field"><span>Fecha actualización</span><strong>{dateLabel(draft.updatedAt)}</strong></div>
          <div className="characterization-field"><span>Versión</span><strong>{draft.version || 'Sin versión'}</strong></div>
          {companies.length > 1 ? (
            <label>Empresa<select value={draft.companyId} onChange={(event) => { setDraft({ ...draft, companyId: event.target.value, responsibleId: '' }); onCompanyChange?.(event.target.value) }} required>
              <option value="">Selecciona una entidad</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select></label>
          ) : (
            <div className="characterization-field"><span>Empresa</span><strong>{selectedCompany?.name ?? 'Sin entidad disponible'}</strong></div>
          )}
          <div className="characterization-field"><span>Tipo de proceso</span><strong>{processTypeOptions.find((option) => option.value === draft.type)?.label ?? draft.type}</strong></div>

          <label>Frecuencia<select value={draft.frequency} onChange={(event) => update('frequency', event.target.value)}><option value="">Selecciona una frecuencia</option>{frequencyOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>Área del organigrama<input value={draft.organizationalArea} onChange={(event) => update('organizationalArea', event.target.value)} placeholder="Ej. Operaciones" maxLength={120} /></label>

          <label>Supervisión<input value={draft.supervision} onChange={(event) => update('supervision', event.target.value)} placeholder="Área o cargo supervisor" maxLength={120} /></label>
            <label>Responsable<select value={draft.responsibleId} onChange={(event) => update('responsibleId', event.target.value)}><option value="">Sin asignar</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>)}</select></label>
          <label>Tipo de ejecución<select value={draft.executionType} onChange={(event) => update('executionType', event.target.value)}><option value="">Selecciona un tipo</option>{executionTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>

          <label>Nombre del proceso<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Gestión Comercial" minLength={3} required /></label>
          <div className="characterization-field"><span>Código</span><strong>{draft.code || 'Se asignará automáticamente'}</strong></div>
          <label>Estado<select value={draft.status} onChange={(event) => update('status', event.target.value as ProcessState)}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></label>
        </div>
      </section>

       <section className="characterization-section attributes-section">
        <div className="characterization-section-heading"><div><p className="detail-label">CONTROL Y RIESGO</p><h3>ATRIBUTOS</h3></div><span className="characterization-helper">Selecciona los que apliquen</span></div>
        <div className="characterization-toggle-grid">
          <ToggleField label="Provisto por tercero" value={draft.thirdPartyProvided} onChange={() => update('thirdPartyProvided', !draft.thirdPartyProvided)} />
          <ToggleField label="Proceso crítico" value={draft.critical} onChange={() => update('critical', !draft.critical)} />
          <ToggleField label="Afecta contabilidad" value={draft.affectsAccounting} onChange={() => update('affectsAccounting', !draft.affectsAccounting)} />
          <ToggleField label="Datos personales" value={draft.personalData} onChange={() => update('personalData', !draft.personalData)} />
        </div>
        </section>
         <EmbeddedKpiSection entries={draft.kpis ?? []} setEntries={(next) => setDraft((current) => ({ ...current, kpis: typeof next === 'function' ? next(current.kpis ?? []) : next }))} users={users as KpiUser[]} availableKpis={availableKpis} allowUnlinkExisting onLinkExisting={(id) => setDraft((current) => ({ ...current, kpiUnlinkIds: (current.kpiUnlinkIds ?? []).filter((item) => item !== id) }))} onUnlinkExisting={(id) => setDraft((current) => ({ ...current, kpiUnlinkIds: Array.from(new Set([...(current.kpiUnlinkIds ?? []), id])) }))} readOnly={readOnly} title="Indicadores KPI" description="Crea KPI nuevos o vincula indicadores existentes de la empresa." />
       </fieldset>

       <ProcessSipocSection processId={processId} readOnly={readOnly} />

      <footer className="characterization-footer">
        <button type="button" className="button secondary" onClick={onClose}>{readOnly ? 'Volver al mapa' : 'Cancelar / volver al listado'}</button>
        {!readOnly && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar proceso'}</button>}
      </footer>
    </form>
  )
}

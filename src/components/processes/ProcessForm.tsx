import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { Company, ProcessState, ProcessType, User } from '../../types'
import { ProcessSipocSection } from './ProcessSipocSection'

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
  executionLevel: string
  organizationalArea: string
  businessLine: string
  supervision: string
  deliveryMethod: string
  executionType: string
  status: ProcessState
  updatedAt: string | null
  thirdPartyProvided: boolean
  critical: boolean
  cashMovement: boolean
  contingencyPlan: boolean
  taxOperations: boolean
  affectsAccounting: boolean
  personalData: boolean
}

const processTypeOptions: { value: ProcessType; label: string }[] = [
  { value: 'STRATEGIC', label: 'Estratégico' },
  { value: 'MISSIONAL', label: 'Misional' },
  { value: 'SUPPORT', label: 'Apoyo' },
]

const frequencyOptions = ['Diaria', 'Semanal', 'Mensual', 'Trimestral', 'Semestral', 'Anual', 'Eventual']
const executionLevelOptions = ['Estratégico', 'Táctico', 'Operativo']
const executionTypeOptions = ['Interna', 'Externa', 'Mixta']

export type ProcessUser = Pick<User, 'id' | 'name'> & { companyId: string | null }

type ProcessFormProps = {
  draft: ProcessDraft
  setDraft: Dispatch<SetStateAction<ProcessDraft>>
  users: ProcessUser[]
  companies: Company[]
  editing: boolean
  readOnly: boolean
  saving: boolean
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onOpenKpis?: () => void
  onOpenRisks?: () => void
  processId?: string
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

export function ProcessForm({ draft, setDraft, users, companies, editing, readOnly, saving, error, onSubmit, onClose, onOpenKpis, onOpenRisks, processId }: ProcessFormProps) {
  // El servidor vuelve a validar esta relación; aquí evitamos ofrecer responsables de otra empresa.
  const availableUsers = users.filter((user) => !draft.companyId || user.companyId === draft.companyId)
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
            <button type="button" className="process-module-card" disabled title="Este módulo estará disponible próximamente."><span className="process-module-icon">▤</span><span><strong>Procedimiento</strong><small>Documentación operativa</small></span></button>
            <button type="button" className="process-module-card interactive" onClick={onOpenKpis} disabled={!onOpenKpis}><span className="process-module-icon">◫</span><span><strong>KPI</strong><small>Indicadores del proceso</small></span><span className="process-module-arrow">→</span></button>
            <button type="button" className="process-module-card interactive" onClick={onOpenRisks} disabled={!onOpenRisks}><span className="process-module-icon">!</span><span><strong>Riesgos</strong><small>Identificación y control</small></span><span className="process-module-arrow">→</span></button>
            <button type="button" className="process-module-card" disabled title="Este módulo estará disponible próximamente."><span className="process-module-icon">◌</span><span><strong>Auditoría</strong><small>Seguimiento y evidencia</small></span></button>
            <button type="button" className="process-module-card" disabled title="Este módulo estará disponible próximamente."><span className="process-module-icon">◇</span><span><strong>Valor</strong><small>Entrega al cliente</small></span></button>
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
          <label>Versión<input value={draft.version} onChange={(event) => update('version', event.target.value)} placeholder="Ej. 1.0" maxLength={120} /></label>
          {companies.length > 1 ? (
            <label>Entidad<select value={draft.companyId} onChange={(event) => setDraft({ ...draft, companyId: event.target.value, responsibleId: '' })} required>
              <option value="">Selecciona una entidad</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select></label>
          ) : (
            <div className="characterization-field"><span>Entidad</span><strong>{selectedCompany?.name ?? 'Sin entidad disponible'}</strong></div>
          )}
          <label>Tipo de proceso<select value={draft.type} onChange={(event) => update('type', event.target.value as ProcessType)}>{processTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>

          <label>Frecuencia<select value={draft.frequency} onChange={(event) => update('frequency', event.target.value)}><option value="">Selecciona una frecuencia</option>{frequencyOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>Nivel de ejecución<select value={draft.executionLevel} onChange={(event) => update('executionLevel', event.target.value)}><option value="">Selecciona un nivel</option>{executionLevelOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>Área del organigrama<input value={draft.organizationalArea} onChange={(event) => update('organizationalArea', event.target.value)} placeholder="Ej. Operaciones" maxLength={120} /></label>
          <label>Línea de negocio<input value={draft.businessLine} onChange={(event) => update('businessLine', event.target.value)} placeholder="Ej. Servicios profesionales" maxLength={120} /></label>

          <label>Supervisión<input value={draft.supervision} onChange={(event) => update('supervision', event.target.value)} placeholder="Área o cargo supervisor" maxLength={120} /></label>
          <label>Responsable<select value={draft.responsibleId} onChange={(event) => update('responsibleId', event.target.value)}><option value="">Sin asignar</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label>Medio de entrega<input value={draft.deliveryMethod} onChange={(event) => update('deliveryMethod', event.target.value)} placeholder="Ej. Plataforma interna" maxLength={120} /></label>
          <label>Tipo de ejecución<select value={draft.executionType} onChange={(event) => update('executionType', event.target.value)}><option value="">Selecciona un tipo</option>{executionTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>

          <label>Nombre del proceso<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Gestión Comercial" minLength={3} required /></label>
          <label>Código<input value={draft.code} onChange={(event) => update('code', event.target.value)} placeholder="Ej. PROC-01" maxLength={40} /></label>
          <label>Estado<select value={draft.status} onChange={(event) => update('status', event.target.value as ProcessState)}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></label>
        </div>
      </section>

      <section className="characterization-section attributes-section">
        <div className="characterization-section-heading"><div><p className="detail-label">CONTROL Y RIESGO</p><h3>ATRIBUTOS</h3></div><span className="characterization-helper">Selecciona los que apliquen</span></div>
        <div className="characterization-toggle-grid">
          <ToggleField label="Provisto por tercero" value={draft.thirdPartyProvided} onChange={() => update('thirdPartyProvided', !draft.thirdPartyProvided)} />
          <ToggleField label="Proceso crítico" value={draft.critical} onChange={() => update('critical', !draft.critical)} />
          <ToggleField label="Mov. efectivo" value={draft.cashMovement} onChange={() => update('cashMovement', !draft.cashMovement)} />
          <ToggleField label="Plan contingencia" value={draft.contingencyPlan} onChange={() => update('contingencyPlan', !draft.contingencyPlan)} />
          <ToggleField label="Op. tributarias" value={draft.taxOperations} onChange={() => update('taxOperations', !draft.taxOperations)} />
          <ToggleField label="Afecta contabilidad" value={draft.affectsAccounting} onChange={() => update('affectsAccounting', !draft.affectsAccounting)} />
          <ToggleField label="Datos personales" value={draft.personalData} onChange={() => update('personalData', !draft.personalData)} />
        </div>
       </section>
       </fieldset>

      <ProcessSipocSection processId={processId} readOnly={readOnly} />

      <footer className="characterization-footer">
        <button type="button" className="button secondary" onClick={onClose}>{readOnly ? 'Volver al mapa' : 'Cancelar / volver al listado'}</button>
        {!readOnly && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar proceso'}</button>}
      </footer>
    </form>
  )
}

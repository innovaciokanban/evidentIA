import type { Company, ProcessType, User } from '../../types'

export type ProcessDraft = {
  name: string
  type: ProcessType
  objective: string
  description: string
  code: string
  responsibleId: string
  companyId: string
}

const processTypeOptions: { value: ProcessType; label: string }[] = [
  { value: 'STRATEGIC', label: 'Estratégico' },
  { value: 'MISSIONAL', label: 'Misional' },
  { value: 'SUPPORT', label: 'Apoyo' },
]

export type ProcessUser = Pick<User, 'id' | 'name'> & { companyId: string | null }

type ProcessFormProps = {
  draft: ProcessDraft
  setDraft: React.Dispatch<React.SetStateAction<ProcessDraft>>
  users: ProcessUser[]
  companies: Company[]
  saving: boolean
  error: string
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export function ProcessForm({ draft, setDraft, users, companies, saving, error, onSubmit, onClose }: ProcessFormProps) {
  // Solo se muestran usuarios de la empresa que va a recibir el proceso: el servidor también lo
  // comprueba, pero así no se ofrece una opción que terminaría en un error.
  const availableUsers = users.filter((user) => !draft.companyId || user.companyId === draft.companyId)
  return (
    <div className="drawer-backdrop centered-backdrop">
      <form className="drawer centered-modal company-modal" onSubmit={onSubmit}>
        <div className="company-modal-header">
          <div className="company-modal-icon">▤</div>
          <div className="company-modal-title">
            <p className="eyebrow">GESTIÓN DE PROCESOS</p>
            <h2>Crear proceso</h2>
            <p className="company-modal-subtitle">Registra un proceso de la organización para ubicarlo en el mapa</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {companies.length > 1 && (
          <label>Empresa<select value={draft.companyId} onChange={(event) => setDraft({ ...draft, companyId: event.target.value, responsibleId: '' })} required>
            <option value="">Selecciona una empresa</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select></label>
        )}
        <label>Nombre del proceso<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Gestión Comercial" minLength={3} required /></label>
        <div className="form-grid">
          <label>Tipo<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ProcessType })}>
            {processTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <label>Código<input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="Opcional. Ej. PROC-01" maxLength={40} /></label>
        </div>
        <label>Responsable<select value={draft.responsibleId} onChange={(event) => setDraft({ ...draft, responsibleId: event.target.value })}>
          <option value="">Sin asignar</option>
          {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select></label>
        <label>Objetivo<textarea value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} placeholder="¿Qué logra este proceso?" rows={4} minLength={3} required /></label>
        <label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Alcance, entradas o consideraciones del proceso..." rows={3} maxLength={5000} /></label>
        <div className="drawer-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  )
}

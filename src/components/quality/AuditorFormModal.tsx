import type { FormEvent } from 'react'
import type { Company } from '../../types'
import type { AuditorDraft } from './auditor.model'
import { auditorStatusOptions, auditorTypeOptions } from './auditor.model'

type AuditorFormModalProps = {
  draft: AuditorDraft
  editing: boolean
  companies: Company[]
  superuser: boolean
  saving: boolean
  error: string
  onChange: (field: keyof AuditorDraft, value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export function AuditorFormModal({ draft, editing, companies, superuser, saving, error, onChange, onSubmit, onClose }: AuditorFormModalProps) {
  return <div className="drawer-backdrop centered-backdrop">
    <form className="drawer centered-modal company-modal auditor-modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="auditor-modal-title">
      <header className="company-modal-header">
        <div className="company-modal-icon auditor-modal-icon">◎</div>
        <div className="company-modal-title"><p className="eyebrow">BANCO DE AUDITORES</p><h2 id="auditor-modal-title">{editing ? 'Editar auditor' : 'Nuevo auditor'}</h2><p className="company-modal-subtitle">Registra un perfil reutilizable sin vincularlo todavía a una auditoría.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar modal">×</button>
      </header>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="auditor-modal-body">
        {superuser && <label>Empresa *<select value={draft.companyId} onChange={(event) => onChange('companyId', event.target.value)} required disabled={editing}><option value="">Selecciona una empresa</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
        <div className="auditor-form-grid">
          <label>Nombre completo *<input value={draft.name} onChange={(event) => onChange('name', event.target.value)} minLength={2} maxLength={160} required placeholder="Ej. Ana María Torres" /></label>
          <label>Correo electrónico *<input type="email" value={draft.email} onChange={(event) => onChange('email', event.target.value)} maxLength={320} required placeholder="ana.torres@empresa.com" /></label>
          <label>Teléfono<input value={draft.phone} onChange={(event) => onChange('phone', event.target.value)} maxLength={40} placeholder="Opcional" /></label>
          <label>Tipo de auditor *<select value={draft.type} onChange={(event) => onChange('type', event.target.value)} required>{auditorTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Cargo<input value={draft.position} onChange={(event) => onChange('position', event.target.value)} maxLength={160} placeholder="Ej. Líder de calidad" /></label>
          <label>Organización de procedencia<input value={draft.organization} onChange={(event) => onChange('organization', event.target.value)} maxLength={200} placeholder="Empresa o independiente" /></label>
          <label>Estado<select value={draft.status} onChange={(event) => onChange('status', event.target.value)}>{auditorStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <label>Experiencia profesional<textarea value={draft.experience} onChange={(event) => onChange('experience', event.target.value)} maxLength={5000} rows={4} placeholder="Normas, sectores o años de experiencia relevantes." /></label>
        <label>Observaciones<textarea value={draft.observations} onChange={(event) => onChange('observations', event.target.value)} maxLength={5000} rows={3} placeholder="Información útil para la coordinación." /></label>
      </div>
      <footer className="drawer-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear auditor'}</button></footer>
    </form>
  </div>
}

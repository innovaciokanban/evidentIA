import type { FormEvent } from 'react'

export type AuditorCompetencyDraft = { name: string; level: string; evidence: string }

type AuditorCompetencyFormProps = {
  draft: AuditorCompetencyDraft
  editing: boolean
  saving: boolean
  error: string
  onChange: (field: keyof AuditorCompetencyDraft, value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export function AuditorCompetencyForm({ draft, editing, saving, error, onChange, onSubmit, onClose }: AuditorCompetencyFormProps) {
  return <div className="drawer-backdrop centered-backdrop">
    <form className="drawer centered-modal company-modal auditor-competency-modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="auditor-competency-modal-title">
      <header className="company-modal-header"><div className="company-modal-icon auditor-modal-icon">✦</div><div className="company-modal-title"><p className="eyebrow">COMPETENCIA PROFESIONAL</p><h2 id="auditor-competency-modal-title">{editing ? 'Editar competencia' : 'Añadir competencia'}</h2><p className="company-modal-subtitle">Escribe una norma, especialidad o área de conocimiento libremente.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar modal">×</button></header>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="auditor-competency-form-body"><label>Competencia *<input value={draft.name} onChange={(event) => onChange('name', event.target.value)} minLength={2} maxLength={160} required placeholder="Ej. ISO 9001, auditoría financiera o riesgos" /></label><label>Nivel de dominio *<select value={draft.level} onChange={(event) => onChange('level', event.target.value)} required>{[1, 2, 3, 4, 5].map((level) => <option value={level} key={level}>{level} · {level === 1 ? 'Inicial' : level === 2 ? 'Básico' : level === 3 ? 'Competente' : level === 4 ? 'Avanzado' : 'Experto'}</option>)}</select></label><label>Evidencia o experiencia<textarea value={draft.evidence} onChange={(event) => onChange('evidence', event.target.value)} maxLength={5000} rows={4} placeholder="Certificación, años de experiencia o referencias relevantes." /></label></div>
      <footer className="drawer-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Añadir competencia'}</button></footer>
    </form>
  </div>
}

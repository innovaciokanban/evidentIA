import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuditIndependenceStatus, AuditTeamMember } from '../../types'
import { independenceStatusLabels } from './audit-team.model'

type AuditIndependenceFormProps = {
  member: AuditTeamMember
  saving: boolean
  error: string
  onSubmit: (payload: { status: AuditIndependenceStatus; declaration: string | null; conflictDescription: string | null; mitigationMeasures: string | null }) => void
  onClose: () => void
}

export function AuditIndependenceForm({ member, saving, error, onSubmit, onClose }: AuditIndependenceFormProps) {
  const [status, setStatus] = useState<AuditIndependenceStatus>(member.independenceStatus)
  const [declaration, setDeclaration] = useState(member.independenceDeclaration ?? '')
  const [conflictDescription, setConflictDescription] = useState(member.conflictDescription ?? '')
  const [mitigationMeasures, setMitigationMeasures] = useState(member.mitigationMeasures ?? '')
  const requiresDeclaration = status !== 'PENDING'
  const requiresConflict = status === 'CONFLICT' || status === 'MITIGATED'
  const requiresMitigation = status === 'MITIGATED'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    onSubmit({
      status,
      declaration: declaration.trim() || null,
      conflictDescription: conflictDescription.trim() || null,
      mitigationMeasures: mitigationMeasures.trim() || null,
    })
  }

  return (
    <div className="drawer-backdrop centered-backdrop">
      <form className="drawer centered-modal company-modal audit-team-independence-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="audit-independence-title">
        <header className="company-modal-header">
          <div>
            <p className="detail-label">INDEPENDENCIA</p>
            <h2 id="audit-independence-title">Evaluar a {member.auditor.name}</h2>
            <p className="muted">La evaluación no se deduce del tipo de auditor. Registra la decisión y su sustento.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Cerrar evaluación">×</button>
        </header>
        <div className="audit-independence-form">
          <label>Estado de independencia
            <select value={status} onChange={(event) => setStatus(event.target.value as AuditIndependenceStatus)} disabled={saving}>
              {Object.entries(independenceStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Declaración o evaluación
            <textarea value={declaration} onChange={(event) => setDeclaration(event.target.value)} maxLength={5000} rows={3} required={requiresDeclaration} disabled={saving} placeholder="Describe la revisión realizada y la conclusión." />
          </label>
          <label>Descripción del conflicto{requiresConflict ? ' *' : ''}
            <textarea value={conflictDescription} onChange={(event) => setConflictDescription(event.target.value)} maxLength={5000} rows={3} required={requiresConflict} disabled={saving} placeholder="Documenta el conflicto, si existe." />
          </label>
          <label>Medidas de mitigación{requiresMitigation ? ' *' : ''}
            <textarea value={mitigationMeasures} onChange={(event) => setMitigationMeasures(event.target.value)} maxLength={5000} rows={3} required={requiresMitigation} disabled={saving} placeholder="Describe las medidas adoptadas para mitigar el conflicto." />
          </label>
          {status === 'MITIGATED' && <p className="audit-team-inline-warning">Mitigado no equivale a sin conflicto: la decisión conservará ambos estados diferenciados.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="drawer-actions">
            <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar evaluación'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}

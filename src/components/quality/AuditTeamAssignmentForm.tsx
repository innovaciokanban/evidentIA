import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuditTeamRole, Auditor } from '../../types'
import { auditTeamRoleLabels } from './audit-team.model'

type AuditTeamAssignmentFormProps = {
  auditors: Auditor[]
  leaderExists: boolean
  saving: boolean
  error: string
  onSubmit: (payload: { auditorId: string; role: AuditTeamRole; observations: string | null }) => void
  onClose: () => void
}

export function AuditTeamAssignmentForm({ auditors, leaderExists, saving, error, onSubmit, onClose }: AuditTeamAssignmentFormProps) {
  const [auditorId, setAuditorId] = useState('')
  const [role, setRole] = useState<AuditTeamRole>('MEMBER')
  const [observations, setObservations] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auditorId || saving) return
    onSubmit({ auditorId, role, observations: observations.trim() || null })
  }

  return (
    <form className="audit-team-assignment-form" onSubmit={submit} aria-label="Asignar integrante al equipo auditor">
      <div className="audit-team-form-heading">
        <div>
          <p className="detail-label">NUEVA ASIGNACIÓN</p>
          <h3>Sumar un profesional</h3>
          <p>Solo aparecen auditores disponibles de la empresa de esta auditoría.</p>
        </div>
        <button type="button" className="text-button" onClick={onClose} disabled={saving}>Cancelar</button>
      </div>
      <div className="audit-team-form-grid">
        <label>Auditor
          <select value={auditorId} onChange={(event) => setAuditorId(event.target.value)} required disabled={saving}>
            <option value="">Selecciona un auditor</option>
            {auditors.map((auditor) => <option key={auditor.id} value={auditor.id}>{auditor.name} · {auditor.type === 'INTERNAL' ? 'Interno' : 'Externo'}</option>)}
          </select>
        </label>
        <label>Función
          <select value={role} onChange={(event) => setRole(event.target.value as AuditTeamRole)} disabled={saving}>
            <option value="MEMBER">{auditTeamRoleLabels.MEMBER}</option>
            <option value="LEAD">{auditTeamRoleLabels.LEAD}</option>
          </select>
        </label>
        <label className="audit-team-field-wide">Observaciones
          <textarea value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={5000} rows={2} disabled={saving} placeholder="Contexto de la asignación, si aplica." />
        </label>
      </div>
      {leaderExists && <p className="audit-team-inline-warning" role="status">Ya existe un líder{role === 'LEAD' ? '. Al guardar, el backend reemplazará la función del líder actual.' : '. Puedes reemplazarlo seleccionando la función Líder.'}</p>}
      {!auditors.length && <p className="muted">No hay auditores disponibles para asignar. Revisa el Banco de Auditores.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="procedure-form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="button primary" disabled={saving || !auditorId}>{saving ? 'Asignando…' : 'Asignar al equipo'}</button>
      </div>
    </form>
  )
}

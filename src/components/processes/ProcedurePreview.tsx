import type { ProcedureIndicatorEntry } from './procedure-indicator.model'
import type { ProcedureStepEntry, ProcedureStepUser } from './procedure-step.model'

const userInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

type ProcedurePreviewProps = {
  code?: string
  name: string
  objective: string
  scope: string
  description: string
  processName: string
  processCode: string | null
  responsibleName: string
  statusLabel: string
  statusClass: string
  version: string
  steps: ProcedureStepEntry[]
  indicators: ProcedureIndicatorEntry[]
  users?: ProcedureStepUser[]
  onClose: () => void
}

export function ProcedurePreview({ code, name, objective, scope, description, processName, processCode, responsibleName, statusLabel, statusClass, version, steps, indicators, users = [], onClose }: ProcedurePreviewProps) {
  return (
    <section className="procedure-document-preview" aria-labelledby="procedure-preview-title">
      <header className="procedure-preview-header">
        <div>
          <p className="eyebrow">VISTA DOCUMENTAL</p>
          <h3 id="procedure-preview-title">{name || 'Procedimiento sin nombre'}</h3>
          <p>Lectura de consulta para reuniones, revisión interna y presentación al cliente.</p>
        </div>
        <button type="button" className="button secondary small-button" onClick={onClose}>Volver al editor</button>
      </header>
      <div className="procedure-preview-sheet">
        <div className="procedure-preview-identity">
          <div><span className="procedure-preview-code">{code ?? 'Código pendiente'}</span><h4>{name || 'Procedimiento sin nombre'}</h4></div>
          <div className="procedure-preview-status"><span className={`procedure-status ${statusClass}`}>{statusLabel}</span><span>Versión {version}</span></div>
        </div>
        <dl className="procedure-preview-meta">
          <div><dt>Proceso</dt><dd>{processCode ? `${processCode} · ` : ''}{processName}</dd></div>
          <div><dt>Responsable</dt><dd>{responsibleName}</dd></div>
          <div><dt>Actividades</dt><dd>{steps.length}</dd></div>
          <div><dt>Indicadores propios</dt><dd>{indicators.length}</dd></div>
        </dl>
        <div className="procedure-preview-copy">
          <div><span>Objetivo</span><p>{objective || 'Sin completar'}</p></div>
          <div><span>Alcance</span><p>{scope || 'Sin completar'}</p></div>
          <div className="procedure-preview-copy-wide"><span>Descripción</span><p>{description || 'Sin descripción'}</p></div>
        </div>
        <section className="procedure-preview-section">
          <div className="procedure-preview-section-heading"><span>01</span><div><h4>Secuencia operativa</h4><p>Actividades ordenadas para ejecutar el procedimiento.</p></div></div>
          {steps.length === 0 ? <p className="procedure-preview-empty">No hay actividades documentadas.</p> : <ol className="procedure-preview-steps">{steps.map((step, index) => <li key={step.key}><span>{index + 1}</span><div><strong>{step.title || 'Actividad sin título'}</strong><p>{step.instruction || 'Sin instrucción'}</p>{step.criteria && <small><b>Criterio:</b> {step.criteria}</small>}{step.responsibleIds && step.responsibleIds.length > 0 && <div className="procedure-preview-responsibles"><small>Responsables</small><div>{step.responsibleIds.map((id) => { const user = users.find((item) => item.id === id); return <span key={id}><i aria-hidden="true">{userInitials(user?.name ?? '?')}</i>{user?.name ?? 'Usuario no disponible'}</span> })}</div></div>}</div></li>)}</ol>}
        </section>
        <section className="procedure-preview-section">
          <div className="procedure-preview-section-heading"><span>02</span><div><h4>Indicadores propios</h4><p>Métricas definidas específicamente para este procedimiento.</p></div></div>
          {indicators.length === 0 ? <p className="procedure-preview-empty">No hay indicadores propios definidos.</p> : <div className="procedure-preview-indicators">{indicators.map((entry) => <div key={entry.key}><strong>{entry.draft.name || 'Indicador sin nombre'}</strong><span>{entry.draft.frequency || 'Sin frecuencia'} · Meta {entry.draft.target || 'sin definir'} · {entry.draft.unit || 'Sin unidad'}</span><small>{entry.draft.description || 'Sin descripción'}</small></div>)}</div>}
        </section>
      </div>
    </section>
  )
}

import { ActivityIcon, ArrowRightIcon, PlusIcon, RiskIcon, WorkflowIcon } from './ProcessIcons'

/** Categoría del proceso dentro del mapa: define el tono visual de la tarjeta. */
export type ProcessCategory = 'estrategico' | 'misional' | 'apoyo'

/** Estado visual del proceso. La fuente de verdad es el backend y se traduce al entrar a la tarjeta. */
export type ProcessStatus = 'active' | 'draft' | 'paused'

export type ProcessCardProps = {
  name: string
  description: string
  category: ProcessCategory
  indicators: number
  risks: number
  status: ProcessStatus
  responsible: string | null
}

const statusLabels: Record<ProcessStatus, string> = { active: 'Activo', draft: 'Borrador', paused: 'En pausa' }

export function ProcessCard({ name, description, category, indicators, risks, status, responsible }: ProcessCardProps) {
  return (
    <article className={`process-card ${category}`}>
      <div className="process-card-head">
        <span className="process-card-icon"><WorkflowIcon /></span>
        <div className="process-card-copy">
          <h4>{name}</h4>
          <p className="process-card-desc">{description}</p>
          <p className="process-card-owner">Responsable · {responsible ?? 'Sin asignar'}</p>
        </div>
      </div>
      <div className="process-card-stats">
        <span className="process-stat"><ActivityIcon />{indicators} indicadores</span>
        <span className="process-stat risk"><RiskIcon />{risks} {risks === 1 ? 'riesgo' : 'riesgos'}</span>
      </div>
      <div className="process-card-foot">
        <span className={`process-status ${status}`}>{statusLabels[status]}</span>
        <button type="button" className="process-card-link" disabled title="Próximamente podrás abrir el detalle del proceso.">
          Ver proceso <ArrowRightIcon size={13} />
        </button>
      </div>
    </article>
  )
}

export type AddProcessCardProps = {
  onClick?: () => void
  disabled?: boolean
  title?: string
}

/** Cierre visual de cada banda del mapa. Al pulsarlo se abre el formulario del proceso nuevo. */
export function AddProcessCard({ onClick, disabled = false, title }: AddProcessCardProps) {
  return (
    <button type="button" className="process-add-card" onClick={onClick} disabled={disabled} title={title}>
      <span className="process-add-icon"><PlusIcon size={16} /></span>
      Agregar proceso
    </button>
  )
}

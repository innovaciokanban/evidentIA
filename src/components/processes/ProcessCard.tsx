import { ArrowRightIcon, PlusIcon, WorkflowIcon } from './ProcessIcons'

/** Categoría del proceso dentro del mapa: define el tono visual de la tarjeta. */
export type ProcessCategory = 'estrategico' | 'misional' | 'apoyo'

/** Estado visual del proceso. La fuente de verdad es el backend y se traduce al entrar a la tarjeta. */
export type ProcessStatus = 'active' | 'draft' | 'paused'

export type ProcessCardProps = {
  name: string
  code: string | null
  objective: string
  description: string
  category: ProcessCategory
  status: ProcessStatus
  responsible: string | null
  onOpen: () => void
  onDelete?: () => void
}

const statusLabels: Record<ProcessStatus, string> = { active: 'Activo', draft: 'Borrador', paused: 'En pausa' }

export function ProcessCard({ name, code, objective, description, category, status, responsible, onOpen, onDelete }: ProcessCardProps) {
  return (
    <article className={`process-card ${category}`}>
      <div className="process-card-head">
        <span className="process-card-icon"><WorkflowIcon /></span>
        <div className="process-card-copy">
          <div className="process-card-title"><h4>{name}</h4>{code && <span className="process-card-code">{code}</span>}</div>
          <p className="process-card-desc">{description}</p>
        </div>
      </div>
      <div className="process-card-detail">
        <span>Responsable</span>
        <strong>{responsible ?? 'Sin asignar'}</strong>
      </div>
      <div className="process-card-detail objective">
        <span>Objetivo</span>
        <p>{objective}</p>
      </div>
      <div className="process-card-foot">
        <span className={`process-status ${status}`}>{statusLabels[status]}</span>
        <div className="process-card-actions">
          <button type="button" className="process-card-link" onClick={onOpen}>Ver proceso <ArrowRightIcon size={13} /></button>
          {onDelete && <button type="button" className="process-card-delete" onClick={onDelete}>Eliminar</button>}
        </div>
      </div>
    </article>
  )
}

export type AddProcessCardProps = {
  onClick?: () => void
  disabled?: boolean
  title?: string
}

/** Cierre visual de cada banda del mapa. Al pulsarlo se abre la ficha embebida del proceso. */
export function AddProcessCard({ onClick, disabled = false, title }: AddProcessCardProps) {
  return (
    <button type="button" className="process-add-card" onClick={onClick} disabled={disabled} title={title}>
      <span className="process-add-icon"><PlusIcon size={16} /></span>
      Agregar proceso
    </button>
  )
}

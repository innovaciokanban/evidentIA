import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { ArrowRightIcon, PlusIcon, WorkflowIcon } from './ProcessIcons'
import type { Process } from '../../types'

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

export function ProcessCard({ name, code, description, category, status, onOpen, onDelete }: ProcessCardProps) {
  return (
    <article className={`process-card ${category}`}>
      <div className="process-card-head">
        <span className="process-card-icon"><WorkflowIcon /></span>
        <div className="process-card-copy">
          <div className="process-card-title"><h4>{name}</h4>{code && <span className="process-card-code">{code}</span>}</div>
          <p className="process-card-desc">{description}</p>
        </div>
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

/** Estado visual del proceso en el mapa. La fuente de verdad es el backend y se traduce al entrar. */
const visualStatusOf: Record<Process['status'], ProcessStatus> = { ACTIVE: 'active', INACTIVE: 'paused' }

export type ProcessMapBandProps = {
  band: { key: ProcessCategory; title: string; role: string; description: string; icon: ReactNode }
  processes: Process[]
  canCreate: boolean
  onOpenProcess: (process: Process) => void
  onCreateProcess: () => void
  onDeleteProcess: (process: Process) => void
}

/** Banda del mapa de procesos. Las acciones de gestión solo se muestran con permiso de escritura. */
export function ProcessMapBand({ band, processes, canCreate, onOpenProcess, onCreateProcess, onDeleteProcess }: ProcessMapBandProps) {
  return (
    <section className={`process-band ${band.key}`}>
      <header className="process-band-head">
        <span className="process-band-icon">{band.icon}</span>
        <div className="process-band-copy">
          <div className="process-band-title">
            <h3>{band.title}</h3>
            <span className="process-band-role">{band.role}</span>
          </div>
          <p>{band.description}</p>
        </div>
      </header>
      <div className="process-band-flow">
        {processes.map((process, processIndex) => (
          <Fragment key={process.id}>
            {processIndex > 0 && <span className="process-arrow"><ArrowRightIcon size={16} /></span>}
            <ProcessCard
              name={process.name}
              code={process.code}
              objective={process.objective}
              description={process.description || ''}
              category={band.key}
              status={visualStatusOf[process.status]}
              responsible={process.responsible?.name ?? null}
              onOpen={() => onOpenProcess(process)}
              onDelete={canCreate ? () => onDeleteProcess(process) : undefined}
            />
          </Fragment>
        ))}
        {canCreate && <AddProcessCard onClick={onCreateProcess} />}
      </div>
    </section>
  )
}

export type ProcessMapFeedbackProps = {
  notice: string
  error: string
}

/** Confirmaciones y errores de acciones del mapa (p. ej. eliminar un proceso bloqueado). */
export function ProcessMapFeedback({ notice, error }: ProcessMapFeedbackProps) {
  return (
    <>
      {notice && <div className="form-success page-alert" role="status">{notice}</div>}
      {error && <div className="form-error page-alert" role="alert">{error}</div>}
    </>
  )
}

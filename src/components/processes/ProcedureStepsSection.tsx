import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { askConfirm } from '../ui/useConfirm'
import { emptyProcedureStep, type ProcedureStepEntry, type ProcedureStepUser } from './procedure-step.model'

type ProcedureStepsSectionProps = {
  entries: ProcedureStepEntry[]
  setEntries?: Dispatch<SetStateAction<ProcedureStepEntry[]>>
  readOnly?: boolean
  onDirty?: () => void
  users?: ProcedureStepUser[]
}

const userInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

export function ProcedureStepsSection({ entries, setEntries, readOnly = false, onDirty, users = [] }: ProcedureStepsSectionProps) {
  const updateEntries: Dispatch<SetStateAction<ProcedureStepEntry[]>> = setEntries ?? (() => undefined)
  const [selectedKey, setSelectedKey] = useState<string | null>(() => entries[0]?.key ?? null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [responsibleSearch, setResponsibleSearch] = useState('')
  const selectedStep = entries.find((step) => step.key === selectedKey) ?? (readOnly ? null : entries[0] ?? null)
  const selectedIndex = selectedStep ? entries.findIndex((step) => step.key === selectedStep.key) : -1
  const selectedResponsibleIds = selectedStep?.responsibleIds ?? []
  const selectedResponsibles = users.filter((user) => selectedResponsibleIds.includes(user.id))
  const responsibleOptions = users.filter((user) => user.isActive !== false || selectedResponsibleIds.includes(user.id))
  const filteredResponsibleOptions = responsibleOptions.filter((user) => user.name.toLowerCase().includes(responsibleSearch.trim().toLowerCase()))

  function selectStep(key: string) {
    if (readOnly && selectedKey === key) {
      setSelectedKey(null)
      return
    }
    if (selectedStep?.key === key) {
      setDetailsOpen((current) => !current)
      return
    }
    setSelectedKey(key)
    setDetailsOpen(true)
    setResponsibleSearch('')
  }

  function selectStepAt(index: number) {
    const step = entries[index]
    if (!step) return
    setSelectedKey(step.key)
    setDetailsOpen(true)
    setResponsibleSearch('')
  }

  function addStep() {
    const next = emptyProcedureStep()
    updateEntries((current) => [...current, { ...next, position: current.length + 1 }])
    setSelectedKey(next.key)
    onDirty?.()
  }

  function updateStep(key: string, field: keyof Omit<ProcedureStepEntry, 'key' | 'id' | 'position'>, value: string) {
    updateEntries((current) => current.map((step) => step.key === key ? { ...step, [field]: value } : step))
    onDirty?.()
  }

  function updateResponsibles(key: string, responsibleIds: string[]) {
    updateEntries((current) => current.map((step) => step.key === key ? { ...step, responsibleIds } : step))
    onDirty?.()
  }

  function toggleResponsible(userId: string) {
    if (!selectedStep) return
    const nextIds = selectedResponsibleIds.includes(userId)
      ? selectedResponsibleIds.filter((id) => id !== userId)
      : [...selectedResponsibleIds, userId]
    updateResponsibles(selectedStep.key, nextIds)
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= entries.length) return
    updateEntries((current) => {
      const next = [...current]
      const [step] = next.splice(index, 1)
      next.splice(target, 0, step)
      return next.map((item, itemIndex) => ({ ...item, position: itemIndex + 1 }))
    })
    onDirty?.()
  }

  async function removeStep(step: ProcedureStepEntry) {
    const confirmed = await askConfirm({ title: 'Eliminar actividad', message: `Se quitará «${step.title || 'esta actividad'}» del procedimiento.`, confirmLabel: 'Eliminar actividad' })
    if (!confirmed) return
    updateEntries((current) => current.filter((item) => item.key !== step.key).map((item, index) => ({ ...item, position: index + 1 })))
    if (selectedKey === step.key) setSelectedKey(null)
    onDirty?.()
  }

  const responsiblePills = (compact = false, removable = false) => selectedResponsibles.length > 0
    ? <div className={`procedure-responsible-pills${compact ? ' compact' : ''}`} aria-label="Responsables asignados">{selectedResponsibles.map((user) => removable ? <button type="button" className="procedure-responsible-pill" key={user.id} onClick={() => toggleResponsible(user.id)} aria-label={`Quitar a ${user.name}`}><i aria-hidden="true">{userInitials(user.name)}</i><span>{user.name}</span>{user.isActive === false && <small>Inactivo</small>}<b aria-hidden="true">×</b></button> : <span className="procedure-responsible-pill" key={user.id}><i aria-hidden="true">{userInitials(user.name)}</i><span>{user.name}</span>{user.isActive === false && <small>Inactivo</small>}</span>)}</div>
    : <span className="procedure-responsible-empty">Sin responsables asignados</span>

  return (
    <section className={`procedure-builder-section procedure-steps-workspace${readOnly ? ' procedure-read-only' : ''}`}>
      <div className="procedure-builder-heading">
        <div><p className="detail-label">SECUENCIA OPERATIVA</p><h3>Actividades del procedimiento</h3>{!readOnly && <p>Selecciona una actividad para ordenar el recorrido, documentar la ejecución y asignar responsables.</p>}</div>
        <div className="procedure-section-actions">{!readOnly && <button type="button" className="button secondary small-button" onClick={addStep}>+ Añadir actividad</button>}</div>
      </div>
      <div className="procedure-builder-toolbar">
        <div className="procedure-step-count"><strong>{entries.length}</strong><span>{entries.length === 1 ? 'actividad documentada' : 'actividades documentadas'}</span></div>
        {entries.length > 0 && <span className="procedure-flow-hint">Selecciona un nodo para ver su detalle</span>}
      </div>
      {entries.length === 0 ? (
        <div className="procedure-builder-empty"><strong>La secuencia empieza aquí</strong><span>Añade actividades en el orden en que ocurren. El flujo se construirá automáticamente.</span>{!readOnly && <button type="button" className="button secondary small-button" onClick={addStep}>Añadir primera actividad</button>}</div>
      ) : <>
        <div className="procedure-flow-scroll" aria-label="Flujo de actividades"><ol className="procedure-flow-track">{entries.map((step, index) => {
          const selected = selectedStep?.key === step.key
          const responsibleCount = step.responsibleIds?.length ?? 0
          return <li key={step.key} className={selected ? 'selected' : ''}><button type="button" className="procedure-flow-node" onClick={() => selectStep(step.key)} aria-pressed={selected} aria-current={selected ? 'step' : undefined}><span className="procedure-flow-number">{String(index + 1).padStart(2, '0')}</span><span className="procedure-flow-node-copy"><strong>{step.title || 'Sin título'}</strong><small><svg className="procedure-flow-responsible-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 6 7Zm4.1 6.2c-.2-2.25-1.55-3.55-4.1-3.55s-3.9 1.3-4.1 3.55h8.2ZM11 7.5a1.8 1.8 0 1 0-.45-3.54 3.2 3.2 0 0 1-.2 3.43c.2.07.42.11.65.11Zm.25 2.2c-.31 0-.6.03-.87.08.8.76 1.3 1.78 1.46 3.07h2.6c-.2-2.02-1.26-3.15-3.19-3.15Z" /></svg><b>{responsibleCount}</b> {responsibleCount === 1 ? 'responsable' : 'responsables'}</small></span></button>{index < entries.length - 1 && <span className="procedure-flow-connector" aria-hidden="true" />}</li>
        })}</ol></div>
        {selectedStep && detailsOpen && <div className="procedure-step-detail" aria-label={`Detalle de actividad ${selectedIndex + 1}`}>
          <header className="procedure-step-detail-header"><div><span className="procedure-detail-index">Actividad {String(selectedIndex + 1).padStart(2, '0')}</span><h4>{selectedStep.title || 'Actividad sin título'}</h4></div>{readOnly ? <div className="procedure-step-navigation"><button type="button" className="button secondary small-button" onClick={() => selectStepAt(selectedIndex - 1)} disabled={selectedIndex <= 0}>Anterior</button><span>Actividad {String(selectedIndex + 1).padStart(2, '0')} de {String(entries.length).padStart(2, '0')}</span><button type="button" className="button secondary small-button" onClick={() => selectStepAt(selectedIndex + 1)} disabled={selectedIndex === entries.length - 1}>Siguiente</button></div> : <div className="procedure-step-actions"><button type="button" className="icon-button" onClick={() => moveStep(selectedIndex, -1)} disabled={selectedIndex === 0} aria-label="Subir actividad">↑</button><button type="button" className="icon-button" onClick={() => moveStep(selectedIndex, 1)} disabled={selectedIndex === entries.length - 1} aria-label="Bajar actividad">↓</button><button type="button" className="text-button danger-text" onClick={() => void removeStep(selectedStep)}>Eliminar</button></div>}</header>
          {readOnly ? <div className="procedure-step-readonly"><div className="procedure-step-readonly-main"><div><span>Instrucción operativa</span><p>{selectedStep.instruction || 'Sin instrucción registrada'}</p></div><div><span>Criterio de aceptación</span><p>{selectedStep.criteria || 'No definido'}</p></div></div><div className="procedure-step-readonly-responsibles"><span>Responsables</span>{responsiblePills()}</div></div> : <div className="procedure-step-editor"><label>Título de la actividad<input value={selectedStep.title} onChange={(event) => updateStep(selectedStep.key, 'title', event.target.value)} placeholder="Ej. Recibir y registrar la solicitud" minLength={2} maxLength={160} required /></label><label>Instrucción operativa<textarea value={selectedStep.instruction} onChange={(event) => updateStep(selectedStep.key, 'instruction', event.target.value)} placeholder="Describe qué debe hacer la persona responsable" rows={4} maxLength={10000} required /></label><label>Criterio de aceptación <span className="field-optional">Opcional</span><textarea value={selectedStep.criteria} onChange={(event) => updateStep(selectedStep.key, 'criteria', event.target.value)} placeholder="Qué evidencia confirma que la actividad quedó completa" rows={3} maxLength={5000} /></label><div className="procedure-responsible-field"><div className="procedure-field-label"><span>Responsables de la actividad</span><small>Opcional · selecciona uno o varios</small></div><div className="procedure-responsible-selection">{responsiblePills(true, true)}</div><label className="procedure-responsible-search"><span className="sr-only">Buscar responsable</span><input value={responsibleSearch} onChange={(event) => setResponsibleSearch(event.target.value)} placeholder="Buscar por nombre..." aria-label="Buscar responsable de la actividad" /></label><div className="procedure-responsible-options" role="listbox" aria-label="Usuarios responsables" aria-multiselectable="true">{filteredResponsibleOptions.length === 0 ? <span className="procedure-responsible-no-results">No hay usuarios que coincidan.</span> : filteredResponsibleOptions.map((user) => { const selected = selectedResponsibleIds.includes(user.id); return <button type="button" role="option" aria-selected={selected} className={`procedure-responsible-option${selected ? ' selected' : ''}`} key={user.id} onClick={() => toggleResponsible(user.id)}><i aria-hidden="true">{userInitials(user.name)}</i><span>{user.name}<small>{user.isActive === false ? 'Asignado anteriormente · inactivo' : 'Usuario activo'}</small></span><b aria-hidden="true">{selected ? '✓' : '+'}</b></button> })}</div><small className="field-help">Puedes quitar una persona desde su etiqueta.</small></div></div>}
        </div>}
      </>}
      {!readOnly && entries.length > 0 && <p className="procedure-builder-help">Los cambios, responsables y el orden se guardan junto con el procedimiento.</p>}
    </section>
  )
}

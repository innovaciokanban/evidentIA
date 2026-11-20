import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { api, ApiError } from '../../api'
import { askConfirm } from '../ui/useConfirm'
import { KpiIndicatorModal } from './KpiForm'
import {
  emptyProcedureIndicatorDraft,
  procedureIndicatorEntryFromIndicator,
  procedureIndicatorMissingFields,
  procedureIndicatorPayloadOf,
  type ProcedureIndicatorDraft,
  type ProcedureIndicatorEntry,
  type ProcedureIndicatorUser,
} from './procedure-indicator.model'
import type { ProcedureIndicator } from '../../types'

let temporaryIndicatorSequence = 0
const temporaryIndicatorKey = () => `temporary-procedure-indicator-${Date.now()}-${temporaryIndicatorSequence++}`

type ProcedureIndicatorSectionProps = {
  processId: string
  procedureId?: string
  entries: ProcedureIndicatorEntry[]
  setEntries?: Dispatch<SetStateAction<ProcedureIndicatorEntry[]>>
  users: ProcedureIndicatorUser[]
  readOnly?: boolean
  onDirty?: () => void
  onPersistedChange?: () => void | Promise<void>
}

const dateLabel = (value: string) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin definir'
const userInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

function ProcedureIndicatorPerson({ user, emptyLabel = 'Sin asignar' }: { user?: ProcedureIndicatorUser; emptyLabel?: string }) {
  if (!user) return <span className="procedure-indicator-unassigned">{emptyLabel}</span>
  return <span className="procedure-indicator-responsible-person"><i aria-hidden="true">{userInitials(user.name)}</i><span>{user.name}<small>{user.isActive === false ? 'Asignado anteriormente · inactivo' : 'Usuario asignado'}</small></span></span>
}

function ProcedureIndicatorDetail({ entry, users, readOnly, onEdit, onRemove }: { entry: ProcedureIndicatorEntry; users: ProcedureIndicatorUser[]; readOnly: boolean; onEdit?: () => void; onRemove?: () => void }) {
  const report = users.find((user) => user.id === entry.draft.reportResponsibleId)
  const monitor = users.find((user) => user.id === entry.draft.monitorResponsibleId)
  const thresholds = [
    { tone: 'green', label: 'Verde', value: entry.draft.greenThreshold },
    { tone: 'yellow', label: 'Amarillo', value: entry.draft.yellowThreshold },
    { tone: 'red', label: 'Rojo', value: entry.draft.redThreshold },
  ]
  return <div className="procedure-indicator-detail" aria-label={`Detalle del indicador ${entry.draft.name || 'sin nombre'}`}>
    <div className="procedure-indicator-detail-toolbar"><div><span className="procedure-indicator-detail-kicker">Ficha del indicador</span><strong>Configuración y seguimiento</strong></div>{!readOnly && <div className="procedure-indicator-actions"><button type="button" className="button secondary small-button procedure-indicator-action-button" onClick={onEdit}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m11.8 1.7 2.5 2.5-8.6 8.6-3.1.6.6-3.1 8.6-8.6Zm-7.9 9.1-.3 1.4 1.4-.3 7.9-7.9-1.1-1.1-7.9 7.9Z" /></svg>Editar</button><button type="button" className="button danger small-button procedure-indicator-action-button" onClick={onRemove}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.2h10v9.3H3V4.2Zm2 1.5V12h6V5.7H5Zm5.5-3.2v1.1h-5V2.5h5ZM6.2 7h1.2v3.7H6.2V7Zm2.4 0h1.2v3.7H8.6V7Z" /></svg>Eliminar</button></div>}</div>
    <div className="procedure-indicator-detail-sections">
      <section className="procedure-indicator-detail-section procedure-indicator-configuration"><header><span className="procedure-indicator-section-index">01</span><div><h4>Configuración del indicador</h4><p>Valores de referencia y periodicidad definida.</p></div></header><div className="procedure-indicator-fact-grid"><div className="procedure-indicator-fact emphasis"><span>Meta</span><strong>{entry.draft.target || 'Sin meta'}</strong><small>{entry.draft.unit || 'Sin unidad'}</small></div><div className="procedure-indicator-fact emphasis"><span>Línea base</span><strong>{entry.draft.baselineValue || 'Sin definir'}</strong><small>Valor de referencia</small></div><div className="procedure-indicator-fact"><span>Frecuencia</span><strong>{entry.draft.frequency || 'Sin frecuencia'}</strong></div><div className="procedure-indicator-fact"><span>Unidad</span><strong>{entry.draft.unit || 'Sin unidad'}</strong></div></div><div className="procedure-indicator-thresholds"><div><span>Semáforo de seguimiento</span><small>Umbrales configurados para este indicador</small></div><div className="procedure-threshold-list">{thresholds.map((threshold) => <div className={`procedure-threshold-item ${threshold.tone}`} key={threshold.tone}><i aria-hidden="true" /><span>{threshold.label}</span><strong>{threshold.value || 'No definido'}</strong></div>)}</div></div></section>
      <section className="procedure-indicator-detail-section procedure-indicator-methodology"><header><span className="procedure-indicator-section-index">02</span><div><h4>Metodología de medición</h4><p>Cómo se obtiene y documenta el valor.</p></div></header><div className="procedure-indicator-method-grid"><div><span>Descripción</span><p>{entry.draft.description || 'Sin completar'}</p></div><div className="procedure-indicator-formula"><span>Fórmula</span><p>{entry.draft.formula || 'Sin completar'}</p></div><div><span>Fuente de datos</span><p>{entry.draft.dataSource || 'Sin completar'}</p></div><div><span>Método de medición</span><p>{entry.draft.measurementMethod || 'Sin completar'}</p></div></div></section>
      <section className="procedure-indicator-detail-section procedure-indicator-follow-up"><header><span className="procedure-indicator-section-index">03</span><div><h4>Responsables y seguimiento</h4><p>Personas asignadas y fecha de control.</p></div></header><div className="procedure-indicator-follow-up-grid"><div><span>Responsable de reporte</span><ProcedureIndicatorPerson user={report} /></div><div><span>Responsable de monitoreo</span><ProcedureIndicatorPerson user={monitor} /></div><div className="procedure-indicator-deadline"><span>Fecha límite</span><strong>{dateLabel(entry.draft.deadline)}</strong></div></div></section>
    </div>
  </div>
}

export function ProcedureIndicatorSection({ processId, procedureId, entries, setEntries, users, readOnly = false, onDirty, onPersistedChange }: ProcedureIndicatorSectionProps) {
  const updateEntries: Dispatch<SetStateAction<ProcedureIndicatorEntry[]>> = setEntries ?? (() => undefined)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editorDraft, setEditorDraft] = useState<ProcedureIndicatorDraft>({ ...emptyProcedureIndicatorDraft })
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? (readOnly ? null : entries[0] ?? null)

  function toggleEntry(key: string) {
    setSelectedKey((current) => readOnly && current === key ? null : key)
  }

  function openNew() {
    setEditingKey(null)
    setEditorDraft({ ...emptyProcedureIndicatorDraft })
    setEditorError('')
    setNotice('')
    setEditorOpen(true)
  }

  function openEdit(entry: ProcedureIndicatorEntry) {
    setEditingKey(entry.key)
    setSelectedKey(entry.key)
    setEditorDraft({ ...entry.draft })
    setEditorError('')
    setNotice('')
    setEditorOpen(true)
  }

  async function saveEditor() {
    if (saving) return
    const missing = procedureIndicatorMissingFields(editorDraft)
    if (missing.length > 0) {
      setEditorError(`Completa: ${missing.join(', ')}.`)
      return
    }
    setSaving(true)
    setEditorError('')
    setNotice('')
    try {
      const existing = entries.find((entry) => entry.key === editingKey)
      if (procedureId) {
        const path = existing?.id
          ? `/processes/${processId}/procedures/${procedureId}/indicators/${existing.id}`
          : `/processes/${processId}/procedures/${procedureId}/indicators`
        const result = await api<{ indicator: ProcedureIndicator }>(path, {
          method: existing?.id ? 'PATCH' : 'POST',
          body: JSON.stringify(procedureIndicatorPayloadOf(editorDraft)),
        })
        const nextEntry = procedureIndicatorEntryFromIndicator(result.indicator)
        updateEntries((current) => existing?.id
          ? current.map((entry) => entry.key === editingKey ? nextEntry : entry)
          : [...current, nextEntry])
        setSelectedKey(nextEntry.key)
        await onPersistedChange?.()
      } else {
        const nextEntry = editingKey
          ? { key: editingKey, draft: { ...editorDraft } }
          : { key: temporaryIndicatorKey(), draft: { ...editorDraft } }
        updateEntries((current) => editingKey
          ? current.map((entry) => entry.key === editingKey ? { ...entry, draft: { ...editorDraft } } : entry)
          : [...current, nextEntry])
        setSelectedKey(nextEntry.key)
        onDirty?.()
      }
      setEditorOpen(false)
      setNotice(`Indicador ${editingKey ? 'actualizado' : 'añadido'} correctamente.`)
    } catch (requestError) {
      setEditorError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el indicador.')
    } finally {
      setSaving(false)
    }
  }

  async function removeEntry(entry: ProcedureIndicatorEntry) {
    if (readOnly) return
    const confirmed = await askConfirm({ title: 'Eliminar indicador', message: `Se eliminará «${entry.draft.name}» únicamente de este procedimiento.`, confirmLabel: 'Eliminar indicador' })
    if (!confirmed) return
    setEditorError('')
    setNotice('')
    try {
      if (procedureId && entry.id) await api(`/processes/${processId}/procedures/${procedureId}/indicators/${entry.id}`, { method: 'DELETE' })
      updateEntries((current) => current.filter((item) => item.key !== entry.key))
      if (selectedKey === entry.key) setSelectedKey(null)
      if (!procedureId) onDirty?.()
      if (procedureId) await onPersistedChange?.()
      setNotice('Indicador eliminado correctamente.')
    } catch (requestError) {
      setEditorError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el indicador.')
    }
  }

  return (
    <section className={`procedure-builder-section procedure-indicators-workspace${readOnly ? ' procedure-read-only' : ''}`}>
      <div className="procedure-builder-heading procedure-indicator-heading">
        <div><p className="detail-label">MEDICIÓN Y SEGUIMIENTO</p><div className="procedure-indicator-heading-title"><h3>Indicadores propios</h3><span className="procedure-indicator-count" aria-label={`${entries.length} indicadores`}>{entries.length}</span></div></div>
        {!readOnly && <button type="button" className="button primary small-button" onClick={openNew}>+ Añadir indicador</button>}
      </div>
      {notice && <div className="form-success procedure-builder-notice" role="status">{notice}</div>}
      {editorError && !editorOpen && <div className="form-error procedure-builder-error" role="alert">{editorError}</div>}
      {entries.length === 0 ? <div className="procedure-builder-empty"><strong>Aún no hay indicadores propios</strong><span>Son opcionales para guardar el procedimiento. Puedes definirlos ahora o añadirlos después.</span>{!readOnly && <button type="button" className="button secondary small-button" onClick={openNew}>Añadir primer indicador</button>}</div> : <div className="procedure-indicator-list" role="list" aria-label="Indicadores propios del procedimiento">
        {entries.map((entry) => {
          const selected = selectedEntry?.key === entry.key
          const report = users.find((user) => user.id === entry.draft.reportResponsibleId)
          const monitor = users.find((user) => user.id === entry.draft.monitorResponsibleId)
          const responsibleUsers = [report, monitor].filter((user): user is ProcedureIndicatorUser => Boolean(user)).filter((user, index, list) => list.findIndex((item) => item.id === user.id) === index)
          return <div className={`procedure-indicator-row${selected ? ' selected' : ''}`} key={entry.key} role="listitem">
            <button type="button" className="procedure-indicator-row-main" onClick={() => toggleEntry(entry.key)} aria-pressed={selected} aria-expanded={selected}><span className="procedure-indicator-row-marker" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 3.2h10v9.6H3V3.2Zm2 2v1.2h6V5.2H5Zm0 2.5v1.2h4V7.7H5Z" /></svg></span><span className="procedure-indicator-row-name"><strong>{entry.draft.name || 'Sin nombre'}</strong><small>{entry.draft.description || 'Sin descripción'}</small></span><span className="procedure-indicator-row-target"><small>Meta</small><strong>{entry.draft.target || 'Sin meta'}</strong><em>{entry.draft.unit || 'Sin unidad'}</em></span><span className="procedure-indicator-row-frequency"><small>Frecuencia</small><strong>{entry.draft.frequency || 'Sin frecuencia'}</strong></span><span className="procedure-indicator-row-responsibles"><small>Seguimiento</small><span className="procedure-indicator-avatar-stack">{responsibleUsers.map((user) => <i key={user.id} title={user.name}>{userInitials(user.name)}</i>)}</span></span><span className="procedure-indicator-row-chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d={selected ? 'm3 10 5-5 5 5' : 'm3 6 5 5 5-5'} /></svg></span></button>
            {selected && <ProcedureIndicatorDetail entry={entry} users={users} readOnly={readOnly} onEdit={() => openEdit(entry)} onRemove={() => void removeEntry(entry)} />}
          </div>
        })}
      </div>}
      {editorOpen && <KpiIndicatorModal draft={editorDraft} setDraft={setEditorDraft} users={users} editing={Boolean(editingKey)} saving={saving} error={editorError} eyebrow="INDICADORES DEL PROCEDIMIENTO" title={editingKey ? 'Editar indicador' : 'Añadir indicador'} description="Completa la métrica propia de este procedimiento. Este registro es independiente de Procesos, SMART y del catálogo KPI." ariaLabel={editingKey ? 'Editar indicador del procedimiento' : 'Añadir indicador del procedimiento'} onSubmit={() => void saveEditor()} onClose={() => { if (!saving) setEditorOpen(false) }} />}
    </section>
  )
}

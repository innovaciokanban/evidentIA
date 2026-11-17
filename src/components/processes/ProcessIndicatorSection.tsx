import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { api, ApiError } from '../../api'
import { askConfirm } from '../ui/useConfirm'
import { KpiIndicatorModal } from './KpiForm'
import {
  emptyProcessIndicatorDraft,
  processIndicatorEntryFromIndicator,
  processIndicatorMissingFields,
  processIndicatorPayloadOf,
  type ProcessIndicatorDraft,
  type ProcessIndicatorEntry,
  type ProcessIndicatorUser,
} from './process-indicator.model'
import type { ProcessIndicator } from '../../types'

let temporaryIndicatorSequence = 0
const temporaryIndicatorKey = () => `temporary-process-indicator-${Date.now()}-${temporaryIndicatorSequence++}`

type ProcessIndicatorSectionProps = {
  processId?: string
  entries: ProcessIndicatorEntry[]
  setEntries: Dispatch<SetStateAction<ProcessIndicatorEntry[]>>
  users: ProcessIndicatorUser[]
  readOnly?: boolean
}

const indicatorDateLabel = (value: string) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin definir'

export function ProcessIndicatorSection({ processId, entries, setEntries, users, readOnly = false }: ProcessIndicatorSectionProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editorDraft, setEditorDraft] = useState<ProcessIndicatorDraft>({ ...emptyProcessIndicatorDraft })
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  function openNew() {
    setEditingKey(null)
    setEditorDraft({ ...emptyProcessIndicatorDraft })
    setEditorError('')
    setNotice('')
    setEditorOpen(true)
  }

  function openEdit(entry: ProcessIndicatorEntry) {
    setEditingKey(entry.key)
    setEditorDraft({ ...entry.draft })
    setEditorError('')
    setNotice('')
    setEditorOpen(true)
  }

  function closeEditor() {
    if (!saving) setEditorOpen(false)
  }

  async function saveEditor() {
    if (saving) return
    const missing = processIndicatorMissingFields(editorDraft)
    if (missing.length > 0) {
      setEditorError(`Completa: ${missing.join(', ')}.`)
      return
    }
    setSaving(true)
    setEditorError('')
    setNotice('')
    try {
      if (processId) {
        const entry = entries.find((item) => item.key === editingKey)
        const path = entry?.id ? `/processes/${processId}/indicators/${entry.id}` : `/processes/${processId}/indicators`
        const result = await api<{ indicator: ProcessIndicator }>(path, { method: entry?.id ? 'PATCH' : 'POST', body: JSON.stringify(processIndicatorPayloadOf(editorDraft)) })
        const nextEntry = processIndicatorEntryFromIndicator(result.indicator)
        setEntries((current) => entry?.id ? current.map((item) => item.key === editingKey ? nextEntry : item) : [...current, nextEntry])
      } else {
        setEntries((current) => editingKey
          ? current.map((item) => item.key === editingKey ? { ...item, draft: { ...editorDraft } } : item)
          : [...current, { key: temporaryIndicatorKey(), draft: { ...editorDraft } }])
      }
      setEditorOpen(false)
      setNotice(`Indicador ${editingKey ? 'actualizado' : 'añadido'} correctamente.`)
    } catch (requestError) {
      setEditorError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el indicador.')
    } finally {
      setSaving(false)
    }
  }

  async function removeEntry(entry: ProcessIndicatorEntry) {
    if (readOnly) return
    const confirmed = await askConfirm({ title: 'Eliminar indicador', message: `Se eliminará «${entry.draft.name}» únicamente de este proceso.`, confirmLabel: 'Eliminar indicador' })
    if (!confirmed) return
    setEditorError('')
    setNotice('')
    try {
      if (processId && entry.id) await api(`/processes/${processId}/indicators/${entry.id}`, { method: 'DELETE' })
      setEntries((current) => current.filter((item) => item.key !== entry.key))
      if (expandedKey === entry.key) setExpandedKey(null)
      setNotice('Indicador eliminado correctamente.')
    } catch (requestError) {
      setEditorError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el indicador.')
    }
  }

  return (
    <section className="process-indicator-section">
      <div className="process-indicator-heading">
        <div><p className="detail-label">MEDICIÓN Y SEGUIMIENTO</p><h3>INDICADORES KPI</h3><p>Define indicadores propios de este proceso, independientes del catálogo KPI y de los procedimientos.</p></div>
        {!readOnly && <button type="button" className="button secondary small-button" onClick={openNew}>Añadir indicador</button>}
      </div>
      {notice && <div className="form-success process-indicator-notice" role="status">{notice}</div>}
      {editorError && !editorOpen && <div className="form-error process-indicator-error" role="alert">{editorError}</div>}
      {entries.length === 0 ? <p className="process-indicator-empty">No hay indicadores propios definidos. Puedes guardar el proceso y añadirlos después.</p> : <div className="process-indicator-list">{entries.map((entry) => {
        const expanded = expandedKey === entry.key
        return <article className={`process-indicator-card${expanded ? ' expanded' : ''}`} key={entry.key}>
          <div className="process-indicator-card-main">
            <div className="process-indicator-card-copy"><span className="process-indicator-kind">INDICADOR PROPIO</span><strong>{entry.draft.name || 'Sin nombre'}</strong><p>{entry.draft.frequency || 'Sin frecuencia'} · Meta {entry.draft.target || 'sin definir'} · {entry.draft.unit || 'Sin unidad'}</p></div>
            <div className="process-indicator-actions">
              <button type="button" className="text-button" onClick={() => setExpandedKey(expanded ? null : entry.key)} aria-expanded={expanded}>{expanded ? 'Ocultar' : 'Ver'}</button>
              {!readOnly && <><button type="button" className="text-button" onClick={() => openEdit(entry)}>Editar</button><button type="button" className="text-button danger-text" onClick={() => void removeEntry(entry)}>Eliminar</button></>}
            </div>
          </div>
          {expanded && <div className="process-indicator-detail"><div className="kpi-detail-grid">
            <div><span>Descripción</span><p>{entry.draft.description || 'Sin completar'}</p></div>
            <div><span>Fórmula</span><p>{entry.draft.formula || 'Sin completar'}</p></div>
            <div><span>Fuente de datos</span><p>{entry.draft.dataSource || 'Sin completar'}</p></div>
            <div><span>Unidad de medida</span><p>{entry.draft.unit || 'Sin completar'}</p></div>
            <div><span>Responsable de reporte</span><p>{users.find((user) => user.id === entry.draft.reportResponsibleId)?.name ?? 'Sin asignar'}</p></div>
            <div><span>Responsable de monitoreo</span><p>{users.find((user) => user.id === entry.draft.monitorResponsibleId)?.name ?? 'Sin asignar'}</p></div>
            <div><span>Línea base</span><p>{entry.draft.baselineValue || 'Sin completar'}</p></div>
            <div><span>Método de medición</span><p>{entry.draft.measurementMethod || 'Sin completar'}</p></div>
            <div><span>Fecha límite</span><p>{indicatorDateLabel(entry.draft.deadline)}</p></div>
            <div><span>Umbrales</span><p><span className="threshold-inline green">{entry.draft.greenThreshold || 'Verde sin definir'}</span><span className="threshold-inline yellow">{entry.draft.yellowThreshold || 'Amarillo sin definir'}</span><span className="threshold-inline red">{entry.draft.redThreshold || 'Rojo sin definir'}</span></p></div>
          </div></div>}
        </article>
      })}</div>}
      {editorOpen && <KpiIndicatorModal draft={editorDraft} setDraft={setEditorDraft} users={users} editing={Boolean(editingKey)} saving={saving} error={editorError} eyebrow="INDICADORES DEL PROCESO" title={editingKey ? 'EDITAR INDICADOR' : 'AÑADIR INDICADOR'} description="Define una métrica propia de este proceso. No se creará ni modificará ningún KPI compartido, indicador SMART o indicador de Procedimientos." ariaLabel={editingKey ? 'Editar indicador del proceso' : 'Añadir indicador del proceso'} onSubmit={() => void saveEditor()} onClose={closeEditor} />}
    </section>
  )
}

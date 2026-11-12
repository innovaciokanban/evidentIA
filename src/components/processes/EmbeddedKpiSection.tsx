import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ProcessKpi } from '../../types'
import { KpiFields } from './KpiForm'
import { embeddedKpiEntryFromKpi, emptyKpiDraft, kpiMissingFields, type KpiDraft, type KpiUser } from './process-kpi.model'

export type EmbeddedKpiEntry = {
  key: string
  id?: string
  draft: KpiDraft
}

let temporaryKpiSequence = 0
const temporaryKpiKey = () => `temporary-kpi-${Date.now()}-${temporaryKpiSequence++}`

type EmbeddedKpiSectionProps = {
  entries: EmbeddedKpiEntry[]
  setEntries: Dispatch<SetStateAction<EmbeddedKpiEntry[]>>
  users: KpiUser[]
  availableKpis?: ProcessKpi[]
  readOnly?: boolean
  allowUnlinkExisting?: boolean
  onLinkExisting?: (id: string) => void
  onUnlinkExisting?: (id: string) => void
  title?: string
  description?: string
}

export function EmbeddedKpiSection({ entries, setEntries, users, availableKpis = [], readOnly = false, allowUnlinkExisting = false, onLinkExisting, onUnlinkExisting, title = 'Indicadores KPI', description = 'Define los indicadores que medirán el resultado de esta entidad.' }: EmbeddedKpiSectionProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editorDraft, setEditorDraft] = useState<KpiDraft>(emptyKpiDraft)
  const [editorError, setEditorError] = useState('')
  const [selectedExistingId, setSelectedExistingId] = useState('')

  const linkedIds = new Set(entries.flatMap((entry) => entry.id ? [entry.id] : []))
  const linkableKpis = availableKpis.filter((kpi) => !linkedIds.has(kpi.id))

  function openNew() {
    setEditingKey(null)
    setEditorDraft({ ...emptyKpiDraft })
    setEditorError('')
    setEditorOpen(true)
  }

  function openEdit(entry: EmbeddedKpiEntry) {
    setEditingKey(entry.key)
    setEditorDraft({ ...entry.draft })
    setEditorError('')
    setEditorOpen(true)
  }

  function saveEditor() {
    const missing = kpiMissingFields(editorDraft)
    if (missing.length > 0) {
      setEditorError(`Completa: ${missing.join(', ')}.`)
      return
    }
    setEntries((current) => editingKey
      ? current.map((entry) => entry.key === editingKey ? { ...entry, draft: { ...editorDraft } } : entry)
      : [...current, { key: temporaryKpiKey(), draft: { ...editorDraft } }])
    setEditorOpen(false)
  }

  function linkExisting() {
    const kpi = linkableKpis.find((item) => item.id === selectedExistingId)
    if (!kpi) return
    setEntries((current) => [...current, embeddedKpiEntryFromKpi(kpi)])
    onLinkExisting?.(kpi.id)
    setSelectedExistingId('')
  }

  function removeEntry(entry: EmbeddedKpiEntry) {
    if (entry.id && !allowUnlinkExisting) return
    if (entry.id) onUnlinkExisting?.(entry.id)
    setEntries((current) => current.filter((item) => item.key !== entry.key))
  }

  return (
    <section className="embedded-kpi-section">
      <div className="embedded-kpi-heading">
        <div><p className="detail-label">MEDICIÓN Y SEGUIMIENTO</p><h3>{title}</h3><p>{description}</p></div>
        {!readOnly && <div className="embedded-kpi-actions"><button type="button" className="button secondary small-button" onClick={openNew}>Crear KPI nuevo</button>{linkableKpis.length > 0 && <><select value={selectedExistingId} onChange={(event) => setSelectedExistingId(event.target.value)} aria-label="Vincular KPI existente"><option value="">Selecciona un KPI existente</option>{linkableKpis.map((kpi) => <option key={kpi.id} value={kpi.id}>{kpi.name}</option>)}</select><button type="button" className="button secondary small-button" onClick={linkExisting} disabled={!selectedExistingId}>Vincular KPI existente</button></>}</div>}
      </div>
      {entries.length === 0 ? <p className="embedded-kpi-empty">No hay indicadores definidos. Puedes guardar sin KPI y añadirlos después.</p> : <div className="embedded-kpi-list">{entries.map((entry) => <article className="embedded-kpi-card" key={entry.key}><div className="embedded-kpi-card-copy"><span className={entry.id ? 'embedded-kpi-kind existing' : 'embedded-kpi-kind'}>{entry.id ? 'Vinculado al proceso' : 'Nuevo al guardar'}</span><strong>{entry.draft.name}</strong><p>{entry.draft.frequency} · Meta {entry.draft.target} · {entry.draft.unit}</p></div>{!readOnly && <div className="embedded-kpi-card-actions"><button type="button" className="text-button" onClick={() => openEdit(entry)}>Editar</button>{(!entry.id || allowUnlinkExisting) && <button type="button" className="text-button danger-text" onClick={() => removeEntry(entry)}>{entry.id ? 'Desvincular' : 'Quitar'}</button>}</div>}</article>)}</div>}
      {editorOpen && <div className="embedded-kpi-editor-backdrop"><div className="embedded-kpi-editor" role="dialog" aria-label={editingKey ? 'Editar indicador KPI' : 'Añadir indicador KPI'}><div className="embedded-kpi-editor-head"><div><p className="eyebrow">INDICADORES KPI</p><h4>{editingKey ? 'Editar indicador' : 'Añadir indicador'}</h4></div><button type="button" className="icon-button" onClick={() => setEditorOpen(false)} aria-label="Cerrar">×</button></div>{editorError && <div className="form-error embedded-kpi-editor-error" role="alert">{editorError}</div>}<KpiFields draft={editorDraft} setDraft={setEditorDraft} users={users} /><div className="embedded-kpi-editor-footer"><button type="button" className="button secondary" onClick={() => setEditorOpen(false)}>Cancelar</button><button type="button" className="button primary" onClick={saveEditor}>Añadir a la ficha</button></div></div></div>}
    </section>
  )
}

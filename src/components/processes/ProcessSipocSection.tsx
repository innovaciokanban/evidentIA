import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import type { ProcessSipoc, ProcessSipocItem } from '../../types'
import { askConfirm } from '../ui/useConfirm'

type SipocKind = keyof ProcessSipoc
type SipocEditor = { kind: SipocKind; item: ProcessSipocItem | null }

const kindMeta: Record<SipocKind, { title: string; singular: string; empty: string; description: string }> = {
  suppliers: { title: 'PROVEEDORES', singular: 'proveedor', empty: 'Sin proveedores registrados', description: 'Quién suministra lo que el proceso necesita.' },
  inputs: { title: 'ENTRADAS', singular: 'entrada', empty: 'Sin entradas registradas', description: 'Información, recursos o requisitos de entrada.' },
  outputs: { title: 'SALIDAS', singular: 'salida', empty: 'Sin salidas registradas', description: 'Resultados que entrega el proceso.' },
  customers: { title: 'CLIENTES', singular: 'cliente', empty: 'Sin clientes registrados', description: 'Quién recibe o utiliza los resultados.' },
}

const emptySipoc: ProcessSipoc = { suppliers: [], inputs: [], outputs: [], customers: [] }

function ItemForm({ kind, item, draft, saving, error, onDraftChange, onSubmit, onCancel }: {
  kind: SipocKind
  item: ProcessSipocItem | null
  draft: string
  saving: boolean
  error: string
  onDraftChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="sipoc-item-form">
      <label htmlFor={`sipoc-${kind}-${item?.id ?? 'new'}`}>{item ? `Editar ${kindMeta[kind].singular}` : `Nuevo ${kindMeta[kind].singular}`}</label>
      <input id={`sipoc-${kind}-${item?.id ?? 'new'}`} value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onSubmit() } }} placeholder={`Describe el ${kindMeta[kind].singular}`} maxLength={500} autoFocus required />
      {error && <span className="sipoc-inline-error" role="alert">{error}</span>}
      <div className="sipoc-item-actions">
        <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>
        <button type="button" className="button primary small-button" disabled={saving || !draft.trim()} onClick={onSubmit}>{saving ? 'Guardando...' : item ? 'Guardar' : 'Agregar'}</button>
      </div>
    </div>
  )
}

export function ProcessSipocSection({ processId, readOnly }: { processId?: string; readOnly: boolean }) {
  const [sipoc, setSipoc] = useState<ProcessSipoc>(emptySipoc)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<SipocEditor | null>(null)
  const [draft, setDraft] = useState('')

  const loadSipoc = useCallback(async () => {
    if (!processId) return
    setLoading(true)
    setError('')
    try {
      setSipoc(await api<ProcessSipoc>(`/processes/${processId}/sipoc`))
    } catch (requestError) {
      console.error('[process-sipoc] failed to load SIPOC', requestError)
      setError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar el análisis SIPOC.')
    } finally {
      setLoading(false)
    }
  }, [processId])

  useEffect(() => {
    if (processId) void loadSipoc()
    else setSipoc(emptySipoc)
  }, [loadSipoc, processId])

  function startCreate(kind: SipocKind) {
    if (readOnly) return
    setError('')
    setNotice('')
    setDraft('')
    setEditor({ kind, item: null })
  }

  function startEdit(kind: SipocKind, item: ProcessSipocItem) {
    if (readOnly) return
    setError('')
    setNotice('')
    setDraft(item.description)
    setEditor({ kind, item })
  }

  function closeEditor() {
    setEditor(null)
    setDraft('')
    setError('')
  }

  async function saveItem(kind: SipocKind, item: ProcessSipocItem | null) {
    if (!processId || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const path = `/processes/${processId}/sipoc/${kind}${item ? `/${item.id}` : ''}`
      await api<{ item: ProcessSipocItem }>(path, { method: item ? 'PATCH' : 'POST', body: JSON.stringify({ description: draft }) })
      await loadSipoc()
      closeEditor()
      setNotice(`${kindMeta[kind].singular[0].toUpperCase()}${kindMeta[kind].singular.slice(1)} ${item ? 'actualizado' : 'agregado'} correctamente.`)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el elemento SIPOC.')
    } finally {
      setSaving(false)
    }
  }

  async function removeItem(kind: SipocKind, item: ProcessSipocItem) {
    if (!processId || readOnly) return
    const confirmed = await askConfirm({ title: `Eliminar ${kindMeta[kind].singular}`, message: `Se eliminará «${item.description}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setError('')
    try {
      await api(`/processes/${processId}/sipoc/${kind}/${item.id}`, { method: 'DELETE' })
      await loadSipoc()
      setNotice(`${kindMeta[kind].singular[0].toUpperCase()}${kindMeta[kind].singular.slice(1)} eliminado correctamente.`)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el elemento SIPOC.')
    }
  }

  return (
    <section className="characterization-section sipoc-section">
      <div className="characterization-section-heading sipoc-heading">
        <div><p className="detail-label">ANÁLISIS DEL PROCESO</p><h3>ANÁLISIS SIPOC</h3><p className="sipoc-subtitle">Identifica los proveedores, entradas, salidas y clientes relacionados con el proceso.</p></div>
        {!readOnly && processId && <div className="sipoc-header-actions"><button type="button" className="button secondary small-button" onClick={() => startCreate('suppliers')}>+ Proveedor / Entrada</button><button type="button" className="button secondary small-button" onClick={() => startCreate('outputs')}>+ Salida / Cliente</button></div>}
      </div>
      {!processId && <p className="sipoc-save-note">Guarda el proceso para comenzar a registrar sus elementos SIPOC.</p>}
      {processId && notice && <div className="form-success sipoc-notice" role="status">{notice}</div>}
      {processId && error && !editor && <div className="form-error sipoc-error" role="alert">{error}<button type="button" className="button secondary small-button" onClick={() => void loadSipoc()}>Reintentar</button></div>}
      {processId && (loading ? <div className="inline-loading"><span className="loader" />Cargando análisis SIPOC...</div> : (
        <div className="sipoc-grid">
          {(Object.keys(kindMeta) as SipocKind[]).map((kind) => {
            const meta = kindMeta[kind]
            const items = sipoc[kind]
            const editing = editor?.kind === kind ? editor.item : null
            const creating = editor?.kind === kind && !editor.item
            return <article className={`sipoc-column sipoc-${kind}`} key={kind}>
              <header className="sipoc-column-header"><div><span className="sipoc-column-kicker">{meta.title}</span><p>{meta.description}</p></div><span className="sipoc-count">{items.length}</span></header>
              {editor?.kind === kind && <ItemForm kind={kind} item={editing} draft={draft} saving={saving} error={error} onDraftChange={setDraft} onSubmit={() => void saveItem(kind, editing)} onCancel={closeEditor} />}
              <div className="sipoc-items">
                {items.map((item) => <div className="sipoc-item" key={item.id}><span className="sipoc-item-marker" /><span className="sipoc-item-text">{item.description}</span>{!readOnly && !creating && <span className="sipoc-item-actions"><button type="button" className="sipoc-icon-button" aria-label={`Editar ${item.description}`} title="Editar" onClick={() => startEdit(kind, item)}>✎</button><button type="button" className="sipoc-icon-button danger" aria-label={`Eliminar ${item.description}`} title="Eliminar" onClick={() => void removeItem(kind, item)}>×</button></span>}</div>)}
                {items.length === 0 && (!editor || editor.kind !== kind) && <div className="sipoc-empty"><span>{meta.empty}</span>{!readOnly && <button type="button" className="text-button" onClick={() => startCreate(kind)}>+ Agregar {meta.singular}</button>}</div>}
              </div>
              {!readOnly && !editor && <button type="button" className="sipoc-add-button" onClick={() => startCreate(kind)}>+ Agregar {meta.singular}</button>}
            </article>
          })}
        </div>
      ))}
    </section>
  )
}

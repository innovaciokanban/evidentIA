import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Process, ProcessKpi, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'

export type KpiUser = Pick<User, 'id' | 'name'> & { companyId: string | null }

export type KpiDraft = {
  name: string
  description: string
  frequency: string
  target: string
  formula: string
  dataSource: string
  unit: string
  reportResponsibleId: string
  monitorResponsibleId: string
  greenThreshold: string
  yellowThreshold: string
  redThreshold: string
}

const emptyKpiDraft: KpiDraft = {
  name: '', description: '', frequency: '', target: '', formula: '', dataSource: '', unit: '',
  reportResponsibleId: '', monitorResponsibleId: '', greenThreshold: '', yellowThreshold: '', redThreshold: '',
}

const draftFromKpi = (kpi: ProcessKpi): KpiDraft => ({
  name: kpi.name,
  description: kpi.description,
  frequency: kpi.frequency,
  target: kpi.target,
  formula: kpi.formula,
  dataSource: kpi.dataSource,
  unit: kpi.unit,
  reportResponsibleId: kpi.reportResponsible?.id ?? '',
  monitorResponsibleId: kpi.monitorResponsible?.id ?? '',
  greenThreshold: kpi.greenThreshold ?? '',
  yellowThreshold: kpi.yellowThreshold ?? '',
  redThreshold: kpi.redThreshold ?? '',
})

type KpiFormProps = {
  draft: KpiDraft
  setDraft: React.Dispatch<React.SetStateAction<KpiDraft>>
  users: KpiUser[]
  editing: boolean
  saving: boolean
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

function KpiForm({ draft, setDraft, users, editing, saving, error, onSubmit, onClose }: KpiFormProps) {
  const update = <K extends keyof KpiDraft>(field: K, value: KpiDraft[K]) => setDraft((current) => ({ ...current, [field]: value }))
  const updateResponsible = (field: 'reportResponsibleId' | 'monitorResponsibleId', value: string) => update(field, value)

  return (
    <form className="kpi-form panel" onSubmit={onSubmit}>
      <header className="kpi-form-header">
        <div>
          <p className="eyebrow">INDICADORES KPI</p>
          <h2>{editing ? 'EDITAR INDICADOR' : 'NUEVO INDICADOR'}</h2>
          <p>Define la configuración del indicador. La medición se incorporará en una fase posterior.</p>
        </div>
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      </header>
      {error && <div className="form-error kpi-form-error" role="alert">{error}</div>}
      <section className="kpi-form-section">
        <div className="kpi-form-grid">
          <label className="kpi-field-wide">Nombre del indicador<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Cumplimiento de entregas" minLength={3} maxLength={120} required /></label>
          <label>Frecuencia<input value={draft.frequency} onChange={(event) => update('frequency', event.target.value)} placeholder="Ej. Mensual" maxLength={80} required /></label>
          <label>Meta<input value={draft.target} onChange={(event) => update('target', event.target.value)} placeholder="Ej. 95%" maxLength={120} required /></label>
          <label>Unidad de medida<input value={draft.unit} onChange={(event) => update('unit', event.target.value)} placeholder="Ej. Porcentaje" maxLength={80} required /></label>
          <label>Responsable de reporte<select value={draft.reportResponsibleId} onChange={(event) => updateResponsible('reportResponsibleId', event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label>Responsable de monitoreo<select value={draft.monitorResponsibleId} onChange={(event) => updateResponsible('monitorResponsibleId', event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label className="kpi-field-wide">Fórmula<textarea value={draft.formula} onChange={(event) => update('formula', event.target.value)} placeholder="Ej. Entregas a tiempo / total de entregas × 100" rows={3} maxLength={1000} required /></label>
          <label className="kpi-field-wide">Fuente de datos<textarea value={draft.dataSource} onChange={(event) => update('dataSource', event.target.value)} placeholder="Sistema, registro o fuente que alimenta el indicador" rows={3} maxLength={1000} required /></label>
          <label className="kpi-field-wide">Descripción<textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Qué mide el indicador y para qué se utiliza" rows={4} maxLength={5000} required /></label>
        </div>
      </section>
      <section className="kpi-form-section kpi-threshold-section">
        <div className="kpi-section-heading"><div><p className="detail-label">CONFIGURACIÓN</p><h3>UMBRALES DEL SEMÁFORO</h3></div><span>Opcionales hasta contar con mediciones</span></div>
        <div className="kpi-threshold-grid">
          <label><span className="threshold-dot green" />Umbral verde<input value={draft.greenThreshold} onChange={(event) => update('greenThreshold', event.target.value)} placeholder="Ej. ≥ 95%" maxLength={120} /></label>
          <label><span className="threshold-dot yellow" />Umbral amarillo<input value={draft.yellowThreshold} onChange={(event) => update('yellowThreshold', event.target.value)} placeholder="Ej. 80% - 94%" maxLength={120} /></label>
          <label><span className="threshold-dot red" />Umbral rojo<input value={draft.redThreshold} onChange={(event) => update('redThreshold', event.target.value)} placeholder="Ej. < 80%" maxLength={120} /></label>
        </div>
      </section>
      <footer className="kpi-form-footer">
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar indicador'}</button>
      </footer>
    </form>
  )
}

export function ProcessKpiPanel({ process, users, canWrite, onBack }: { process: Process; users: KpiUser[]; canWrite: boolean; onBack: () => void }) {
  const [kpis, setKpis] = useState<ProcessKpi[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProcessKpi | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<KpiDraft>(emptyKpiDraft)

  const availableUsers = users.filter((user) => user.companyId === process.companyId)
  const loadKpis = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ kpis: ProcessKpi[] }>(`/processes/${process.id}/kpis`)
      setKpis(result.kpis)
    } catch (requestError) {
      console.error('[process-kpis] failed to load KPIs', requestError)
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar los indicadores KPI.')
    } finally {
      setLoading(false)
    }
  }, [process.id])

  useEffect(() => { void loadKpis() }, [loadKpis])

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setFormError('')
  }

  function startCreate() {
    setEditing(null)
    setDraft(emptyKpiDraft)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function startEdit(kpi: ProcessKpi) {
    setEditing(kpi)
    setDraft(draftFromKpi(kpi))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  async function saveKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError('')
    setNotice('')
    const payload = {
      name: draft.name,
      description: draft.description,
      frequency: draft.frequency,
      target: draft.target,
      formula: draft.formula,
      dataSource: draft.dataSource,
      unit: draft.unit,
      reportResponsibleId: draft.reportResponsibleId || null,
      monitorResponsibleId: draft.monitorResponsibleId || null,
      greenThreshold: draft.greenThreshold.trim() || null,
      yellowThreshold: draft.yellowThreshold.trim() || null,
      redThreshold: draft.redThreshold.trim() || null,
    }
    try {
      if (editing) {
        await api<{ kpi: ProcessKpi }>(`/processes/${process.id}/kpis/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api<{ kpi: ProcessKpi }>(`/processes/${process.id}/kpis`, { method: 'POST', body: JSON.stringify(payload) })
      }
      await loadKpis()
      closeForm()
      setNotice(`Indicador ${editing ? 'actualizado' : 'creado'} correctamente.`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el indicador.')
    } finally {
      setSaving(false)
    }
  }

  async function removeKpi(kpi: ProcessKpi) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar indicador', message: `Se eliminará «${kpi.name}». Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setFormError('')
    try {
      await api(`/processes/${process.id}/kpis/${kpi.id}`, { method: 'DELETE' })
      await loadKpis()
      setNotice('Indicador eliminado correctamente.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el indicador.')
    }
  }

  return (
    <div className="process-kpi-page">
      <div className="kpi-page-header">
        <button type="button" className="text-button kpi-back-button" onClick={onBack}>← Volver a la caracterización</button>
        <div className="kpi-page-heading">
          <div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO KPI</p><h1>Indicadores KPI</h1><p className="muted">Administra los indicadores que pertenecen exclusivamente a este proceso.</p></div>
          {!showForm && canWrite && <button type="button" className="button primary" onClick={startCreate}>+ Nuevo indicador</button>}
        </div>
      </div>

      <section className="panel kpi-process-context">
        <div><span>Proceso</span><strong>{process.name}</strong></div>
        <div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div>
        <div><span>Indicadores configurados</span><strong>{kpis.length}</strong></div>
      </section>

      {notice && !showForm && <div className="form-success page-alert" role="status">{notice}</div>}
      {showForm ? (
        <KpiForm draft={draft} setDraft={setDraft} users={availableUsers} editing={Boolean(editing)} saving={saving} error={formError} onSubmit={(event) => void saveKpi(event)} onClose={closeForm} />
      ) : (
        <section className="panel kpi-list-panel">
          <div className="panel-heading kpi-list-heading"><div><p className="detail-label">INDICADORES DEL PROCESO</p><h2>Listado de KPI</h2></div><span className="kpi-measure-note">Sin medición actual</span></div>
          {loadError && <div className="form-error kpi-list-error" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadKpis()}>Reintentar</button></div>}
          {loading ? <div className="inline-loading"><span className="loader" />Cargando indicadores...</div> : kpis.length === 0 ? (
            <div className="kpi-empty"><span className="kpi-empty-icon">◫</span><h3>Aún no hay indicadores</h3><p>Define el primer KPI para hacer seguimiento a este proceso.</p>{canWrite && <button type="button" className="button secondary" onClick={startCreate}>Crear primer indicador</button>}</div>
          ) : (
            <div className="kpi-table-wrap">
              <div className="kpi-table-head"><span>Indicador</span><span>Frecuencia</span><span>Meta</span><span>Estado</span><span /></div>
              {kpis.map((kpi) => {
                const expanded = expandedId === kpi.id
                return <article className={`kpi-row${expanded ? ' expanded' : ''}`} key={kpi.id}>
                  <button type="button" className="kpi-row-summary" onClick={() => setExpandedId(expanded ? null : kpi.id)} aria-expanded={expanded}>
                    <span className="kpi-name-cell"><strong>{kpi.name}</strong><small>{kpi.description}</small></span>
                    <span>{kpi.frequency}</span>
                    <span>{kpi.target}</span>
                    <span className="kpi-status configured">Sin medición</span>
                    <span className="kpi-expand-icon">{expanded ? '⌃' : '⌄'}</span>
                  </button>
                  {expanded && <div className="kpi-detail">
                    <div className="kpi-detail-grid">
                      <div><span>Definición / descripción</span><p>{kpi.description}</p></div>
                      <div><span>Fórmula</span><p>{kpi.formula}</p></div>
                      <div><span>Fuente de datos</span><p>{kpi.dataSource}</p></div>
                      <div><span>Unidad de medida</span><p>{kpi.unit}</p></div>
                      <div><span>Responsable de reporte</span><p>{kpi.reportResponsible?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Responsable de monitoreo</span><p>{kpi.monitorResponsible?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Frecuencia</span><p>{kpi.frequency}</p></div>
                      <div><span>Umbrales</span><p><span className="threshold-inline green">{kpi.greenThreshold ?? 'Verde sin definir'}</span><span className="threshold-inline yellow">{kpi.yellowThreshold ?? 'Amarillo sin definir'}</span><span className="threshold-inline red">{kpi.redThreshold ?? 'Rojo sin definir'}</span></p></div>
                    </div>
                    {canWrite && <div className="kpi-detail-actions"><button type="button" className="button secondary small-button" onClick={() => startEdit(kpi)}>Editar</button><button type="button" className="button danger small-button" onClick={() => void removeKpi(kpi)}>Eliminar</button></div>}
                  </div>}
                </article>
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

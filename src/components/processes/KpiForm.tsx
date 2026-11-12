import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { KpiDraft, KpiUser } from './process-kpi.model'
import { userOptionLabel } from '../../user-status'

const frequencyOptions = ['Diaria', 'Semanal', 'Quincenal', 'Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Anual']

export type KpiSupplementalFields = {
  baselineValue: string
  measurementMethod: string
  deadline: string
}

type KpiFormProps = {
  draft: KpiDraft
  setDraft: Dispatch<SetStateAction<KpiDraft>>
  users: KpiUser[]
  editing: boolean
  saving: boolean
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export function KpiForm({ draft, setDraft, users, editing, saving, error, onSubmit, onClose }: KpiFormProps) {
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
      <KpiFields draft={draft} setDraft={setDraft} users={users} />
      <footer className="kpi-form-footer">
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar indicador'}</button>
      </footer>
    </form>
  )
}

export function KpiFields<T extends KpiDraft>({ draft, setDraft, users, supplemental }: { draft: T; setDraft: Dispatch<SetStateAction<T>>; users: KpiUser[]; supplemental?: KpiSupplementalFields }) {
  const update = <K extends keyof KpiDraft>(field: K, value: KpiDraft[K]) => setDraft((current) => ({ ...current, [field]: value } as T))
  const updateResponsible = (field: 'reportResponsibleId' | 'monitorResponsibleId', value: string) => update(field, value)
  const updateSupplemental = <K extends keyof KpiSupplementalFields>(field: K, value: KpiSupplementalFields[K]) => setDraft((current) => ({ ...current, [field]: value } as T))
  const availableFrequencies = draft.frequency && !frequencyOptions.includes(draft.frequency) ? [draft.frequency, ...frequencyOptions] : frequencyOptions

  return (
    <>
      <section className="kpi-form-section">
        <div className="kpi-section-heading"><div><p className="detail-label">CONFIGURACIÓN BASE</p><h3>INFORMACIÓN GENERAL</h3></div><span>La métrica y el resultado esperado</span></div>
        <div className="kpi-form-grid kpi-general-grid">
          <label className="kpi-field-wide">Nombre del indicador<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Cumplimiento de entregas" minLength={3} maxLength={120} required /></label>
          <label>Frecuencia<select value={draft.frequency} onChange={(event) => update('frequency', event.target.value)} required><option value="">Seleccionar frecuencia</option>{availableFrequencies.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}</select></label>
          <label>Unidad de medida<input value={draft.unit} onChange={(event) => update('unit', event.target.value)} placeholder="Ej. Porcentaje" maxLength={80} required /></label>
          <label>Meta<input value={draft.target} onChange={(event) => update('target', event.target.value)} placeholder="Ej. 95%" maxLength={120} required /></label>
          {supplemental && <label>Línea base<input value={supplemental.baselineValue} onChange={(event) => updateSupplemental('baselineValue', event.target.value)} placeholder="Ej. 82%" maxLength={120} /></label>}
        </div>
      </section>
      <section className="kpi-form-section">
        <div className="kpi-section-heading"><div><p className="detail-label">GESTIÓN DE LA INFORMACIÓN</p><h3>RESPONSABLES</h3></div><span>Quién reporta y quién monitorea</span></div>
        <div className="kpi-form-grid">
           <label>Responsable de reporte<select value={draft.reportResponsibleId} onChange={(event) => updateResponsible('reportResponsibleId', event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>)}</select></label>
           <label>Responsable de monitoreo<select value={draft.monitorResponsibleId} onChange={(event) => updateResponsible('monitorResponsibleId', event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>)}</select></label>
        </div>
      </section>
      <section className="kpi-form-section">
        <div className="kpi-section-heading"><div><p className="detail-label">TRAZABILIDAD</p><h3>MEDICIÓN Y SEGUIMIENTO</h3></div><span>Cómo se calcula, alimenta y revisa</span></div>
        <div className="kpi-form-grid kpi-measurement-grid">
           <label className="kpi-field-wide">Fórmula<textarea value={draft.formula} onChange={(event) => update('formula', event.target.value)} placeholder="Ej. Entregas a tiempo / total de entregas × 100" rows={3} maxLength={1000} required /></label>
           <label className="kpi-field-wide">Fuente de datos<textarea value={draft.dataSource} onChange={(event) => update('dataSource', event.target.value)} placeholder="Sistema, registro o fuente que alimenta el indicador" rows={3} maxLength={1000} required /></label>
           {supplemental && <label className="kpi-field-wide">Método de medición<textarea value={supplemental.measurementMethod} onChange={(event) => updateSupplemental('measurementMethod', event.target.value)} placeholder="Ej. Reporte mensual consolidado" rows={2} maxLength={1000} /></label>}
           {supplemental && <label>Fecha límite<input type="date" value={supplemental.deadline} onChange={(event) => updateSupplemental('deadline', event.target.value)} /></label>}
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
    </>
  )
}

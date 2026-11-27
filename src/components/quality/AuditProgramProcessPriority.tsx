import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { AuditProgramProcessPriority, AuditProgramProcessPriorityLevel, AuditProgramStatus, Process } from '../../types'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import { priorityForScore } from './audit-program-priority.model'

type CriterionField = 'criticality' | 'recentChanges' | 'previousUnfavorableResults'
type PriorityForm = {
  processId: string
  criticality: number | null
  recentChanges: number | null
  previousUnfavorableResults: number | null
  manualPriority: AuditProgramProcessPriorityLevel | ''
  manualJustification: string
  observations: string
}

const priorityLabels: Record<AuditProgramProcessPriorityLevel, string> = { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' }
const criterionFields: Array<{ field: CriterionField; label: string; description: string; levels: string[] }> = [
  { field: 'criticality', label: 'Criticidad', description: 'Impacto del proceso sobre los objetivos y resultados de la organización.', levels: ['Impacto bajo', 'Impacto medio', 'Impacto alto'] },
  { field: 'recentChanges', label: 'Cambios recientes', description: 'Nivel de cambio reciente en el proceso, responsables, controles o contexto.', levels: ['Sin cambios relevantes', 'Cambios moderados', 'Cambios importantes'] },
  { field: 'previousUnfavorableResults', label: 'Resultados desfavorables anteriores', description: 'Evidencia de resultados no favorables en revisiones o mediciones anteriores.', levels: ['Sin resultados desfavorables', 'Antecedentes puntuales', 'Antecedentes recurrentes'] },
]

const emptyForm: PriorityForm = { processId: '', criticality: null, recentChanges: null, previousUnfavorableResults: null, manualPriority: '', manualJustification: '', observations: '' }

const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

const priorityClass = (priority: AuditProgramProcessPriorityLevel) => `audit-priority-pill ${priority.toLowerCase()}`

export function AuditProgramProcessPriorityMatrix({ programId, companyId, programStatus, processes, canWrite }: { programId: string; companyId: string; programStatus: AuditProgramStatus; processes: Process[]; canWrite: boolean }) {
  const [items, setItems] = useState<AuditProgramProcessPriority[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AuditProgramProcessPriority | null>(null)
  const [form, setForm] = useState<PriorityForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const canManage = canWrite && (programStatus === 'DRAFT' || programStatus === 'ACTIVE')

  const loadPriorities = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ processPriorities: AuditProgramProcessPriority[] }>(`/audit-programs/${programId}/process-priorities`)
      setItems(result.processPriorities)
    } catch (error) {
      setLoadError(errorMessage(error, 'No se pudo cargar la matriz de priorización.'))
    } finally {
      setLoading(false)
    }
  }, [programId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPriorities() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadPriorities])

  const availableProcesses = useMemo(() => {
    const evaluatedIds = new Set(items.map((item) => item.processId))
    return processes.filter((process) => process.companyId === companyId && (!evaluatedIds.has(process.id) || process.id === editing?.processId))
  }, [companyId, editing?.processId, items, processes])

  const indicators = useMemo(() => items.reduce((summary, item) => ({
    evaluated: summary.evaluated + 1,
    high: summary.high + (item.effectivePriority === 'HIGH' ? 1 : 0),
    medium: summary.medium + (item.effectivePriority === 'MEDIUM' ? 1 : 0),
    low: summary.low + (item.effectivePriority === 'LOW' ? 1 : 0),
  }), { evaluated: 0, high: 0, medium: 0, low: 0 }), [items])

  const { criticality, recentChanges, previousUnfavorableResults } = form
  const criteriaComplete = criticality !== null && recentChanges !== null && previousUnfavorableResults !== null
  const estimatedScore = criteriaComplete ? criticality + recentChanges + previousUnfavorableResults : null
  const estimatedPriority = estimatedScore === null ? null : priorityForScore(estimatedScore)

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function openEdit(item: AuditProgramProcessPriority) {
    setEditing(item)
    setForm({ processId: item.processId, criticality: item.criticality, recentChanges: item.recentChanges, previousUnfavorableResults: item.previousUnfavorableResults, manualPriority: item.manualPriority ?? '', manualJustification: item.manualJustification ?? '', observations: item.observations ?? '' })
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function updateCriterion(field: CriterionField, value: number) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function savePriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!form.processId) {
      setFormError('Selecciona un proceso para evaluar.')
      return
    }
    if (!criteriaComplete) {
      setFormError('Completa los tres criterios antes de guardar.')
      return
    }
    if (form.manualPriority && !form.manualJustification.trim()) {
      setFormError('Explica la razón de la prioridad manual antes de guardar.')
      return
    }
    setSaving(true)
    setFormError('')
    setNotice('')
    const body = {
      ...(editing ? {} : { processId: form.processId }),
      criticality: form.criticality,
      recentChanges: form.recentChanges,
      previousUnfavorableResults: form.previousUnfavorableResults,
      manualPriority: form.manualPriority || null,
      manualJustification: form.manualJustification.trim() || null,
      observations: form.observations.trim() || null,
    }
    try {
      if (editing) {
        await api(`/audit-programs/${programId}/process-priorities/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await api(`/audit-programs/${programId}/process-priorities`, { method: 'POST', body: JSON.stringify(body) })
      }
      await loadPriorities()
      setShowForm(false)
      setEditing(null)
      setNotice(`Evaluación ${editing ? 'actualizada' : 'creada'} correctamente.`)
    } catch (error) {
      setFormError(errorMessage(error, 'No se pudo guardar la evaluación de priorización.'))
    } finally {
      setSaving(false)
    }
  }

  async function removePriority(item: AuditProgramProcessPriority) {
    const confirmed = await askConfirm({ title: 'Eliminar evaluación', message: `Se eliminará la evaluación de «${item.process.name}». El proceso original no se modifica.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setDeletingId(item.id)
    setFormError('')
    try {
      await api(`/audit-programs/${programId}/process-priorities/${item.id}`, { method: 'DELETE' })
      await loadPriorities()
      setNotice('Evaluación eliminada correctamente.')
    } catch (error) {
      setFormError(errorMessage(error, 'No se pudo eliminar la evaluación.'))
    } finally {
      setDeletingId(null)
    }
  }

  return <section className="audit-program-priority-section" aria-labelledby="audit-program-priority-title">
    <div className="audit-program-priority-heading"><div><p className="eyebrow">PLANIFICACIÓN BASADA EN RIESGO</p><h2 id="audit-program-priority-title">Priorización de procesos</h2><p className="muted">Evalúa qué procesos requieren mayor atención para orientar la planificación. Esta matriz no crea auditorías automáticamente.</p></div>{canManage && <button type="button" className="button primary" onClick={openCreate}>Evaluar proceso</button>}</div>
    {notice && <div className="notice success" role="status">{notice}</div>}
    {formError && !showForm && <div className="notice error" role="alert">{formError}</div>}
    {!loading && !loadError && <div className="audit-priority-metrics" aria-label="Indicadores de priorización"><PriorityMetric label="Procesos evaluados" value={indicators.evaluated} tone="blue" /><PriorityMetric label="Prioridad alta" value={indicators.high} tone="red" /><PriorityMetric label="Prioridad media" value={indicators.medium} tone="amber" /><PriorityMetric label="Prioridad baja" value={indicators.low} tone="green" /></div>}
    {loading ? <LoadingState text="Cargando matriz de priorización…" /> : loadError ? <div className="notice error" role="alert">{loadError}</div> : items.length === 0 ? <EmptyState compact title="Sin procesos evaluados" text="Agrega procesos reales de la empresa para orientar la planificación de auditorías." action={canManage ? <button type="button" className="button primary" onClick={openCreate}>Evaluar proceso</button> : undefined} /> : <div className="audit-priority-table-wrap"><table className="audit-priority-table"><thead><tr><th>Proceso</th><th>Criticidad</th><th>Cambios recientes</th><th>Resultados anteriores</th><th>Puntuación</th><th>Calculada</th><th>Efectiva</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <PriorityRow key={item.id} item={item} canManage={canManage} deleting={deletingId === item.id} onEdit={() => openEdit(item)} onDelete={() => void removePriority(item)} />)}</tbody></table></div>}
     {showForm && <PriorityFormModal form={form} editing={editing} availableProcesses={availableProcesses} estimatedScore={estimatedScore} estimatedPriority={estimatedPriority} canSubmit={Boolean(form.processId && criteriaComplete && (!form.manualPriority || form.manualJustification.trim()))} saving={saving} error={formError} onCriterionChange={updateCriterion} onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))} onSubmit={savePriority} onClose={() => { if (!saving) setShowForm(false) }} />}
  </section>
}

function PriorityMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`audit-priority-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

function PriorityRow({ item, canManage, deleting, onEdit, onDelete }: { item: AuditProgramProcessPriority; canManage: boolean; deleting: boolean; onEdit: () => void; onDelete: () => void }) {
  const hasDetails = Boolean(item.manualJustification || item.observations)
  return <>
    <tr><td className="audit-priority-process"><strong>{item.process.code ?? 'Sin código'}</strong><span>{item.process.name}</span>{item.manualPriority && <em>Ajustada manualmente</em>}</td><td>{item.criticality}</td><td>{item.recentChanges}</td><td>{item.previousUnfavorableResults}</td><td><strong className="audit-priority-score">{item.score}</strong></td><td><span className={priorityClass(item.calculatedPriority)}>{priorityLabels[item.calculatedPriority]}</span></td><td><span className={priorityClass(item.effectivePriority)}>{priorityLabels[item.effectivePriority]}</span></td><td><div className="audit-priority-actions">{hasDetails && <details><summary>Detalle</summary><div><p><strong>Justificación:</strong> {item.manualJustification ?? 'No aplica'}</p><p><strong>Observaciones:</strong> {item.observations ?? 'Sin observaciones'}</p></div></details>}{canManage && <button type="button" className="text-button" onClick={onEdit}>Editar</button>}{canManage && <button type="button" className="text-button danger" disabled={deleting} onClick={onDelete}>{deleting ? 'Eliminando…' : 'Eliminar'}</button>}</div></td></tr>
  </>
}

type PriorityFormModalProps = {
  form: PriorityForm
  editing: AuditProgramProcessPriority | null
  availableProcesses: Process[]
  estimatedScore: number | null
  estimatedPriority: AuditProgramProcessPriorityLevel | null
  canSubmit: boolean
  saving: boolean
  error: string
  onCriterionChange: (field: CriterionField, value: number) => void
  onChange: (field: 'processId' | 'manualPriority' | 'manualJustification' | 'observations', value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export function PriorityFormModal({ form, editing, availableProcesses, estimatedScore, estimatedPriority, canSubmit, saving, error, onCriterionChange, onChange, onSubmit, onClose }: PriorityFormModalProps) {
  return <div className="drawer-backdrop centered-backdrop"><form className="drawer centered-modal company-modal audit-priority-modal" onSubmit={onSubmit}><header className="company-modal-header"><div className="company-modal-icon audit-program-modal-icon">◎</div><div className="company-modal-title"><p className="eyebrow">MATRIZ DE PRIORIZACIÓN</p><h2>{editing ? 'Editar evaluación' : 'Evaluar proceso'}</h2><p className="company-modal-subtitle">La puntuación se calcula con los tres criterios. El backend confirma el resultado al guardar.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar modal">×</button></header>{error && <div className="form-error" role="alert">{error}</div>}<div className="audit-priority-form-body"><label className="audit-priority-process-field">Proceso<select value={form.processId} onChange={(event) => onChange('processId', event.target.value)} disabled={Boolean(editing)} required><option value="">Selecciona un proceso</option>{availableProcesses.map((process) => <option value={process.id} key={process.id}>{process.code ? `${process.code} · ` : ''}{process.name}</option>)}</select></label><div className="audit-priority-criteria">{criterionFields.map(({ field, label, description, levels }) => <fieldset key={field}><legend>{label}</legend><p>{description}</p><div className="audit-priority-levels">{[1, 2, 3].map((level) => <label key={level} className={form[field] === level ? 'selected' : ''}><input type="radio" name={field} value={level} checked={form[field] === level} onChange={() => onCriterionChange(field, level)} required={level === 1} /><span>{level}</span><small>{levels[level - 1]}</small></label>)}</div></fieldset>)}</div>{estimatedScore !== null && estimatedPriority && <div className="audit-priority-estimate"><div><span>Puntuación estimada</span><strong>{estimatedScore} / 9</strong></div><span className={priorityClass(estimatedPriority)}>{priorityLabels[estimatedPriority]}</span></div>}<label><span>Prioridad manual opcional</span><select value={form.manualPriority} onChange={(event) => onChange('manualPriority', event.target.value)}><option value="">Usar prioridad calculada</option><option value="HIGH">Alta</option><option value="MEDIUM">Media</option><option value="LOW">Baja</option></select><small className="audit-priority-help">Permite ajustar la prioridad calculada mediante criterio profesional.</small></label>{form.manualPriority && <label>Justificación de prioridad manual<textarea value={form.manualJustification} onChange={(event) => onChange('manualJustification', event.target.value)} required minLength={1} maxLength={2000} rows={3} placeholder="Explica por qué se ajusta la prioridad calculada." /></label>}<label>Observaciones<textarea value={form.observations} onChange={(event) => onChange('observations', event.target.value)} maxLength={5000} rows={3} placeholder="Notas relevantes para la planificación." /></label></div><footer className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving || !canSubmit}>{saving ? 'Guardando…' : 'Guardar evaluación'}</button></footer></form></div>
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import { smartErrorMessage, smartMissingFields } from './strategic-objectives.model'
import type { DiagnosticStrategy, StrategicObjective, StrategicObjectiveStrategy, StrategicObjectiveSuggestion, StrategyBand, StrategySource } from '../../types'

export type StrategicStrategyOption = DiagnosticStrategy & { sourceRef: string }

type ObjectiveDraft = {
  title: string
  statement: string
  specificCriteria: string
  measurableCriteria: string
  achievableCriteria: string
  relevantCriteria: string
  timeBoundCriteria: string
  hasIndicator: boolean
  indicator: {
    name: string
    unit: string
    baselineValue: string
    targetValue: string
    measurementMethod: string
    deadline: string
  }
}

const emptyDraft: ObjectiveDraft = {
  title: '',
  statement: '',
  specificCriteria: '',
  measurableCriteria: '',
  achievableCriteria: '',
  relevantCriteria: '',
  timeBoundCriteria: '',
  hasIndicator: false,
  indicator: { name: '', unit: '', baselineValue: '', targetValue: '', measurementMethod: '', deadline: '' },
}

const criterionFields: Array<{ key: keyof Pick<ObjectiveDraft, 'specificCriteria' | 'measurableCriteria' | 'achievableCriteria' | 'relevantCriteria' | 'timeBoundCriteria'>; label: string; hint: string }> = [
  { key: 'specificCriteria', label: 'Específico', hint: 'Qué se quiere cambiar y dónde.' },
  { key: 'measurableCriteria', label: 'Medible', hint: 'Cómo se comprobará el avance.' },
  { key: 'achievableCriteria', label: 'Alcanzable', hint: 'Qué hace viable el objetivo.' },
  { key: 'relevantCriteria', label: 'Relevante', hint: 'Por qué importa para la organización.' },
  { key: 'timeBoundCriteria', label: 'Temporal', hint: 'En qué horizonte debe lograrse.' },
]

const indicatorFields: Array<{ key: keyof ObjectiveDraft['indicator']; label: string; type?: 'date'; wide?: boolean }> = [
  { key: 'name', label: 'Nombre del indicador' },
  { key: 'unit', label: 'Unidad' },
  { key: 'baselineValue', label: 'Línea base' },
  { key: 'targetValue', label: 'Meta' },
  { key: 'measurementMethod', label: 'Método de medición', wide: true },
  { key: 'deadline', label: 'Fecha límite', type: 'date' },
]

const sourceLabels: Record<StrategySource, string> = { AI_ANALYSIS: 'Análisis IA', CHECKY: 'Checky', STRATEGIC_CROSS: 'Cruce DOFA' }
const sourceTones: Record<StrategySource, string> = { AI_ANALYSIS: 'ai', CHECKY: 'checky', STRATEGIC_CROSS: 'cross' }
const bandLabels: Record<StrategyBand, string> = { INMEDIATA: 'Inmediata', CORTO_PLAZO: 'Corto plazo', MEDIANO_PLAZO: 'Mediano plazo', LARGO_PLAZO: 'Largo plazo' }
const statusLabels = { DRAFT: 'Borrador', APPROVED: 'Aprobado' } as const
const pendingFieldLabels: Record<string, string> = { specificCriteria: 'criterio específico', measurableCriteria: 'criterio medible', achievableCriteria: 'criterio alcanzable', relevantCriteria: 'criterio relevante', timeBoundCriteria: 'criterio temporal', indicator: 'indicador' }

const keyOf = (source: string, sourceRef: string) => `${source}:${sourceRef}`
const linkKey = (link: Pick<StrategicObjectiveStrategy, 'source' | 'sourceRef'>) => keyOf(link.source, link.sourceRef)

const normalizeStrategyText = (description: string) => description.trim().replace(/\s+/g, ' ').toLowerCase()

async function strategySourceRef(description: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador no puede preparar las estrategias. Abre la aplicación en HTTPS o en localhost.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeStrategyText(description)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function dateInput(value: string | null | undefined) { return value ? value.slice(0, 10) : '' }

function draftOf(objective?: StrategicObjective): ObjectiveDraft {
  return objective ? {
    title: objective.title,
    statement: objective.statement,
    specificCriteria: objective.specificCriteria ?? '',
    measurableCriteria: objective.measurableCriteria ?? '',
    achievableCriteria: objective.achievableCriteria ?? '',
    relevantCriteria: objective.relevantCriteria ?? '',
    timeBoundCriteria: objective.timeBoundCriteria ?? '',
    hasIndicator: Boolean(objective.indicator),
    indicator: {
      name: objective.indicator?.name ?? '',
      unit: objective.indicator?.unit ?? '',
      baselineValue: objective.indicator?.baselineValue ?? '',
      targetValue: objective.indicator?.targetValue ?? '',
      measurementMethod: objective.indicator?.measurementMethod ?? '',
      deadline: dateInput(objective.indicator?.deadline),
    },
  } : { ...emptyDraft, indicator: { ...emptyDraft.indicator } }
}

function draftOfSuggestion(suggestion: StrategicObjectiveSuggestion): ObjectiveDraft {
  return {
    title: suggestion.title,
    statement: suggestion.statement,
    specificCriteria: suggestion.specificCriteria ?? '',
    measurableCriteria: suggestion.measurableCriteria ?? '',
    achievableCriteria: suggestion.achievableCriteria ?? '',
    relevantCriteria: suggestion.relevantCriteria ?? '',
    timeBoundCriteria: suggestion.timeBoundCriteria ?? '',
    hasIndicator: Boolean(suggestion.indicator),
    indicator: {
      name: suggestion.indicator?.name ?? '',
      unit: suggestion.indicator?.unit ?? '',
      baselineValue: suggestion.indicator?.baselineValue ?? '',
      targetValue: suggestion.indicator?.targetValue ?? '',
      measurementMethod: suggestion.indicator?.measurementMethod ?? '',
      deadline: dateInput(suggestion.indicator?.deadline),
    },
  }
}

function completionOf(objective: StrategicObjective) {
  const criteria = [objective.title, objective.statement, objective.specificCriteria, objective.measurableCriteria, objective.achievableCriteria, objective.relevantCriteria, objective.timeBoundCriteria]
  const indicator = objective.indicator ? [objective.indicator.name, objective.indicator.unit, objective.indicator.baselineValue, objective.indicator.targetValue, objective.indicator.measurementMethod, objective.indicator.deadline] : []
  const total = criteria.length + 6
  const completed = criteria.filter((value) => Boolean(value?.trim())).length + indicator.filter((value) => Boolean(value)).length
  return { completed, total }
}

function ObjectiveStatus({ status }: { status: StrategicObjective['status'] }) {
  return <span className={`smart-status ${status.toLowerCase()}`}><span aria-hidden="true" />{statusLabels[status]}</span>
}

function SmartObjectiveCard({ objective, canWrite, busyKey, onEdit, onApprove, onToggle, onUnlink, expanded }: { objective: StrategicObjective; canWrite: boolean; busyKey: string; onEdit: () => void; onApprove: () => void; onToggle: () => void; onUnlink: (link: StrategicObjectiveStrategy) => void; expanded: boolean }) {
  const completion = completionOf(objective)
  return (
    <article className={`smart-objective-card ${objective.status.toLowerCase()}${expanded ? ' expanded' : ''}`}>
      <header className="smart-objective-card-head">
        <div className="smart-objective-mark" aria-hidden="true">◎</div>
        <div className="smart-objective-card-title">
          <div className="smart-objective-card-meta"><span>Objetivo estratégico</span><ObjectiveStatus status={objective.status} /></div>
          <h3>{objective.title}</h3>
        </div>
        <span className="smart-objective-score">{completion.completed}<small>/{completion.total} SMART</small></span>
      </header>
      <p className="smart-objective-statement">{objective.statement}</p>
      <div className="smart-objective-card-foot">
        <span className="smart-objective-link-count">{objective.strategies.length} {objective.strategies.length === 1 ? 'estrategia vinculada' : 'estrategias vinculadas'}</span>
        <div className="smart-objective-actions">
          <button type="button" className="text-button" onClick={onToggle}>{expanded ? 'Ocultar detalle' : 'Consultar detalle'}</button>
          {canWrite && <button type="button" className="button secondary small-button" onClick={onEdit}>Editar</button>}
          {canWrite && objective.status === 'DRAFT' && <button type="button" className="button primary small-button" onClick={onApprove} disabled={busyKey === objective.id}>{busyKey === objective.id ? 'Validando...' : 'Aprobar'}</button>}
        </div>
      </div>
      {expanded && (
        <div className="smart-objective-detail">
          <div className="smart-objective-detail-grid">
            {criterionFields.map((field) => <div key={field.key}><span>{field.label}</span><p>{objective[field.key] || 'Sin completar'}</p></div>)}
          </div>
          <div className="smart-objective-indicator">
            <div className="smart-objective-detail-heading"><div><span className="detail-label">INDICADOR</span><h4>{objective.indicator?.name || 'Sin indicador'}</h4></div>{objective.indicator?.deadline && <span className="smart-objective-deadline">Límite {new Date(objective.indicator.deadline).toLocaleDateString('es-CO')}</span>}</div>
            {objective.indicator && <div className="smart-indicator-values"><span><b>Unidad</b>{objective.indicator.unit || 'Sin completar'}</span><span><b>Línea base</b>{objective.indicator.baselineValue || 'Sin completar'}</span><span><b>Meta</b>{objective.indicator.targetValue || 'Sin completar'}</span><span><b>Medición</b>{objective.indicator.measurementMethod || 'Sin completar'}</span></div>}
          </div>
          <div className="smart-objective-relations">
            <div className="smart-objective-detail-heading"><div><span className="detail-label">ESTRATEGIAS VINCULADAS</span><h4>Relaciones de ejecución</h4></div><span className="smart-relation-count">{objective.strategies.length}</span></div>
            {objective.strategies.length === 0 ? <p className="smart-objective-muted">Aún no hay estrategias vinculadas.</p> : <div className="smart-linked-list">{objective.strategies.map((link) => <div className="smart-linked-row" key={link.id}><span className={`smart-source ${sourceTones[link.source]}`}>{sourceLabels[link.source]}</span><div><strong>{link.strategyTitle}</strong><p>{link.strategyDescription}</p></div><span className="smart-linked-score">{link.weightedScore.toFixed(2)} · {bandLabels[link.weightingBand]}</span>{canWrite && <button type="button" className="text-button danger-text" onClick={() => onUnlink(link)} disabled={busyKey === link.id}>{busyKey === link.id ? 'Retirando...' : 'Desvincular'}</button>}</div>)}</div>}
          </div>
        </div>
      )}
    </article>
  )
}

function ObjectiveFormModal({ draft, editing, origin, strategyOptions, selectedKeys, saving, error, onDraftChange, onToggleStrategy, onSubmit, onClose }: { draft: ObjectiveDraft; editing: StrategicObjective | null; origin: 'MANUAL' | 'CHECKY'; strategyOptions: StrategicStrategyOption[]; selectedKeys: Set<string>; saving: boolean; error: string; onDraftChange: (draft: ObjectiveDraft) => void; onToggleStrategy: (strategy: StrategicStrategyOption) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <div className="drawer-backdrop centered-backdrop smart-objective-backdrop">
      <form className="drawer centered-modal company-modal smart-objective-modal" onSubmit={onSubmit} aria-label={editing ? 'Editar objetivo SMART' : 'Crear objetivo SMART'}>
        <div className="company-modal-header">
          <div className="company-modal-icon smart-objective-modal-icon">◎</div>
          <div className="company-modal-title"><p className="eyebrow">ANÁLISIS ESTRATÉGICO</p><h2>{editing ? 'Editar objetivo SMART' : origin === 'CHECKY' ? 'Revisar propuesta de Checky' : 'Nuevo objetivo SMART'}</h2><p className="company-modal-subtitle">Guarda el trabajo en cualquier punto. La aprobación solo estará disponible cuando el contenido esté completo.</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">01</span><div><h3>Dirección</h3><p>La intención central del objetivo.</p></div></div><label>Título del objetivo<input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder="Ej. Reducir el tiempo de respuesta comercial" minLength={3} maxLength={200} required /></label><label>Declaración<textarea value={draft.statement} onChange={(event) => onDraftChange({ ...draft, statement: event.target.value })} placeholder="Describe el resultado que quieres lograr." rows={3} maxLength={5000} minLength={3} required /></label></div>
        <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">02</span><div><h3>Criterios SMART</h3><p>Completa lo que ya esté definido; lo demás puede quedar pendiente.</p></div></div><div className="smart-criteria-form">{criterionFields.map((field) => <label key={field.key}>{field.label}<textarea value={draft[field.key]} onChange={(event) => onDraftChange({ ...draft, [field.key]: event.target.value })} placeholder={field.hint} rows={2} maxLength={2000} /></label>)}</div></div>
        <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">03</span><div><h3>Indicador</h3><p>Solo registra una métrica si ya existe una definición real.</p></div><label className="smart-toggle"><input type="checkbox" checked={draft.hasIndicator} onChange={(event) => onDraftChange({ ...draft, hasIndicator: event.target.checked })} /><span>Incluir indicador</span></label></div>{draft.hasIndicator && <div className="smart-indicator-form">{indicatorFields.map((field) => <label className={field.wide ? 'smart-field-wide' : ''} key={field.key}>{field.label}<input type={field.type ?? 'text'} value={draft.indicator[field.key]} onChange={(event) => onDraftChange({ ...draft, indicator: { ...draft.indicator, [field.key]: event.target.value } })} placeholder={field.key === 'deadline' ? '' : 'Sin completar'} /></label>)}<p className="smart-form-note">Los campos del indicador pueden permanecer incompletos en un borrador. Para quitarlo durante una edición, desactiva el indicador.</p></div>}</div>
        <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">04</span><div><h3>Estrategias relacionadas</h3><p>Solo aparecen estrategias aceptadas, ponderadas y clasificadas.</p></div><span className="smart-selection-count">{selectedKeys.size} seleccionadas</span></div>{strategyOptions.length === 0 ? <p className="smart-objective-muted">No hay estrategias disponibles. Primero acepta y pondera una estrategia.</p> : <div className="smart-strategy-picker">{strategyOptions.map((strategy) => { const selected = selectedKeys.has(keyOf(strategy.source, strategy.sourceRef)); return <label className={`smart-strategy-option${selected ? ' selected' : ''}`} key={strategy.id}><input type="checkbox" checked={selected} onChange={() => onToggleStrategy(strategy)} /><span className={`smart-source ${sourceTones[strategy.source]}`}>{sourceLabels[strategy.source]}</span><span className="smart-strategy-option-copy"><strong>{strategy.title}</strong><small>{strategy.description}</small></span><span className="smart-strategy-option-score">{strategy.weighting?.weightedScore.toFixed(2)}<small>{strategy.weightingBand ? bandLabels[strategy.weightingBand] : ''}</small></span></label> })}</div>}</div>
        <div className="drawer-actions smart-form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? <><span className="button-loader" />Guardando...</> : editing ? 'Guardar cambios' : 'Guardar borrador'}</button></div>
      </form>
    </div>
  )
}

function RelationMap({ objectives }: { objectives: StrategicObjective[] }) {
  const linkedObjectives = objectives.filter((objective) => objective.strategies.length > 0)
  if (linkedObjectives.length === 0) return null
  return <section className="smart-relation-map"><div className="smart-relation-map-heading"><div><span className="detail-label">MAPA DE RELACIONES</span><h3>Objetivos y estrategias</h3></div><p>Una lectura rápida de qué estrategias sostienen cada objetivo.</p></div><div className="smart-relation-map-list">{linkedObjectives.map((objective) => <div className="smart-relation-map-row" key={objective.id}><div className="smart-map-objective"><span className="smart-map-node objective-node">◎</span><strong>{objective.title}</strong></div><div className="smart-map-lines" aria-hidden="true">{objective.strategies.map((link) => <span key={link.id} />)}</div><div className="smart-map-strategies">{objective.strategies.map((link) => <span key={link.id} className={`smart-map-pill ${sourceTones[link.source]}`}>{link.strategyTitle}</span>)}</div></div>)}</div></section>
}

export function StrategicObjectivesSection({ diagnosticId, canWrite, initialObjectives, initialStrategyOptions, initialLoading, initialExpandedId }: { diagnosticId: string; canWrite: boolean; initialObjectives?: StrategicObjective[]; initialStrategyOptions?: StrategicStrategyOption[]; initialLoading?: boolean; initialExpandedId?: string | null }) {
  const [objectives, setObjectives] = useState<StrategicObjective[]>(initialObjectives ?? [])
  const [strategyOptions, setStrategyOptions] = useState<StrategicStrategyOption[]>(initialStrategyOptions ?? [])
  const [loading, setLoading] = useState(initialLoading ?? (initialObjectives === undefined || initialStrategyOptions === undefined))
  const [loadError, setLoadError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StrategicObjective | null>(null)
  const [draft, setDraft] = useState<ObjectiveDraft>(() => draftOf())
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null)
  const [suggestions, setSuggestions] = useState<StrategicObjectiveSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestionError, setSuggestionError] = useState('')
  const [draftOrigin, setDraftOrigin] = useState<'MANUAL' | 'CHECKY'>('MANUAL')
  const [activeSuggestion, setActiveSuggestion] = useState<StrategicObjectiveSuggestion | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [objectiveResult, strategyResult] = await Promise.all([
        api<{ objectives: StrategicObjective[] }>(`/diagnostics/${diagnosticId}/strategic-objectives`),
        api<{ strategies: DiagnosticStrategy[] }>(`/diagnostics/${diagnosticId}/strategies?acceptedOnly=true`),
      ])
      const options = await Promise.all(strategyResult.strategies.filter((strategy) => Boolean(strategy.weighting && strategy.weightingBand)).map(async (strategy) => ({ ...strategy, sourceRef: await strategySourceRef(strategy.description) })))
      setObjectives(objectiveResult.objectives)
      setStrategyOptions(options)
    } catch (requestError) {
      setLoadError(smartErrorMessage(requestError, 'No pudimos cargar los objetivos SMART.'))
    } finally {
      setLoading(false)
    }
  }, [diagnosticId])

  useEffect(() => { if (initialObjectives === undefined || initialStrategyOptions === undefined) { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) } return undefined }, [initialObjectives, initialStrategyOptions, load])

  function openCreate() { setEditing(null); setActiveSuggestion(null); setDraftOrigin('MANUAL'); setDraft(draftOf()); setSelectedKeys(new Set()); setError(''); setModalOpen(true) }
  function openEdit(objective: StrategicObjective) { setEditing(objective); setActiveSuggestion(null); setDraftOrigin('MANUAL'); setDraft(draftOf(objective)); setSelectedKeys(new Set(objective.strategies.map(linkKey))); setError(''); setModalOpen(true) }
  function openSuggestion(suggestion: StrategicObjectiveSuggestion) {
    setEditing(null)
    setActiveSuggestion(suggestion)
    setDraftOrigin('CHECKY')
    setDraft(draftOfSuggestion(suggestion))
    setSelectedKeys(new Set(suggestion.strategies.map((strategy) => keyOf(strategy.source, strategy.sourceRef))))
    setError('')
    setModalOpen(true)
  }
  function replaceObjective(objective: StrategicObjective) { setObjectives((current) => current.map((item) => item.id === objective.id ? objective : item)) }

  function payloadOf() {
    const criterion = (value: string) => value.trim() || null
    const indicator = draft.hasIndicator
      ? Object.fromEntries(Object.entries(draft.indicator).filter(([, value]) => Boolean(value.trim())))
      : null
    return { title: draft.title, statement: draft.statement, specificCriteria: criterion(draft.specificCriteria), measurableCriteria: criterion(draft.measurableCriteria), achievableCriteria: criterion(draft.achievableCriteria), relevantCriteria: criterion(draft.relevantCriteria), timeBoundCriteria: criterion(draft.timeBoundCriteria), ...(editing ? {} : { origin: draftOrigin }), indicator }
  }

  async function syncLinks(objective: StrategicObjective) {
    let current = objective
    const desired = selectedKeys
    for (const link of current.strategies) {
      if (desired.has(linkKey(link))) continue
      const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${current.id}/strategies/${link.source}/${encodeURIComponent(link.sourceRef)}`, { method: 'DELETE' })
      current = result.objective
    }
    for (const strategy of strategyOptions) {
      const linkKeyValue = keyOf(strategy.source, strategy.sourceRef)
      if (!desired.has(linkKeyValue) || current.strategies.some((link) => linkKey(link) === linkKeyValue)) continue
      const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${current.id}/strategies`, { method: 'POST', body: JSON.stringify({ source: strategy.source, sourceRef: strategy.sourceRef }) })
      current = result.objective
    }
    return current
  }

  async function saveObjective(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const result = editing
        ? await api<{ objective: StrategicObjective }>(`/strategic-objectives/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payloadOf()) })
        : await api<{ objective: StrategicObjective }>(`/diagnostics/${diagnosticId}/strategic-objectives`, { method: 'POST', body: JSON.stringify(payloadOf()) })
      const objective = await syncLinks(result.objective)
      setObjectives((current) => editing ? current.map((item) => item.id === objective.id ? objective : item) : [objective, ...current])
      if (activeSuggestion) setSuggestions((current) => current.filter((item) => item.id !== activeSuggestion.id))
      setModalOpen(false)
      setActiveSuggestion(null)
    } catch (requestError) {
      setError(smartErrorMessage(requestError, 'No se pudo guardar el objetivo SMART.'))
    } finally {
      setSaving(false)
    }
  }

  async function suggest() {
    if (suggesting || strategyOptions.length === 0) return
    setSuggesting(true)
    setSuggestionError('')
    try {
      const result = await api<{ suggestions: Omit<StrategicObjectiveSuggestion, 'id'>[]; missingInformation: string[] }>(`/diagnostics/${diagnosticId}/strategic-objectives/suggest`, { method: 'POST', body: JSON.stringify({}) })
      setSuggestions(result.suggestions.map((suggestion, index) => ({ ...suggestion, id: `${Date.now()}-${index}` })))
    } catch (requestError) {
      setSuggestionError(smartErrorMessage(requestError, 'No se pudieron generar sugerencias con Checky.'))
    } finally {
      setSuggesting(false)
    }
  }

  function discardSuggestion(id: string) { setSuggestions((current) => current.filter((suggestion) => suggestion.id !== id)) }

  async function approve(objective: StrategicObjective) {
    const missing = smartMissingFields(objective)
    if (missing.length > 0) {
      setError(`Completa antes de aprobar: ${missing.join(', ')}.`)
      return
    }
    const confirmed = await askConfirm({ title: 'Aprobar objetivo SMART', message: `«${objective.title}» pasará a estado aprobado. El backend verificará que esté completo.`, confirmLabel: 'Aprobar' })
    if (!confirmed) return
    setBusyKey(objective.id)
    setError('')
    try {
      const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${objective.id}/approve`, { method: 'POST', body: JSON.stringify({}) })
      replaceObjective(result.objective)
    } catch (requestError) {
      setError(smartErrorMessage(requestError, 'No se pudo aprobar el objetivo SMART.'))
    } finally {
      setBusyKey('')
    }
  }

  async function unlink(objective: StrategicObjective, link: StrategicObjectiveStrategy) {
    setBusyKey(link.id)
    setError('')
    try {
      const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${objective.id}/strategies/${link.source}/${encodeURIComponent(link.sourceRef)}`, { method: 'DELETE' })
      replaceObjective(result.objective)
    } catch (requestError) {
      setError(smartErrorMessage(requestError, 'No se pudo desvincular la estrategia.'))
    } finally {
      setBusyKey('')
    }
  }

  const draftCount = useMemo(() => objectives.filter((objective) => objective.status === 'DRAFT').length, [objectives])
  const approvedCount = useMemo(() => objectives.filter((objective) => objective.status === 'APPROVED').length, [objectives])
  const linkedCount = useMemo(() => new Set(objectives.flatMap((objective) => objective.strategies.map(linkKey))).size, [objectives])
  const toggleStrategy = (strategy: StrategicStrategyOption) => setSelectedKeys((current) => { const next = new Set(current); const key = keyOf(strategy.source, strategy.sourceRef); if (next.has(key)) next.delete(key); else next.add(key); return next })

  return (
    <section className="smart-objectives-section" aria-busy={loading}>
      <header className="smart-objectives-header">
        <div className="smart-objectives-heading"><span className="diag-step-chip smart-step-chip">◎</span><div><p className="detail-label">QUINTA ETAPA</p><h2>Objetivos SMART</h2><p>Convierte las estrategias priorizadas en resultados concretos, sin perder el contexto que las sostiene.</p></div></div>
        {canWrite && <div className="smart-header-actions"><button type="button" className="button secondary" onClick={() => void suggest()} disabled={suggesting || strategyOptions.length === 0}>{suggesting ? 'Consultando Checky...' : 'Sugerir con IA-Checky'}</button><button type="button" className="button primary" onClick={openCreate}>+ Nuevo objetivo</button></div>}
      </header>
      {error && <div className="form-error smart-page-alert" role="alert">{error}</div>}
      {loadError && <div className="form-error smart-page-alert" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void load()}>Reintentar</button></div>}
      {suggestionError && <div className="form-error smart-page-alert" role="alert">{suggestionError}</div>}
      <div className="smart-objective-stats"><div className="smart-stat draft"><span>En trabajo</span><strong>{draftCount}</strong><small>Borradores</small></div><div className="smart-stat approved"><span>Concluidos</span><strong>{approvedCount}</strong><small>Aprobados</small></div><div className="smart-stat linked"><span>Conectadas</span><strong>{linkedCount}</strong><small>Estrategias vinculadas</small></div><div className="smart-stat available"><span>Disponibles</span><strong>{strategyOptions.length}</strong><small>Estrategias priorizadas</small></div></div>
      {suggestions.length > 0 && <section className="smart-suggestions" aria-label="Propuestas de IA-Checky"><div className="smart-suggestions-heading"><div><span className="detail-label">PROPUESTAS TEMPORALES</span><h3>Revisa antes de guardar</h3></div><p>Checky no ha creado objetivos. Edita una propuesta o descártala.</p></div><div className="smart-suggestions-list">{suggestions.map((suggestion) => <article className="smart-suggestion-card" key={suggestion.id}><div className="smart-suggestion-card-head"><span className="smart-source checky">IA-CHECKY</span><button type="button" className="text-button danger-text" onClick={() => discardSuggestion(suggestion.id)}>Descartar</button></div><h4>{suggestion.title}</h4><p>{suggestion.statement}</p><div className="smart-suggestion-strategies">{suggestion.strategies.map((strategy) => <span className="smart-map-pill checky" key={strategy.id}>{strategy.title}</span>)}</div>{suggestion.pendingFields.length > 0 && <p className="smart-suggestion-pending">Pendiente por definir: {suggestion.pendingFields.map((field) => pendingFieldLabels[field] ?? field).join(', ')}.</p>}{suggestion.missingInformation.length > 0 && <ul className="smart-suggestion-pending-list">{suggestion.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>}<button type="button" className="button secondary small-button" onClick={() => openSuggestion(suggestion)}>Editar propuesta</button></article>)}</div></section>}
      {loading ? <LoadingState text="Cargando objetivos y estrategias priorizadas..." /> : objectives.length === 0 ? <EmptyState icon="◎" title="Todavía no hay objetivos SMART" text={canWrite ? 'Crea un borrador y completa sus criterios a medida que avances.' : 'Los objetivos SMART de este análisis aparecerán aquí.'} action={canWrite ? <button type="button" className="button secondary" onClick={openCreate}>Crear primer objetivo</button> : undefined} /> : <div className="smart-objectives-list">{objectives.map((objective) => <SmartObjectiveCard key={objective.id} objective={objective} canWrite={canWrite} busyKey={busyKey} expanded={expandedId === objective.id} onToggle={() => setExpandedId((current) => current === objective.id ? null : objective.id)} onEdit={() => openEdit(objective)} onApprove={() => void approve(objective)} onUnlink={(link) => void unlink(objective, link)} />)}</div>}
      {!loading && <RelationMap objectives={objectives} />}
      {modalOpen && <ObjectiveFormModal draft={draft} editing={editing} origin={draftOrigin} strategyOptions={strategyOptions} selectedKeys={selectedKeys} saving={saving} error={error} onDraftChange={setDraft} onToggleStrategy={toggleStrategy} onSubmit={(event) => void saveObjective(event)} onClose={() => { if (!saving) setModalOpen(false) }} />}
    </section>
  )
}

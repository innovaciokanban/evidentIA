import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { askConfirm } from '../ui/useConfirm'
import { smartErrorMessage, smartMissingFields } from './strategic-objectives.model'
import { KpiFields } from '../processes/KpiForm'
import { emptyKpiDraft, kpiMissingFields, type KpiDraft, type KpiUser } from '../processes/process-kpi.model'
import type { DiagnosticStrategy, StrategicObjective, StrategicObjectiveStrategy, StrategicObjectiveSuggestionCard, StrategicObjectiveSuggestionPayload, StrategicObjectiveSuggestionRecord, StrategyBand, StrategySource, User } from '../../types'
import checkyImage from '../../assets/Aprobado por checky.png'

export type StrategicStrategyOption = DiagnosticStrategy & { sourceRef: string }

type ObjectiveDraft = {
  title: string
  statement: string
  specificCriteria: string
  measurableCriteria: string
  achievableCriteria: string
  relevantCriteria: string
  timeBoundCriteria: string
  indicators: SmartIndicatorDraft[]
}

type SmartIndicatorDraft = KpiDraft & {
  baselineValue: string
  measurementMethod: string
  deadline: string
}

const emptyDraft: ObjectiveDraft = {
  title: '',
  statement: '',
  specificCriteria: '',
  measurableCriteria: '',
  achievableCriteria: '',
  relevantCriteria: '',
  timeBoundCriteria: '',
  indicators: [],
}

const criterionFields: Array<{ key: keyof Pick<ObjectiveDraft, 'specificCriteria' | 'measurableCriteria' | 'achievableCriteria' | 'relevantCriteria' | 'timeBoundCriteria'>; label: string; hint: string }> = [
  { key: 'specificCriteria', label: 'Específico', hint: 'Qué se quiere cambiar y dónde.' },
  { key: 'measurableCriteria', label: 'Medible', hint: 'Cómo se comprobará el avance.' },
  { key: 'achievableCriteria', label: 'Alcanzable', hint: 'Qué hace viable el objetivo.' },
  { key: 'relevantCriteria', label: 'Relevante', hint: 'Por qué importa para la organización.' },
  { key: 'timeBoundCriteria', label: 'Temporal', hint: 'En qué horizonte debe lograrse.' },
]

const sourceLabels: Record<StrategySource, string> = { AI_ANALYSIS: 'Análisis IA', CHECKY: 'Checky', STRATEGIC_CROSS: 'Cruce DOFA' }
const sourceTones: Record<StrategySource, string> = { AI_ANALYSIS: 'ai', CHECKY: 'checky', STRATEGIC_CROSS: 'cross' }
const bandLabels: Record<StrategyBand, string> = { INMEDIATA: 'Inmediata', CORTO_PLAZO: 'Corto plazo', MEDIANO_PLAZO: 'Mediano plazo', LARGO_PLAZO: 'Largo plazo' }
const statusLabels = { DRAFT: 'Borrador', APPROVED: 'Aprobado' } as const
const pendingFieldLabels: Record<string, string> = { specificCriteria: 'criterio específico', measurableCriteria: 'criterio medible', achievableCriteria: 'criterio alcanzable', relevantCriteria: 'criterio relevante', timeBoundCriteria: 'criterio temporal', indicator: 'indicador' }
const suggestionStatusLabels = { PENDING: 'Pendiente', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada' } as const
const suggestionStatusIcons = { PENDING: '◌', ACCEPTED: '✓', REJECTED: '×' } as const

const keyOf = (source: string, sourceRef: string) => `${source}:${sourceRef}`
const linkKey = (link: Pick<StrategicObjectiveStrategy, 'source' | 'sourceRef'>) => keyOf(link.source, link.sourceRef)

const normalizeStrategyText = (description: string) => description.trim().replace(/\s+/g, ' ').toLowerCase()

async function strategySourceRef(description: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador no puede preparar las estrategias. Abre la aplicación en HTTPS o en localhost.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeStrategyText(description)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function dateInput(value: string | null | undefined) { return value ? value.slice(0, 10) : '' }

function indicatorDraftOf(indicator: StrategicObjective['indicator'] | null | undefined): SmartIndicatorDraft {
  return {
    ...emptyKpiDraft,
    name: indicator?.name ?? '',
    description: indicator?.description ?? '',
    frequency: indicator?.frequency ?? '',
    target: indicator?.targetValue ?? '',
    formula: indicator?.formula ?? '',
    dataSource: indicator?.dataSource ?? '',
    unit: indicator?.unit ?? '',
    reportResponsibleId: indicator?.reportResponsibleId ?? indicator?.reportResponsible?.id ?? '',
    monitorResponsibleId: indicator?.monitorResponsibleId ?? indicator?.monitorResponsible?.id ?? '',
    greenThreshold: indicator?.greenThreshold ?? '',
    yellowThreshold: indicator?.yellowThreshold ?? '',
    redThreshold: indicator?.redThreshold ?? '',
    baselineValue: indicator?.baselineValue ?? '',
    measurementMethod: indicator?.measurementMethod ?? '',
    deadline: dateInput(indicator?.deadline),
  }
}

function draftOf(objective?: StrategicObjective): ObjectiveDraft {
  return objective ? {
    title: objective.title,
    statement: objective.statement,
    specificCriteria: objective.specificCriteria ?? '',
    measurableCriteria: objective.measurableCriteria ?? '',
    achievableCriteria: objective.achievableCriteria ?? '',
    relevantCriteria: objective.relevantCriteria ?? '',
    timeBoundCriteria: objective.timeBoundCriteria ?? '',
    indicators: (objective.indicators?.length ? objective.indicators : objective.indicator ? [objective.indicator] : []).map(indicatorDraftOf),
  } : { ...emptyDraft, indicators: [] }
}

function draftOfSuggestion(suggestion: StrategicObjectiveSuggestionCard): ObjectiveDraft {
  const payload = suggestion.editablePayload
  return {
    title: payload.title,
    statement: payload.statement,
    specificCriteria: payload.specificCriteria ?? '',
    measurableCriteria: payload.measurableCriteria ?? '',
    achievableCriteria: payload.achievableCriteria ?? '',
    relevantCriteria: payload.relevantCriteria ?? '',
    timeBoundCriteria: payload.timeBoundCriteria ?? '',
    indicators: (payload.indicators?.length ? payload.indicators : payload.indicator ? [payload.indicator] : []).map((indicator) => ({
      ...emptyKpiDraft,
      name: indicator.name ?? '',
      description: indicator.description ?? '',
      frequency: indicator.frequency ?? '',
      target: indicator.targetValue ?? '',
      formula: indicator.formula ?? '',
      dataSource: indicator.dataSource ?? '',
      unit: indicator.unit ?? '',
      reportResponsibleId: indicator.reportResponsibleId ?? '',
      monitorResponsibleId: indicator.monitorResponsibleId ?? '',
      greenThreshold: indicator.greenThreshold ?? '',
      yellowThreshold: indicator.yellowThreshold ?? '',
      redThreshold: indicator.redThreshold ?? '',
      baselineValue: indicator.baselineValue ?? '',
      measurementMethod: indicator.measurementMethod ?? '',
      deadline: dateInput(indicator.deadline),
    })),
  }
}

function suggestionPendingFields(payload: StrategicObjectiveSuggestionPayload): string[] {
  const fields: Array<[string, unknown]> = [
    ['specificCriteria', payload.specificCriteria],
    ['measurableCriteria', payload.measurableCriteria],
    ['achievableCriteria', payload.achievableCriteria],
    ['relevantCriteria', payload.relevantCriteria],
    ['timeBoundCriteria', payload.timeBoundCriteria],
    ['indicator', payload.indicator],
  ]
  return fields.flatMap(([field, value]) => value === null || (typeof value === 'string' && !value.trim()) ? [field] : [])
}

function suggestionCardOf(record: StrategicObjectiveSuggestionRecord, strategyOptions: StrategicStrategyOption[], missingInformation: string[] = []): StrategicObjectiveSuggestionCard {
  const payload = record.editablePayload
  const strategies = record.strategyRefs.map((ref) => {
    const strategy = strategyOptions.find((option) => option.id === ref)
    return strategy ? { id: strategy.id, source: strategy.source, sourceRef: strategy.sourceRef, title: strategy.title, description: strategy.description, weightedScore: strategy.weightedScore ?? 0, weightingBand: strategy.weightingBand! } : null
  }).filter((strategy): strategy is NonNullable<typeof strategy> => strategy !== null)
  return {
    ...record,
    title: payload.title,
    statement: payload.statement,
    specificCriteria: payload.specificCriteria,
    measurableCriteria: payload.measurableCriteria,
    achievableCriteria: payload.achievableCriteria,
    relevantCriteria: payload.relevantCriteria,
    timeBoundCriteria: payload.timeBoundCriteria,
    indicators: payload.indicators?.length ? payload.indicators : payload.indicator ? [payload.indicator] : [],
    indicator: payload.indicator,
    origin: 'CHECKY',
    missingInformation,
    pendingFields: suggestionPendingFields(payload),
    strategies,
  }
}

function completionOf(objective: StrategicObjective) {
  const criteria = [objective.title, objective.statement, objective.specificCriteria, objective.measurableCriteria, objective.achievableCriteria, objective.relevantCriteria, objective.timeBoundCriteria]
  const indicators = objective.indicators?.length ? objective.indicators : objective.indicator ? [objective.indicator] : []
  const indicatorValues = indicators.flatMap((indicator) => [indicator.name, indicator.unit, indicator.baselineValue, indicator.targetValue, indicator.measurementMethod, indicator.deadline])
  const total = criteria.length + indicators.length * 6
  const completed = criteria.filter((value) => Boolean(value?.trim())).length + indicatorValues.filter((value) => Boolean(value)).length
  return { completed, total }
}

function ObjectiveStatus({ status }: { status: StrategicObjective['status'] }) {
  return <span className={`smart-status ${status.toLowerCase()}`}><span aria-hidden="true" />{statusLabels[status]}</span>
}

function SmartObjectiveCard({ objective, canWrite, busyKey, onEdit, onEditIndicator, onDeleteIndicator, onApprove, onToggle, onUnlink, expanded }: { objective: StrategicObjective; canWrite: boolean; busyKey: string; onEdit: () => void; onEditIndicator: (indicatorId: string) => void; onDeleteIndicator: (indicatorId: string) => void; onApprove: () => void; onToggle: () => void; onUnlink: (link: StrategicObjectiveStrategy) => void; expanded: boolean }) {
  const completion = completionOf(objective)
  const indicators = objective.indicators?.length ? objective.indicators : objective.indicator ? [objective.indicator] : []
  return (
    <article className={`smart-objective-card ${objective.status.toLowerCase()}${expanded ? ' expanded' : ''}`}>
      <header className="smart-objective-card-head">
        <div className="smart-objective-mark" aria-hidden="true">◎</div>
        <div className="smart-objective-card-title">
            <div className="smart-objective-card-meta"><span>Objetivo estratégico</span><span className={`smart-origin-badge ${objective.origin.toLowerCase()}`}>{objective.origin === 'CHECKY' ? 'IA-Checky' : 'Creado por ti'}</span><ObjectiveStatus status={objective.status} /></div>
          <h3>{objective.title}</h3>
        </div>
        <span className="smart-objective-score">{completion.completed}<small>/{completion.total} SMART</small></span>
      </header>
      <p className="smart-objective-statement">{objective.statement}</p>
      {indicators.length > 0 && <div className="smart-objective-indicators-summary"><div className="smart-objective-indicators-heading"><span className="detail-label">INDICADORES SMART</span><span>{indicators.length}</span></div>{indicators.map((indicator) => <div className="smart-objective-indicator-summary" key={indicator.id}><div><strong>{indicator.name || 'Sin nombre'}</strong><small>{indicator.frequency || 'Sin frecuencia'} · Meta {indicator.targetValue || 'sin definir'} · {indicator.unit || 'Sin unidad'}</small></div>{canWrite && <div><button type="button" className="text-button" onClick={() => onEditIndicator(indicator.id)}>Editar</button><button type="button" className="text-button danger-text" onClick={() => onDeleteIndicator(indicator.id)} disabled={busyKey === indicator.id}>{busyKey === indicator.id ? 'Eliminando...' : 'Eliminar'}</button></div>}</div>)}</div>}
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
             <div className="smart-objective-detail-heading"><div><span className="detail-label">INDICADORES</span><h4>{indicators.length === 0 ? 'Sin indicadores' : `${indicators.length} indicador${indicators.length === 1 ? '' : 'es'}`}</h4></div></div>
             {indicators.length > 0 ? indicators.map((indicator) => <div className="smart-objective-indicator-block" key={indicator.id}><div className="smart-objective-detail-heading"><h4>{indicator.name || 'Sin indicador'}</h4>{indicator.deadline && <span className="smart-objective-deadline">Límite {new Date(indicator.deadline).toLocaleDateString('es-CO')}</span>}</div><div className="smart-indicator-values"><span><b>Frecuencia</b>{indicator.frequency || 'Sin completar'}</span><span><b>Meta</b>{indicator.targetValue || 'Sin completar'}</span><span><b>Unidad</b>{indicator.unit || 'Sin completar'}</span><span><b>Descripción</b>{indicator.description || 'Sin completar'}</span><span><b>Fórmula</b>{indicator.formula || 'Sin completar'}</span><span><b>Fuente de datos</b>{indicator.dataSource || 'Sin completar'}</span><span><b>Reporte</b>{indicator.reportResponsible?.name || 'Sin asignar'}</span><span><b>Monitoreo</b>{indicator.monitorResponsible?.name || 'Sin asignar'}</span><span><b>Umbral verde</b>{indicator.greenThreshold || 'Sin completar'}</span><span><b>Umbral amarillo</b>{indicator.yellowThreshold || 'Sin completar'}</span><span><b>Umbral rojo</b>{indicator.redThreshold || 'Sin completar'}</span><span><b>Línea base</b>{indicator.baselineValue || 'Sin completar'}</span><span><b>Medición</b>{indicator.measurementMethod || 'Sin completar'}</span></div></div>) : <p className="smart-objective-muted">Sin indicadores definidos.</p>}
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

function SuggestionStatusBadge({ status }: { status: StrategicObjectiveSuggestionCard['status'] }) {
  return <span className={`checky-status ${status.toLowerCase()}`}><span aria-hidden="true">{suggestionStatusIcons[status]}</span>{suggestionStatusLabels[status]}</span>
}

function SmartSuggestionCard({ suggestion, canWrite, busy, onEdit, onAccept, onReject }: { suggestion: StrategicObjectiveSuggestionCard; canWrite: boolean; busy: boolean; onEdit: () => void; onAccept: () => void; onReject: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const criteria = [
    ['Específico', suggestion.specificCriteria],
    ['Medible', suggestion.measurableCriteria],
    ['Alcanzable', suggestion.achievableCriteria],
    ['Relevante', suggestion.relevantCriteria],
    ['Temporal', suggestion.timeBoundCriteria],
  ]
  return (
    <article className={`smart-suggestion-card ${suggestion.status.toLowerCase()}`}>
      <header className="smart-suggestion-card-head">
        <div className="smart-suggestion-identity"><span className="smart-source checky">IA-CHECKY</span><SuggestionStatusBadge status={suggestion.status} /></div>
        <span className="smart-suggestion-icon" aria-hidden="true">✦</span>
      </header>
      <div className="smart-suggestion-card-title"><p className="checky-card-kicker">Propuesta colaborativa</p><h4>{suggestion.title}</h4></div>
      <p>{suggestion.statement}</p>
      <div className="smart-suggestion-smart-grid">
        {criteria.map(([label, value]) => <div key={label}><span>{label}</span><p>{value || 'Pendiente por definir'}</p></div>)}
      </div>
      <div className="smart-suggestion-indicator">
        <span className="detail-label">INDICADORES SMART</span>
        {suggestion.indicators.length > 0 ? suggestion.indicators.map((indicator, index) => <div key={`${indicator.name ?? 'indicator'}-${index}`}><strong>{indicator.name || 'Sin nombre'}</strong><span>{indicator.unit || 'Sin unidad'} · Meta {indicator.targetValue || 'pendiente'}{indicator.deadline ? ` · ${dateInput(indicator.deadline)}` : ''}</span></div>) : <p>Checky no propuso indicadores todavía.</p>}
      </div>
      {suggestion.strategies.length > 0 && <div className="smart-suggestion-strategies">{suggestion.strategies.map((strategy) => <span className={`smart-map-pill ${sourceTones[strategy.source]}`} key={strategy.id}>{strategy.title}</span>)}</div>}
      {suggestion.pendingFields.length > 0 && <p className="smart-suggestion-pending">Pendiente por definir: {suggestion.pendingFields.map((field) => pendingFieldLabels[field] ?? field).join(', ')}.</p>}
      {suggestion.missingInformation.length > 0 && <ul className="smart-suggestion-pending-list">{suggestion.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>}
      <div className="smart-suggestion-card-foot">
        <button type="button" className="checky-review-btn" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? 'Ocultar detalle' : 'Ver detalle'} <span aria-hidden="true">▾</span></button>
        {suggestion.status === 'PENDING' && canWrite && <div className="checky-actions"><button type="button" className="button secondary small-button" onClick={onReject} disabled={busy}>Rechazar</button><button type="button" className="button primary small-button" onClick={onAccept} disabled={busy}>{busy ? 'Guardando...' : 'Aceptar propuesta'}</button></div>}
      </div>
      {expanded && <div className="smart-suggestion-detail"><div><span className="detail-label">ESTRATEGIAS DE ORIGEN</span><p>{suggestion.strategies.length > 0 ? suggestion.strategies.map((strategy) => strategy.description).join(' · ') : 'Sin estrategias vinculadas.'}</p></div><div><span className="detail-label">DECISIÓN</span><p>{suggestion.status === 'PENDING' ? 'La propuesta todavía no crea un objetivo oficial.' : suggestion.status === 'ACCEPTED' ? `Aceptada como borrador${suggestion.acceptedObjectiveId ? ` · ${suggestion.acceptedObjectiveId}` : ''}.` : suggestion.decisionNote || 'Propuesta rechazada.'}</p></div></div>}
      {suggestion.status === 'PENDING' && canWrite && <button type="button" className="button secondary small-button smart-suggestion-edit" onClick={onEdit}>Editar propuesta</button>}
      {suggestion.status === 'ACCEPTED' && <p className="checky-decided accepted"><span aria-hidden="true">✓</span> Aceptada: el objetivo quedó en borrador.</p>}
      {suggestion.status === 'REJECTED' && <p className="checky-decided rejected"><span aria-hidden="true">✕</span> Rechazada: se conserva para consulta.</p>}
    </article>
  )
}

function SmartIndicatorModal({ draft, users, editing, saving, error, onDraftChange, onSubmit, onClose }: { draft: SmartIndicatorDraft; users: KpiUser[]; editing: boolean; saving: boolean; error: string; onDraftChange: React.Dispatch<React.SetStateAction<SmartIndicatorDraft>>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <div className="drawer-backdrop centered-backdrop smart-indicator-backdrop">
      <form className="kpi-form panel smart-indicator-modal" onSubmit={onSubmit} aria-label={editing ? 'Editar indicador SMART' : 'Nuevo indicador SMART'}>
        <header className="kpi-form-header">
          <div>
            <p className="eyebrow">INDICADORES SMART</p>
            <h2>{editing ? 'EDITAR INDICADOR' : 'NUEVO INDICADOR'}</h2>
            <p>Define la configuración propia de este objetivo. No se creará ni modificará ningún KPI de Procesos o Procedimientos.</p>
          </div>
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        </header>
        {error && <div className="form-error kpi-form-error" role="alert">{error}</div>}
        <KpiFields draft={draft} setDraft={onDraftChange} users={users} supplemental={draft} />
        <footer className="kpi-form-footer">
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar indicador'}</button>
        </footer>
      </form>
    </div>
  )
}

function ObjectiveFormModal({ draft, editing, suggestionMode, strategyOptions, selectedKeys, saving, error, onDraftChange, onToggleStrategy, onOpenIndicator, onEditIndicator, onSubmit, onClose }: { draft: ObjectiveDraft; editing: StrategicObjective | null; suggestionMode: boolean; strategyOptions: StrategicStrategyOption[]; selectedKeys: Set<string>; saving: boolean; error: string; onDraftChange: (draft: ObjectiveDraft) => void; onToggleStrategy: (strategy: StrategicStrategyOption) => void; onOpenIndicator: () => void; onEditIndicator: (index: number) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <div className="drawer-backdrop centered-backdrop smart-objective-backdrop">
      <form className="drawer centered-modal company-modal smart-objective-modal" onSubmit={onSubmit} aria-label={editing ? 'Editar objetivo SMART' : 'Crear objetivo SMART'}>
        <div className="company-modal-header">
          <div className="company-modal-icon smart-objective-modal-icon">◎</div>
          <div className="company-modal-title"><p className="eyebrow">ANÁLISIS ESTRATÉGICO</p><h2>{editing ? 'Editar objetivo SMART' : suggestionMode ? 'Revisar propuesta de Checky' : 'Nuevo objetivo SMART'}</h2><p className="company-modal-subtitle">{suggestionMode ? 'Edita la propuesta sin crear todavía un objetivo oficial.' : 'Guarda el trabajo en cualquier punto. La aprobación solo estará disponible cuando el contenido esté completo.'}</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">01</span><div><h3>Dirección</h3><p>La intención central del objetivo.</p></div></div><label>Título del objetivo<input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder="Ej. Reducir el tiempo de respuesta comercial" minLength={3} maxLength={200} required /></label><label>Declaración<textarea value={draft.statement} onChange={(event) => onDraftChange({ ...draft, statement: event.target.value })} placeholder="Describe el resultado que quieres lograr." rows={3} maxLength={5000} minLength={3} required /></label></div>
        <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">02</span><div><h3>Criterios SMART</h3><p>Completa lo que ya esté definido; lo demás puede quedar pendiente.</p></div></div><div className="smart-criteria-form">{criterionFields.map((field) => <label key={field.key}>{field.label}<textarea value={draft[field.key]} onChange={(event) => onDraftChange({ ...draft, [field.key]: event.target.value })} placeholder={field.hint} rows={2} maxLength={2000} /></label>)}</div></div>
          <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">03</span><div><h3>Indicadores propios</h3><p>Define una o varias métricas de este objetivo sin vincularlas a Gestión por Procesos.</p></div><button type="button" className="button secondary small-button" onClick={onOpenIndicator}>+ Añadir indicador</button></div>{draft.indicators.length > 0 ? <div className="smart-indicator-draft-list">{draft.indicators.map((indicator, index) => <div className="smart-indicator-summary" key={`${indicator.name}-${index}`}><div><span className="detail-label">INDICADOR {index + 1}</span><strong>{indicator.name || 'Sin nombre'}</strong><p>{indicator.frequency || 'Sin frecuencia'} · Meta {indicator.target || 'sin definir'} · {indicator.unit || 'Sin unidad'}</p></div><button type="button" className="button secondary small-button" onClick={() => onEditIndicator(index)}>Editar</button></div>)}</div> : <p className="smart-objective-muted">No hay indicadores definidos. Puedes guardar el objetivo y añadirlos después.</p>}</div>
         <div className="smart-form-section"><div className="smart-form-section-heading"><span className="smart-form-index">04</span><div><h3>Estrategias relacionadas</h3><p>{suggestionMode ? 'Las referencias de Checky se conservan y se validarán al aceptar.' : 'Solo aparecen estrategias aceptadas, ponderadas y clasificadas.'}</p></div><span className="smart-selection-count">{selectedKeys.size} seleccionadas</span></div>{suggestionMode ? <div className="smart-suggestion-source-list">{strategyOptions.filter((strategy) => selectedKeys.has(keyOf(strategy.source, strategy.sourceRef))).map((strategy) => <div key={strategy.id}><span className={`smart-source ${sourceTones[strategy.source]}`}>{sourceLabels[strategy.source]}</span><strong>{strategy.title}</strong></div>)}</div> : strategyOptions.length === 0 ? <p className="smart-objective-muted">No hay estrategias disponibles. Primero acepta y pondera una estrategia.</p> : <div className="smart-strategy-picker">{strategyOptions.map((strategy) => { const selected = selectedKeys.has(keyOf(strategy.source, strategy.sourceRef)); return <label className={`smart-strategy-option${selected ? ' selected' : ''}`} key={strategy.id}><input type="checkbox" checked={selected} onChange={() => onToggleStrategy(strategy)} /><span className={`smart-source ${sourceTones[strategy.source]}`}>{sourceLabels[strategy.source]}</span><span className="smart-strategy-option-copy"><strong>{strategy.title}</strong><small>{strategy.description}</small></span><span className="smart-strategy-option-score">{strategy.weighting?.weightedScore.toFixed(2)}<small>{strategy.weightingBand ? bandLabels[strategy.weightingBand] : ''}</small></span></label> })}</div>}</div>
         <div className="drawer-actions smart-form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? <><span className="button-loader" />Guardando...</> : editing ? 'Guardar cambios' : suggestionMode ? 'Guardar propuesta' : 'Guardar borrador'}</button></div>
      </form>
    </div>
  )
}

function RelationMap({ objectives }: { objectives: StrategicObjective[] }) {
  const linkedObjectives = objectives.filter((objective) => objective.strategies.length > 0)
  if (linkedObjectives.length === 0) return null
  return <section className="smart-relation-map"><div className="smart-relation-map-heading"><div><span className="detail-label">MAPA DE RELACIONES</span><h3>Objetivos y estrategias</h3></div><p>Una lectura rápida de qué estrategias sostienen cada objetivo.</p></div><div className="smart-relation-map-list">{linkedObjectives.map((objective) => <div className="smart-relation-map-row" key={objective.id}><div className="smart-map-objective"><span className="smart-map-node objective-node">◎</span><strong>{objective.title}</strong></div><div className="smart-map-lines" aria-hidden="true">{objective.strategies.map((link) => <span key={link.id} />)}</div><div className="smart-map-strategies">{objective.strategies.map((link) => <span key={link.id} className={`smart-map-pill ${sourceTones[link.source]}`}>{link.strategyTitle}</span>)}</div></div>)}</div></section>
}

export function StrategicObjectivesSection({ diagnosticId, companyId, canWrite, initialObjectives, initialStrategyOptions, initialSuggestions, initialLoading, initialExpandedId }: { diagnosticId: string; companyId?: string; canWrite: boolean; initialObjectives?: StrategicObjective[]; initialStrategyOptions?: StrategicStrategyOption[]; initialSuggestions?: StrategicObjectiveSuggestionCard[]; initialLoading?: boolean; initialExpandedId?: string | null }) {
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
  const [suggestions, setSuggestions] = useState<StrategicObjectiveSuggestionCard[]>(initialSuggestions ?? [])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestionError, setSuggestionError] = useState('')
  const [draftOrigin, setDraftOrigin] = useState<'MANUAL' | 'CHECKY'>('MANUAL')
  const [activeSuggestion, setActiveSuggestion] = useState<StrategicObjectiveSuggestionCard | null>(null)
  const [indicatorModalOpen, setIndicatorModalOpen] = useState(false)
  const [indicatorEditor, setIndicatorEditor] = useState<SmartIndicatorDraft>(() => indicatorDraftOf(null))
  const [editingIndicatorId, setEditingIndicatorId] = useState<string | null>(null)
  const [editingIndicatorIndex, setEditingIndicatorIndex] = useState<number | null>(null)
  const [indicatorSaving, setIndicatorSaving] = useState(false)
  const [indicatorError, setIndicatorError] = useState('')
  const [indicatorUsers, setIndicatorUsers] = useState<KpiUser[]>([])

  const loadIndicatorUsers = useCallback(async () => {
    if (!companyId) return
    try {
      const result = await api<{ users: User[] }>('/users')
      setIndicatorUsers(result.users.filter((user) => user.companyId === companyId && user.isActive !== false).map((user) => ({ id: user.id, name: user.name, isActive: user.isActive, companyId: user.companyId ?? null })))
    } catch {
      setIndicatorUsers([])
    }
  }, [companyId])

  useEffect(() => {
    if (indicatorModalOpen) void loadIndicatorUsers()
  }, [indicatorModalOpen, loadIndicatorUsers])

  const loadSuggestions = useCallback(async (options: StrategicStrategyOption[]) => {
    const result = await api<{ suggestions: StrategicObjectiveSuggestionRecord[] }>(`/diagnostics/${diagnosticId}/strategic-objective-suggestions`)
    setSuggestions(result.suggestions.map((suggestion) => suggestionCardOf(suggestion, options)))
  }, [diagnosticId])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [objectiveResult, strategyResult, suggestionResult] = await Promise.all([
        api<{ objectives: StrategicObjective[] }>(`/diagnostics/${diagnosticId}/strategic-objectives`),
        api<{ strategies: DiagnosticStrategy[] }>(`/diagnostics/${diagnosticId}/strategies?acceptedOnly=true`),
        api<{ suggestions: StrategicObjectiveSuggestionRecord[] }>(`/diagnostics/${diagnosticId}/strategic-objective-suggestions`),
      ])
      const options = await Promise.all(strategyResult.strategies.filter((strategy) => Boolean(strategy.weighting && strategy.weightingBand)).map(async (strategy) => ({ ...strategy, sourceRef: await strategySourceRef(strategy.description) })))
      setObjectives(objectiveResult.objectives)
      setStrategyOptions(options)
      setSuggestions(suggestionResult.suggestions.map((suggestion) => suggestionCardOf(suggestion, options)))
    } catch (requestError) {
      setLoadError(smartErrorMessage(requestError, 'No pudimos cargar los objetivos SMART.'))
    } finally {
      setLoading(false)
    }
  }, [diagnosticId])

  useEffect(() => { if (initialObjectives === undefined || initialStrategyOptions === undefined) { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) } return undefined }, [initialObjectives, initialStrategyOptions, load])

  function openCreate() { setEditing(null); setActiveSuggestion(null); setDraftOrigin('MANUAL'); setDraft(draftOf()); setIndicatorEditor(indicatorDraftOf(null)); setEditingIndicatorId(null); setEditingIndicatorIndex(null); setSelectedKeys(new Set()); setError(''); setIndicatorError(''); setModalOpen(true) }
  function openEdit(objective: StrategicObjective) { const nextDraft = draftOf(objective); setEditing(objective); setActiveSuggestion(null); setDraftOrigin('MANUAL'); setDraft(nextDraft); setIndicatorEditor(indicatorDraftOf(null)); setEditingIndicatorId(null); setEditingIndicatorIndex(null); setSelectedKeys(new Set(objective.strategies.map(linkKey))); setError(''); setIndicatorError(''); setModalOpen(true) }
  function openSuggestion(suggestion: StrategicObjectiveSuggestionCard) {
    setEditing(null)
    setActiveSuggestion(suggestion)
    setDraftOrigin('CHECKY')
    const nextDraft = draftOfSuggestion(suggestion)
    setDraft(nextDraft)
    setIndicatorEditor(indicatorDraftOf(null))
    setEditingIndicatorId(null)
    setEditingIndicatorIndex(null)
    setSelectedKeys(new Set(suggestion.strategies.map((strategy) => keyOf(strategy.source, strategy.sourceRef))))
    setError('')
    setIndicatorError('')
    setModalOpen(true)
  }
  function replaceObjective(objective: StrategicObjective) { setObjectives((current) => current.map((item) => item.id === objective.id ? objective : item)) }

  function indicatorPayloadOf(indicator: SmartIndicatorDraft) {
    const text = (value: string) => value.trim() || null
    return {
      name: text(indicator.name),
      description: text(indicator.description),
      frequency: text(indicator.frequency),
      targetValue: text(indicator.target),
      formula: text(indicator.formula),
      dataSource: text(indicator.dataSource),
      unit: text(indicator.unit),
      reportResponsibleId: indicator.reportResponsibleId || null,
      monitorResponsibleId: indicator.monitorResponsibleId || null,
      greenThreshold: text(indicator.greenThreshold),
      yellowThreshold: text(indicator.yellowThreshold),
      redThreshold: text(indicator.redThreshold),
      baselineValue: text(indicator.baselineValue),
      measurementMethod: text(indicator.measurementMethod),
      deadline: text(indicator.deadline),
    }
  }

  function openIndicatorEditor() {
    setEditingIndicatorId(null)
    setEditingIndicatorIndex(null)
    setIndicatorEditor(indicatorDraftOf(null))
    setIndicatorError('')
    setIndicatorModalOpen(true)
  }

  function openIndicatorEditorForIndex(index: number) {
    setEditingIndicatorId(null)
    setEditingIndicatorIndex(index)
    setIndicatorEditor(draft.indicators[index] ?? indicatorDraftOf(null))
    setIndicatorError('')
    setIndicatorModalOpen(true)
  }

  function openIndicatorEditorForId(objective: StrategicObjective, indicatorId: string) {
    const indicator = (objective.indicators?.length ? objective.indicators : objective.indicator ? [objective.indicator] : []).find((item) => item.id === indicatorId)
    if (!indicator) return
    setEditing(objective)
    setDraft(draftOf(objective))
    setEditingIndicatorId(indicatorId)
    setEditingIndicatorIndex(null)
    setIndicatorEditor(indicatorDraftOf(indicator))
    setIndicatorError('')
    setModalOpen(true)
    setIndicatorModalOpen(true)
  }

  async function saveIndicator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (indicatorSaving) return
    const missing = kpiMissingFields(indicatorEditor)
    if (missing.length > 0) {
      setIndicatorError(`Completa los campos obligatorios: ${missing.join(', ')}.`)
      return
    }
    setIndicatorSaving(true)
    setIndicatorError('')
    try {
      if (editing && editingIndicatorId) {
        const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${editing.id}/indicators/${editingIndicatorId}`, { method: 'PUT', body: JSON.stringify(indicatorPayloadOf(indicatorEditor)) })
        replaceObjective(result.objective)
        setEditing(result.objective)
        setDraft(draftOf(result.objective))
        setIndicatorEditor(indicatorDraftOf(null))
      } else if (editing) {
        const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${editing.id}/indicators`, { method: 'POST', body: JSON.stringify(indicatorPayloadOf(indicatorEditor)) })
        replaceObjective(result.objective)
        setEditing(result.objective)
        setDraft(draftOf(result.objective))
        setIndicatorEditor(indicatorDraftOf(null))
      } else {
        setDraft((current) => ({ ...current, indicators: editingIndicatorIndex === null ? [...current.indicators, indicatorEditor] : current.indicators.map((indicator, index) => index === editingIndicatorIndex ? indicatorEditor : indicator) }))
      }
      setIndicatorModalOpen(false)
    } catch (requestError) {
      setIndicatorError(smartErrorMessage(requestError, 'No se pudo guardar el indicador SMART.'))
    } finally {
      setIndicatorSaving(false)
    }
  }

  function payloadOf() {
    const criterion = (value: string) => value.trim() || null
    return { title: draft.title, statement: draft.statement, specificCriteria: criterion(draft.specificCriteria), measurableCriteria: criterion(draft.measurableCriteria), achievableCriteria: criterion(draft.achievableCriteria), relevantCriteria: criterion(draft.relevantCriteria), timeBoundCriteria: criterion(draft.timeBoundCriteria), ...(editing ? {} : { origin: draftOrigin }), ...(!editing ? { indicators: draft.indicators.map(indicatorPayloadOf) } : {}) }
  }

  function suggestionPayloadOf(): StrategicObjectiveSuggestionPayload {
    const text = (value: string) => value.trim() || null
    return {
      title: draft.title,
      statement: draft.statement,
      specificCriteria: text(draft.specificCriteria),
      measurableCriteria: text(draft.measurableCriteria),
      achievableCriteria: text(draft.achievableCriteria),
      relevantCriteria: text(draft.relevantCriteria),
      timeBoundCriteria: text(draft.timeBoundCriteria),
      indicators: draft.indicators.map(indicatorPayloadOf),
    }
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
      if (activeSuggestion) {
        const result = await api<{ suggestion: StrategicObjectiveSuggestionRecord }>(`/strategic-objective-suggestions/${activeSuggestion.id}`, { method: 'PATCH', body: JSON.stringify({ editablePayload: suggestionPayloadOf() }) })
        setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? suggestionCardOf(result.suggestion, strategyOptions, item.missingInformation) : item))
        setModalOpen(false)
        setActiveSuggestion(null)
        return
      }
      const result = editing
        ? await api<{ objective: StrategicObjective }>(`/strategic-objectives/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payloadOf()) })
        : await api<{ objective: StrategicObjective }>(`/diagnostics/${diagnosticId}/strategic-objectives`, { method: 'POST', body: JSON.stringify(payloadOf()) })
       const objective = await syncLinks(result.objective)
      setObjectives((current) => editing ? current.map((item) => item.id === objective.id ? objective : item) : [objective, ...current])
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
      await api<{ suggestions: unknown[]; missingInformation: string[] }>(`/diagnostics/${diagnosticId}/strategic-objectives/suggest`, { method: 'POST', body: JSON.stringify({}) })
      await loadSuggestions(strategyOptions)
    } catch (requestError) {
      setSuggestionError(smartErrorMessage(requestError, 'No se pudieron generar sugerencias con Checky.'))
    } finally {
      setSuggesting(false)
    }
  }

  async function decideSuggestion(suggestion: StrategicObjectiveSuggestionCard, next: 'ACCEPTED' | 'REJECTED') {
    if (!canWrite || busyKey) return
    const confirmed = await askConfirm({ title: next === 'ACCEPTED' ? 'Aceptar propuesta de Checky' : 'Rechazar propuesta de Checky', message: next === 'ACCEPTED' ? `«${suggestion.title}» se convertirá en un objetivo SMART en borrador.` : `«${suggestion.title}» quedará rechazada, pero seguirá visible para consulta.`, confirmLabel: next === 'ACCEPTED' ? 'Aceptar propuesta' : 'Rechazar propuesta' })
    if (!confirmed) return
    setBusyKey(suggestion.id)
    setSuggestionError('')
    try {
      if (next === 'ACCEPTED') {
        const result = await api<{ objective: StrategicObjective; suggestion: StrategicObjectiveSuggestionRecord }>(`/strategic-objective-suggestions/${suggestion.id}/accept`, { method: 'POST', body: JSON.stringify({}) })
        setObjectives((current) => [result.objective, ...current.filter((objective) => objective.id !== result.objective.id)])
        setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? suggestionCardOf(result.suggestion, strategyOptions, item.missingInformation) : item))
      } else {
        const result = await api<{ suggestion: StrategicObjectiveSuggestionRecord }>(`/strategic-objective-suggestions/${suggestion.id}/reject`, { method: 'POST', body: JSON.stringify({}) })
        setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? suggestionCardOf(result.suggestion, strategyOptions, item.missingInformation) : item))
      }
    } catch (requestError) {
      setSuggestionError(smartErrorMessage(requestError, next === 'ACCEPTED' ? 'No se pudo aceptar la propuesta de Checky.' : 'No se pudo rechazar la propuesta de Checky.'))
      if (requestError instanceof Error && 'status' in requestError && (requestError as { status?: number }).status === 409) {
        try { await loadSuggestions(strategyOptions) } catch { /* conserva la propuesta editada si la recarga también falla */ }
      }
    } finally {
      setBusyKey('')
    }
  }

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

  async function deleteIndicator(objective: StrategicObjective, indicatorId: string) {
    if (!canWrite || busyKey) return
    const confirmed = await askConfirm({ title: 'Eliminar indicador SMART', message: 'Se eliminará únicamente este indicador. Los demás indicadores del objetivo permanecerán intactos.', confirmLabel: 'Eliminar indicador' })
    if (!confirmed) return
    setBusyKey(indicatorId)
    setError('')
    try {
      const result = await api<{ objective: StrategicObjective }>(`/strategic-objectives/${objective.id}/indicators/${indicatorId}`, { method: 'DELETE' })
      replaceObjective(result.objective)
      if (editing?.id === objective.id) setEditing(result.objective)
    } catch (requestError) {
      setError(smartErrorMessage(requestError, 'No se pudo eliminar el indicador SMART.'))
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
       {suggestions.length > 0 && <section className="smart-suggestions" aria-label="Propuestas de IA-Checky"><div className="smart-suggestions-heading"><div className="smart-suggestions-heading-main"><img className="checky-avatar" src={checkyImage} alt="Checky" /><div><span className="detail-label">COLABORACIÓN CON CHECKY</span><h3>Propuestas SMART persistentes</h3></div></div><p>Revisa, edita y decide cada propuesta sin perder su trazabilidad.</p></div><div className="smart-suggestions-list">{suggestions.map((suggestion) => <SmartSuggestionCard key={suggestion.id} suggestion={suggestion} canWrite={canWrite} busy={busyKey === suggestion.id} onEdit={() => openSuggestion(suggestion)} onAccept={() => void decideSuggestion(suggestion, 'ACCEPTED')} onReject={() => void decideSuggestion(suggestion, 'REJECTED')} />)}</div></section>}
        {loading ? <LoadingState text="Cargando objetivos y estrategias priorizadas..." /> : objectives.length === 0 ? <EmptyState icon="◎" title="Todavía no hay objetivos SMART" text={canWrite ? 'Crea un borrador y completa sus criterios a medida que avances.' : 'Los objetivos SMART de este análisis aparecerán aquí.'} action={canWrite ? <button type="button" className="button secondary" onClick={openCreate}>Crear primer objetivo</button> : undefined} /> : <div className="smart-objectives-list">{objectives.map((objective) => <SmartObjectiveCard key={objective.id} objective={objective} canWrite={canWrite} busyKey={busyKey} expanded={expandedId === objective.id} onToggle={() => setExpandedId((current) => current === objective.id ? null : objective.id)} onEdit={() => openEdit(objective)} onEditIndicator={(indicatorId) => openIndicatorEditorForId(objective, indicatorId)} onDeleteIndicator={(indicatorId) => void deleteIndicator(objective, indicatorId)} onApprove={() => void approve(objective)} onUnlink={(link) => void unlink(objective, link)} />)}</div>}
       {!loading && <RelationMap objectives={objectives} />}
         {modalOpen && <ObjectiveFormModal draft={draft} editing={editing} suggestionMode={Boolean(activeSuggestion)} strategyOptions={strategyOptions} selectedKeys={selectedKeys} saving={saving} error={error} onDraftChange={setDraft} onToggleStrategy={toggleStrategy} onOpenIndicator={openIndicatorEditor} onEditIndicator={openIndicatorEditorForIndex} onSubmit={(event) => void saveObjective(event)} onClose={() => { if (!saving) setModalOpen(false) }} />}
         {indicatorModalOpen && <SmartIndicatorModal draft={indicatorEditor} users={indicatorUsers} editing={editingIndicatorId !== null || editingIndicatorIndex !== null} saving={indicatorSaving} error={indicatorError} onDraftChange={setIndicatorEditor} onSubmit={(event) => void saveIndicator(event)} onClose={() => { if (!indicatorSaving) setIndicatorModalOpen(false) }} />}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import { askConfirm } from '../ui/useConfirm'
import type { AuditCheckySuggestion, AuditCheckySuggestionCriterionPayload, AuditCheckySuggestionKind, AuditCheckySuggestionPayload, AuditEfficacyMethodology, AuditFinding, AuditRootCauseAnalysis } from '../../types'
import checkyImage from '../../assets/Aprobado por checky.png'

const kindLabels: Record<AuditCheckySuggestionKind, string> = {
  ROOT_CAUSE: 'Causa raíz potencial',
  ROOT_CAUSE_ANALYSIS: 'Análisis de causa raíz',
  CORRECTIVE_ACTION: 'Acción correctiva',
}

const statusLabels: Record<AuditCheckySuggestion['status'], string> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
}

const methodologyLabels: Record<AuditEfficacyMethodology, string> = {
  DOCUMENTARY_SAMPLING: 'Muestreo documental',
  INDICATOR_MONITORING: 'Seguimiento de indicadores',
  DIRECT_OBSERVATION: 'Observación directa',
  INTERVIEWS: 'Entrevistas',
  RECORD_REVIEW: 'Revisión de registros',
  FOLLOW_UP_AUDIT: 'Auditoría de seguimiento',
  OTHER: 'Otro',
}

type EligibleCause = { id: string; description: string; analysis: { methodology: string; problemDescription: string } | null }
type DecisionEditor = { suggestion: AuditCheckySuggestion; note: string }

const payloadText = (suggestion: AuditCheckySuggestion): string => {
  const payload = suggestion.editablePayload
  if (payload.kind === 'ROOT_CAUSE') return String(payload.description ?? '')
  if (payload.kind === 'ROOT_CAUSE_ANALYSIS') return String(payload.problemDescription ?? '')
  return String(payload.title ?? '')
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'No se pudo completar la operación de Checky.'
}

function criterionList(payload: AuditCheckySuggestionPayload): AuditCheckySuggestionCriterionPayload[] {
  return Array.isArray(payload.acceptanceCriteria) ? payload.acceptanceCriteria : []
}

export function CheckyFindingSuggestionsPanel({ auditId, finding, canWrite, onChanged, onError, onNotice }: {
  auditId: string
  finding: AuditFinding
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [suggestions, setSuggestions] = useState<AuditCheckySuggestion[]>([])
  const [analyses, setAnalyses] = useState<AuditRootCauseAnalysis[]>([])
  const [eligibleCauses, setEligibleCauses] = useState<EligibleCause[]>([])
  const [analysisId, setAnalysisId] = useState('')
  const [editing, setEditing] = useState<{ id: string; payload: AuditCheckySuggestionPayload } | null>(null)
  const [decision, setDecision] = useState<DecisionEditor | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const readonly = !canWrite || finding.status === 'VERIFIED'

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api<{ suggestions: AuditCheckySuggestion[] }>(`/audits/${auditId}/findings/${finding.id}/checky/suggestions`),
      api<{ analyses: AuditRootCauseAnalysis[] }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses`),
      api<{ causes: EligibleCause[] }>(`/audits/${auditId}/findings/${finding.id}/eligible-root-causes`),
    ]).then(([suggestionResult, analysisResult, causeResult]) => {
      if (!cancelled) {
        setSuggestions(suggestionResult.suggestions)
        setAnalyses(analysisResult.analyses)
        setEligibleCauses(causeResult.causes)
      }
    }).catch((requestError) => {
      if (!cancelled) {
        const message = errorMessage(requestError)
        setError(message)
        onError(message)
      }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [auditId, finding.id, onError])

  function updateEditing(payload: AuditCheckySuggestionPayload) {
    setEditing((current) => current ? { ...current, payload } : current)
  }

  function updateEditingField(field: string, value: unknown) {
    if (!editing) return
    updateEditing({ ...editing.payload, [field]: value })
  }

  function updateCriterion(index: number, field: keyof AuditCheckySuggestionCriterionPayload, value: string | boolean) {
    if (!editing) return
    const nextCriteria = criterionList(editing.payload).map((criterion, criterionIndex) => criterionIndex === index ? { ...criterion, [field]: value } : criterion)
    updateEditingField('acceptanceCriteria', nextCriteria)
  }

  function addCriterion(type: AuditCheckySuggestionCriterionPayload['type']) {
    if (!editing) return
    updateEditingField('acceptanceCriteria', [...criterionList(editing.payload), { type, description: '', expectedResult: '', required: true }])
  }

  function removeCriterion(index: number) {
    if (!editing) return
    updateEditingField('acceptanceCriteria', criterionList(editing.payload).filter((_, criterionIndex) => criterionIndex !== index))
  }

  function toggleCause(causeId: string) {
    if (!editing) return
    const causeIds = Array.isArray(editing.payload.causeIds) ? editing.payload.causeIds : []
    updateEditingField('causeIds', causeIds.includes(causeId) ? causeIds.filter((id) => id !== causeId) : [...causeIds, causeId])
  }

  async function generate() {
    if (busy || readonly) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ suggestions: AuditCheckySuggestion[] }>(`/audits/${auditId}/findings/${finding.id}/checky/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ kinds: ['ROOT_CAUSE_ANALYSIS', 'ROOT_CAUSE', 'CORRECTIVE_ACTION'], ...(analysisId ? { analysisId } : {}) }),
      })
      setSuggestions((current) => [...result.suggestions, ...current.filter((item) => !result.suggestions.some((next) => next.id === item.id))])
      onNotice('Checky generó propuestas separadas del expediente oficial.')
    } catch (requestError) {
      const message = errorMessage(requestError)
      setError(message)
      onError(message)
    } finally { setBusy(false) }
  }

  async function saveEditing() {
    if (!editing || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ suggestion: AuditCheckySuggestion }>(`/audit-checky-suggestions/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ editablePayload: editing.payload }) })
      setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item))
      setEditing(null)
      onNotice('Propuesta actualizada. El documento original permanece intacto.')
    } catch (requestError) {
      const message = errorMessage(requestError)
      setError(message)
      onError(message)
    } finally { setBusy(false) }
  }

  async function decide(suggestion: AuditCheckySuggestion, decisionType: 'accept' | 'reject', note?: string) {
    if (busy || readonly || suggestion.status !== 'PENDING') return
    if (decisionType === 'reject' && !note?.trim()) {
      setError('La justificación es obligatoria para rechazar una propuesta.')
      return
    }
    const confirmed = await askConfirm({
      title: decisionType === 'accept' ? 'Aceptar propuesta de Checky' : 'Rechazar propuesta de Checky',
      message: decisionType === 'accept' ? 'Se creará el registro oficial correspondiente y la propuesta dejará de estar pendiente.' : 'La propuesta quedará rechazada y no podrá volver a decidirse.',
      confirmLabel: decisionType === 'accept' ? 'Aceptar' : 'Rechazar',
    })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ suggestion: AuditCheckySuggestion }>(`/audit-checky-suggestions/${suggestion.id}/${decisionType}`, { method: 'POST', body: JSON.stringify(decisionType === 'reject' ? { decisionNote: note?.trim() } : {}) })
      setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item))
      setDecision(null)
      await onChanged()
      onNotice(decisionType === 'accept' ? 'Propuesta aceptada y registrada para revisión.' : 'Propuesta rechazada con justificación.')
    } catch (requestError) {
      const message = errorMessage(requestError)
      setError(message)
      onError(message)
    } finally { setBusy(false) }
  }

  const renderEditor = () => {
    if (!editing) return null
    const payload = editing.payload
    return <div className="finding-checky-editor">
      <div className="finding-dossier-form-title"><strong>Editar propuesta pendiente</strong><span>El original generado por Checky no se modifica.</span></div>
      {payload.kind === 'ROOT_CAUSE_ANALYSIS' && <><label>Metodología<select value={String(payload.methodology ?? 'MANUAL')} onChange={(event) => updateEditingField('methodology', event.target.value)}><option value="MANUAL">Manual</option><option value="FIVE_WHYS">Five Whys</option><option value="ISHIKAWA">Ishikawa</option></select></label><label>Descripción del problema<textarea value={String(payload.problemDescription ?? '')} onChange={(event) => updateEditingField('problemDescription', event.target.value)} required rows={3} /></label></>}
      {payload.kind === 'ROOT_CAUSE' && <><label>Análisis en borrador<select value={String(payload.analysisId ?? '')} onChange={(event) => updateEditingField('analysisId', event.target.value)} required><option value="">Selecciona un análisis</option>{analyses.filter((analysis) => analysis.status === 'DRAFT').map((analysis) => <option key={analysis.id} value={analysis.id}>{analysis.methodology} · {analysis.problemDescription}</option>)}</select></label><label>Causa propuesta<textarea value={String(payload.description ?? '')} onChange={(event) => updateEditingField('description', event.target.value)} required rows={3} /></label><label>Justificación<textarea value={String(payload.justification ?? '')} onChange={(event) => updateEditingField('justification', event.target.value || null)} rows={2} /></label></>}
      {payload.kind === 'CORRECTIVE_ACTION' && <>
        <label>Título<input value={String(payload.title ?? '')} onChange={(event) => updateEditingField('title', event.target.value)} required minLength={3} /></label>
        <label>Descripción<textarea value={String(payload.description ?? '')} onChange={(event) => updateEditingField('description', event.target.value)} required rows={3} /></label>
        <label>Objetivo<textarea value={String(payload.objective ?? '')} onChange={(event) => updateEditingField('objective', event.target.value || null)} rows={2} /></label>
        <label>Plan de implementación<textarea value={String(payload.implementationPlan ?? '')} onChange={(event) => updateEditingField('implementationPlan', event.target.value || null)} rows={2} /></label>
        <div className="finding-checky-editor-grid"><label>Prioridad<select value={String(payload.priority ?? 'MEDIUM')} onChange={(event) => updateEditingField('priority', event.target.value)}><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label><label>Periodo sugerido de observación<input value={String(payload.observationPeriod ?? '')} onChange={(event) => updateEditingField('observationPeriod', event.target.value || null)} placeholder="Ej. 30 días" /></label></div>
        <label>Metodología sugerida para eficacia<select value={String(payload.methodology ?? '')} onChange={(event) => updateEditingField('methodology', event.target.value || null)}><option value="">No especificada</option>{Object.entries(methodologyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="finding-checky-criteria"><div className="corrective-action-subheading"><strong>Criterios propuestos</strong><span><button type="button" className="text-button" onClick={() => addCriterion('IMPLEMENTATION')}>+ Implementación</button><button type="button" className="text-button" onClick={() => addCriterion('EFFECTIVENESS')}>+ Eficacia</button></span></div>{criterionList(payload).map((criterion, index) => <div className="finding-checky-criterion-editor" key={`${criterion.type}-${index}`}><div className="finding-checky-editor-grid"><label>Tipo<select value={criterion.type} onChange={(event) => updateCriterion(index, 'type', event.target.value as AuditCheckySuggestionCriterionPayload['type'])}><option value="IMPLEMENTATION">Implementación</option><option value="EFFECTIVENESS">Eficacia</option></select></label><label className="quality-checkbox-field"><input type="checkbox" checked={criterion.required} onChange={(event) => updateCriterion(index, 'required', event.target.checked)} /> Obligatorio</label></div><label>Descripción<input value={criterion.description} onChange={(event) => updateCriterion(index, 'description', event.target.value)} required /></label><label>Resultado esperado<textarea value={criterion.expectedResult} onChange={(event) => updateCriterion(index, 'expectedResult', event.target.value)} required rows={2} /></label><button type="button" className="text-button" onClick={() => removeCriterion(index)}>Eliminar criterio</button></div>)}</div>
        {eligibleCauses.length > 0 && <fieldset className="finding-checky-causes"><legend>Causas confirmadas vinculadas</legend>{eligibleCauses.map((cause) => <label key={cause.id} className="quality-checkbox-field"><input type="checkbox" checked={Array.isArray(payload.causeIds) && payload.causeIds.includes(cause.id)} onChange={() => toggleCause(cause.id)} /> {cause.description}</label>)}</fieldset>}
      </>}
      <footer><button type="button" className="button primary small-button" onClick={() => void saveEditing()} disabled={busy}>Guardar propuesta</button><button type="button" className="button secondary small-button" onClick={() => setEditing(null)} disabled={busy}>Cancelar</button></footer>
    </div>
  }

  return (
    <section className="finding-dossier-checky" aria-labelledby="finding-checky-title">
      <header className="finding-checky-header checky-context-header">
        <div className="finding-checky-avatar checky-context-avatar"><img src={checkyImage} alt="" aria-hidden="true" /></div>
        <div className="finding-checky-identity">
          <p className="detail-label">ASISTENCIA CONTEXTUAL</p>
          <h3 id="finding-checky-title">Checky en el tratamiento</h3>
          <p className="finding-checky-intro">Sugiere análisis de causa raíz y acciones correctivas a partir del contexto del hallazgo.</p>
          <span className="finding-checky-origin">Sugerencias de IA · revisión humana obligatoria</span>
        </div>
        {!readonly && <button type="button" className="button primary small-button finding-checky-generate" onClick={() => void generate()} disabled={busy}>{busy ? 'Analizando…' : 'Generar sugerencias'}</button>}
      </header>
      <p className="finding-checky-note">Nada se incorpora automáticamente al expediente oficial. Edita, acepta o rechaza cada propuesta para conservar la trazabilidad.</p>
      {!readonly && analyses.some((analysis) => analysis.status === 'DRAFT') && <label className="finding-checky-analysis">Análisis para una causa potencial <select value={analysisId} onChange={(event) => setAnalysisId(event.target.value)}><option value="">Cualquiera en borrador</option>{analyses.filter((analysis) => analysis.status === 'DRAFT').map((analysis) => <option key={analysis.id} value={analysis.id}>{analysis.methodology} · {analysis.problemDescription}</option>)}</select></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {renderEditor()}
      {loading ? <div className="finding-checky-state finding-checky-loading" role="status" aria-busy="true"><span className="loader" />Cargando propuestas de Checky…</div> : suggestions.length === 0 ? <div className="finding-checky-state finding-dossier-empty"><strong>Aún no hay propuestas</strong><span>Genera una lectura cuando el hallazgo tenga contexto suficiente. Las propuestas aparecerán aquí antes de cualquier registro oficial.</span></div> : (
        <div className="finding-checky-list">{suggestions.map((suggestion) => {
          const payload = suggestion.editablePayload
          const criteria = payload.kind === 'CORRECTIVE_ACTION' ? criterionList(payload) : []
          return <article className={`finding-checky-card ${suggestion.status.toLowerCase()}`} key={suggestion.id}>
            <header className="finding-checky-card-header"><div><span className="finding-checky-kind">{kindLabels[suggestion.kind]}</span><h4>{payloadText(suggestion)}</h4></div><span className={`finding-checky-status ${suggestion.status.toLowerCase()}`}>{statusLabels[suggestion.status]}</span></header>
            <div className="finding-checky-card-meta"><span className="finding-checky-source">Checky</span><span>{suggestion.evidenceIds.length > 0 ? `${suggestion.evidenceIds.length} evidencia(s) citada(s)` : 'Sin evidencias citadas'}</span></div>
            {suggestion.kind === 'ROOT_CAUSE_ANALYSIS' && <div className="finding-checky-details"><p>Metodología: {String(payload.methodology ?? 'No especificada')}</p><p>Se creará como análisis en borrador al aceptar.</p></div>}
            {suggestion.kind === 'ROOT_CAUSE' && <div className="finding-checky-details"><p>Se asociará a un análisis en borrador al aceptar.</p>{payload.justification && <p>Justificación propuesta: {String(payload.justification)}</p>}</div>}
            {suggestion.kind === 'CORRECTIVE_ACTION' && <div className="finding-checky-details"><p>{criteria.length} criterio(s) propuesto(s).</p>{payload.methodology && <p>Metodología sugerida: {methodologyLabels[payload.methodology as AuditEfficacyMethodology]}</p>}{payload.observationPeriod && <p>Periodo sugerido: {String(payload.observationPeriod)}</p>}{Array.isArray(payload.causeIds) && payload.causeIds.length > 0 && <p>{payload.causeIds.length} causa(s) confirmada(s) para vincular.</p>}</div>}
            {suggestion.decisionNote && <p className="finding-checky-decision-note">Justificación: {suggestion.decisionNote}</p>}
            {suggestion.status === 'PENDING' && !readonly && <div className="finding-checky-actions"><button type="button" className="button secondary small-button finding-checky-edit-action" onClick={() => setEditing({ id: suggestion.id, payload: suggestion.editablePayload })} disabled={busy}>Editar</button><button type="button" className="button primary small-button" onClick={() => void decide(suggestion, 'accept')} disabled={busy}>Aceptar</button><button type="button" className="button secondary small-button finding-checky-reject-action" onClick={() => setDecision({ suggestion, note: '' })} disabled={busy}>Rechazar</button></div>}
            {decision?.suggestion.id === suggestion.id && <form className="finding-checky-decision-form" onSubmit={(event) => { event.preventDefault(); void decide(suggestion, 'reject', decision.note) }}><label>Justificación del rechazo<textarea value={decision.note} onChange={(event) => setDecision((current) => current ? { ...current, note: event.target.value } : current)} required minLength={1} maxLength={1000} rows={3} /></label><button type="submit" className="button primary small-button" disabled={busy}>Confirmar rechazo</button><button type="button" className="button secondary small-button" onClick={() => setDecision(null)} disabled={busy}>Cancelar</button></form>}
          </article>
        })}</div>
      )}
    </section>
  )
}

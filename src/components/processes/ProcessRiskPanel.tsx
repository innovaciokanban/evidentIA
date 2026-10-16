import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import { riskLevelFor, riskLevelLabel, riskLevelText, riskScoreFor } from '../../risk-matrix'
import type { Process, ProcessRisk, ProcessRiskControl, ProcessRiskEvidence, RiskAcceptanceStatus, RiskControlEvaluation, RiskLevel, RiskTreatment, RiskType, User } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { RiskHeatmap, type HeatmapSelection } from './RiskHeatmap'

type RiskDraft = {
  name: string
  description: string
  riskType: string
  riskOwnerId: string
  acceptanceStatus: RiskAcceptanceStatus
  treatment: string
  mitigationOwnerId: string
  mitigationStartDate: string
  mitigationDueDate: string
  inherentImpact: string
  inherentProbability: string
  residualImpact: string
  residualProbability: string
}

type ControlDraft = { description: string; evaluation: RiskControlEvaluation }
type EvidenceDraft = { name: string; description: string; url: string }

const emptyRiskDraft: RiskDraft = {
  name: '', description: '', riskType: '', riskOwnerId: '', acceptanceStatus: 'PENDING', treatment: '', mitigationOwnerId: '', mitigationStartDate: '', mitigationDueDate: '', inherentImpact: '3', inherentProbability: '3', residualImpact: '1', residualProbability: '1',
}
const emptyControlDraft: ControlDraft = { description: '', evaluation: 'PENDING' }
const emptyEvidenceDraft: EvidenceDraft = { name: '', description: '', url: '' }
const impactOptions = [['1', '1 - Insignificante'], ['2', '2 - Menor'], ['3', '3 - Moderado'], ['4', '4 - Mayor'], ['5', '5 - Catastrófico']]
const probabilityOptions = [['1', '1 - Raro'], ['2', '2 - Improbable'], ['3', '3 - Posible'], ['4', '4 - Probable'], ['5', '5 - Casi seguro']]
const riskTypeOptions: Array<[RiskType, string]> = [['ESTRATEGICO', 'Estratégico'], ['MISIONAL', 'Misional'], ['APOYO', 'Apoyo']]
const riskTypeLabelFor = (value: string): string => riskTypeOptions.find(([option]) => option === value)?.[1] ?? value
const controlEvaluationOptions: Array<[RiskControlEvaluation, string]> = [['PENDING', 'Pendiente'], ['WEAK', 'Débil'], ['PARTIAL', 'Parcial'], ['EFFECTIVE', 'Efectivo']]
const treatmentOptions: Array<[RiskTreatment, string]> = [['AVOID', 'Evitar'], ['MITIGATE', 'Mitigar'], ['TRANSFER', 'Transferir'], ['ACCEPT', 'Aceptar']]
const treatmentLabelFor = (value: RiskTreatment | null): string => value ? (treatmentOptions.find(([option]) => option === value)?.[1] ?? value) : '—'
const acceptanceOptions: Array<[RiskAcceptanceStatus, string]> = [['PENDING', 'Pendiente'], ['ACCEPTED', 'Aceptado'], ['REJECTED', 'Rechazado']]
const acceptanceLabelFor = (value: RiskAcceptanceStatus): string => acceptanceOptions.find(([option]) => option === value)?.[1] ?? value
const isHttpUrl = (value: string): boolean => /^https?:\/\/\S+$/i.test(value.trim())

const draftFromRisk = (risk: ProcessRisk): RiskDraft => ({
  name: risk.name,
  description: risk.description,
  riskType: risk.riskType,
  riskOwnerId: risk.riskOwner?.id ?? '',
  acceptanceStatus: risk.acceptanceStatus,
  treatment: risk.treatment ?? '',
  mitigationOwnerId: risk.mitigationOwner?.id ?? '',
  mitigationStartDate: risk.mitigationStartDate ? risk.mitigationStartDate.slice(0, 10) : '',
  mitigationDueDate: risk.mitigationDueDate ? risk.mitigationDueDate.slice(0, 10) : '',
  inherentImpact: String(risk.inherentImpact),
  inherentProbability: String(risk.inherentProbability),
  residualImpact: String(risk.residualImpact),
  residualProbability: String(risk.residualProbability),
})

const isCurrentRiskType = (value: string): value is RiskType => riskTypeOptions.some(([option]) => option === value)
const riskTypeOptionsFor = (value: string): Array<[string, string]> => isCurrentRiskType(value) || !value
  ? riskTypeOptions
  : [[value, `${value} (legado)`], ...riskTypeOptions]

function LevelBadge({ level, score }: { level: RiskLevel; score: number }) {
  return <span className={`risk-level-badge ${level.toLowerCase()}`}><span className="risk-level-dot" />{score} — {riskLevelLabel[level]}</span>
}

// El código lo genera el backend: aquí solo se muestra, nunca se edita.
export function RiskCodeInput({ code, creating }: { code: string | null; creating: boolean }) {
  return <label>Código del riesgo<input className="risk-code-input" disabled value={code ?? ''} placeholder={creating ? 'Se asignará automáticamente' : 'Se asignará al clasificar el tipo'} /></label>
}

function EvaluationCard({ title, impact, probability, onImpact, onProbability, disabled }: {
  title: string
  impact: string
  probability: string
  onImpact: (value: string) => void
  onProbability: (value: string) => void
  disabled: boolean
}) {
  const level = riskLevelFor(Number(impact), Number(probability))
  return (
    <div className="risk-evaluation-card">
      <div className="risk-evaluation-title"><span>{title}</span><LevelBadge level={level} score={riskScoreFor(Number(impact), Number(probability))} /></div>
      <label>Impacto<select value={impact} onChange={(event) => onImpact(event.target.value)} disabled={disabled}>{impactOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Probabilidad<select value={probability} onChange={(event) => onProbability(event.target.value)} disabled={disabled}>{probabilityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="risk-calculated-level"><span>Nivel calculado</span><strong className={`risk-level-text ${level.toLowerCase()}`}>{riskLevelText(Number(impact), Number(probability))}</strong></div>
    </div>
  )
}

function ControlEditor({ control, draft, saving, error, onDraftChange, onSave, onCancel }: {
  control: ProcessRiskControl | null
  draft: ControlDraft
  saving: boolean
  error: string
  onDraftChange: (draft: ControlDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="risk-control-editor">
      <label>{control ? 'Editar control' : 'Nuevo control'}<textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} placeholder="Describe la acción de control" rows={3} maxLength={1000} autoFocus /></label>
      <label>Evaluación<select value={draft.evaluation} onChange={(event) => onDraftChange({ ...draft, evaluation: event.target.value as RiskControlEvaluation })}>{controlEvaluationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error && <span className="risk-inline-error" role="alert">{error}</span>}
      <div className="risk-control-editor-actions"><button type="button" className="text-button" onClick={onCancel}>Cancelar</button><button type="button" className="button primary small-button" disabled={saving || draft.description.trim().length < 3} onClick={onSave}>{saving ? 'Guardando...' : control ? 'Guardar control' : 'Agregar control'}</button></div>
    </div>
  )
}

function EvidenceEditor({ evidence, draft, saving, error, onDraftChange, onSave, onCancel }: {
  evidence: ProcessRiskEvidence | null
  draft: EvidenceDraft
  saving: boolean
  error: string
  onDraftChange: (draft: EvidenceDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const urlValid = isHttpUrl(draft.url) && draft.url.trim().length <= 500
  return (
    <div className="risk-control-editor">
      <label>{evidence ? 'Editar evidencia' : 'Nueva evidencia'}<input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} placeholder="Ej. Acta de aprobación del comité" minLength={3} maxLength={160} autoFocus /></label>
      <label>Descripción<textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} placeholder="Qué demuestra esta evidencia" rows={3} maxLength={2000} /></label>
      <label>Enlace<input type="url" value={draft.url} onChange={(event) => onDraftChange({ ...draft, url: event.target.value })} placeholder="https://..." maxLength={500} /></label>
      {error && <span className="risk-inline-error" role="alert">{error}</span>}
      <div className="risk-control-editor-actions"><button type="button" className="text-button" onClick={onCancel}>Cancelar</button><button type="button" className="button primary small-button" disabled={saving || draft.name.trim().length < 3 || draft.description.trim().length < 3 || !urlValid} onClick={onSave}>{saving ? 'Guardando...' : evidence ? 'Guardar evidencia' : 'Agregar evidencia'}</button></div>
    </div>
  )
}

export function ProcessRiskPanel({ process, users, canWrite, onBack }: { process: Process; users: Array<Pick<User, 'id' | 'name'> & { companyId: string | null }>; canWrite: boolean; onBack: () => void }) {
  const [risks, setRisks] = useState<ProcessRisk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ProcessRisk | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [draft, setDraft] = useState<RiskDraft>(emptyRiskDraft)
  const [controlEditor, setControlEditor] = useState<{ control: ProcessRiskControl | null; draft: ControlDraft } | null>(null)
  const [evidenceEditor, setEvidenceEditor] = useState<{ evidence: ProcessRiskEvidence | null; draft: EvidenceDraft } | null>(null)
  const [riskView, setRiskView] = useState<'list' | 'heatmap'>('list')
  const [heatmapSelection, setHeatmapSelection] = useState<HeatmapSelection | null>(null)

  const loadRisks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<{ risks: ProcessRisk[] }>(`/processes/${process.id}/risks`)
      setRisks(result.risks)
      return result.risks
    } catch (requestError) {
      console.error('[process-risks] failed to load risks', requestError)
      setError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar los riesgos.')
      return []
    } finally {
      setLoading(false)
    }
  }, [process.id])

  useEffect(() => { void loadRisks() }, [loadRisks])

  function openCreate() {
    setShowDetail(true)
    setSelected(null)
    setDraft(emptyRiskDraft)
    setControlEditor(null)
    setEvidenceEditor(null)
    setNotice('')
    setError('')
  }

  function openEdit(risk: ProcessRisk) {
    setShowDetail(true)
    setSelected(risk)
    setDraft(draftFromRisk(risk))
    setControlEditor(null)
    setEvidenceEditor(null)
    setNotice('')
    setError('')
  }

  function closeDetail() {
    setShowDetail(false)
    setSelected(null)
    setControlEditor(null)
    setEvidenceEditor(null)
    setError('')
  }

  async function saveRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite || saving) return
    if (draft.mitigationStartDate && draft.mitigationDueDate && draft.mitigationDueDate < draft.mitigationStartDate) {
      setError('La fecha de vencimiento del plan no puede ser anterior a la fecha de inicio.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    const payload: Record<string, unknown> = {
      name: draft.name,
      description: draft.description,
      riskType: draft.riskType,
      riskOwnerId: draft.riskOwnerId || null,
      acceptanceStatus: draft.acceptanceStatus,
      treatment: draft.treatment || null,
      mitigationOwnerId: draft.mitigationOwnerId || null,
      mitigationStartDate: draft.mitigationStartDate || null,
      mitigationDueDate: draft.mitigationDueDate || null,
      inherentImpact: Number(draft.inherentImpact),
      inherentProbability: Number(draft.inherentProbability),
      residualImpact: Number(draft.residualImpact),
      residualProbability: Number(draft.residualProbability),
    }
    if (selected && !isCurrentRiskType(draft.riskType)) delete payload.riskType
    try {
      const result = selected
        ? await api<{ risk: ProcessRisk }>(`/processes/${process.id}/risks/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ risk: ProcessRisk }>(`/processes/${process.id}/risks`, { method: 'POST', body: JSON.stringify(payload) })
      await loadRisks()
      setSelected(result.risk)
      setDraft(draftFromRisk(result.risk))
      setNotice(`Riesgo ${selected ? 'actualizado' : 'creado'} correctamente.`)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el riesgo.')
    } finally {
      setSaving(false)
    }
  }

  async function removeRisk(risk: ProcessRisk) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar riesgo', message: `Se eliminará «${risk.name}», sus controles y evidencias. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    setError('')
    try {
      await api(`/processes/${process.id}/risks/${risk.id}`, { method: 'DELETE' })
      await loadRisks()
      if (selected?.id === risk.id) closeDetail()
      setNotice('Riesgo eliminado correctamente.')
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el riesgo.')
    }
  }

  async function saveControl() {
    if (!selected || !canWrite || !controlEditor || saving) return
    setSaving(true)
    setError('')
    try {
      const path = `/processes/${process.id}/risks/${selected.id}/controls${controlEditor.control ? `/${controlEditor.control.id}` : ''}`
      await api(path, { method: controlEditor.control ? 'PATCH' : 'POST', body: JSON.stringify(controlEditor.draft) })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) setSelected(updated)
      setControlEditor(null)
      setNotice(`Control ${controlEditor.control ? 'actualizado' : 'agregado'} correctamente.`)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el control.')
    } finally {
      setSaving(false)
    }
  }

  async function removeControl(control: ProcessRiskControl) {
    if (!selected || !canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar control', message: `Se eliminará «${control.description}».`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    try {
      await api(`/processes/${process.id}/risks/${selected.id}/controls/${control.id}`, { method: 'DELETE' })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) setSelected(updated)
      setNotice('Control eliminado correctamente.')
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el control.')
    }
  }

  async function saveEvidence() {
    if (!selected || !canWrite || !evidenceEditor || saving) return
    const url = evidenceEditor.draft.url.trim()
    if (!isHttpUrl(url)) {
      setError('El enlace de la evidencia debe empezar por http:// o https://.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const path = `/processes/${process.id}/risks/${selected.id}/evidences${evidenceEditor.evidence ? `/${evidenceEditor.evidence.id}` : ''}`
      await api(path, { method: evidenceEditor.evidence ? 'PATCH' : 'POST', body: JSON.stringify({ ...evidenceEditor.draft, url }) })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) setSelected(updated)
      setEvidenceEditor(null)
      setNotice(`Evidencia ${evidenceEditor.evidence ? 'actualizada' : 'agregada'} correctamente.`)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar la evidencia.')
    } finally {
      setSaving(false)
    }
  }

  async function removeEvidence(evidence: ProcessRiskEvidence) {
    if (!selected || !canWrite) return
    const confirmed = await askConfirm({ title: 'Eliminar evidencia', message: `Se eliminará «${evidence.name}».`, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    try {
      await api(`/processes/${process.id}/risks/${selected.id}/evidences/${evidence.id}`, { method: 'DELETE' })
      const updated = (await loadRisks()).find((risk) => risk.id === selected.id)
      if (updated) setSelected(updated)
      setNotice('Evidencia eliminada correctamente.')
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar la evidencia.')
    }
  }

  const isDetail = showDetail
  const availableRiskOwners = users.filter((user) => user.companyId === process.companyId)
  const renderLevel = (level: RiskLevel, score: number) => <LevelBadge level={level} score={score} />
  const heatmapMatches = heatmapSelection ? risks.filter((risk) => {
    const impact = heatmapSelection.mode === 'inherent' ? risk.inherentImpact : risk.residualImpact
    const probability = heatmapSelection.mode === 'inherent' ? risk.inherentProbability : risk.residualProbability
    return impact === heatmapSelection.impact && probability === heatmapSelection.probability
  }) : []
  const heatmapSelectionLevel = heatmapSelection ? riskLevelFor(heatmapSelection.impact, heatmapSelection.probability) : null

  function toggleHeatmapCell(selection: HeatmapSelection) {
    setHeatmapSelection((current) => (
      current && current.mode === selection.mode && current.impact === selection.impact && current.probability === selection.probability
        ? null
        : selection
    ))
  }

  return (
    <div className="process-risk-page">
      <div className="risk-page-header">
        <button type="button" className="text-button risk-back-button" onClick={onBack}>← Volver a la caracterización</button>
        {!isDetail ? <div className="risk-page-heading"><div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO RIESGOS</p><h1>Riesgos</h1><p className="muted">Identifica y evalúa los riesgos asociados a este proceso.</p></div>{canWrite && <button type="button" className="button primary" onClick={openCreate}>+ Nuevo riesgo</button>}</div> : <div className="risk-page-heading"><div><p className="eyebrow">RIESGOS / DETALLE</p><h1>{selected ? 'Detalle del riesgo' : 'Nuevo riesgo'}</h1><p className="muted">Registra la información y evaluación del riesgo.</p></div></div>}
      </div>

      <section className="panel risk-process-context"><div><span>Proceso</span><strong>{process.name}</strong></div><div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div><div><span>Riesgos registrados</span><strong>{risks.length}</strong></div></section>
      {notice && <div className="form-success page-alert" role="status">{notice}</div>}
      {error && !controlEditor && !evidenceEditor && <div className="form-error page-alert" role="alert">{error}<button type="button" className="button secondary small-button" onClick={() => void loadRisks()}>Reintentar</button></div>}

      {isDetail ? (
        <form className="panel risk-detail-panel" onSubmit={(event) => void saveRisk(event)}>
          <div className="risk-detail-toolbar"><button type="button" className="text-button" onClick={closeDetail}>← Volver a riesgos</button>{selected && canWrite && <button type="button" className="button danger small-button" onClick={() => void removeRisk(selected)}>Eliminar riesgo</button>}</div>
          <fieldset disabled={!canWrite} className="risk-detail-fields">
             <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">INFORMACIÓN BASE</p><h2>DETALLE DEL RIESGO</h2></div><span className="risk-process-chip">{process.code ?? 'Proceso'}</span></div><div className="risk-base-grid"><RiskCodeInput code={selected ? selected.code : null} creating={!selected} /><label>Nombre del riesgo<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Entrega tardía de información" minLength={3} maxLength={160} required /></label><label>Tipo de riesgo<select value={draft.riskType} onChange={(event) => setDraft({ ...draft, riskType: event.target.value })} required><option value="">Selecciona un tipo</option>{riskTypeOptionsFor(draft.riskType).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Dueño del riesgo<select value={draft.riskOwnerId} onChange={(event) => setDraft({ ...draft, riskOwnerId: event.target.value })}><option value="">Sin asignar</option>{availableRiskOwners.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label><label className="risk-base-wide">Descripción del riesgo<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Qué puede ocurrir, por qué y qué efecto tendría." rows={4} maxLength={5000} required /></label></div></section>
            <section className="risk-detail-section risk-evaluation-section"><div className="risk-section-heading"><div><p className="detail-label">VALORACIÓN</p><h2>EVALUACIÓN DE RIESGOS</h2></div><span className="risk-method-note">Matriz 5 × 5 · impacto × probabilidad</span></div><div className="risk-evaluation-layout"><EvaluationCard title="RIESGO INHERENTE" impact={draft.inherentImpact} probability={draft.inherentProbability} onImpact={(value) => setDraft({ ...draft, inherentImpact: value })} onProbability={(value) => setDraft({ ...draft, inherentProbability: value })} disabled={!canWrite} /><section className="risk-controls-card"><div className="risk-controls-heading"><div><p className="detail-label">MITIGACIÓN</p><h3>CONTROLES</h3></div>{canWrite && selected && !controlEditor && <button type="button" className="button secondary small-button" onClick={() => setControlEditor({ control: null, draft: emptyControlDraft })}>+ Agregar control</button>}</div>{!selected ? <div className="risk-controls-empty">Guarda el riesgo para agregar controles.</div> : selected.controls.length === 0 && !controlEditor ? <div className="risk-controls-empty">Sin controles registrados{canWrite && <button type="button" className="text-button" onClick={() => setControlEditor({ control: null, draft: emptyControlDraft })}>+ Agregar control</button>}</div> : <div className="risk-control-list">{selected.controls.map((control) => <div className="risk-control-item" key={control.id}><span className="risk-control-mark">✓</span><div><strong>{control.description}</strong><span className={`control-evaluation ${control.evaluation.toLowerCase()}`}>{controlEvaluationOptions.find(([value]) => value === control.evaluation)?.[1]}</span></div>{canWrite && <span className="risk-control-actions"><button type="button" className="sipoc-icon-button" title="Editar control" aria-label="Editar control" onClick={() => setControlEditor({ control, draft: { description: control.description, evaluation: control.evaluation } })}>✎</button><button type="button" className="sipoc-icon-button danger" title="Eliminar control" aria-label="Eliminar control" onClick={() => void removeControl(control)}>×</button></span>}</div>)}</div>}{controlEditor && selected && <ControlEditor control={controlEditor.control} draft={controlEditor.draft} saving={saving} error={error} onDraftChange={(value) => setControlEditor({ ...controlEditor, draft: value })} onSave={() => void saveControl()} onCancel={() => setControlEditor(null)} />}</section><EvaluationCard title="RIESGO RESIDUAL" impact={draft.residualImpact} probability={draft.residualProbability} onImpact={(value) => setDraft({ ...draft, residualImpact: value })} onProbability={(value) => setDraft({ ...draft, residualProbability: value })} disabled={!canWrite} /></div></section>
            <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">TRATAMIENTO</p><h2>TRATAMIENTO Y ACEPTACIÓN</h2></div><span className="risk-method-note">Independiente de los niveles inherente y residual</span></div><div className="risk-base-grid"><label>Tratamiento del riesgo<select value={draft.treatment} onChange={(event) => setDraft({ ...draft, treatment: event.target.value })}><option value="">Sin tratamiento definido</option>{treatmentOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Aceptación del riesgo<select value={draft.acceptanceStatus} onChange={(event) => setDraft({ ...draft, acceptanceStatus: event.target.value as RiskAcceptanceStatus })}>{acceptanceOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><p className="risk-field-note">El tratamiento define cómo se gestionará el riesgo; la aceptación registra el veredicto formal (inicialmente «Pendiente») y no depende del tratamiento.</p></div></section>
            <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">SEGUIMIENTO</p><h2>PLAN DE MITIGACIÓN</h2></div><span className="risk-method-note">Responsable, fechas y evidencias</span></div><div className="risk-base-grid"><label>Responsable del plan<select value={draft.mitigationOwnerId} onChange={(event) => setDraft({ ...draft, mitigationOwnerId: event.target.value })}><option value="">Sin asignar</option>{availableRiskOwners.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label><span className="risk-plan-dates"><label>Fecha de inicio<input type="date" value={draft.mitigationStartDate} onChange={(event) => setDraft({ ...draft, mitigationStartDate: event.target.value })} /></label><label>Fecha de vencimiento<input type="date" value={draft.mitigationDueDate} min={draft.mitigationStartDate || undefined} onChange={(event) => setDraft({ ...draft, mitigationDueDate: event.target.value })} /></label></span></div><div className="risk-evidence-block"><div className="risk-controls-heading"><div><p className="detail-label">EVIDENCIAS</p><h3>EVIDENCIAS DEL PLAN</h3></div>{canWrite && selected && !evidenceEditor && <button type="button" className="button secondary small-button" onClick={() => setEvidenceEditor({ evidence: null, draft: emptyEvidenceDraft })}>+ Agregar evidencia</button>}</div>{!selected ? <div className="risk-controls-empty">Guarda el riesgo para agregar evidencias.</div> : selected.evidences.length === 0 && !evidenceEditor ? <div className="risk-controls-empty">Sin evidencias registradas{canWrite && <button type="button" className="text-button" onClick={() => setEvidenceEditor({ evidence: null, draft: emptyEvidenceDraft })}>+ Agregar evidencia</button>}</div> : <div className="risk-control-list">{selected.evidences.map((evidence) => <div className="risk-control-item" key={evidence.id}><span className="risk-control-mark">✓</span><div><strong>{evidence.name}</strong><span className="risk-evidence-description">{evidence.description}</span><a className="risk-evidence-link" href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.url}</a></div>{canWrite && <span className="risk-control-actions"><button type="button" className="sipoc-icon-button" title="Editar evidencia" aria-label="Editar evidencia" onClick={() => setEvidenceEditor({ evidence, draft: { name: evidence.name, description: evidence.description, url: evidence.url } })}>✎</button><button type="button" className="sipoc-icon-button danger" title="Eliminar evidencia" aria-label="Eliminar evidencia" onClick={() => void removeEvidence(evidence)}>×</button></span>}</div>)}</div>}{evidenceEditor && selected && <EvidenceEditor evidence={evidenceEditor.evidence} draft={evidenceEditor.draft} saving={saving} error={error} onDraftChange={(value) => setEvidenceEditor({ ...evidenceEditor, draft: value })} onSave={() => void saveEvidence()} onCancel={() => setEvidenceEditor(null)} />}</div></section>
          </fieldset>
          {error && !controlEditor && !evidenceEditor && <div className="form-error risk-detail-error" role="alert">{error}</div>}
          <footer className="risk-detail-footer"><button type="button" className="button secondary" onClick={closeDetail}>Cancelar</button>{canWrite && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : selected ? 'Guardar cambios' : 'Guardar riesgo'}</button>}</footer>
        </form>
      ) : (
         <section className="panel risk-list-panel"><div className="panel-heading risk-list-heading"><div><p className="detail-label">MATRIZ DEL PROCESO</p><h2>{riskView === 'heatmap' ? 'Matriz de calor' : 'Listado de riesgos'}</h2></div><div className="risk-view-toggle" role="group" aria-label="Vista de riesgos"><button type="button" className={riskView === 'list' ? 'is-active' : ''} aria-pressed={riskView === 'list'} onClick={() => setRiskView('list')}>Listado</button><button type="button" className={riskView === 'heatmap' ? 'is-active' : ''} aria-pressed={riskView === 'heatmap'} onClick={() => setRiskView('heatmap')}>Matriz de calor</button></div></div>{loading ? <div className="inline-loading"><span className="loader" />Cargando riesgos...</div> : risks.length === 0 ? <div className="risk-empty"><span className="risk-empty-icon">!</span><h3>Aún no hay riesgos registrados</h3><p>Documenta el primer riesgo asociado a este proceso.</p>{canWrite && <button type="button" className="button secondary" onClick={openCreate}>Crear primer riesgo</button>}</div> : riskView === 'heatmap' ? <div className="risk-heatmaps"><RiskHeatmap title="RIESGO INHERENTE" subtitle="ANTES DE CONTROLES" mode="inherent" risks={risks} selection={heatmapSelection} onSelect={toggleHeatmapCell} /><RiskHeatmap title="RIESGO RESIDUAL" subtitle="DESPUÉS DE CONTROLES" mode="residual" risks={risks} selection={heatmapSelection} onSelect={toggleHeatmapCell} />{heatmapSelection && heatmapSelectionLevel && <div className="risk-heatmap-results"><div className="risk-heatmap-results-heading"><h3>{heatmapSelection.mode === 'inherent' ? 'Inherente' : 'Residual'} · Impacto {heatmapSelection.impact} × Probabilidad {heatmapSelection.probability} <span className={`risk-level-badge ${heatmapSelectionLevel.toLowerCase()}`}><span className="risk-level-dot" />{riskScoreFor(heatmapSelection.impact, heatmapSelection.probability)} — {riskLevelLabel[heatmapSelectionLevel]}</span></h3><button type="button" className="text-button" onClick={() => setHeatmapSelection(null)}>Limpiar selección</button></div>{heatmapMatches.length === 0 ? <div className="risk-controls-empty">Sin riesgos en esta celda.</div> : heatmapMatches.map((risk) => <button type="button" className="risk-heatmap-result" key={risk.id} onClick={() => openEdit(risk)}><span className="risk-heatmap-result-name"><strong>{risk.name}</strong><small>{risk.code ? `${risk.code} · ` : ''}{risk.riskOwner?.name ?? 'Sin asignar'}</small></span><span>{renderLevel(heatmapSelection.mode === 'inherent' ? risk.inherentLevel : risk.residualLevel, heatmapSelection.mode === 'inherent' ? risk.inherentScore : risk.residualScore)}</span><span className="risk-list-arrow">→</span></button>)}</div>}</div> : <div className="risk-list"><div className="risk-list-head"><span>Riesgo</span><span>Código</span><span>Tipo</span><span>Dueño</span><span>Tratamiento</span><span>Aceptación</span><span>Inherente</span><span>Residual</span><span /></div>{risks.map((risk) => <article className="risk-list-item" key={risk.id}><button type="button" className="risk-list-main" onClick={() => openEdit(risk)}><span className="risk-list-name"><strong>{risk.name}</strong><small>{risk.description}</small></span><span className="risk-list-code">{risk.code ?? '—'}</span><span>{riskTypeLabelFor(risk.riskType)}</span><span>{risk.riskOwner?.name ?? 'Sin asignar'}</span><span className={`risk-treatment-chip ${risk.treatment ? risk.treatment.toLowerCase() : 'none'}`}>{treatmentLabelFor(risk.treatment)}</span><span className={`risk-acceptance-chip ${risk.acceptanceStatus.toLowerCase()}`}>{acceptanceLabelFor(risk.acceptanceStatus)}</span><span>{renderLevel(risk.inherentLevel, risk.inherentScore)}</span><span>{renderLevel(risk.residualLevel, risk.residualScore)}</span><span className="risk-list-arrow">→</span></button>{canWrite && <button type="button" className="risk-list-delete" aria-label={`Eliminar ${risk.name}`} onClick={() => void removeRisk(risk)}>×</button>}</article>)}</div>}</section>
      )}
    </div>
  )
}

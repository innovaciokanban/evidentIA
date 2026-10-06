import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Process, ProcessRisk, ProcessRiskControl, RiskControlEvaluation, RiskLevel } from '../../types'
import { askConfirm } from '../ui/useConfirm'

type RiskDraft = {
  name: string
  description: string
  riskType: string
  bpmnActivity: string
  inherentImpact: string
  inherentProbability: string
  residualImpact: string
  residualProbability: string
}

type ControlDraft = { description: string; evaluation: RiskControlEvaluation }

const emptyRiskDraft: RiskDraft = {
  name: '', description: '', riskType: '', bpmnActivity: '', inherentImpact: '3', inherentProbability: '3', residualImpact: '1', residualProbability: '1',
}
const emptyControlDraft: ControlDraft = { description: '', evaluation: 'PENDING' }
const impactOptions = [['1', '1 - Insignificante'], ['2', '2 - Menor'], ['3', '3 - Moderado'], ['4', '4 - Mayor'], ['5', '5 - Catastrófico']]
const probabilityOptions = [['1', '1 - Raro'], ['2', '2 - Improbable'], ['3', '3 - Posible'], ['4', '4 - Probable'], ['5', '5 - Casi seguro']]
const controlEvaluationOptions: Array<[RiskControlEvaluation, string]> = [['PENDING', 'Pendiente'], ['WEAK', 'Débil'], ['PARTIAL', 'Parcial'], ['EFFECTIVE', 'Efectivo']]
const levelLabel: Record<RiskLevel, string> = { LOW: 'Bajo', MEDIUM: 'Medio', HIGH: 'Alto', CRITICAL: 'Crítico' }
const levelFor = (impact: number, probability: number): RiskLevel => {
  const score = impact * probability
  if (score <= 4) return 'LOW'
  if (score <= 9) return 'MEDIUM'
  if (score <= 16) return 'HIGH'
  return 'CRITICAL'
}

const draftFromRisk = (risk: ProcessRisk): RiskDraft => ({
  name: risk.name,
  description: risk.description,
  riskType: risk.riskType,
  bpmnActivity: risk.bpmnActivity,
  inherentImpact: String(risk.inherentImpact),
  inherentProbability: String(risk.inherentProbability),
  residualImpact: String(risk.residualImpact),
  residualProbability: String(risk.residualProbability),
})

function LevelBadge({ level, score }: { level: RiskLevel; score: number }) {
  return <span className={`risk-level-badge ${level.toLowerCase()}`}><span className="risk-level-dot" />{levelLabel[level]} <small>{score}</small></span>
}

function EvaluationCard({ title, impact, probability, onImpact, onProbability, disabled }: {
  title: string
  impact: string
  probability: string
  onImpact: (value: string) => void
  onProbability: (value: string) => void
  disabled: boolean
}) {
  const level = levelFor(Number(impact), Number(probability))
  return (
    <div className="risk-evaluation-card">
      <div className="risk-evaluation-title"><span>{title}</span><LevelBadge level={level} score={Number(impact) * Number(probability)} /></div>
      <label>Impacto<select value={impact} onChange={(event) => onImpact(event.target.value)} disabled={disabled}>{impactOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Probabilidad<select value={probability} onChange={(event) => onProbability(event.target.value)} disabled={disabled}>{probabilityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="risk-calculated-level"><span>Nivel calculado</span><strong className={`risk-level-text ${level.toLowerCase()}`}>{levelLabel[level]}</strong></div>
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

export function ProcessRiskPanel({ process, canWrite, onBack }: { process: Process; canWrite: boolean; onBack: () => void }) {
  const [risks, setRisks] = useState<ProcessRisk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ProcessRisk | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [draft, setDraft] = useState<RiskDraft>(emptyRiskDraft)
  const [controlEditor, setControlEditor] = useState<{ control: ProcessRiskControl | null; draft: ControlDraft } | null>(null)

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
    setNotice('')
    setError('')
  }

  function openEdit(risk: ProcessRisk) {
    setShowDetail(true)
    setSelected(risk)
    setDraft(draftFromRisk(risk))
    setControlEditor(null)
    setNotice('')
    setError('')
  }

  function closeDetail() {
    setShowDetail(false)
    setSelected(null)
    setControlEditor(null)
    setError('')
  }

  async function saveRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {
      name: draft.name,
      description: draft.description,
      riskType: draft.riskType,
      bpmnActivity: draft.bpmnActivity,
      inherentImpact: Number(draft.inherentImpact),
      inherentProbability: Number(draft.inherentProbability),
      residualImpact: Number(draft.residualImpact),
      residualProbability: Number(draft.residualProbability),
    }
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
    const confirmed = await askConfirm({ title: 'Eliminar riesgo', message: `Se eliminará «${risk.name}» y sus controles. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar' })
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

  const isDetail = showDetail
  const renderLevel = (impact: number, probability: number) => <LevelBadge level={levelFor(impact, probability)} score={impact * probability} />

  return (
    <div className="process-risk-page">
      <div className="risk-page-header">
        <button type="button" className="text-button risk-back-button" onClick={onBack}>← Volver a la caracterización</button>
        {!isDetail ? <div className="risk-page-heading"><div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO RIESGOS</p><h1>Riesgos</h1><p className="muted">Identifica y evalúa los riesgos asociados a este proceso.</p></div>{canWrite && <button type="button" className="button primary" onClick={openCreate}>+ Nuevo riesgo</button>}</div> : <div className="risk-page-heading"><div><p className="eyebrow">RIESGOS / DETALLE</p><h1>{selected ? 'Detalle del riesgo' : 'Nuevo riesgo'}</h1><p className="muted">Registra la información y evaluación del riesgo.</p></div></div>}
      </div>

      <section className="panel risk-process-context"><div><span>Proceso</span><strong>{process.name}</strong></div><div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div><div><span>Riesgos registrados</span><strong>{risks.length}</strong></div></section>
      {notice && <div className="form-success page-alert" role="status">{notice}</div>}
      {error && !controlEditor && <div className="form-error page-alert" role="alert">{error}<button type="button" className="button secondary small-button" onClick={() => void loadRisks()}>Reintentar</button></div>}

      {isDetail ? (
        <form className="panel risk-detail-panel" onSubmit={(event) => void saveRisk(event)}>
          <div className="risk-detail-toolbar"><button type="button" className="text-button" onClick={closeDetail}>← Volver a riesgos</button>{selected && canWrite && <button type="button" className="button danger small-button" onClick={() => void removeRisk(selected)}>Eliminar riesgo</button>}</div>
          <fieldset disabled={!canWrite} className="risk-detail-fields">
            <section className="risk-detail-section"><div className="risk-section-heading"><div><p className="detail-label">INFORMACIÓN BASE</p><h2>DETALLE DEL RIESGO</h2></div><span className="risk-process-chip">{process.code ?? 'Proceso'}</span></div><div className="risk-base-grid"><label>Nombre del riesgo<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Entrega tardía de información" minLength={3} maxLength={160} required /></label><label>Tipo de riesgo<input value={draft.riskType} onChange={(event) => setDraft({ ...draft, riskType: event.target.value })} placeholder="Ej. Operativo" maxLength={120} required /></label><label>Actividad BPMN<input value={draft.bpmnActivity} onChange={(event) => setDraft({ ...draft, bpmnActivity: event.target.value })} placeholder="Ej. Validar solicitud" maxLength={160} required /></label><label className="risk-base-wide">Descripción del riesgo<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Qué puede ocurrir, por qué y qué efecto tendría." rows={4} maxLength={5000} required /></label></div></section>
            <section className="risk-detail-section risk-evaluation-section"><div className="risk-section-heading"><div><p className="detail-label">VALORACIÓN</p><h2>EVALUACIÓN DE RIESGOS</h2></div><span className="risk-method-note">Matriz 5 × 5 · impacto × probabilidad</span></div><div className="risk-evaluation-layout"><EvaluationCard title="RIESGO INHERENTE" impact={draft.inherentImpact} probability={draft.inherentProbability} onImpact={(value) => setDraft({ ...draft, inherentImpact: value })} onProbability={(value) => setDraft({ ...draft, inherentProbability: value })} disabled={!canWrite} /><section className="risk-controls-card"><div className="risk-controls-heading"><div><p className="detail-label">MITIGACIÓN</p><h3>CONTROLES</h3></div>{canWrite && selected && !controlEditor && <button type="button" className="button secondary small-button" onClick={() => setControlEditor({ control: null, draft: emptyControlDraft })}>+ Agregar control</button>}</div>{!selected ? <div className="risk-controls-empty">Guarda el riesgo para agregar controles.</div> : selected.controls.length === 0 && !controlEditor ? <div className="risk-controls-empty">Sin controles registrados{canWrite && <button type="button" className="text-button" onClick={() => setControlEditor({ control: null, draft: emptyControlDraft })}>+ Agregar control</button>}</div> : <div className="risk-control-list">{selected.controls.map((control) => <div className="risk-control-item" key={control.id}><span className="risk-control-mark">✓</span><div><strong>{control.description}</strong><span className={`control-evaluation ${control.evaluation.toLowerCase()}`}>{controlEvaluationOptions.find(([value]) => value === control.evaluation)?.[1]}</span></div>{canWrite && <span className="risk-control-actions"><button type="button" className="sipoc-icon-button" title="Editar control" aria-label="Editar control" onClick={() => setControlEditor({ control, draft: { description: control.description, evaluation: control.evaluation } })}>✎</button><button type="button" className="sipoc-icon-button danger" title="Eliminar control" aria-label="Eliminar control" onClick={() => void removeControl(control)}>×</button></span>}</div>)}</div>}{controlEditor && selected && <ControlEditor control={controlEditor.control} draft={controlEditor.draft} saving={saving} error={error} onDraftChange={(value) => setControlEditor({ ...controlEditor, draft: value })} onSave={() => void saveControl()} onCancel={() => setControlEditor(null)} />}</section><EvaluationCard title="RIESGO RESIDUAL" impact={draft.residualImpact} probability={draft.residualProbability} onImpact={(value) => setDraft({ ...draft, residualImpact: value })} onProbability={(value) => setDraft({ ...draft, residualProbability: value })} disabled={!canWrite} /></div></section>
          </fieldset>
          {error && !controlEditor && <div className="form-error risk-detail-error" role="alert">{error}</div>}
          <footer className="risk-detail-footer"><button type="button" className="button secondary" onClick={closeDetail}>Cancelar</button>{canWrite && <button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando...' : selected ? 'Guardar cambios' : 'Guardar riesgo'}</button>}</footer>
        </form>
      ) : (
        <section className="panel risk-list-panel"><div className="panel-heading risk-list-heading"><div><p className="detail-label">MATRIZ DEL PROCESO</p><h2>Listado de riesgos</h2></div><span className="risk-list-note">Nivel residual</span></div>{loading ? <div className="inline-loading"><span className="loader" />Cargando riesgos...</div> : risks.length === 0 ? <div className="risk-empty"><span className="risk-empty-icon">!</span><h3>Aún no hay riesgos registrados</h3><p>Documenta el primer riesgo asociado a este proceso.</p>{canWrite && <button type="button" className="button secondary" onClick={openCreate}>Crear primer riesgo</button>}</div> : <div className="risk-list"><div className="risk-list-head"><span>Riesgo</span><span>Tipo</span><span>Actividad BPMN</span><span>Inherente</span><span>Residual</span><span /></div>{risks.map((risk) => <article className="risk-list-item" key={risk.id}><button type="button" className="risk-list-main" onClick={() => openEdit(risk)}><span className="risk-list-name"><strong>{risk.name}</strong><small>{risk.description}</small></span><span>{risk.riskType}</span><span>{risk.bpmnActivity}</span><span>{renderLevel(risk.inherentImpact, risk.inherentProbability)}</span><span>{renderLevel(risk.residualImpact, risk.residualProbability)}</span><span className="risk-list-arrow">→</span></button>{canWrite && <button type="button" className="risk-list-delete" aria-label={`Eliminar ${risk.name}`} onClick={() => void removeRisk(risk)}>×</button>}</article>)}</div>}</section>
      )}
    </div>
  )
}

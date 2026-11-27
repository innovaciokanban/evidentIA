import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { AuditFinding, AuditRootCause, AuditRootCauseAnalysis, AuditRootCauseFiveWhyStep } from '../../types'
import { activeUserOptions, userOptionLabel } from '../../user-status'
import { askConfirm } from '../ui/useConfirm'
import { formatAuditDateTime } from './audit-history.model'
import {
  causeCanBeConfirmed,
  causeCanBeEdited,
  emptyFiveWhyStepDraft,
  emptyRootCauseDraft,
  nextFiveWhySequence,
  rootCauseAnalysisCanBeConfirmed,
  rootCauseAnalysisDraftFromFinding,
  rootCauseAnalysisRequirements,
  rootCauseAnalysisStatusLabels,
  rootCauseCounts,
  rootCauseMethodDescriptions,
  rootCauseMethodLabels,
  rootCauseStatusLabels,
  ishikawaCategorySuggestions,
  fiveWhySequenceIssues,
  type FiveWhyStepDraft,
  type RootCauseAnalysisDraft,
  type RootCauseDraft,
} from './root-cause.model'
import type { QualityUser } from './quality.model'

type AnalysisEditor = { mode: 'create' | 'edit'; analysisId: string | null }
type CauseEditor = { analysisId: string; cause: AuditRootCause | null }
type CauseDecision = { analysisId: string; cause: AuditRootCause; justification: string }
type FiveWhyStepEditor = { analysisId: string; step: AuditRootCauseFiveWhyStep | null }

const analysisStatusClass = (status: AuditRootCauseAnalysis['status']) => status.toLowerCase()
const causeStatusClass = (status: AuditRootCause['status']) => status.toLowerCase()

function errorMessage(requestError: unknown, fallback: string): string {
  return requestError instanceof ApiError ? requestError.message : fallback
}

function replaceAnalysis(analyses: AuditRootCauseAnalysis[], next: AuditRootCauseAnalysis): AuditRootCauseAnalysis[] {
  return analyses.map((analysis) => analysis.id === next.id ? next : analysis)
}

function replaceCause(analyses: AuditRootCauseAnalysis[], analysisId: string, next: AuditRootCause): AuditRootCauseAnalysis[] {
  return analyses.map((analysis) => analysis.id === analysisId
    ? { ...analysis, causes: analysis.causes.map((cause) => cause.id === next.id ? next : cause), updatedAt: next.updatedAt }
    : analysis)
}

function appendCause(analyses: AuditRootCauseAnalysis[], analysisId: string, cause: AuditRootCause): AuditRootCauseAnalysis[] {
  return analyses.map((analysis) => analysis.id === analysisId ? { ...analysis, causes: [...analysis.causes, cause], updatedAt: cause.updatedAt } : analysis)
}

function replaceStep(analyses: AuditRootCauseAnalysis[], analysisId: string, next: AuditRootCauseFiveWhyStep): AuditRootCauseAnalysis[] {
  return analyses.map((analysis) => analysis.id === analysisId
    ? { ...analysis, fiveWhySteps: analysis.fiveWhySteps.map((step) => step.id === next.id ? next : step), updatedAt: next.updatedAt }
    : analysis)
}

function appendStep(analyses: AuditRootCauseAnalysis[], analysisId: string, step: AuditRootCauseFiveWhyStep): AuditRootCauseAnalysis[] {
  return analyses.map((analysis) => analysis.id === analysisId ? { ...analysis, fiveWhySteps: [...analysis.fiveWhySteps, step].sort((left, right) => left.sequence - right.sequence), updatedAt: step.updatedAt } : analysis)
}

function removeStep(analyses: AuditRootCauseAnalysis[], analysisId: string, stepId: string): AuditRootCauseAnalysis[] {
  return analyses.map((analysis) => analysis.id === analysisId ? { ...analysis, fiveWhySteps: analysis.fiveWhySteps.filter((step) => step.id !== stepId) } : analysis)
}

function FiveWhyWorkspace({ analysis, readonly, busy, editor, draft, onOpenCreate, onOpenEdit, onDraftChange, onSave, onCancel, onDelete }: {
  analysis: AuditRootCauseAnalysis
  readonly: boolean
  busy: boolean
  editor: FiveWhyStepEditor | null
  draft: FiveWhyStepDraft
  onOpenCreate: () => void
  onOpenEdit: (step: AuditRootCauseFiveWhyStep) => void
  onDraftChange: (draft: FiveWhyStepDraft) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onDelete: (step: AuditRootCauseFiveWhyStep) => void
}) {
  const issues = fiveWhySequenceIssues(analysis.fiveWhySteps)
  const steps = [...analysis.fiveWhySteps].sort((left, right) => left.sequence - right.sequence)
  return (
    <section className="five-why-workspace" aria-labelledby={`five-why-title-${analysis.id}`}>
      <div className="five-why-heading">
        <div><strong id={`five-why-title-${analysis.id}`}>Recorrido de los 5 porqués</strong><span>La investigación puede tener tantos pasos como necesite el análisis. Las causas se registran abajo y no se confirman automáticamente.</span></div>
        {!readonly && analysis.status === 'DRAFT' && <button type="button" className="button secondary small-button" onClick={onOpenCreate} disabled={Boolean(editor) || busy}>+ Añadir paso</button>}
      </div>
      {issues.length > 0 && <div className="five-why-status" role="status"><strong>Revisión pendiente</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
      {steps.length === 0 ? <p className="root-cause-empty">Todavía no hay preguntas registradas.</p> : <div className="five-why-timeline">{steps.map((step, index) => {
        const incomplete = !step.question.trim() || !step.answer.trim()
        return <article className={`five-why-step ${incomplete ? 'incomplete' : ''}`} key={step.id}>
          <div className="five-why-step-marker" aria-hidden="true">{step.sequence}</div>
          <div className="five-why-step-content">
            <header><div><span>Pregunta {index + 1} · Secuencia {step.sequence}</span><strong>{incomplete ? 'Incompleto' : 'Registrado'}</strong></div>{!readonly && analysis.status === 'DRAFT' && <div className="five-why-step-actions"><button type="button" className="button secondary small-button" onClick={() => onOpenEdit(step)} disabled={busy}>Editar</button><button type="button" className="button danger small-button" onClick={() => onDelete(step)} disabled={busy}>Eliminar</button></div>}</header>
            <p className="five-why-question">{step.question || 'Pregunta pendiente'}</p><p className="five-why-answer">{step.answer || 'Respuesta pendiente'}</p>
          </div>
        </article>
      })}</div>}
      {editor?.analysisId === analysis.id && <form className="five-why-editor" onSubmit={onSave}>
        <div className="root-cause-editor-heading"><strong>{editor.step ? 'Editar paso Five Whys' : 'Nuevo paso Five Whys'}</strong><span>La secuencia debe ser única. Puedes reorganizar el recorrido editando su número.</span></div>
        <label>Secuencia<input type="number" min="1" max="100" value={draft.sequence} onChange={(event) => onDraftChange({ ...draft, sequence: event.target.value })} required /></label>
        <label className="root-cause-field-wide">Pregunta<textarea value={draft.question} onChange={(event) => onDraftChange({ ...draft, question: event.target.value })} minLength={1} maxLength={2000} rows={2} required autoFocus /></label>
        <label className="root-cause-field-wide">Respuesta<textarea value={draft.answer} onChange={(event) => onDraftChange({ ...draft, answer: event.target.value })} minLength={1} maxLength={5000} rows={3} required /></label>
        <div className="procedure-form-actions root-cause-field-wide"><button type="submit" className="button primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar paso'}</button><button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancelar</button></div>
      </form>}
    </section>
  )
}

function IshikawaVisual({ analysis }: { analysis: AuditRootCauseAnalysis }) {
  const groups = Array.from(new Set(analysis.causes.map((cause) => cause.ishikawaCategory?.trim() || 'Sin categoría'))).map((category) => ({ category, causes: analysis.causes.filter((cause) => (cause.ishikawaCategory?.trim() || 'Sin categoría') === category) }))
  return (
    <section className="ishikawa-workspace" aria-labelledby={`ishikawa-title-${analysis.id}`}>
      <div className="ishikawa-heading"><div><strong id={`ishikawa-title-${analysis.id}`}>Diagrama de Ishikawa</strong><span>Las ramas reflejan únicamente las causas persistidas en este análisis.</span></div><span className="ishikawa-total">{analysis.causes.length} causa(s)</span></div>
      {groups.length === 0 ? <p className="root-cause-empty">Añade una causa para comenzar a formar el diagrama.</p> : <>
        <div className="ishikawa-fishbone" aria-label="Diagrama de causas Ishikawa">
          <div className="ishikawa-problem"><span>Problema central</span><strong>{analysis.problemDescription}</strong></div>
          <div className="ishikawa-spine" aria-hidden="true" />
          <div className="ishikawa-branches">{groups.map((group, index) => <div className={`ishikawa-branch ${index % 2 === 0 ? 'upper' : 'lower'}`} key={group.category}><div className="ishikawa-branch-line" /><div className="ishikawa-category-card"><header><strong>{group.category}</strong><span>{group.causes.length}</span></header><ul>{group.causes.map((cause) => <li key={cause.id} className={causeStatusClass(cause.status)}>{cause.description}</li>)}</ul></div></div>)}</div>
        </div>
        <div className="ishikawa-category-cards" aria-label="Causas agrupadas por categoría">{groups.map((group) => <article key={group.category}><header><strong>{group.category}</strong><span>{group.causes.length} causa(s)</span></header><ul>{group.causes.map((cause) => <li key={cause.id}><span className={`root-cause-cause-status ${causeStatusClass(cause.status)}`}>{rootCauseStatusLabels[cause.status]}</span>{cause.description}</li>)}</ul></article>)}</div>
      </>}
    </section>
  )
}

export function RootCauseAnalysisPanel({ auditId, finding, users, canWrite, onChanged, onError, onNotice }: {
  auditId: string
  finding: AuditFinding
  users: QualityUser[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [analyses, setAnalyses] = useState<AuditRootCauseAnalysis[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [analysisEditor, setAnalysisEditor] = useState<AnalysisEditor | null>(null)
  const [analysisDraft, setAnalysisDraft] = useState<RootCauseAnalysisDraft>(() => rootCauseAnalysisDraftFromFinding(finding))
  const [causeEditor, setCauseEditor] = useState<CauseEditor | null>(null)
  const [causeDraft, setCauseDraft] = useState<RootCauseDraft>(emptyRootCauseDraft)
  const [causeDecision, setCauseDecision] = useState<CauseDecision | null>(null)
  const [fiveWhyStepEditor, setFiveWhyStepEditor] = useState<FiveWhyStepEditor | null>(null)
  const [fiveWhyStepDraft, setFiveWhyStepDraft] = useState<FiveWhyStepDraft>(emptyFiveWhyStepDraft)

  const readonly = !canWrite || finding.status === 'VERIFIED'
  const availableUsers = activeUserOptions(users, analyses.flatMap((analysis) => analysis.responsible ? [{ ...analysis.responsible, companyId: null }] : []))
  const counts = rootCauseCounts(analyses)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setAnalyses([])
      setExpandedIds(new Set())
      setAnalysisEditor(null)
      setCauseEditor(null)
      setCauseDecision(null)
      setFiveWhyStepEditor(null)
      setAnalysisDraft(rootCauseAnalysisDraftFromFinding(finding))
      setError('')
      setLoading(true)
      try {
        const result = await api<{ analyses: AuditRootCauseAnalysis[] }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses`)
        if (!cancelled) setAnalyses(result.analyses)
      } catch (requestError) {
        if (!cancelled) {
          const message = errorMessage(requestError, 'No se pudieron cargar los análisis de causa raíz.')
          setError(message)
          onError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [auditId, finding, onError])

  function openCreateAnalysis() {
    setAnalysisEditor({ mode: 'create', analysisId: null })
    setAnalysisDraft(rootCauseAnalysisDraftFromFinding(finding))
    setCauseEditor(null)
    setCauseDecision(null)
    setFiveWhyStepEditor(null)
    setError('')
  }

  function openEditAnalysis(analysis: AuditRootCauseAnalysis) {
    setAnalysisEditor({ mode: 'edit', analysisId: analysis.id })
    setAnalysisDraft({ problemDescription: analysis.problemDescription, responsibleId: analysis.responsible?.id ?? '', methodology: analysis.methodology })
    setExpandedIds((current) => new Set(current).add(analysis.id))
    setCauseEditor(null)
    setCauseDecision(null)
    setFiveWhyStepEditor(null)
    setError('')
  }

  function closeEditors() {
    setAnalysisEditor(null)
    setCauseEditor(null)
    setCauseDecision(null)
    setFiveWhyStepEditor(null)
  }

  async function saveAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!analysisEditor || busy || readonly) return
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...(analysisEditor.mode === 'create' ? { origin: 'MANUAL' } : {}),
        methodology: analysisDraft.methodology,
        problemDescription: analysisDraft.problemDescription.trim(),
        responsibleId: analysisDraft.responsibleId || null,
      }
      const result = analysisEditor.mode === 'create'
        ? await api<{ analysis: AuditRootCauseAnalysis }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses`, { method: 'POST', body: JSON.stringify(payload) })
        : await api<{ analysis: AuditRootCauseAnalysis }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisEditor.analysisId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      setAnalyses((current) => analysisEditor.mode === 'create' ? [...current, result.analysis] : replaceAnalysis(current, result.analysis))
      setExpandedIds((current) => new Set(current).add(result.analysis.id))
      closeEditors()
      await onChanged()
      onNotice(analysisEditor.mode === 'create' ? `${rootCauseMethodLabels[result.analysis.methodology]} creado.` : 'Análisis de causa raíz actualizado.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo guardar el análisis de causa raíz.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  function openCreateCause(analysis: AuditRootCauseAnalysis) {
    setCauseEditor({ analysisId: analysis.id, cause: null })
    setCauseDraft(emptyRootCauseDraft)
    setCauseDecision(null)
    setExpandedIds((current) => new Set(current).add(analysis.id))
    setError('')
  }

  function openEditCause(analysis: AuditRootCauseAnalysis, cause: AuditRootCause) {
    setCauseEditor({ analysisId: analysis.id, cause })
    setCauseDraft({ description: cause.description, justification: cause.justification ?? '', supportingEvidence: cause.supportingEvidence ?? '', ishikawaCategory: cause.ishikawaCategory ?? '' })
    setCauseDecision(null)
    setExpandedIds((current) => new Set(current).add(analysis.id))
    setError('')
  }

  async function saveCause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!causeEditor || busy || readonly) return
    setBusy(true)
    setError('')
    try {
      const parentAnalysis = analyses.find((analysis) => analysis.id === causeEditor.analysisId)
      if (!parentAnalysis) throw new Error('El análisis ya no está disponible. Recarga el expediente.')
      const payload = {
        description: causeDraft.description.trim(),
        justification: causeDraft.justification.trim() || null,
        supportingEvidence: causeDraft.supportingEvidence.trim() || null,
        ishikawaCategory: causeDraft.ishikawaCategory.trim() || null,
        position: causeEditor.cause?.position ?? parentAnalysis.causes.length,
      }
      const result = causeEditor.cause
        ? await api<{ cause: AuditRootCause }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${causeEditor.analysisId}/causes/${causeEditor.cause.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ cause: AuditRootCause }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${causeEditor.analysisId}/causes`, { method: 'POST', body: JSON.stringify(payload) })
      setAnalyses((current) => causeEditor.cause ? replaceCause(current, causeEditor.analysisId, result.cause) : appendCause(current, causeEditor.analysisId, result.cause))
      setCauseEditor(null)
      await onChanged()
      onNotice(causeEditor.cause ? 'Causa potencial actualizada.' : 'Causa potencial añadida.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo guardar la causa raíz.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  function openCreateFiveWhyStep(analysis: AuditRootCauseAnalysis) {
    setFiveWhyStepEditor({ analysisId: analysis.id, step: null })
    setFiveWhyStepDraft({ ...emptyFiveWhyStepDraft, sequence: String(nextFiveWhySequence(analysis.fiveWhySteps)) })
    setCauseEditor(null)
    setCauseDecision(null)
    setExpandedIds((current) => new Set(current).add(analysis.id))
    setError('')
  }

  function openEditFiveWhyStep(analysis: AuditRootCauseAnalysis, step: AuditRootCauseFiveWhyStep) {
    setFiveWhyStepEditor({ analysisId: analysis.id, step })
    setFiveWhyStepDraft({ sequence: String(step.sequence), question: step.question, answer: step.answer })
    setCauseEditor(null)
    setCauseDecision(null)
    setExpandedIds((current) => new Set(current).add(analysis.id))
    setError('')
  }

  async function saveFiveWhyStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fiveWhyStepEditor || busy || readonly) return
    const analysis = analyses.find((candidate) => candidate.id === fiveWhyStepEditor.analysisId)
    const sequence = Number(fiveWhyStepDraft.sequence)
    if (!analysis || analysis.status !== 'DRAFT' || analysis.methodology !== 'FIVE_WHYS') {
      setError('El análisis Five Whys ya no está disponible para editar.')
      return
    }
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 100) {
      setError('La secuencia debe ser un número entero entre 1 y 100.')
      return
    }
    if (analysis.fiveWhySteps.some((step) => step.sequence === sequence && step.id !== fiveWhyStepEditor.step?.id)) {
      setError('La secuencia ya existe en este análisis. Usa otra numeración.')
      return
    }
    const question = fiveWhyStepDraft.question.trim()
    const answer = fiveWhyStepDraft.answer.trim()
    if (!question || !answer) {
      setError('Cada paso necesita una pregunta y una respuesta.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = { sequence, question, answer }
      const result = fiveWhyStepEditor.step
        ? await api<{ step: AuditRootCauseFiveWhyStep }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysis.id}/five-why-steps/${fiveWhyStepEditor.step.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ step: AuditRootCauseFiveWhyStep }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysis.id}/five-why-steps`, { method: 'POST', body: JSON.stringify(payload) })
      setAnalyses((current) => fiveWhyStepEditor.step ? replaceStep(current, analysis.id, result.step) : appendStep(current, analysis.id, result.step))
      setFiveWhyStepEditor(null)
      await onChanged()
      onNotice(fiveWhyStepEditor.step ? 'Paso Five Whys actualizado.' : 'Paso Five Whys añadido.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo guardar el paso Five Whys.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteFiveWhyStep(analysis: AuditRootCauseAnalysis, step: AuditRootCauseFiveWhyStep) {
    if (busy || readonly || analysis.status !== 'DRAFT') return
    const confirmed = await askConfirm({ title: 'Eliminar paso Five Whys', message: 'El paso se eliminará del recorrido de investigación.', confirmLabel: 'Eliminar paso' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      await api<void>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysis.id}/five-why-steps/${step.id}`, { method: 'DELETE' })
      setAnalyses((current) => removeStep(current, analysis.id, step.id))
      await onChanged()
      onNotice('Paso Five Whys eliminado.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo eliminar el paso Five Whys.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmCause(analysis: AuditRootCauseAnalysis, cause: AuditRootCause) {
    if (busy || readonly) return
    if (!causeCanBeConfirmed(cause, analysis.methodology)) {
      setError('Completa la justificación, la evidencia y la categoría Ishikawa cuando corresponda antes de confirmar la causa.')
      openEditCause(analysis, cause)
      return
    }
    const confirmed = await askConfirm({ title: 'Confirmar causa raíz', message: 'La causa confirmada ya no podrá modificarse ni descartarse.', confirmLabel: 'Confirmar causa' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ cause: AuditRootCause }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysis.id}/causes/${cause.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'CONFIRMED' }) })
      setAnalyses((current) => replaceCause(current, analysis.id, result.cause))
      await onChanged()
      onNotice('Causa raíz confirmada.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo confirmar la causa raíz.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  async function discardCause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!causeDecision || busy || readonly) return
    const justification = causeDecision.justification.trim()
    if (!justification) {
      setError('La justificación es obligatoria para descartar una causa.')
      return
    }
    const confirmed = await askConfirm({ title: 'Descartar causa raíz', message: 'La causa quedará descartada y no podrá modificarse.', confirmLabel: 'Descartar causa' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const patch = await api<{ cause: AuditRootCause }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${causeDecision.analysisId}/causes/${causeDecision.cause.id}`, { method: 'PATCH', body: JSON.stringify({ justification }) })
      const result = await api<{ cause: AuditRootCause }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${causeDecision.analysisId}/causes/${causeDecision.cause.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'DISCARDED' }) })
      setAnalyses((current) => replaceCause(replaceCause(current, causeDecision.analysisId, patch.cause), causeDecision.analysisId, result.cause))
      setCauseDecision(null)
      await onChanged()
      onNotice('Causa raíz descartada.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo descartar la causa raíz.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmAnalysis(analysis: AuditRootCauseAnalysis) {
    if (busy || readonly || analysis.status !== 'DRAFT') return
    if (!rootCauseAnalysisCanBeConfirmed(analysis)) {
      setError('Completa todos los requisitos pendientes antes de confirmar el análisis.')
      setExpandedIds((current) => new Set(current).add(analysis.id))
      return
    }
    const confirmed = await askConfirm({ title: 'Confirmar análisis de causa raíz', message: 'Después de confirmar, el análisis y sus causas quedarán en solo lectura.', confirmLabel: 'Confirmar análisis' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ analysis: AuditRootCauseAnalysis }>(`/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysis.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'CONFIRMED' }) })
      setAnalyses((current) => replaceAnalysis(current, result.analysis))
      await onChanged()
      onNotice('Análisis de causa raíz confirmado. Quedó en solo lectura.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo confirmar el análisis de causa raíz.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  function toggleAnalysis(analysisId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(analysisId)) next.delete(analysisId)
      else next.add(analysisId)
      return next
    })
  }

  const editingAnalysis = analysisEditor?.analysisId ? analyses.find((analysis) => analysis.id === analysisEditor.analysisId) : null
  const methodologyLocked = Boolean(editingAnalysis?.fiveWhySteps.length)

  return (
    <section className="root-cause-panel" aria-labelledby="root-cause-panel-title">
      <div className="finding-dossier-section-heading">
        <div>
          <p className="detail-label">INVESTIGACIÓN</p>
          <h3 id="root-cause-panel-title">Análisis de causa raíz</h3>
        </div>
        {!readonly && <button type="button" className="button primary small-button" onClick={openCreateAnalysis} disabled={Boolean(analysisEditor) || busy}>+ Nuevo análisis</button>}
      </div>
      <div className="root-cause-stat-grid" aria-label="Resumen de causas raíz">
        <div><strong>{counts.analyses}</strong><span>Análisis</span></div>
        <div><strong>{counts.potential}</strong><span>Potenciales</span></div>
        <div><strong>{counts.confirmed}</strong><span>Confirmadas</span></div>
        <div><strong>{counts.discarded}</strong><span>Descartadas</span></div>
      </div>
      {finding.status === 'VERIFIED' && <p className="finding-dossier-lock" role="note">Este hallazgo está verificado. Los análisis de causa raíz quedan en solo lectura.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {analysisEditor && (
        <form className="root-cause-editor" onSubmit={saveAnalysis}>
          <div className="root-cause-editor-heading"><strong>{analysisEditor.mode === 'create' ? 'Nuevo análisis' : 'Editar análisis'}</strong><span>{rootCauseMethodDescriptions[analysisDraft.methodology]}</span></div>
          <label className="root-cause-field-wide">Descripción del problema<textarea value={analysisDraft.problemDescription} onChange={(event) => setAnalysisDraft((current) => ({ ...current, problemDescription: event.target.value }))} minLength={1} maxLength={5000} rows={4} required autoFocus /></label>
          <label>Responsable<select value={analysisDraft.responsibleId} onChange={(event) => setAnalysisDraft((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Sin asignar</option>{availableUsers.map((user) => <option value={user.id} key={user.id}>{userOptionLabel(user)}</option>)}</select></label>
          <label>Metodología<select value={analysisDraft.methodology} onChange={(event) => setAnalysisDraft((current) => ({ ...current, methodology: event.target.value as RootCauseAnalysisDraft['methodology'] }))} disabled={methodologyLocked}><option value="MANUAL">Manual</option><option value="FIVE_WHYS">Five Whys</option><option value="ISHIKAWA">Ishikawa</option></select>{methodologyLocked && <small className="root-cause-field-note">No puedes cambiar la metodología mientras existan pasos Five Whys.</small>}</label>
          <div className="root-cause-method-preview root-cause-field-wide"><strong>{rootCauseMethodLabels[analysisDraft.methodology]}</strong><span>{rootCauseMethodDescriptions[analysisDraft.methodology]}</span></div>
          <div className="procedure-form-actions root-cause-field-wide"><button type="submit" className="button primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar análisis'}</button><button type="button" className="button secondary" onClick={() => setAnalysisEditor(null)} disabled={busy}>Cancelar</button></div>
        </form>
      )}
      {loading ? <div className="inline-loading"><span className="loader" />Cargando análisis de causa raíz...</div> : analyses.length === 0 ? (
         <div className="finding-dossier-empty"><strong>No hay análisis de causa raíz registrados.</strong><span>Elige una metodología para documentar por qué ocurrió el hallazgo.</span>{!readonly && <button type="button" className="button secondary small-button" onClick={openCreateAnalysis}>Crear primer análisis</button>}</div>
      ) : (
        <div className="root-cause-analysis-list">
          {analyses.map((analysis, index) => {
            const expanded = expandedIds.has(analysis.id)
            const requirements = analysis.status === 'DRAFT' ? rootCauseAnalysisRequirements(analysis) : []
            return (
              <article className={`root-cause-analysis-card ${analysisStatusClass(analysis.status)}`} key={analysis.id}>
                <header className="root-cause-analysis-header">
                  <div><span className="root-cause-analysis-kicker">Análisis {index + 1} · {analysis.origin === 'CHECKY' ? 'Origen Checky' : 'Origen manual'}</span><h4>{rootCauseMethodLabels[analysis.methodology]}</h4><div className="root-cause-badges"><span className={`root-cause-status ${analysisStatusClass(analysis.status)}`}>{rootCauseAnalysisStatusLabels[analysis.status]}</span>{analysis.status === 'CONFIRMED' && <span className="root-cause-readonly-label">Solo lectura</span>}</div></div>
                  <button type="button" className="text-button" aria-expanded={expanded} onClick={() => toggleAnalysis(analysis.id)}>{expanded ? 'Ocultar detalle' : 'Ver detalle'}</button>
                </header>
                <div className="root-cause-analysis-meta"><span><strong>Responsable</strong>{analysis.responsible?.name ?? 'Sin asignar'}</span><span><strong>Creado</strong>{formatAuditDateTime(analysis.createdAt)}</span><span><strong>Actualizado</strong>{formatAuditDateTime(analysis.updatedAt)}</span>{analysis.confirmedAt && <span><strong>Confirmado</strong>{formatAuditDateTime(analysis.confirmedAt)}</span>}</div>
                {expanded && (
                  <div className="root-cause-analysis-body">
                    <div className="root-cause-problem"><span>Descripción del problema</span><p>{analysis.problemDescription}</p></div>
                    {analysis.status === 'DRAFT' && <div className="root-cause-requirements"><strong>Requisitos para confirmar</strong><ul>{requirements.map((requirement) => <li key={requirement.key} className={requirement.met ? 'met' : 'pending'}><span aria-hidden="true">{requirement.met ? '✓' : '!'}</span>{requirement.label}</li>)}</ul></div>}
                     {analysis.methodology === 'FIVE_WHYS' && <FiveWhyWorkspace analysis={analysis} readonly={readonly} busy={busy} editor={fiveWhyStepEditor} draft={fiveWhyStepDraft} onOpenCreate={() => openCreateFiveWhyStep(analysis)} onOpenEdit={(step) => openEditFiveWhyStep(analysis, step)} onDraftChange={setFiveWhyStepDraft} onSave={saveFiveWhyStep} onCancel={() => setFiveWhyStepEditor(null)} onDelete={(step) => void deleteFiveWhyStep(analysis, step)} />}
                     {analysis.methodology === 'ISHIKAWA' && <IshikawaVisual analysis={analysis} />}
                     <div className="root-cause-causes-heading"><div><span>Causas registradas</span><strong>{analysis.causes.length} causa(s)</strong></div>{!readonly && analysis.status === 'DRAFT' && <button type="button" className="button secondary small-button" onClick={() => openCreateCause(analysis)} disabled={Boolean(causeEditor) || busy}>+ Añadir causa</button>}</div>
                    {analysis.causes.length === 0 ? <p className="root-cause-empty">Aún no hay causas registradas.</p> : <div className="root-cause-cause-list">{analysis.causes.map((cause) => {
                      const canEdit = !readonly && causeCanBeEdited(analysis, cause)
                      return (
                        <article className={`root-cause-cause-card ${causeStatusClass(cause.status)}`} key={cause.id}>
                            <header><div><span className={`root-cause-cause-status ${causeStatusClass(cause.status)}`}>{rootCauseStatusLabels[cause.status]}</span><h5>{cause.description}</h5></div>{canEdit && <div className="root-cause-cause-actions"><button type="button" className="button secondary small-button" onClick={() => openEditCause(analysis, cause)} disabled={busy}>Editar</button><button type="button" className="button primary small-button" onClick={() => void confirmCause(analysis, cause)} disabled={busy || !causeCanBeConfirmed(cause, analysis.methodology)} title={!causeCanBeConfirmed(cause, analysis.methodology) ? 'Completa la justificación, la evidencia y la categoría Ishikawa cuando corresponda.' : undefined}>Confirmar</button><button type="button" className="button danger small-button" onClick={() => setCauseDecision({ analysisId: analysis.id, cause, justification: cause.justification ?? '' })} disabled={busy}>Descartar</button></div>}</header>
                            {canEdit && !causeCanBeConfirmed(cause, analysis.methodology) && <p className="root-cause-cause-hint">Completa la justificación, la evidencia y la categoría Ishikawa cuando corresponda para confirmar esta causa.</p>}
                           <div className="root-cause-cause-details"><div><span>Justificación</span><p>{cause.justification ?? 'Sin registrar'}</p></div><div><span>Evidencia de soporte descriptiva</span><p>{cause.supportingEvidence ?? 'Sin registrar'}</p></div>{analysis.methodology === 'ISHIKAWA' && <div><span>Categoría Ishikawa</span><p>{cause.ishikawaCategory ?? 'Sin registrar'}</p></div>}</div>
                          {cause.confirmedAt && <p className="root-cause-cause-footer">Decisión registrada el {formatAuditDateTime(cause.confirmedAt)}{cause.confirmedBy ? ` por ${cause.confirmedBy.name}` : ''}.</p>}
                          {causeDecision?.cause.id === cause.id && (
                            <form className="root-cause-decision" onSubmit={discardCause}><label>Justificación para descartar<textarea value={causeDecision.justification} onChange={(event) => setCauseDecision((current) => current ? { ...current, justification: event.target.value } : current)} minLength={1} maxLength={5000} rows={3} required autoFocus /></label><div className="finding-correction-actions"><button type="submit" className="button danger small-button" disabled={busy}>{busy ? 'Procesando…' : 'Confirmar descarte'}</button><button type="button" className="button secondary small-button" onClick={() => setCauseDecision(null)} disabled={busy}>Cancelar</button></div></form>
                          )}
                        </article>
                      )
                    })}</div>}
                    {causeEditor?.analysisId === analysis.id && (
                       <form className="root-cause-editor root-cause-cause-editor" onSubmit={saveCause}><div className="root-cause-editor-heading"><strong>{causeEditor.cause ? 'Editar causa potencial' : 'Añadir causa potencial'}</strong><span>La evidencia de soporte es descriptiva; no adjunta archivos oficiales.</span></div><label className="root-cause-field-wide">Descripción<input value={causeDraft.description} onChange={(event) => setCauseDraft((current) => ({ ...current, description: event.target.value }))} maxLength={5000} minLength={1} required autoFocus /></label><label>Justificación<textarea value={causeDraft.justification} onChange={(event) => setCauseDraft((current) => ({ ...current, justification: event.target.value }))} maxLength={5000} rows={3} /></label><label>Evidencia de soporte descriptiva<textarea value={causeDraft.supportingEvidence} onChange={(event) => setCauseDraft((current) => ({ ...current, supportingEvidence: event.target.value }))} maxLength={5000} rows={3} /></label>{analysis.methodology === 'ISHIKAWA' && <label>Categoría Ishikawa<input value={causeDraft.ishikawaCategory} onChange={(event) => setCauseDraft((current) => ({ ...current, ishikawaCategory: event.target.value }))} list="ishikawa-category-suggestions" maxLength={160} required /><small className="root-cause-field-note">Elige una sugerencia o escribe una categoría propia.</small><datalist id="ishikawa-category-suggestions">{ishikawaCategorySuggestions.map((category) => <option value={category} key={category} />)}</datalist></label>}<div className="procedure-form-actions root-cause-field-wide"><button type="submit" className="button primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar causa'}</button><button type="button" className="button secondary" onClick={() => setCauseEditor(null)} disabled={busy}>Cancelar</button></div></form>
                    )}
                     {!readonly && analysis.status === 'DRAFT' && <div className="root-cause-analysis-actions"><button type="button" className="button secondary small-button" onClick={() => openEditAnalysis(analysis)} disabled={busy}>Editar análisis</button><button type="button" className="button primary small-button" onClick={() => void confirmAnalysis(analysis)} disabled={busy}>Confirmar análisis</button></div>}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

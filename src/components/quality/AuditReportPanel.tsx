import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, apiUrl } from '../../api'
import type { AuditReport, AuditReportEditable, AuditReportSnapshot } from '../../types'
import { askConfirm } from '../ui/useConfirm'

const emptyEditable: AuditReportEditable = { executiveSummary: '', conclusions: '', recommendations: '' }
const statusLabels = { DRAFT: 'Borrador', IN_REVIEW: 'En revisión', APPROVED: 'Aprobado' } as const
const reportStages: Array<AuditReport['status']> = ['DRAFT', 'IN_REVIEW', 'APPROVED']
const findingStatusLabels: Record<string, string> = { OPEN: 'Abierto', IN_PROGRESS: 'En curso', RESOLVED: 'Resuelto', VERIFIED: 'Verificado' }
const findingTypeLabels: Record<string, string> = { NONCONFORMITY: 'No conformidad', OBSERVATION: 'Observación', OPPORTUNITY: 'Oportunidad' }
const outcomeLabels: Record<string, string> = { EFFECTIVE: 'Eficaz', PARTIALLY_EFFECTIVE: 'Parcialmente eficaz', INEFFECTIVE: 'No eficaz', PENDING: 'Pendiente' }

const formatDate = (value: string | null | undefined): string => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const formatDateTime = (value: string): string => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const formatBytes = (value: number): string => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`

type ReportResponse = { report: AuditReport | null; currentSourceFingerprint: string }

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function reportSnapshotForValidity(report: AuditReport): AuditReportSnapshot | null {
  if (report.status === 'APPROVED') return report.versions.find((version) => version.id === report.approvedVersionId)?.snapshot ?? null
  return report.draftSnapshot
}

export function AuditReportPanel({ auditId, canWrite, onError, onNotice }: { auditId: string; canWrite: boolean; onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [report, setReport] = useState<AuditReport | null>(null)
  const [currentFingerprint, setCurrentFingerprint] = useState('')
  const [editable, setEditable] = useState<AuditReportEditable>(emptyEditable)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [returning, setReturning] = useState(false)
  const [returnJustification, setReturnJustification] = useState('')

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<ReportResponse>(`/audits/${auditId}/report`)
      setReport(result.report)
      setCurrentFingerprint(result.currentSourceFingerprint)
      setEditable(result.report?.draftSnapshot.editable ?? emptyEditable)
    } catch (requestError) {
      const message = errorMessage(requestError, 'No se pudo cargar el informe de auditoría.')
      setError(message)
      onError(message)
    } finally {
      setLoading(false)
    }
  }, [auditId, onError])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadReport() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadReport])

  async function generateDraft() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ report: AuditReport }>(`/audits/${auditId}/report/draft`, { method: 'POST', body: JSON.stringify({}) })
      setReport(result.report)
      setEditable(result.report.draftSnapshot.editable)
      await loadReport()
      onNotice('Borrador de informe generado desde el expediente oficial.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo generar el borrador.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<{ report: AuditReport }>(`/audits/${auditId}/report`, { method: 'PATCH', body: JSON.stringify(editable) })
      setReport(result.report)
      setEditable(result.report.draftSnapshot.editable)
      onNotice('Cambios del borrador guardados.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo guardar el borrador.'))
    } finally {
      setBusy(false)
    }
  }

  async function submitForReview() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ report: AuditReport }>(`/audits/${auditId}/report/submit`, { method: 'POST', body: JSON.stringify({}) })
      setReport(result.report)
      onNotice('El informe fue enviado a revisión.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo enviar el informe a revisión.'))
    } finally {
      setBusy(false)
    }
  }

  async function returnToDraft(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<{ report: AuditReport }>(`/audits/${auditId}/report/return-to-draft`, { method: 'POST', body: JSON.stringify({ justification: returnJustification }) })
      setReport(result.report)
      setReturning(false)
      setReturnJustification('')
      onNotice('El informe volvió a borrador con la justificación registrada.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo devolver el informe a borrador.'))
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    const confirmed = await askConfirm({ title: 'Aprobar informe', message: 'Se generará una versión oficial inmutable y su PDF.', confirmLabel: 'Aprobar' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ report: AuditReport }>(`/audits/${auditId}/report/approve`, { method: 'POST', body: JSON.stringify({}) })
      setReport(result.report)
      onNotice('Informe aprobado y PDF oficial almacenado.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo aprobar el informe.'))
    } finally {
      setBusy(false)
    }
  }

  async function downloadPdf(versionId: string, filename: string) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl(`/audits/${auditId}/report/versions/${versionId}/pdf`), { credentials: 'include' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new ApiError(body.error ?? 'No se pudo descargar el PDF oficial.', response.status)
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo descargar el PDF oficial.'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="panel audit-report-loading" role="status"><span className="loader" />Cargando informe de auditoría…</div>
  if (error && !report) return <section className="panel audit-report-panel"><div className="form-error page-alert" role="alert"><span>{error}</span><button type="button" className="button secondary small-button" onClick={() => void loadReport()}>Reintentar</button></div></section>

  const snapshot = report ? reportSnapshotForValidity(report) : null
  const isCurrent = Boolean(snapshot && currentFingerprint && snapshot.sourceFingerprint === currentFingerprint)
  const editableReport = report?.status === 'DRAFT' && canWrite
  const official = snapshot?.official
  const reportStageIndex = report ? reportStages.indexOf(report.status) : 0
  const checklistPercent = official && official.results.checklistTotal > 0 ? Math.round((official.results.checklistEvaluated / official.results.checklistTotal) * 100) : 0
  const conformityPercent = official && official.results.checklistEvaluated > 0 ? Math.round((official.results.conform / official.results.checklistEvaluated) * 100) : 0
  const findingsResolvedPercent = official && official.results.findingsTotal > 0 ? Math.round(((official.results.findingsTotal - official.results.findingsOpen) / official.results.findingsTotal) * 100) : 0
  const reportTextComplete = Boolean(editable.executiveSummary.trim() && editable.conclusions.trim() && editable.recommendations.trim())

  return (
    <div className="audit-report-panel-wrap">
      <section className="panel audit-report-panel">
        <header className="audit-report-heading">
          <div>
            <p className="detail-label">DOCUMENTO OFICIAL</p>
            <h2>Informe de auditoría</h2>
            <p className="muted">Consolida el expediente, documenta las conclusiones y deja una versión aprobada trazable.</p>
          </div>
          {report && <div className="audit-report-heading-state"><span className={`audit-report-status ${report.status.toLowerCase()}`}>{statusLabels[report.status]}</span><span className={`audit-report-validity ${isCurrent ? 'current' : 'stale'}`}>{isCurrent ? 'Vigente' : 'Desactualizado'}</span></div>}
        </header>
        <nav className="audit-report-route" aria-label="Estado del informe">
          {reportStages.map((stage, index) => <div className={`audit-report-route-step${index < reportStageIndex ? ' complete' : index === reportStageIndex ? ' current' : ''}`} key={stage}><span aria-hidden="true">{index < reportStageIndex ? '✓' : index + 1}</span><strong>{statusLabels[stage]}</strong>{index < reportStages.length - 1 && <i aria-hidden="true" />}</div>)}
        </nav>

        {error && <div className="form-error page-alert" role="alert"><span>{error}</span><button type="button" className="icon-button" aria-label="Cerrar error" onClick={() => setError('')}>×</button></div>}

        {!report ? (
          <div className="audit-report-empty">
            <div className="audit-report-empty-mark" aria-hidden="true">✦</div>
            <div><h3>Aún no hay un informe preparado</h3><p>Genera un borrador para consolidar resultados, hallazgos y evidencias de esta auditoría.</p></div>
            {canWrite ? <button type="button" className="button primary" onClick={() => void generateDraft()} disabled={busy}>{busy ? 'Generando…' : 'Generar borrador'}</button> : <span className="muted">No tienes permisos para preparar el informe.</span>}
          </div>
        ) : (
          <>
            {!isCurrent && <div className="audit-report-stale" role="status"><strong>El informe necesita actualización.</strong><span>El expediente oficial cambió desde que se generó este snapshot. Regenera el borrador antes de enviarlo o aprobarlo.</span>{report.status !== 'APPROVED' && canWrite && <button type="button" className="text-button" onClick={() => void generateDraft()} disabled={busy}>Actualizar desde el expediente</button>}</div>}
            <div className="audit-report-toolbar">
              <span className="muted">Última actualización: {formatDateTime(report.updatedAt)}</span>
              <div className="audit-report-actions">
                {report.status !== 'APPROVED' && canWrite && <button type="button" className="button secondary small-button" onClick={() => void generateDraft()} disabled={busy}>Sincronizar expediente</button>}
                {report.status === 'DRAFT' && canWrite && <button type="button" className="button primary small-button" onClick={() => void submitForReview()} disabled={busy || !isCurrent}>{busy ? 'Enviando…' : 'Enviar a revisión'}</button>}
                {report.status === 'IN_REVIEW' && canWrite && <><button type="button" className="button secondary small-button" onClick={() => setReturning((current) => !current)} disabled={busy}>Devolver a borrador</button><button type="button" className="button primary small-button" onClick={() => void approve()} disabled={busy || !isCurrent}>{busy ? 'Aprobando…' : 'Aprobar informe'}</button></>}
              </div>
            </div>
            <section className="audit-report-requirements" aria-label="Requisitos y preparación del informe">
              <div><p className="detail-label">PREPARACIÓN</p><h3>Estado del documento</h3></div>
              <ul><li className={isCurrent ? 'done' : 'pending'}><span aria-hidden="true">{isCurrent ? '✓' : '!'}</span><div><strong>Snapshot vigente</strong><small>{isCurrent ? 'El informe refleja el expediente oficial actual.' : 'Sincroniza el informe antes de continuar.'}</small></div></li><li className={reportTextComplete ? 'done' : 'pending'}><span aria-hidden="true">{reportTextComplete ? '✓' : '!'}</span><div><strong>Redacción completa</strong><small>{reportTextComplete ? 'Resumen, conclusiones y recomendaciones registrados.' : 'Completa las tres secciones de redacción.'}</small></div></li><li className={report.status === 'APPROVED' ? 'done' : 'pending'}><span aria-hidden="true">{report.status === 'APPROVED' ? '✓' : '○'}</span><div><strong>Versión oficial</strong><small>{report.status === 'APPROVED' ? 'PDF inmutable disponible en el historial.' : 'Se crea al aprobar el informe.'}</small></div></li></ul>
            </section>
            {returning && <form className="audit-report-return" onSubmit={returnToDraft}><label>Motivo de devolución<textarea value={returnJustification} onChange={(event) => setReturnJustification(event.target.value)} minLength={3} maxLength={5000} required rows={3} placeholder="Explica qué debe corregirse antes de volver a revisar el informe." /></label><div><button type="button" className="button secondary small-button" onClick={() => setReturning(false)}>Cancelar</button><button type="submit" className="button primary small-button" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar devolución'}</button></div></form>}

            {official && <>
              <div className="audit-report-results" aria-label="Resultados consolidados">
                <div><span>Checklist evaluado</span><strong>{official.results.checklistEvaluated}<small> / {official.results.checklistTotal}</small></strong></div>
                <div><span>Conformes</span><strong>{official.results.conform}</strong></div>
                <div><span>No conformes</span><strong>{official.results.nonConform}</strong></div>
                <div><span>Hallazgos abiertos</span><strong>{official.results.findingsOpen}<small> / {official.results.findingsTotal}</small></strong></div>
              </div>
              <section className="audit-report-charts" aria-label="Avance consolidado">
                <div><div><span>Checklist evaluado</span><strong>{checklistPercent}%</strong></div><span className="audit-report-chart-track" role="progressbar" aria-label={`Checklist evaluado ${checklistPercent}%`} aria-valuenow={checklistPercent} aria-valuemin={0} aria-valuemax={100}><i className="checklist" style={{ width: `${checklistPercent}%` }} /></span><small>{official.results.checklistEvaluated} de {official.results.checklistTotal} criterios</small></div>
                <div><div><span>Conformidad</span><strong>{conformityPercent}%</strong></div><span className="audit-report-chart-track" role="progressbar" aria-label={`Conformidad ${conformityPercent}%`} aria-valuenow={conformityPercent} aria-valuemin={0} aria-valuemax={100}><i className="conform" style={{ width: `${conformityPercent}%` }} /></span><small>{official.results.conform} conformes de los evaluados</small></div>
                <div><div><span>Hallazgos resueltos</span><strong>{findingsResolvedPercent}%</strong></div><span className="audit-report-chart-track" role="progressbar" aria-label={`Hallazgos resueltos ${findingsResolvedPercent}%`} aria-valuenow={findingsResolvedPercent} aria-valuemin={0} aria-valuemax={100}><i className="findings" style={{ width: `${findingsResolvedPercent}%` }} /></span><small>{official.results.findingsTotal - official.results.findingsOpen} de {official.results.findingsTotal} hallazgos</small></div>
              </section>
              <div className="audit-report-official-grid">
                <section className="audit-report-section"><div className="audit-report-section-heading"><div><p className="detail-label">SÍNTESIS DEL AUDITOR</p><h3>Lectura oficial del expediente</h3></div><span>{official.findings.length} hallazgos</span></div><dl className="audit-report-facts"><div><dt>Alcance</dt><dd>{official.scope}</dd></div><div><dt>Criterios</dt><dd>{official.criteria}</dd></div><div><dt>Fechas</dt><dd>{formatDate(official.dates.startDate)} · planificada {formatDate(official.dates.plannedDate)}</dd></div></dl></section>
                <section className="audit-report-section"><div className="audit-report-section-heading"><div><p className="detail-label">DOCUMENTACIÓN</p><h3>Fuentes consolidadas</h3></div></div><div className="audit-report-source-list"><span>{official.checklists.length} checklist</span><span>{official.evidences.length + official.evidenceFiles.length} evidencias</span><span>{official.processes.length} procesos</span><span>{official.procedures.length} procedimientos</span></div></section>
              </div>

              <form className="audit-report-editor" onSubmit={saveDraft}>
                <div className="audit-report-section-heading"><div><p className="detail-label">REDACCIÓN</p><h3>Conclusiones del informe</h3></div>{report.status === 'APPROVED' && <span className="audit-report-locked">Versión protegida</span>}</div>
                <label>Resumen ejecutivo<textarea value={editable.executiveSummary} onChange={(event) => setEditable((current) => ({ ...current, executiveSummary: event.target.value }))} disabled={!editableReport} maxLength={20000} rows={5} placeholder="Resume el propósito, alcance y resultado global de la auditoría." /></label>
                <div className="audit-report-editor-grid"><label>Conclusiones<textarea value={editable.conclusions} onChange={(event) => setEditable((current) => ({ ...current, conclusions: event.target.value }))} disabled={!editableReport} maxLength={20000} rows={6} placeholder="Explica qué concluye el equipo auditor frente a los criterios." /></label><label>Recomendaciones<textarea value={editable.recommendations} onChange={(event) => setEditable((current) => ({ ...current, recommendations: event.target.value }))} disabled={!editableReport} maxLength={20000} rows={6} placeholder="Registra las recomendaciones formales para la organización." /></label></div>
                {editableReport && <div className="audit-report-savebar"><span className="muted">Guarda el borrador antes de enviarlo a revisión.</span><button type="submit" className="button secondary small-button" disabled={busy}>{busy ? 'Guardando…' : 'Guardar borrador'}</button></div>}
              </form>

              <section className="audit-report-section audit-report-findings"><div className="audit-report-section-heading"><div><p className="detail-label">RESULTADOS DETALLADOS</p><h3>Hallazgos incluidos</h3></div></div>{official.findings.length === 0 ? <p className="muted">No hay hallazgos registrados.</p> : <div className="audit-report-finding-list">{official.findings.map((finding) => <article key={finding.id}><div><span className="audit-report-finding-type">{findingTypeLabels[finding.type] ?? finding.type}</span><h4>{finding.title}</h4><p>{finding.description}</p></div><div className="audit-report-finding-meta"><span>{findingStatusLabels[finding.status] ?? finding.status}</span><span>{finding.severity}</span><span>{finding.actions.length} {finding.actions.length === 1 ? 'acción' : 'acciones'}</span>{finding.efficacyEvaluations.length > 0 && <span>{outcomeLabels[finding.efficacyEvaluations[finding.efficacyEvaluations.length - 1].outcome] ?? 'Eficacia registrada'}</span>}</div></article>)}</div>}</section>
            </>}
          </>
        )}
      </section>

      {report && report.versions.length > 0 && <section className="panel audit-report-versions"><div className="audit-report-section-heading"><div><p className="detail-label">HISTORIAL DOCUMENTAL</p><h3>Versiones aprobadas</h3></div><span>{report.versions.length} inmutable(s)</span></div><div className="audit-report-version-list">{report.versions.map((version) => <article key={version.id}><div className="audit-report-version-main"><span className="audit-report-version-mark" aria-hidden="true">PDF</span><div><strong>Versión {version.version}</strong><span>Aprobada {formatDateTime(version.approvedAt)} por {version.approvedBy?.name ?? 'Administrador'}</span><small>{formatBytes(version.pdfEvidenceFile?.size ?? 0)} · Hash: {version.snapshotHash.slice(0, 16)}…</small></div></div>{version.pdfEvidenceFile ? <button type="button" className="button secondary small-button" onClick={() => void downloadPdf(version.id, version.pdfEvidenceFile?.filename ?? `informe-v${version.version}.pdf`)} disabled={busy}>Descargar PDF</button> : <span className="muted">PDF no disponible</span>}</article>)}</div></section>}
    </div>
  )
}

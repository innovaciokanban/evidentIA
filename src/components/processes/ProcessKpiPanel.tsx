import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import type { Process, ProcessIndicator } from '../../types'
import { ProcessIndicatorSection } from './ProcessIndicatorSection'
import { processIndicatorEntryFromIndicator, type ProcessIndicatorEntry, type ProcessIndicatorUser } from './process-indicator.model'

export function ProcessKpiPanel({ process, users, canWrite, onBack }: { process: Process; users: ProcessIndicatorUser[]; canWrite: boolean; onBack: () => void }) {
  const [entries, setEntries] = useState<ProcessIndicatorEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const loadIndicators = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ indicators: ProcessIndicator[] }>(`/processes/${process.id}/indicators`)
      setEntries(result.indicators.map(processIndicatorEntryFromIndicator))
    } catch (requestError) {
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar los indicadores del proceso.')
    } finally {
      setLoading(false)
    }
  }, [process.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadIndicators() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadIndicators])

  return (
    <div className="process-kpi-page">
      <div className="kpi-page-header">
        <button type="button" className="text-button kpi-back-button" onClick={onBack}>← Volver a la caracterización</button>
        <div className="kpi-page-heading">
          <div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO KPI</p><h1>Indicadores del proceso</h1><p className="muted">Administra indicadores propios de este proceso sin modificar el catálogo KPI compartido.</p></div>
        </div>
      </div>
      <section className="panel kpi-process-context">
        <div><span>Proceso</span><strong>{process.name}</strong></div>
        <div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div>
        <div><span>Indicadores propios</span><strong>{entries.length}</strong></div>
      </section>
      {loadError && <div className="form-error page-alert" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadIndicators()}>Reintentar</button></div>}
      {loading ? <div className="inline-loading"><span className="loader" />Cargando indicadores...</div> : <section className="panel process-indicator-panel"><ProcessIndicatorSection processId={process.id} entries={entries} setEntries={setEntries} users={users} readOnly={!canWrite} /></section>}
    </div>
  )
}

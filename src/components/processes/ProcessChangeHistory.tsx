import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import type { Process, ProcessChange, ProcessChangeValue } from '../../types'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const valueLabel = (value: ProcessChangeValue) => {
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value
}

export function ProcessChangeHistory({ process, onBack }: { process: Process; onBack: () => void }) {
  const [history, setHistory] = useState<ProcessChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<{ history: ProcessChange[] }>(`/processes/${process.id}/change-history`)
      setHistory(result.history)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar el historial de cambios.')
    } finally {
      setLoading(false)
    }
  }, [process.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadHistory() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadHistory])

  return (
    <div className="process-history-page">
      <div className="history-page-header">
        <button type="button" className="text-button history-back-button" onClick={onBack}>← Volver a la caracterización</button>
        <div className="history-page-heading">
          <div>
            <p className="eyebrow">GESTIÓN POR PROCESOS / TRAZABILIDAD</p>
            <h1>Control de cambios</h1>
            <p className="muted">Consulta quién modificó este proceso, cuándo ocurrió y qué campos fueron impactados.</p>
          </div>
        </div>
      </div>

      <section className="panel history-process-context">
        <div><span>Proceso</span><strong>{process.name}</strong></div>
        <div><span>Versión actual</span><strong>{process.version ?? 'Sin versión'}</strong></div>
        <div><span>Registros</span><strong>{history.length}</strong></div>
      </section>

      {error && <div className="form-error page-alert history-error" role="alert"><span>{error}</span><button type="button" className="button secondary small-button" onClick={() => void loadHistory()}>Reintentar</button></div>}
      {loading ? <div className="inline-loading"><span className="loader" />Cargando historial...</div> : history.length === 0 ? (
        <section className="panel history-empty"><span className="history-empty-icon">↺</span><h2>Sin cambios registrados</h2><p>Las modificaciones futuras del proceso aparecerán aquí.</p></section>
      ) : (
        <section className="panel history-list-panel">
          <div className="panel-heading history-list-heading"><div><p className="detail-label">HISTORIAL DEL PROCESO</p><h2>Versiones registradas</h2></div><span className="history-list-note">Solo lectura</span></div>
          <div className="history-list">
            {history.map((entry) => (
              <article className="history-entry" key={entry.id}>
                <div className="history-entry-marker" aria-hidden="true"><span /></div>
                <div className="history-entry-body">
                  <header className="history-entry-header">
                    <div><span className="history-version">Versión {entry.version}</span><h3>{entry.action === 'CREATED' ? 'Proceso creado' : 'Proceso actualizado'}</h3></div>
                    <time dateTime={entry.changedAt}>{dateFormatter.format(new Date(entry.changedAt))}</time>
                  </header>
                  <p className="history-actor">Responsable del cambio: <strong>{entry.changedByName ?? entry.changedBy?.name ?? 'Usuario no disponible'}</strong>{entry.changedByEmail && <span> · {entry.changedByEmail}</span>}</p>
                  <div className="history-change-list">
                    {entry.changes.map((change) => <div className="history-change" key={`${entry.id}-${change.field}`}><span>{change.label}</span><strong>{valueLabel(change.previousValue)}</strong><b aria-hidden="true">→</b><strong>{valueLabel(change.newValue)}</strong></div>)}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

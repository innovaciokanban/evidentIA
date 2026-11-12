import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Process, ProcessKpi } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { activeUserOptions } from '../../user-status'
import { KpiForm } from './KpiForm'
import { draftFromKpi, emptyKpiDraft, kpiPayloadOf, type KpiDraft, type KpiUser } from './process-kpi.model'

export function ProcessKpiPanel({ process, users, canWrite, onBack }: { process: Process; users: KpiUser[]; canWrite: boolean; onBack: () => void }) {
  const [kpis, setKpis] = useState<ProcessKpi[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProcessKpi | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<KpiDraft>(emptyKpiDraft)

  const historicalUsers: KpiUser[] = editing ? [editing.reportResponsible, editing.monitorResponsible].filter((user): user is NonNullable<typeof user> => Boolean(user)).map((user) => ({ ...user, companyId: process.companyId })) : []
  const availableUsers = activeUserOptions<KpiUser>(users.filter((user) => user.companyId === process.companyId), historicalUsers)
  const loadKpis = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ kpis: ProcessKpi[] }>(`/processes/${process.id}/kpis`)
      setKpis(result.kpis)
    } catch (requestError) {
      console.error('[process-kpis] failed to load KPIs', requestError)
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar los indicadores KPI.')
    } finally {
      setLoading(false)
    }
  }, [process.id])

  // El catálogo se sincroniza con el proceso activo al entrar al panel.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadKpis() }, [loadKpis])

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setFormError('')
  }

  function startCreate() {
    setEditing(null)
    setDraft(emptyKpiDraft)
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function startEdit(kpi: ProcessKpi) {
    setEditing(kpi)
    setDraft(draftFromKpi(kpi))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  async function saveKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError('')
    setNotice('')
    const payload = kpiPayloadOf(draft)
    try {
      if (editing) {
        await api<{ kpi: ProcessKpi }>(`/processes/${process.id}/kpis/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api<{ kpi: ProcessKpi }>(`/processes/${process.id}/kpis`, { method: 'POST', body: JSON.stringify(payload) })
      }
      await loadKpis()
      closeForm()
      setNotice(`Indicador ${editing ? 'actualizado' : 'creado'} correctamente.`)
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo guardar el indicador.')
    } finally {
      setSaving(false)
    }
  }

  async function removeKpi(kpi: ProcessKpi) {
    if (!canWrite) return
    const confirmed = await askConfirm({ title: 'Desvincular indicador', message: `Se quitará «${kpi.name}» de este proceso, pero el indicador seguirá disponible para otros usos.`, confirmLabel: 'Desvincular' })
    if (!confirmed) return
    setFormError('')
    try {
      await api(`/processes/${process.id}/kpis/${kpi.id}`, { method: 'DELETE' })
      await loadKpis()
      setNotice('Indicador desvinculado correctamente. El KPI no fue eliminado.')
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : 'No se pudo eliminar el indicador.')
    }
  }

  return (
    <div className="process-kpi-page">
      <div className="kpi-page-header">
        <button type="button" className="text-button kpi-back-button" onClick={onBack}>← Volver a la caracterización</button>
        <div className="kpi-page-heading">
          <div><p className="eyebrow">GESTIÓN POR PROCESOS / MÓDULO KPI</p><h1>Indicadores KPI</h1><p className="muted">Administra los indicadores asociados a este proceso sin eliminar el catálogo compartido.</p></div>
          {!showForm && canWrite && <button type="button" className="button primary" onClick={startCreate}>+ Nuevo indicador</button>}
        </div>
      </div>

      <section className="panel kpi-process-context">
        <div><span>Proceso</span><strong>{process.name}</strong></div>
        <div><span>Código</span><strong>{process.code ?? 'Sin código'}</strong></div>
        <div><span>Indicadores configurados</span><strong>{kpis.length}</strong></div>
      </section>

      {notice && !showForm && <div className="form-success page-alert" role="status">{notice}</div>}
      {showForm ? (
        <KpiForm draft={draft} setDraft={setDraft} users={availableUsers} editing={Boolean(editing)} saving={saving} error={formError} onSubmit={(event) => void saveKpi(event)} onClose={closeForm} />
      ) : (
        <section className="panel kpi-list-panel">
          <div className="panel-heading kpi-list-heading"><div><p className="detail-label">INDICADORES DEL PROCESO</p><h2>Listado de KPI</h2></div><span className="kpi-measure-note">Sin medición actual</span></div>
          {loadError && <div className="form-error kpi-list-error" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadKpis()}>Reintentar</button></div>}
          {loading ? <div className="inline-loading"><span className="loader" />Cargando indicadores...</div> : kpis.length === 0 ? (
            <div className="kpi-empty"><span className="kpi-empty-icon">◫</span><h3>Aún no hay indicadores</h3><p>Define el primer KPI para hacer seguimiento a este proceso.</p>{canWrite && <button type="button" className="button secondary" onClick={startCreate}>Crear primer indicador</button>}</div>
          ) : (
            <div className="kpi-table-wrap">
              <div className="kpi-table-head"><span>Indicador</span><span>Frecuencia</span><span>Meta</span><span>Estado</span><span /></div>
              {kpis.map((kpi) => {
                const expanded = expandedId === kpi.id
                return <article className={`kpi-row${expanded ? ' expanded' : ''}`} key={kpi.id}>
                  <button type="button" className="kpi-row-summary" onClick={() => setExpandedId(expanded ? null : kpi.id)} aria-expanded={expanded}>
                    <span className="kpi-name-cell"><strong>{kpi.name}</strong><small>{kpi.description}</small></span>
                    <span>{kpi.frequency}</span>
                    <span>{kpi.target}</span>
                    <span className="kpi-status configured">Sin medición</span>
                    <span className="kpi-expand-icon">{expanded ? '⌃' : '⌄'}</span>
                  </button>
                  {expanded && <div className="kpi-detail">
                    <div className="kpi-detail-grid">
                      <div><span>Definición / descripción</span><p>{kpi.description}</p></div>
                      <div><span>Fórmula</span><p>{kpi.formula}</p></div>
                      <div><span>Fuente de datos</span><p>{kpi.dataSource}</p></div>
                      <div><span>Unidad de medida</span><p>{kpi.unit}</p></div>
                      <div><span>Responsable de reporte</span><p>{kpi.reportResponsible?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Responsable de monitoreo</span><p>{kpi.monitorResponsible?.name ?? 'Sin asignar'}</p></div>
                      <div><span>Frecuencia</span><p>{kpi.frequency}</p></div>
                      <div><span>Umbrales</span><p><span className="threshold-inline green">{kpi.greenThreshold ?? 'Verde sin definir'}</span><span className="threshold-inline yellow">{kpi.yellowThreshold ?? 'Amarillo sin definir'}</span><span className="threshold-inline red">{kpi.redThreshold ?? 'Rojo sin definir'}</span></p></div>
                    </div>
                     {canWrite && <div className="kpi-detail-actions"><button type="button" className="button secondary small-button" onClick={() => startEdit(kpi)}>Editar</button><button type="button" className="button danger small-button" onClick={() => void removeKpi(kpi)}>Desvincular</button></div>}
                  </div>}
                </article>
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

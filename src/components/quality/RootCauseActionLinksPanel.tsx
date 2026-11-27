import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { AuditCorrectiveAction, AuditFinding, AuditRootCauseActionAssociation, AuditRootCauseEligible } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { formatAuditDateTime } from './audit-history.model'
import { actionPriorityLabels, actionStatusLabels } from './quality.model'

type LinkEditor = { actionId: string; causeIds: string[] }

const terminalAction = (action: AuditCorrectiveAction): boolean => action.status === 'COMPLETED' || action.status === 'CANCELLED'

const requestMessage = (requestError: unknown, fallback: string): string => requestError instanceof ApiError ? requestError.message : fallback

function replaceAssociation(links: Record<string, AuditRootCauseActionAssociation[]>, next: AuditRootCauseActionAssociation): Record<string, AuditRootCauseActionAssociation[]> {
  const current = links[next.actionId] ?? []
  return { ...links, [next.actionId]: [...current.filter((link) => link.id !== next.id), next] }
}

export function RootCauseActionLinksPanel({ auditId, finding, actions, canWrite, onChanged, onError, onNotice, onGoToAction }: {
  auditId: string
  finding: AuditFinding
  actions: AuditCorrectiveAction[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
  onGoToAction?: (actionId: string) => void
}) {
  const [causes, setCauses] = useState<AuditRootCauseEligible[]>([])
  const [linksByAction, setLinksByAction] = useState<Record<string, AuditRootCauseActionAssociation[]>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkEditor, setLinkEditor] = useState<LinkEditor | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const readonly = !canWrite || finding.status === 'VERIFIED'
  const actionIds = actions.map((action) => action.id).join(',')
  const activeLinks = Object.values(linksByAction).flat().filter((link) => link.isActive)
  const activeCauseIds = new Set(activeLinks.map((link) => link.causeId))
  const causeActionCount = new Map<string, number>()
  for (const link of activeLinks) causeActionCount.set(link.causeId, (causeActionCount.get(link.causeId) ?? 0) + 1)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const eligibleResult = await api<{ causes: AuditRootCauseEligible[] }>(`/audits/${auditId}/findings/${finding.id}/eligible-root-causes`)
        const associationResults = await Promise.all(actions.map(async (action) => {
          const result = await api<{ associations: AuditRootCauseActionAssociation[] }>(`/audits/${auditId}/findings/${finding.id}/actions/${action.id}/causes?history=true`)
          return [action.id, result.associations] as const
        }))
        if (!cancelled) {
          setCauses(eligibleResult.causes)
          setLinksByAction(Object.fromEntries(associationResults))
        }
      } catch (requestError) {
        if (!cancelled) {
          const message = requestMessage(requestError, 'No se pudieron cargar las vinculaciones de causas y acciones.')
          setError(message)
          onError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [auditId, finding.id, actionIds, actions, onError])

  function linksForCause(causeId: string): AuditRootCauseActionAssociation[] {
    return Object.values(linksByAction).flat().filter((link) => link.causeId === causeId && link.isActive)
  }

  function availableCausesForAction(actionId: string): AuditRootCauseEligible[] {
    const linkedIds = new Set((linksByAction[actionId] ?? []).filter((link) => link.isActive).map((link) => link.causeId))
    return causes.filter((cause) => !linkedIds.has(cause.id))
  }

  async function linkCauses(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!linkEditor || busy || readonly) return
    if (linkEditor.causeIds.length === 0) {
      setError('Selecciona al menos una causa confirmada para vincular.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api<{ associations: AuditRootCauseActionAssociation[] }>(`/audits/${auditId}/findings/${finding.id}/actions/${linkEditor.actionId}/causes`, {
        method: 'POST',
        body: JSON.stringify({ causeIds: linkEditor.causeIds }),
      })
      setLinksByAction((current) => result.associations.reduce(replaceAssociation, current))
      setLinkEditor(null)
      await onChanged()
      onNotice(result.associations.length === 1 ? 'Causa vinculada a la acción.' : `${result.associations.length} causas vinculadas a la acción.`)
    } catch (requestError) {
      const message = requestMessage(requestError, 'No se pudieron vincular las causas a la acción.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  async function unlinkCause(action: AuditCorrectiveAction, cause: AuditRootCauseEligible) {
    if (busy || readonly || terminalAction(action)) return
    const confirmed = await askConfirm({ title: 'Desvincular causa', message: `La causa «${cause.description}» dejará de estar vinculada a «${action.title}». El registro histórico se conservará.`, confirmLabel: 'Desvincular' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ association: AuditRootCauseActionAssociation }>(`/audits/${auditId}/findings/${finding.id}/actions/${action.id}/causes/${cause.id}`, { method: 'DELETE' })
      setLinksByAction((current) => replaceAssociation(current, result.association))
      await onChanged()
      onNotice('Causa desvinculada. El historial de la asociación se conservó.')
    } catch (requestError) {
      const message = requestMessage(requestError, 'No se pudo desvincular la causa de la acción.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="root-cause-links-panel" aria-labelledby="root-cause-links-title">
      <div className="finding-dossier-section-heading">
        <div><p className="detail-label">TRATAMIENTO Y SEGUIMIENTO</p><h3 id="root-cause-links-title">Causas y acciones correctivas</h3></div>
        <span className="root-cause-links-summary">{activeLinks.length} vínculo(s) activo(s)</span>
      </div>
      {finding.status === 'VERIFIED' && <p className="finding-dossier-lock" role="note">Este hallazgo está verificado. Las vinculaciones quedan en solo lectura.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {loading ? <div className="inline-loading"><span className="loader" />Cargando vinculaciones...</div> : (
        <>
          <section className="root-cause-link-cause-summary" aria-labelledby="root-cause-confirmed-title">
            <div className="root-cause-links-subheading"><div><strong id="root-cause-confirmed-title">Causas confirmadas</strong><span>Solo las causas de análisis confirmados pueden vincularse.</span></div><span>{causes.length} elegible(s)</span></div>
            {causes.length === 0 ? <p className="root-cause-empty">No hay causas confirmadas disponibles para asociar todavía.</p> : <div className="root-cause-confirmed-cause-list">{causes.map((cause) => {
              const related = linksForCause(cause.id)
              return <article className="root-cause-confirmed-cause" key={cause.id}>
                <div><span className="root-cause-cause-status confirmed">Confirmada</span><strong>{cause.description}</strong><small>{cause.analysis.methodology === 'ISHIKAWA' && cause.ishikawaCategory ? `${cause.ishikawaCategory} · ` : ''}{cause.analysis.methodology === 'FIVE_WHYS' ? 'Five Whys' : cause.analysis.methodology === 'ISHIKAWA' ? 'Ishikawa' : 'Manual'}</small></div>
                <div className="root-cause-related-actions">{related.length === 0 ? <span className="root-cause-unlinked-label">Sin acción vinculada</span> : related.map((link) => <button type="button" className="text-button" key={link.id} onClick={() => onGoToAction?.(link.actionId)} disabled={!onGoToAction}>↗ {link.action.title}</button>)}</div>
              </article>
            })}</div>}
          </section>

          <section className="root-cause-action-links" aria-labelledby="root-cause-actions-title">
            <div className="root-cause-links-subheading"><div><strong id="root-cause-actions-title">Acciones correctivas del hallazgo</strong><span>Una acción puede tener varias causas y una causa puede explicar varias acciones.</span></div><span>{actions.length} acción(es)</span></div>
            {actions.length === 0 ? <p className="root-cause-empty">Este hallazgo todavía no tiene acciones correctivas oficiales.</p> : <div className="root-cause-action-link-list">{actions.map((action) => {
              const associations = linksByAction[action.id] ?? []
              const active = associations.filter((link) => link.isActive)
              const historical = associations.filter((link) => !link.isActive)
              const available = availableCausesForAction(action.id)
              const editing = linkEditor?.actionId === action.id
              const canManage = !readonly && !terminalAction(action)
              return <article className={`root-cause-action-link-card ${terminalAction(action) ? 'terminal' : ''}`} key={action.id}>
                <header><div><span className="root-cause-action-kicker">Acción correctiva</span><h4>{action.title}</h4><p>{action.responsible?.name ?? 'Sin responsable'} · {actionPriorityLabels[action.priority]}</p></div><span className={`root-cause-action-status ${action.status.toLowerCase()}`}>{actionStatusLabels[action.status]}</span></header>
                <div className="root-cause-action-link-body">
                  <strong>Causas vinculadas ({active.length})</strong>
                  {active.length === 0 ? <p className="root-cause-unlinked-label">Esta acción no tiene causas vinculadas.</p> : <ul>{active.map((link) => <li key={link.id}><span>{link.cause.description}</span>{canManage && <button type="button" className="text-button danger-text" onClick={() => void unlinkCause(action, link.cause)} disabled={busy}>Desvincular</button>}</li>)}</ul>}
                  {canManage && available.length > 0 && <button type="button" className="button secondary small-button" onClick={() => setLinkEditor({ actionId: action.id, causeIds: [] })} disabled={busy || Boolean(linkEditor)}>+ Vincular causas</button>}
                  {terminalAction(action) && <p className="root-cause-terminal-note">Las acciones completadas o canceladas son de solo lectura para asociaciones.</p>}
                   {editing && <form className="root-cause-link-editor" onSubmit={linkCauses}><strong>Selecciona causas confirmadas</strong><div>{available.map((cause) => <label key={cause.id}><input type="checkbox" checked={linkEditor.causeIds.includes(cause.id)} onChange={(event) => setLinkEditor((current) => current ? { ...current, causeIds: event.target.checked ? [...current.causeIds, cause.id] : current.causeIds.filter((id) => id !== cause.id) } : current)} /><span>{cause.description}</span></label>)}</div><footer><button type="submit" className="button primary small-button" disabled={busy}>{busy ? 'Vinculando…' : 'Vincular seleccionadas'}</button><button type="button" className="button secondary small-button" onClick={() => setLinkEditor(null)} disabled={busy}>Cancelar</button></footer></form>}
                  {historical.length > 0 && <details className="root-cause-link-history" open={historyOpen} onToggle={(event) => setHistoryOpen((event.currentTarget as HTMLDetailsElement).open)}><summary>Historial de vínculos ({historical.length})</summary><ul>{historical.map((link) => <li key={link.id}><span>{link.cause.description}</span><small>Desvinculada {link.removedAt ? formatAuditDateTime(link.removedAt) : 'sin fecha'}{link.removedBy ? ` · ${link.removedBy.name}` : ''}</small></li>)}</ul></details>}
                </div>
              </article>
            })}</div>}
          </section>
          {causes.some((cause) => (causeActionCount.get(cause.id) ?? 0) === 0) && <p className="root-cause-links-attention" role="status">Hay causas confirmadas sin acciones correctivas vinculadas.</p>}
          {activeCauseIds.size === 0 && actions.length > 0 && causes.length > 0 && <p className="root-cause-links-attention" role="status">Las acciones correctivas aún no tienen causas asociadas.</p>}
        </>
      )}
    </section>
  )
}

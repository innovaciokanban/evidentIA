import { useState } from 'react'
import { api, ApiError } from '../../api'
import type { Auditor, AuditorCompetency, Role } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { AuditorCompetencyForm, type AuditorCompetencyDraft } from './AuditorCompetencyForm'
import { auditorStatusLabels, auditorStatusTone, auditorTypeLabels } from './auditor.model'

type AuditorDetailProps = {
  auditor: Auditor
  companyName?: string
  role: Role
  onBack: () => void
  onEdit: () => void
  onUpdated: (auditor: Auditor) => void
}

const emptyCompetencyDraft: AuditorCompetencyDraft = { name: '', level: '1', evidence: '' }
const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

export function AuditorDetail({ auditor, companyName, role, onBack, onEdit, onUpdated }: AuditorDetailProps) {
  const canWrite = role === 'SUPERUSER' || role === 'COMPANY_ADMIN'
  const [competencies, setCompetencies] = useState<AuditorCompetency[]>(auditor.competencies)
  const [competencyForm, setCompetencyForm] = useState<AuditorCompetencyDraft | null>(null)
  const [editingCompetency, setEditingCompetency] = useState<AuditorCompetency | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function openNewCompetency() {
    setEditingCompetency(null)
    setCompetencyForm(emptyCompetencyDraft)
    setError('')
    setNotice('')
  }

  function openEditCompetency(competency: AuditorCompetency) {
    setEditingCompetency(competency)
    setCompetencyForm({ name: competency.name, level: String(competency.level), evidence: competency.evidence ?? '' })
    setError('')
    setNotice('')
  }

  async function saveCompetency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !competencyForm) return
    setSaving(true)
    setError('')
    setNotice('')
    const body = { name: competencyForm.name.trim(), level: Number(competencyForm.level), evidence: competencyForm.evidence.trim() || null }
    try {
      const result = editingCompetency
        ? await api<{ competency: AuditorCompetency }>(`/auditors/${auditor.id}/competencies/${editingCompetency.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<{ competency: AuditorCompetency }>(`/auditors/${auditor.id}/competencies`, { method: 'POST', body: JSON.stringify(body) })
      const next = editingCompetency ? competencies.map((item) => item.id === result.competency.id ? result.competency : item) : [...competencies, result.competency]
      setCompetencies(next)
      onUpdated({ ...auditor, competencies: next })
      setCompetencyForm(null)
      setEditingCompetency(null)
      setNotice(`Competencia ${editingCompetency ? 'actualizada' : 'añadida'} correctamente.`)
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo guardar la competencia.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeCompetency(competency: AuditorCompetency) {
    const confirmed = await askConfirm({ title: 'Eliminar competencia', message: `Se quitará «${competency.name}» de la ficha de ${auditor.name}.`, confirmLabel: 'Eliminar competencia' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/auditors/${auditor.id}/competencies/${competency.id}`, { method: 'DELETE' })
      const next = competencies.filter((item) => item.id !== competency.id)
      setCompetencies(next)
      onUpdated({ ...auditor, competencies: next })
      setNotice('Competencia eliminada correctamente.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo eliminar la competencia.'))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    const confirmed = await askConfirm({ title: 'Desactivar auditor', message: `${auditor.name} quedará inactivo y conservará su ficha y competencias.`, confirmLabel: 'Desactivar auditor' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ auditor: Auditor }>(`/auditors/${auditor.id}/deactivate`, { method: 'POST' })
      onUpdated({ ...result.auditor, competencies })
      setNotice('Auditor desactivado correctamente.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudo desactivar el auditor.'))
    } finally {
      setBusy(false)
    }
  }

  return <div className="auditor-detail-view">
    <div className="auditor-detail-topbar"><button type="button" className="text-button" onClick={onBack}>← Volver al banco</button><span className={`auditor-status ${auditorStatusTone(auditor.status)}`}>{auditorStatusLabels[auditor.status]}</span></div>
    <header className="panel auditor-detail-header"><div className="auditor-detail-avatar" aria-hidden="true">{auditor.name.trim().slice(0, 1).toUpperCase()}</div><div className="auditor-detail-title"><p className="eyebrow">FICHA DEL AUDITOR</p><h1>{auditor.name}</h1><p>{auditorTypeLabels[auditor.type]}{auditor.position ? ` · ${auditor.position}` : ''}{companyName ? ` · ${companyName}` : ''}</p></div>{canWrite && <div className="auditor-detail-actions"><button type="button" className="button secondary" onClick={onEdit}>Editar</button>{auditor.status !== 'INACTIVE' && <button type="button" className="button danger" onClick={() => void deactivate()} disabled={busy}>Desactivar</button>}</div>}</header>
    {notice && <div className="notice success" role="status">{notice}</div>}
    {error && !competencyForm && <div className="notice error" role="alert">{error}</div>}
    <div className="auditor-detail-layout">
      <section className="panel auditor-profile-panel"><div className="auditor-detail-section-heading"><div><span className="detail-label">PERFIL PROFESIONAL</span><h2>Información del auditor</h2></div></div><div className="auditor-profile-grid"><AuditorField label="Correo electrónico" value={auditor.email} /><AuditorField label="Teléfono" value={auditor.phone ?? 'No registrado'} /><AuditorField label="Organización" value={auditor.organization ?? 'Independiente'} /><AuditorField label="Estado" value={auditorStatusLabels[auditor.status]} /><AuditorField label="Experiencia" value={auditor.experience ?? 'No registrada'} wide /><AuditorField label="Observaciones" value={auditor.observations ?? 'Sin observaciones'} wide /></div></section>
      <section className="panel auditor-competencies-panel"><div className="auditor-detail-section-heading"><div><span className="detail-label">COMPETENCIAS</span><h2>Áreas de conocimiento</h2><p>{competencies.length === 0 ? 'Todavía no hay competencias registradas.' : `${competencies.length} ${competencies.length === 1 ? 'competencia registrada' : 'competencias registradas'}.`}</p></div>{canWrite && auditor.status !== 'INACTIVE' && <button type="button" className="button primary small-button" onClick={openNewCompetency}>+ Añadir</button>}</div>{competencies.length > 0 && <div className="auditor-competency-list">{competencies.map((competency) => <article className="auditor-competency-row" key={competency.id}><div className="auditor-competency-main"><div><strong>{competency.name}</strong>{competency.evidence && <p>{competency.evidence}</p>}</div><span className="auditor-level-badge" aria-label={`Nivel ${competency.level} de 5`}>{competency.level}/5</span></div>{canWrite && auditor.status !== 'INACTIVE' && <div className="auditor-competency-actions"><button type="button" className="text-button" onClick={() => openEditCompetency(competency)}>Editar</button><button type="button" className="text-button danger" onClick={() => void removeCompetency(competency)} disabled={busy}>Eliminar</button></div>}</article>)}</div>}</section>
    </div>
    {competencyForm && <AuditorCompetencyForm draft={competencyForm} editing={Boolean(editingCompetency)} saving={saving} error={error} onChange={(field, value) => setCompetencyForm((current) => current ? { ...current, [field]: value } : current)} onSubmit={saveCompetency} onClose={() => { if (!saving) setCompetencyForm(null) }} />}
  </div>
}

function AuditorField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={`auditor-profile-field${wide ? ' wide' : ''}`}><span>{label}</span><strong>{value}</strong></div>
}

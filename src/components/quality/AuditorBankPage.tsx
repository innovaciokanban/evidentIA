import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Auditor, AuditorStatus, AuditorType, Company, User } from '../../types'
import { AuditorDetail } from './AuditorDetail'
import { AuditorDirectory } from './AuditorDirectory'
import { AuditorFormModal } from './AuditorFormModal'
import { auditorDraftFrom, emptyAuditorDraft, type AuditorDraft } from './auditor.model'

type AuditorBankPageProps = {
  user: Pick<User, 'id' | 'role' | 'companyId'>
  companies: Company[]
  companyId: string
  onCompanyChange: (value: string) => void
  onBack: () => void
}

const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

export function AuditorBankPage({ user, companies, companyId, onCompanyChange, onBack }: AuditorBankPageProps) {
  const [auditors, setAuditors] = useState<Auditor[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AuditorType | ''>('')
  const [statusFilter, setStatusFilter] = useState<AuditorStatus | ''>('')
  const [selectedAuditor, setSelectedAuditor] = useState<Auditor | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Auditor | null>(null)
  const [draft, setDraft] = useState<AuditorDraft>(emptyAuditorDraft)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  const loadAuditors = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
      const result = await api<{ auditors: Auditor[] }>(`/auditors${query}`)
      setAuditors(result.auditors)
    } catch (requestError) {
      setLoadError(errorMessage(requestError, 'No pudimos cargar el banco de auditores.'))
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAuditors() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAuditors])

  const selectedCompanyName = companies.find((company) => company.id === (selectedAuditor?.companyId ?? companyId))?.name

  function handleCompanyChange(nextCompanyId: string) {
    setSelectedAuditor(null)
    onCompanyChange(nextCompanyId)
  }

  function openCreate() {
    setEditing(null)
    setDraft({ ...emptyAuditorDraft, companyId })
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function openEdit() {
    if (!selectedAuditor) return
    setEditing(selectedAuditor)
    setDraft(auditorDraftFrom(selectedAuditor))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  async function saveAuditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (user.role === 'SUPERUSER' && !editing && !draft.companyId) {
      setFormError('Selecciona una empresa para registrar el auditor.')
      return
    }
    setSaving(true)
    setFormError('')
    setNotice('')
    const body = {
      ...(user.role === 'SUPERUSER' && !editing ? { companyId: draft.companyId } : {}),
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      phone: draft.phone.trim() || null,
      type: draft.type,
      position: draft.position.trim() || null,
      organization: draft.organization.trim() || null,
      experience: draft.experience.trim() || null,
      status: draft.status,
      observations: draft.observations.trim() || null,
    }
    try {
      const result = editing
        ? await api<{ auditor: Auditor }>(`/auditors/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<{ auditor: Auditor }>('/auditors', { method: 'POST', body: JSON.stringify(body) })
      setAuditors((current) => editing ? current.map((item) => item.id === result.auditor.id ? result.auditor : item) : [...current, result.auditor])
      if (editing) setSelectedAuditor(result.auditor)
      setShowForm(false)
      setEditing(null)
      setNotice(`Auditor ${editing ? 'actualizado' : 'registrado'} correctamente.`)
    } catch (requestError) {
      setFormError(errorMessage(requestError, 'No se pudo guardar el auditor.'))
    } finally {
      setSaving(false)
    }
  }

  function updateSelected(next: Auditor) {
    setAuditors((current) => current.map((item) => item.id === next.id ? next : item))
    setSelectedAuditor(next)
  }

  return <>
    {selectedAuditor ? <AuditorDetail auditor={selectedAuditor} companyName={selectedCompanyName} role={user.role} onBack={() => setSelectedAuditor(null)} onEdit={openEdit} onUpdated={updateSelected} /> : <>
      {notice && <div className="notice success auditor-bank-notice" role="status">{notice}</div>}
      <AuditorDirectory role={user.role} companyId={companyId} companies={companies} auditors={auditors} loading={loading} loadError={loadError} search={search} typeFilter={typeFilter} statusFilter={statusFilter} onSearch={setSearch} onTypeFilter={setTypeFilter} onStatusFilter={setStatusFilter} onCompanyChange={handleCompanyChange} onRetry={() => void loadAuditors()} onBack={onBack} onNew={openCreate} onOpen={setSelectedAuditor} />
    </>}
    {showForm && <AuditorFormModal draft={draft} editing={Boolean(editing)} companies={companies} superuser={user.role === 'SUPERUSER'} saving={saving} error={formError} onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} onSubmit={saveAuditor} onClose={() => { if (!saving) setShowForm(false) }} />}
  </>
}

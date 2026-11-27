import type { Auditor, AuditorStatus, AuditorType } from '../../types'

export type AuditorDraft = {
  companyId: string
  name: string
  email: string
  phone: string
  type: AuditorType
  position: string
  organization: string
  experience: string
  status: AuditorStatus
  observations: string
}

export const auditorTypeLabels: Record<AuditorType, string> = { INTERNAL: 'Interno', EXTERNAL: 'Externo' }
export const auditorStatusLabels: Record<AuditorStatus, string> = { AVAILABLE: 'Disponible', UNAVAILABLE: 'No disponible', INACTIVE: 'Inactivo' }
export const auditorTypeOptions: Array<{ value: AuditorType; label: string }> = Object.entries(auditorTypeLabels).map(([value, label]) => ({ value: value as AuditorType, label }))
export const auditorStatusOptions: Array<{ value: AuditorStatus; label: string }> = Object.entries(auditorStatusLabels).map(([value, label]) => ({ value: value as AuditorStatus, label }))

export const emptyAuditorDraft: AuditorDraft = {
  companyId: '',
  name: '',
  email: '',
  phone: '',
  type: 'INTERNAL',
  position: '',
  organization: '',
  experience: '',
  status: 'AVAILABLE',
  observations: '',
}

export const auditorDraftFrom = (auditor: Auditor): AuditorDraft => ({
  companyId: auditor.companyId,
  name: auditor.name,
  email: auditor.email,
  phone: auditor.phone ?? '',
  type: auditor.type,
  position: auditor.position ?? '',
  organization: auditor.organization ?? '',
  experience: auditor.experience ?? '',
  status: auditor.status,
  observations: auditor.observations ?? '',
})

export const auditorStatusTone = (status: AuditorStatus) => status.toLowerCase()

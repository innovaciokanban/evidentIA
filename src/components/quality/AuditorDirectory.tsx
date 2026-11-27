import { useMemo } from 'react'
import type { Company, Role, Auditor, AuditorStatus, AuditorType } from '../../types'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { auditorStatusLabels, auditorStatusTone, auditorTypeLabels } from './auditor.model'

type AuditorDirectoryProps = {
  role: Role
  companyId: string
  companies: Company[]
  auditors: Auditor[]
  loading: boolean
  loadError: string
  search: string
  typeFilter: AuditorType | ''
  statusFilter: AuditorStatus | ''
  onSearch: (value: string) => void
  onTypeFilter: (value: AuditorType | '') => void
  onStatusFilter: (value: AuditorStatus | '') => void
  onCompanyChange: (value: string) => void
  onRetry: () => void
  onBack: () => void
  onNew: () => void
  onOpen: (auditor: Auditor) => void
}

export function AuditorDirectory({ role, companyId, companies, auditors, loading, loadError, search, typeFilter, statusFilter, onSearch, onTypeFilter, onStatusFilter, onCompanyChange, onRetry, onBack, onNew, onOpen }: AuditorDirectoryProps) {
  const canWrite = role === 'SUPERUSER' || role === 'COMPANY_ADMIN'
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return auditors.filter((auditor) => {
      const matchesSearch = !term || auditor.name.toLowerCase().includes(term) || auditor.email.toLowerCase().includes(term)
      const matchesType = !typeFilter || auditor.type === typeFilter
      const matchesStatus = !statusFilter || auditor.status === statusFilter
      return matchesSearch && matchesType && matchesStatus
    })
  }, [auditors, search, statusFilter, typeFilter])
  const stats = {
    total: auditors.length,
    available: auditors.filter((auditor) => auditor.status === 'AVAILABLE').length,
    internal: auditors.filter((auditor) => auditor.type === 'INTERNAL').length,
    external: auditors.filter((auditor) => auditor.type === 'EXTERNAL').length,
  }

  return <div className="auditor-bank-page page">
    <div className="page-heading auditor-bank-heading">
      <div>
        <button type="button" className="text-button auditor-bank-back" onClick={onBack}>← Gestión de auditorías</button>
        <p className="eyebrow">PLANIFICACIÓN Y COMPETENCIA</p>
        <h1>Banco de auditores</h1>
        <p className="muted">Centraliza las personas disponibles para futuros equipos de auditoría y conserva su experiencia profesional.</p>
      </div>
      <div className="auditor-bank-heading-actions">
        {role === 'SUPERUSER' && <label className="auditor-company-filter"><span>Empresa</span><select value={companyId} onChange={(event) => onCompanyChange(event.target.value)} aria-label="Filtrar banco por empresa"><option value="">Todas las empresas</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
        {canWrite && <button type="button" className="button primary" onClick={onNew}>+ Nuevo auditor</button>}
      </div>
    </div>

    <section className="auditor-stat-strip" aria-label="Indicadores del banco de auditores">
      <AuditorStat label="Auditores registrados" value={stats.total} tone="blue" />
      <AuditorStat label="Disponibles" value={stats.available} tone="green" />
      <AuditorStat label="Internos" value={stats.internal} tone="purple" />
      <AuditorStat label="Externos" value={stats.external} tone="amber" />
    </section>

    <section className="panel auditor-directory-toolbar" aria-label="Filtros del banco de auditores">
      <div className="auditor-directory-toolbar-copy"><span className="detail-label">DIRECTORIO</span><h2>Auditores y competencias</h2><p>{loadError ? 'Directorio no disponible' : `${filtered.length} visibles · ${auditors.reduce((total, auditor) => total + auditor.competencies.length, 0)} competencias registradas`}</p></div>
      <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por nombre o correo…" aria-label="Buscar auditores" /></div>
      <select value={typeFilter} onChange={(event) => onTypeFilter(event.target.value as AuditorType | '')} aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="INTERNAL">Internos</option><option value="EXTERNAL">Externos</option></select>
      <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as AuditorStatus | '')} aria-label="Filtrar por estado"><option value="">Todos los estados</option>{Object.entries(auditorStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </section>

    {loading ? <LoadingState text="Cargando banco de auditores…" /> : loadError ? <div className="notice error auditor-bank-error" role="alert"><span>{loadError}</span><button type="button" className="button secondary small-button" onClick={onRetry}>Reintentar</button></div> : filtered.length === 0 ? <EmptyState icon="◎" title={auditors.length === 0 ? 'Aún no hay auditores registrados' : 'No hay coincidencias'} text={auditors.length === 0 ? 'Registra auditores internos o externos para construir el banco de competencia.' : 'Prueba con otro nombre, correo o filtro.'} action={canWrite && auditors.length === 0 ? <button type="button" className="button primary" onClick={onNew}>Registrar primer auditor</button> : undefined} /> : <div className="auditor-directory-grid">{filtered.map((auditor) => <AuditorCard key={auditor.id} auditor={auditor} onOpen={() => onOpen(auditor)} />)}</div>}
  </div>
}

function AuditorStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`auditor-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

function AuditorCard({ auditor, onOpen }: { auditor: Auditor; onOpen: () => void }) {
  return <article className="panel auditor-card">
    <div className="auditor-card-top"><div className="auditor-avatar" aria-hidden="true">{auditor.name.trim().slice(0, 1).toUpperCase()}</div><div className="auditor-card-title"><span className="auditor-type-label">{auditorTypeLabels[auditor.type]}</span><h3>{auditor.name}</h3><p>{auditor.position ?? 'Perfil profesional sin cargo registrado'}</p></div><span className={`auditor-status ${auditorStatusTone(auditor.status)}`}>{auditorStatusLabels[auditor.status]}</span></div>
    <div className="auditor-card-contact"><span><small>Correo</small><strong>{auditor.email}</strong></span><span><small>Organización</small><strong>{auditor.organization ?? 'Independiente'}</strong></span></div>
    <footer className="auditor-card-footer"><span className="auditor-competency-count"><strong>{auditor.competencies.length}</strong> {auditor.competencies.length === 1 ? 'competencia' : 'competencias'}</span><button type="button" className="button secondary small-button" onClick={onOpen}>Ver ficha</button></footer>
  </article>
}

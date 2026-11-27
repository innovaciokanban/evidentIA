import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Auditor, Company } from '../../types'
import { AuditorCompetencyForm } from './AuditorCompetencyForm'
import { AuditorDetail } from './AuditorDetail'
import { AuditorDirectory } from './AuditorDirectory'
import { AuditorFormModal } from './AuditorFormModal'
import { emptyAuditorDraft } from './auditor.model'

const company: Company = { id: 'company-1', name: 'Empresa Uno', identification: '9001', industry: 'Servicios', description: 'Empresa de prueba.', admin: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const auditor: Auditor = {
  id: 'auditor-1', companyId: company.id, name: 'Ana Torres', email: 'ana@example.com', phone: null, type: 'INTERNAL', position: 'Líder de calidad', organization: null, experience: 'ISO 9001', status: 'AVAILABLE', observations: null, createdById: 'user-1', createdBy: { id: 'user-1', name: 'Admin', email: 'admin@example.com', isActive: true }, competencies: [{ id: 'competency-1', auditorId: 'auditor-1', name: 'ISO 9001', level: 5, evidence: 'Certificación vigente', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

const noop = () => undefined

describe('AuditorBank frontend', () => {
  it('renders a real empty read-only directory without write actions or fake rows', () => {
    const markup = renderToStaticMarkup(<AuditorDirectory role="COMPANY_USER" companyId={company.id} companies={[]} auditors={[]} loading={false} loadError="" search="" typeFilter="" statusFilter="" onSearch={noop} onTypeFilter={noop} onStatusFilter={noop} onCompanyChange={noop} onRetry={noop} onBack={noop} onNew={noop} onOpen={noop} />)
    expect(markup).toContain('Banco de auditores')
    expect(markup).toContain('Aún no hay auditores registrados')
    expect(markup).not.toContain('Nuevo auditor')
    expect(markup).not.toContain('Ana Torres')
  })

  it('shows directory indicators, type, status and competency count from real records', () => {
    const markup = renderToStaticMarkup(<AuditorDirectory role="COMPANY_ADMIN" companyId={company.id} companies={[company]} auditors={[auditor]} loading={false} loadError="" search="" typeFilter="" statusFilter="" onSearch={noop} onTypeFilter={noop} onStatusFilter={noop} onCompanyChange={noop} onRetry={noop} onBack={noop} onNew={noop} onOpen={noop} />)
    expect(markup).toContain('Auditores registrados')
    expect(markup).toContain('Disponible')
    expect(markup).toContain('Interno')
    expect(markup).toContain('1 competencia')
    expect(markup).toContain('ana@example.com')
  })

  it('renders loading and retry states without falling back to fictitious data', () => {
    const loadingMarkup = renderToStaticMarkup(<AuditorDirectory role="COMPANY_ADMIN" companyId={company.id} companies={[company]} auditors={[]} loading loadError="" search="" typeFilter="" statusFilter="" onSearch={noop} onTypeFilter={noop} onStatusFilter={noop} onCompanyChange={noop} onRetry={noop} onBack={noop} onNew={noop} onOpen={noop} />)
    const errorMarkup = renderToStaticMarkup(<AuditorDirectory role="COMPANY_ADMIN" companyId={company.id} companies={[company]} auditors={[]} loading={false} loadError="No pudimos cargar el banco." search="" typeFilter="" statusFilter="" onSearch={noop} onTypeFilter={noop} onStatusFilter={noop} onCompanyChange={noop} onRetry={noop} onBack={noop} onNew={noop} onOpen={noop} />)
    expect(loadingMarkup).toContain('Cargando banco de auditores')
    expect(errorMarkup).toContain('No pudimos cargar el banco.')
    expect(errorMarkup).toContain('Reintentar')
  })

  it('marks required auditor fields and exposes company selection for a superuser', () => {
    const markup = renderToStaticMarkup(<AuditorFormModal draft={{ ...emptyAuditorDraft }} editing={false} companies={[company]} superuser saving={false} error="" onChange={noop} onSubmit={noop} onClose={noop} />)
    expect(markup).toContain('Empresa *')
    expect(markup).toContain('Nombre completo *')
    expect(markup).toContain('Correo electrónico *')
    expect(markup).toContain('type="email"')
    expect(markup).toContain('required')
  })

  it('keeps competency management and auditor actions read-only for company users', () => {
    const markup = renderToStaticMarkup(<AuditorDetail auditor={auditor} companyName={company.name} role="COMPANY_USER" onBack={noop} onEdit={noop} onUpdated={noop} />)
    expect(markup).toContain('ISO 9001')
    expect(markup).toContain('5/5')
    expect(markup).not.toContain('Desactivar')
    expect(markup).not.toContain('Añadir')
    expect(markup).not.toContain('Eliminar')
  })

  it('offers all five competency levels and optional evidence', () => {
    const markup = renderToStaticMarkup(<AuditorCompetencyForm draft={{ name: '', level: '1', evidence: '' }} editing={false} saving={false} error="" onChange={noop} onSubmit={noop} onClose={noop} />)
    expect(markup).toContain('value="5"')
    expect(markup).toContain('Evidencia o experiencia')
    expect(markup).toContain('Añadir competencia')
  })
})

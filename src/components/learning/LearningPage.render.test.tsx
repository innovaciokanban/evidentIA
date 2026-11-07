import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { User } from '../../types'
import { LearningCourseCard, LearningPage } from './LearningPage'
import type { LearningCourse } from '../../learning/learning-types'

const user: User = { id: 'cmuser00000000000000001', name: 'Ana', email: 'ana@test.local', role: 'COMPANY_USER', companyId: 'cmcompany00000000000000001' }
const admin: User = { id: 'cmadmin00000000000000001', name: 'Admin', email: 'admin@test.local', role: 'COMPANY_ADMIN', companyId: 'cmcompany00000000000000001' }
const course: LearningCourse = {
  id: 'cmcourse00000000000000001', companyId: user.companyId!, title: 'Cultura de servicio', description: 'Aprendizaje práctico para el equipo.', category: 'Cultura', status: 'PUBLISHED',
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', company: { id: user.companyId!, name: 'Empresa A' }, createdBy: { id: 'cmadmin00000000000000001', name: 'Admin' }, updatedBy: { id: 'cmadmin00000000000000001', name: 'Admin' },
  versions: [{ id: 'cmversion00000000000000001', courseId: 'cmcourse00000000000000001', versionNumber: 1, status: 'PUBLISHED', changeSummary: null, publishedAt: '2026-11-05T10:00:00.000Z', createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', createdBy: { id: 'cmadmin00000000000000001', name: 'Admin' }, updatedBy: { id: 'cmadmin00000000000000001', name: 'Admin' }, modules: [] }],
  enrollment: { id: 'cmenrollment000000000000001', versionId: 'cmversion00000000000000001', assignedAt: '2026-11-05T10:00:00.000Z' },
}

describe('learning catalog UI', () => {
  it('shows the real course card without inventing progress data', () => {
    const markup = renderToStaticMarkup(<LearningCourseCard course={course} index={0} canManage={false} onOpen={vi.fn()} />)
    expect(markup).toContain('Cultura de servicio')
    expect(markup).toContain('Publicado')
    expect(markup).toContain('Inscrito')
    expect(markup).not.toContain('75%')
    expect(markup).not.toContain('progreso')
  })

  it('renders the learning entry point with an empty/loading state instead of fake courses', () => {
    const markup = renderToStaticMarkup(<LearningPage user={user} />)
    expect(markup).toContain('Mi espacio de aprendizaje')
    expect(markup).toContain('Podcasts y recursos')
    expect(markup).not.toContain('Crear curso')
    expect(markup).not.toContain('Curso de ejemplo')
  })

  it('keeps course administration out of the company user view', () => {
    const markup = renderToStaticMarkup(<LearningPage user={admin} />)
    expect(markup).toContain('Centro de aprendizaje')
    expect(markup).toContain('Crear curso')
    expect(markup).not.toContain('Mi espacio de aprendizaje')
  })
})

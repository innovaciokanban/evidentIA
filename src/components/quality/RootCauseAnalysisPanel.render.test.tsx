import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AuditFinding, AuditRootCauseAnalysis } from '../../types'
import { RootCauseAnalysisPanel } from './RootCauseAnalysisPanel'
import { causeCanBeConfirmed, fiveWhySequenceIssues, ishikawaCategorySuggestions, rootCauseAnalysisCanBeConfirmed, rootCauseAnalysisRequirements, rootCauseCounts, rootCauseMethodDescriptions, rootCauseMethodLabels } from './root-cause.model'

const finding = {
  id: 'finding-1',
  auditId: 'audit-1',
  title: 'Control documental incompleto',
  description: 'No se encontró el registro firmado.',
  status: 'OPEN',
  responsible: { id: 'user-1', name: 'Laura Gómez', isActive: true },
} as unknown as AuditFinding

const analysis = (overrides: Partial<AuditRootCauseAnalysis> = {}) => ({
  id: 'analysis-1',
  findingId: 'finding-1',
  methodology: 'MANUAL',
  status: 'DRAFT',
  origin: 'MANUAL',
  problemDescription: 'Problema documentado.',
  responsible: { id: 'user-1', name: 'Laura Gómez', isActive: true },
  createdBy: { id: 'user-1', name: 'Laura Gómez', isActive: true },
  confirmedBy: null,
  confirmedAt: null,
  causes: [],
  fiveWhySteps: [],
  createdAt: '2026-11-25T04:30:00.000Z',
  updatedAt: '2026-11-25T04:30:00.000Z',
  ...overrides,
}) as AuditRootCauseAnalysis

describe('RootCauseAnalysisPanel', () => {
  it('renders the loading workspace without inventing data', () => {
    const markup = renderToStaticMarkup(
      <RootCauseAnalysisPanel
        auditId="audit-1"
        finding={finding}
        users={[{ id: 'user-1', name: 'Laura Gómez', isActive: true, companyId: 'company-1' }]}
        canWrite
        onChanged={vi.fn()}
        onError={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    expect(markup).toContain('Análisis de causa raíz')
    expect(markup).toContain('Cargando análisis de causa raíz')
  })

  it('computes confirmation requirements and cause counters', () => {
    const draft = analysis({
      causes: [{ status: 'POTENTIAL' }, { status: 'CONFIRMED', justification: 'Causa validada.', supportingEvidence: 'Registro revisado.' }],
    } as never)
    expect(rootCauseAnalysisRequirements(draft).find((item) => item.key === 'confirmedCause')?.met).toBe(true)
    expect(rootCauseAnalysisRequirements(draft).find((item) => item.key === 'noPotential')?.met).toBe(false)
    expect(rootCauseCounts([draft])).toEqual({ analyses: 1, potential: 1, confirmed: 1, discarded: 0 })
    expect(causeCanBeConfirmed(draft.causes[0])).toBe(false)
    expect(causeCanBeConfirmed({ ...draft.causes[1], status: 'POTENTIAL' })).toBe(true)
  })

  it('validates flexible Five Whys sequences and Ishikawa categories before confirmation', () => {
    expect(rootCauseMethodLabels.FIVE_WHYS).toBe('Five Whys')
    expect(rootCauseMethodDescriptions.ISHIKAWA).toContain('categorías')
    expect(ishikawaCategorySuggestions).toContain('Entorno')
    const fiveWhy = analysis({ methodology: 'FIVE_WHYS', fiveWhySteps: [{ sequence: 1, question: '¿Por qué?', answer: 'Porque...' }, { sequence: 3, question: '¿Por qué otra vez?', answer: 'Porque...' }] } as never)
    expect(fiveWhySequenceIssues(fiveWhy.fiveWhySteps)).toContain('Las secuencias deben ser consecutivas desde 1.')
    expect(rootCauseAnalysisRequirements(fiveWhy).find((item) => item.key === 'fiveWhySteps')?.met).toBe(false)
    expect(rootCauseAnalysisCanBeConfirmed(fiveWhy)).toBe(false)

    const ishikawa = analysis({ methodology: 'ISHIKAWA', causes: [{ status: 'CONFIRMED', justification: 'Validada.', supportingEvidence: 'Registro.', ishikawaCategory: 'Personas y competencias' }] } as never)
    expect(rootCauseAnalysisRequirements(ishikawa).find((item) => item.key === 'ishikawaCategory')?.met).toBe(true)
    expect(causeCanBeConfirmed({ ...ishikawa.causes[0], status: 'POTENTIAL', ishikawaCategory: null }, 'ISHIKAWA')).toBe(false)
  })
})

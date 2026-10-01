import { describe, expect, it } from 'vitest'
import { sanitizeAIAnalysisResult } from './ai-service.js'
import { sanitizeTextWithSwotItems } from './text-sanitization.js'
import type { AIAnalysisResult } from './ai-service.js'

const supportId = 'cmuoch1430004uwl58z1940k'
const marketId = 'cmmarket1430004uwl58z1940x'
const support = { id: supportId, description: 'El soporte del aplicativo contable está en casa [interno]' }
const market = { id: marketId, description: 'Mercado en expansión (regional)' }

describe('backend text sanitization', () => {
  it('replaces real CUID2 ids, multiple ids and descriptions with regex characters', () => {
    const text = `Relaciona ${supportId} con ${marketId}; valida ${supportId}.`

    expect(sanitizeTextWithSwotItems(text, [support, market])).toBe('Relaciona El soporte del aplicativo contable está en casa [interno] con Mercado en expansión (regional); valida El soporte del aplicativo contable está en casa [interno].')
  })

  it('removes an unknown technical CUID2 without relying on the SWOT map', () => {
    const unknownId = 'cmunknown1430004uwl58z1940q'

    expect(sanitizeTextWithSwotItems(`Texto visible (${unknownId})`, [support])).toBe('Texto visible')
  })

  it('sanitizes every visible AIAnalysis text field and preserves evidenceIds', () => {
    const analysis: AIAnalysisResult = {
      executiveSummary: `Resumen ${supportId}`,
      diagnosis: `Diagnóstico ${marketId}`,
      keyFindings: [{ finding: `Hallazgo ${supportId}`, interpretation: `Interpretación ${marketId}`, basis: 'INFERENCE', evidenceIds: [supportId, marketId] }],
      foStrategies: [`Estrategia FO ${supportId}`],
      doStrategies: [`Estrategia DO ${marketId}`],
      faStrategies: [`Estrategia FA ${supportId}`],
      daStrategies: [`Estrategia DA ${marketId}`],
      priorityRisks: [`Riesgo ${supportId}`],
      priorityOpportunities: [`Oportunidad ${marketId}`],
      recommendations: [{ title: `Título ${supportId}`, description: `Descripción ${marketId}`, priority: 'HIGH', expectedImpact: `Impacto ${supportId}`, suggestedAction: `Acción ${marketId}` }],
    }

    const sanitized = sanitizeAIAnalysisResult(analysis, [support, market])
    const visibleText = JSON.stringify({ ...sanitized, keyFindings: sanitized.keyFindings.map(({ evidenceIds, ...finding }) => finding) })

    expect(visibleText).not.toContain(supportId)
    expect(visibleText).not.toContain(marketId)
    expect(sanitized.keyFindings[0].evidenceIds).toEqual([supportId, marketId])
    expect(sanitized.keyFindings[0].finding).toContain(support.description)
    expect(sanitized.keyFindings[0].interpretation).toContain(market.description)
  })
})

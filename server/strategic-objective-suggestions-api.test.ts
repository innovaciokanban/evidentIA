/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import request from './test-request.js'
import { createApp } from './app.js'
import type { AIService } from './ai-service.js'

const diagnosticId = 'cmdiagnostic-suggestion000001'
const foreignDiagnosticId = 'cmdiagnostic-suggestion000002'
const companyId = 'cmcompany-suggestion000001'
const foreignCompanyId = 'cmcompany-suggestion000002'
const admin = { id: 'cmadmin-suggestion000001', email: 'admin@suggestion.test', name: 'Suggestion Admin', role: 'COMPANY_ADMIN', companyId, isActive: true }
const companyUser = { id: 'cmuser-suggestion000001', email: 'user@suggestion.test', name: 'Suggestion User', role: 'COMPANY_USER', companyId, isActive: true }
const foreignAdmin = { id: 'cmadmin-suggestion000002', email: 'foreign@suggestion.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN', companyId: foreignCompanyId, isActive: true }
const strategy = {
  id: 'cmsuggestioncross000001',
  diagnosticId,
  crossType: 'FO',
  origin: 'USER',
  factor1: { id: 'cmfactor-suggestion000001', type: 'STRENGTH', description: 'Equipo preparado' },
  factor2: { id: 'cmfactor-suggestion000002', type: 'OPPORTUNITY', description: 'Mercado digital' },
  strategy: 'Digitalizar el proceso comercial para capturar el mercado.',
  strategyStatus: 'ACCEPTED',
  weighting: { id: 'cmweight-suggestion000001', crossId: 'cmsuggestioncross000001', impactoEstrategico: 'ALTO', viabilidad: 'ALTO', urgencia: 'MEDIO', sinergiaInterna: 'ALTO', impactoReputacional: 'MEDIO', weightedScore: 4.2 },
}
const payload = {
  title: 'Reducir el tiempo de respuesta',
  statement: 'Reducir el tiempo promedio de respuesta comercial.',
  specificCriteria: 'En el proceso comercial.',
  measurableCriteria: 'Reducirlo en 20%.',
  achievableCriteria: 'Con automatización y capacitación.',
  relevantCriteria: 'Mejora la experiencia del cliente.',
  timeBoundCriteria: 'Durante 2026.',
  indicator: { name: 'Tiempo promedio de respuesta', unit: 'Horas', baselineValue: '48', targetValue: '38', measurementMethod: 'Reporte mensual del CRM', deadline: '2026-12-31' },
}

  const diagnostic = { id: diagnosticId, companyId, title: 'Diagnóstico comercial', description: 'Contexto comercial', status: 'DRAFT', company: { id: companyId } }
  const foreignDiagnostic = { id: foreignDiagnosticId, companyId: foreignCompanyId, title: 'Diagnóstico extranjero', description: 'Otro contexto', status: 'DRAFT', company: { id: foreignCompanyId } }

type HarnessOptions = { role?: typeof admin.role; user?: typeof admin; proposalStrategyRef?: string; seedAccepted?: boolean }

function makeHarness(options: HarnessOptions = {}) {
  const currentUser = options.user ?? (options.role === companyUser.role ? companyUser : admin)
  const rows = new Map<string, any>()
  const objectives = new Map<string, any>()
  const links: any[] = []
  const histories: any[] = []
  const failureState = { history: false, strategyLink: false }
  const strategyState = { ...strategy, weighting: strategy.weighting ? { ...strategy.weighting } : null }
  const ownKpi = { id: '550e8400-e29b-41d4-a716-446655440001', process: { id: 'cmprocess-suggestion000001', companyId, name: 'Comercial', code: 'COM-01' }, name: 'Tiempo comercial', description: 'KPI propio', frequency: 'Mensual', target: '38', formula: 'Promedio', dataSource: 'CRM', unit: 'Horas', reportResponsible: null, monitorResponsible: null, greenThreshold: null, yellowThreshold: null, redThreshold: null, createdAt: new Date(), updatedAt: new Date() }
  const foreignKpi = { ...ownKpi, id: '550e8400-e29b-41d4-a716-446655440002', process: { ...ownKpi.process, id: 'cmprocess-suggestion000002', companyId: foreignCompanyId } }
  const kpiFindUnique = vi.fn(async ({ where: { id } }: any) => id === ownKpi.id ? ownKpi : id === foreignKpi.id ? foreignKpi : null)
  let nextId = 1
  let nextObjectiveId = 1
  let nextHistoryId = 1
  const now = () => new Date()
  const requestedBy = (id: string) => [admin, companyUser, foreignAdmin].find((user) => user.id === id) ?? currentUser
  const withRelations = (row: any) => ({
    ...row,
    requestedBy: row.requestedBy ?? requestedBy(row.requestedById),
    diagnostic: row.diagnostic ?? (row.diagnosticId === foreignDiagnosticId ? foreignDiagnostic : diagnostic),
  })
  const hydrateObjective = (id: string) => {
    const objective = objectives.get(id)
    if (!objective) return null
    const createdBy = requestedBy(objective.createdById)
    return {
      ...objective,
      createdBy: { id: createdBy.id, name: createdBy.name, email: createdBy.email },
       indicators: objective.indicators ?? (objective.indicator ? [objective.indicator] : []),
       indicator: objective.indicators?.[0] ?? objective.indicator ?? null,
      strategyLinks: links.filter((link) => link.objectiveId === id).map((link) => ({ ...link, linkedBy: { id: admin.id, name: admin.name, email: admin.email } })),
    }
  }
  if (options.seedAccepted) {
    rows.set('accepted', withRelations({
      id: 'cmsuggestion-accepted000001', diagnosticId, requestedById: admin.id, originalPayload: payload, editablePayload: payload,
      strategyRefs: [`cross:${strategy.id}`], dedupeKey: 'accepted-key', status: 'ACCEPTED', decisionNote: 'Aceptada en una fase anterior', acceptedObjectiveId: 'cmobjective-accepted000001', decidedAt: now(), createdAt: now(), updatedAt: now(),
    }))
    rows.set('pending', withRelations({
      id: 'cmsuggestion-pending000001', diagnosticId, requestedById: admin.id, originalPayload: payload, editablePayload: { ...payload, title: 'Otra propuesta pendiente' },
      strategyRefs: [`cross:${strategy.id}`], dedupeKey: 'pending-key', status: 'PENDING', decisionNote: null, acceptedObjectiveId: null, decidedAt: null, createdAt: now(), updatedAt: now(),
    }))
  }

  const aiService = {
    suggestStrategicObjectives: vi.fn(async () => ({
      suggestions: [{ title: payload.title, statement: payload.statement, specificCriteria: payload.specificCriteria, measurableCriteria: payload.measurableCriteria, achievableCriteria: payload.achievableCriteria, relevantCriteria: payload.relevantCriteria, timeBoundCriteria: payload.timeBoundCriteria, indicators: [payload.indicator], strategyRefs: [options.proposalStrategyRef ?? `cross:${strategy.id}`] }],
      missingInformation: [],
    })),
  }

  const db: any = {
    $transaction: async (operation: (client: any) => Promise<unknown>) => operation(db),
    session: { findUnique: async () => ({ id: 'cmsession-suggestion000001', expiresAt: new Date(Date.now() + 60_000), user: currentUser }) },
    qualityDiagnostic: {
      findUnique: async ({ where: { id } }: any) => id === diagnosticId ? diagnostic : id === foreignDiagnosticId ? foreignDiagnostic : null,
    },
    aIAnalysis: { findUnique: async () => null },
    strategicCross: { findMany: async () => [strategyState] },
    sWOTItem: { findMany: async () => [] },
    checkyMessage: { findMany: async () => [] },
    strategyWeighting: { findMany: async () => [] },
    actionPlan: { findMany: async () => [] },
    strategicObjectiveSuggestion: {
      upsert: async ({ where, create }: any) => {
        const existing = [...rows.values()].find((row) => row.diagnosticId === where.diagnosticId_dedupeKey.diagnosticId && row.dedupeKey === where.diagnosticId_dedupeKey.dedupeKey)
        if (existing) return withRelations(existing)
        const created = withRelations({ ...create, id: `cmsuggestion-created-${String(nextId++).padStart(6, '0')}`, acceptedObjectiveId: null, decisionNote: null, decidedAt: null, createdAt: now(), updatedAt: now() })
        rows.set(created.id, created)
        return created
      },
      findMany: async () => [...rows.values()].map(withRelations),
      findUnique: async ({ where: { id } }: any) => rows.has(id) ? withRelations(rows.get(id)) : null,
      updateMany: async ({ where, data }: any) => {
        const row = rows.get(where.id)
        if (!row || row.diagnosticId !== where.diagnosticId || row.status !== where.status) return { count: 0 }
        Object.assign(row, data, { updatedAt: now() })
        return { count: 1 }
      },
    },
    kpi: {
      findUnique: kpiFindUnique,
    },
    strategicObjective: {
      findUnique: async ({ where: { id } }: any) => hydrateObjective(id),
      findMany: async ({ where }: any = {}) => [...objectives.values()].filter((objective) => !where?.diagnosticId || objective.diagnosticId === where.diagnosticId).map((objective) => hydrateObjective(objective.id)),
      create: async ({ data }: any) => {
        const id = `cmobjective-suggestion-${String(nextObjectiveId++).padStart(6, '0')}`
        const created = {
          id,
          diagnosticId: data.diagnosticId,
          title: data.title,
          statement: data.statement,
          specificCriteria: data.specificCriteria,
          measurableCriteria: data.measurableCriteria,
          achievableCriteria: data.achievableCriteria,
          relevantCriteria: data.relevantCriteria,
          timeBoundCriteria: data.timeBoundCriteria,
          status: data.status ?? 'DRAFT',
          origin: data.origin,
          createdById: data.createdById,
          createdAt: now(),
          updatedAt: now(),
           indicators: (data.indicators?.create ?? (data.indicator?.create ? [data.indicator.create] : [])).map((indicator: any, index: number) => ({ id: `cmindicator-suggestion-${id}-${index + 1}`, objectiveId: id, ...indicator })),
           indicator: null,
        }
        objectives.set(id, created)
        return hydrateObjective(id)
      },
    },
    strategicObjectiveStrategy: {
      create: async ({ data }: any) => {
        if (failureState.strategyLink) throw new Error('Simulated strategy link failure')
        const link = { id: `cmlink-suggestion-${String(links.length + 1).padStart(6, '0')}`, ...data, linkedAt: now() }
        links.push(link)
        return link
      },
    },
    strategicObjectiveHistory: {
      create: async ({ data }: any) => {
        if (failureState.history) throw new Error('Simulated history failure')
        const event = { id: `cmhistory-suggestion-${String(nextHistoryId++).padStart(6, '0')}`, ...data, occurredAt: now() }
        histories.push(event)
        return event
      },
    },
  }
  let transactionTail = Promise.resolve()
  db.$transaction = (operation: (client: any) => Promise<unknown>) => {
    const execute = transactionTail.then(async () => {
      const rowsBefore = new Map([...rows.entries()].map(([id, row]) => [id, { ...row, originalPayload: structuredClone(row.originalPayload), editablePayload: structuredClone(row.editablePayload) }]))
       const objectivesBefore = new Map([...objectives.entries()].map(([id, objective]) => [id, { ...objective, indicators: (objective.indicators ?? []).map((indicator: any) => ({ ...indicator })), indicator: objective.indicator ? { ...objective.indicator } : null }]))
      const linksBefore = links.map((link) => ({ ...link }))
      const historiesBefore = histories.map((event) => ({ ...event }))
      const idsBefore = { nextId, nextObjectiveId, nextHistoryId }
      try {
        return await operation(db)
      } catch (error) {
        rows.clear()
        for (const [id, row] of rowsBefore) rows.set(id, row)
        objectives.clear()
        for (const [id, objective] of objectivesBefore) objectives.set(id, objective)
        links.splice(0, links.length, ...linksBefore)
        histories.splice(0, histories.length, ...historiesBefore)
        nextId = idsBefore.nextId
        nextObjectiveId = idsBefore.nextObjectiveId
        nextHistoryId = idsBefore.nextHistoryId
        throw error
      }
    })
    transactionTail = execute.then(() => undefined, () => undefined)
    return execute
  }
  return { app: createApp(db, aiService as unknown as AIService), db, rows, aiService, objectives, links, histories, failureState, strategyState, kpiFindUnique }
}

const auth = { Authorization: 'Bearer suggestion-test-token' }
const suggest = (app: ReturnType<typeof createApp>) => request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives/suggest`).set(auth).send({})
const accept = (app: ReturnType<typeof createApp>, id: string) => request(app).post(`/api/strategic-objective-suggestions/${id}/accept`).set(auth).send({})

describe('strategic objective suggestion API', () => {
  it('persists PENDING proposals with stable IDs and does not duplicate repeated generation', async () => {
    const harness = makeHarness()
    const first = await suggest(harness.app)
    const second = await suggest(harness.app)

    expect(first.status).toBe(200)
    expect(first.body.suggestions[0]).toMatchObject({ id: expect.stringContaining('cmsuggestion-created-'), status: 'PENDING', title: payload.title })
    expect(second.body.suggestions[0].id).toBe(first.body.suggestions[0].id)
    expect(harness.rows.size).toBe(1)
  })

  it('lists pending, accepted and rejected proposals only for the authorized diagnostic', async () => {
    const harness = makeHarness({ seedAccepted: true })
    const generated = await suggest(harness.app)
    await request(harness.app).post(`/api/strategic-objective-suggestions/${generated.body.suggestions[0].id}/reject`).set(auth).send({ decisionNote: 'No es prioritario' })

    const listed = await request(harness.app).get(`/api/diagnostics/${diagnosticId}/strategic-objective-suggestions`).set(auth)
    expect(listed.status).toBe(200)
    expect(listed.body.suggestions.map((item: { status: string }) => item.status)).toEqual(expect.arrayContaining(['ACCEPTED', 'REJECTED']))
    expect((await request(harness.app).get(`/api/diagnostics/${foreignDiagnosticId}/strategic-objective-suggestions`).set(auth)).status).toBe(404)
  })

  it('edits only editablePayload while preserving the original payload', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const editedPayload = { ...payload, title: 'Reducir respuesta con automatización' }
    const edited = await request(harness.app).patch(`/api/strategic-objective-suggestions/${generated.body.suggestions[0].id}`).set(auth).send({ editablePayload: editedPayload })

    expect(edited.status).toBe(200)
    expect(edited.body.suggestion.originalPayload.title).toBe(payload.title)
    expect(edited.body.suggestion.editablePayload.title).toBe(editedPayload.title)
    expect(harness.rows.get(generated.body.suggestions[0].id).status).toBe('PENDING')
  })

  it('rejects a proposal with note and refuses repeated or concurrent decisions', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const id = generated.body.suggestions[0].id
    const decisions = await Promise.all([
      request(harness.app).post(`/api/strategic-objective-suggestions/${id}/reject`).set(auth).send({ decisionNote: 'Descartada por el equipo' }),
      request(harness.app).post(`/api/strategic-objective-suggestions/${id}/reject`).set(auth).send({ decisionNote: 'Otra decisión' }),
    ])

    expect(decisions.map((response) => response.status).sort()).toEqual([200, 409])
    expect(harness.rows.get(id)).toMatchObject({ status: 'REJECTED', decisionNote: expect.any(String), decidedAt: expect.any(Date) })
    expect((await request(harness.app).patch(`/api/strategic-objective-suggestions/${id}`).set(auth).send({ editablePayload: payload })).status).toBe(409)
  })

  it('rejects writes for company users and hides another company diagnostic', async () => {
    const readOnly = makeHarness({ role: companyUser.role, user: companyUser })
    expect((await suggest(readOnly.app)).status).toBe(403)
    expect((await request(readOnly.app).get(`/api/diagnostics/${foreignDiagnosticId}/strategic-objective-suggestions`).set(auth)).status).toBe(404)

    const foreign = makeHarness({ user: foreignAdmin })
    expect((await suggest(foreign.app)).status).toBe(404)
  })

  it('rejects a Checky proposal whose strategy is not part of the diagnostic', async () => {
    const harness = makeHarness({ proposalStrategyRef: 'cross:foreign-strategy' })
    const response = await suggest(harness.app)

    expect(response.status).toBe(502)
    expect(harness.rows.size).toBe(0)
  })

  it('rejects malformed edits without changing the persisted proposal', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const response = await request(harness.app).patch(`/api/strategic-objective-suggestions/${generated.body.suggestions[0].id}`).set(auth).send({ editablePayload: { ...payload, indicator: { ...payload.indicator, deadline: '2026-02-30' } } })

    expect(response.status).toBe(400)
    expect(harness.rows.get(generated.body.suggestions[0].id).editablePayload.title).toBe(payload.title)
  })

  it('accepts a PENDING proposal atomically as a CHECKY DRAFT with indicator, strategy links and history', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const id = generated.body.suggestions[0].id

    const response = await accept(harness.app, id)

    expect(response.status).toBe(201)
    expect(response.body.objective).toMatchObject({ id: expect.stringContaining('cmobjective-suggestion-'), status: 'DRAFT', origin: 'CHECKY', title: payload.title })
    expect(response.body.objective.indicator).toMatchObject({ name: payload.indicator.name, targetValue: payload.indicator.targetValue })
    expect(response.body.objective.indicator).not.toHaveProperty('kpiId')
    expect(harness.kpiFindUnique).not.toHaveBeenCalled()
    expect(response.body.objective.strategies).toHaveLength(1)
    expect(response.body.objective.strategies[0]).toMatchObject({ source: 'STRATEGIC_CROSS', sourceRef: expect.any(String), weightedScore: 4.2 })
    expect(response.body.suggestion).toMatchObject({ id, status: 'ACCEPTED', acceptedObjectiveId: response.body.objective.id })
    expect(harness.histories.map((event) => event.eventType)).toEqual(['CREATED', 'STRATEGY_LINKED'])
    expect(harness.rows.get(id)).toMatchObject({ status: 'ACCEPTED', acceptedObjectiveId: response.body.objective.id })
  })

  it('persists all Checky indicators and keeps them independent after acceptance', async () => {
    const harness = makeHarness()
    const indicators = [
      payload.indicator,
      { ...payload.indicator, name: 'Cobertura de registros', targetValue: '98%' },
      { ...payload.indicator, name: 'Calidad de datos', targetValue: '99%' },
    ]
    harness.aiService.suggestStrategicObjectives.mockResolvedValueOnce({
      suggestions: [{ title: payload.title, statement: payload.statement, specificCriteria: payload.specificCriteria, measurableCriteria: payload.measurableCriteria, achievableCriteria: payload.achievableCriteria, relevantCriteria: payload.relevantCriteria, timeBoundCriteria: payload.timeBoundCriteria, indicators, strategyRefs: [`cross:${strategy.id}`] }],
      missingInformation: [],
    })
    const generated = await suggest(harness.app)
    expect(generated.status).toBe(200)
    expect(generated.body.suggestions[0].indicators).toHaveLength(3)

    const response = await accept(harness.app, generated.body.suggestions[0].id)
    expect(response.status).toBe(201)
    expect(response.body.objective.indicators).toHaveLength(3)
    expect(response.body.objective.indicators.map((indicator: { name: string }) => indicator.name)).toEqual(['Tiempo promedio de respuesta', 'Cobertura de registros', 'Calidad de datos'])
  })

  it('serializes concurrent acceptance and refuses repeated decisions without duplicating the objective', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const id = generated.body.suggestions[0].id

    const decisions = await Promise.all([accept(harness.app, id), accept(harness.app, id)])

    expect(decisions.map((response) => response.status).sort()).toEqual([201, 409])
    expect(harness.objectives.size).toBe(1)
    expect(harness.rows.get(id)).toMatchObject({ status: 'ACCEPTED', acceptedObjectiveId: expect.any(String) })
  })

  it('rejects legacy KPI references without changing the proposal', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const id = generated.body.suggestions[0].id
    const editedPayload = { ...payload, indicator: { ...payload.indicator, kpiId: '550e8400-e29b-41d4-a716-446655440002' } }
    const response = await request(harness.app).patch(`/api/strategic-objective-suggestions/${id}`).set(auth).send({ editablePayload: editedPayload })

    expect(response.status).toBe(400)
    expect(harness.objectives.size).toBe(0)
    expect(harness.rows.get(id).status).toBe('PENDING')
    expect(harness.rows.get(id).originalPayload.indicator).not.toHaveProperty('kpiId')
  })

  it('revalidates the linked strategy before creating an official objective', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const id = generated.body.suggestions[0].id
    harness.strategyState.strategyStatus = 'REJECTED'

    const response = await accept(harness.app, id)

    expect(response.status).toBe(409)
    expect(harness.objectives.size).toBe(0)
    expect(harness.rows.get(id).status).toBe('PENDING')
  })

  it('hides a proposal from another company during acceptance', async () => {
    const harness = makeHarness()
    const foreignId = 'cmsuggestion-foreign000001'
    harness.rows.set(foreignId, {
      id: foreignId,
      diagnosticId: foreignDiagnosticId,
      requestedById: foreignAdmin.id,
      originalPayload: payload,
      editablePayload: payload,
      strategyRefs: [`cross:${strategy.id}`],
      dedupeKey: 'foreign-key',
      status: 'PENDING',
      decisionNote: null,
      acceptedObjectiveId: null,
      decidedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await accept(harness.app, foreignId)

    expect(response.status).toBe(404)
    expect(harness.rows.get(foreignId).status).toBe('PENDING')
    expect(harness.objectives.size).toBe(0)
  })

  it('rolls back the objective, links, history and decision when any write fails', async () => {
    const harness = makeHarness()
    const generated = await suggest(harness.app)
    const id = generated.body.suggestions[0].id
    harness.failureState.history = true

    const response = await accept(harness.app, id)

    expect(response.status).toBe(500)
    expect(harness.objectives.size).toBe(0)
    expect(harness.links).toHaveLength(0)
    expect(harness.histories).toHaveLength(0)
    expect(harness.rows.get(id)).toMatchObject({ status: 'PENDING', acceptedObjectiveId: null })
  })
})

import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { createHash } from 'node:crypto'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { ActionItemStatus, Prisma, PrismaClient, Priority, CrossOrigin, CrossType, Role, TicketPriority, TicketStatus } from '@prisma/client'
import { env } from './env.js'
import { prisma } from './prisma.js'
import { authenticate, clearSessionCookie, createSession, publicUser, requireRole } from './auth.js'
import { AIService, AIServiceError, type CrossAnalysisResult, type GeneratedCrossForAI } from './ai-service.js'
import { getDashboardData } from './dashboard-service.js'
import { actionItemCreateSchema, actionItemUpdateSchema, actionPlanCreateSchema, actionPlanUpdateSchema, aiAnalysisSchema, companyCreateSchema, companyQuerySchema, companyUpdateSchema, crossAnalyzeSchema, crossAnalysisSchema, crossCreateSchema, crossTypeFor, crossUpdateSchema, diagnosticCreateSchema, diagnosticUpdateSchema, loginSchema, recommendationUpdateSchema, swotItemCreateSchema, swotItemUpdateSchema, ticketCreateSchema, ticketQuerySchema, ticketUpdateSchema, userCreateSchema, userUpdateSchema } from './validation.js'

const asyncHandler = (handler: RequestHandler): RequestHandler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)

const DUMMY_PASSWORD_HASH = '$2b$12$UjBgyzK627Qyclju5Vdtne3rVrXxGDHxvGqnZahRh5D9geupYld9y'

const userInclude = { createdBy: { select: { id: true, name: true, email: true, companyId: true } }, assignedTo: { select: { id: true, name: true, email: true, companyId: true } } } as const
const ticketView = (ticket: Prisma.TicketGetPayload<{ include: typeof userInclude }>) => ticket
const companyInclude = { users: { where: { role: Role.COMPANY_ADMIN }, select: { id: true, name: true, email: true, role: true, companyId: true }, take: 1 } } as const
const companyView = (company: Prisma.CompanyGetPayload<{ include: typeof companyInclude }>) => ({ id: company.id, name: company.name, identification: company.identification, industry: company.industry, description: company.description, admin: company.users[0] ?? null, createdAt: company.createdAt, updatedAt: company.updatedAt })
const diagnosticInclude = { company: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true, email: true } }, swotAnalysis: { include: { items: { orderBy: { createdAt: 'asc' } } } } } as const
const diagnosticView = (diagnostic: Prisma.QualityDiagnosticGetPayload<{ include: typeof diagnosticInclude }>) => diagnostic
const swotItemAccessInclude = { swot: { include: { diagnostic: { select: { companyId: true, company: { select: { id: true } } } } } } } as const
const swotItemView = (item: Prisma.SWOTItemGetPayload<{ include: typeof swotItemAccessInclude }>) => ({ id: item.id, swotId: item.swotId, type: item.type, description: item.description, createdAt: item.createdAt })
const aiAnalysisView = (analysis: { id: string; diagnosticId: string; executiveSummary: string; diagnosis: string; keyFindings: unknown; foStrategies: unknown; doStrategies: unknown; faStrategies: unknown; daStrategies: unknown; priorityRisks: unknown; priorityOpportunities: unknown; recommendations: unknown; createdAt: Date; updatedAt: Date }) => ({ id: analysis.id, diagnosticId: analysis.diagnosticId, ...aiAnalysisSchema.parse({ executiveSummary: analysis.executiveSummary, diagnosis: analysis.diagnosis, keyFindings: analysis.keyFindings, foStrategies: analysis.foStrategies, doStrategies: analysis.doStrategies, faStrategies: analysis.faStrategies, daStrategies: analysis.daStrategies, priorityRisks: analysis.priorityRisks, priorityOpportunities: analysis.priorityOpportunities, recommendations: analysis.recommendations }), createdAt: analysis.createdAt, updatedAt: analysis.updatedAt })
const recommendationView = (recommendation: { id: string; diagnosticId: string; title: string; description: string; priority: string; expectedImpact: string; suggestedAction: string; status: string; createdAt: Date; updatedAt: Date }) => recommendation
const actionItemInclude = { recommendation: { select: { id: true, title: true, priority: true, status: true } }, responsible: { select: { id: true, name: true, email: true } }, ticket: { select: { id: true } } } as const
const actionItemView = (item: Prisma.ActionItemGetPayload<{ include: typeof actionItemInclude }>) => item
const actionPlanInclude = { createdBy: { select: { id: true, name: true, email: true } }, items: { include: actionItemInclude, orderBy: { createdAt: 'asc' as const } } } as const
const actionPlanView = (plan: Prisma.ActionPlanGetPayload<{ include: typeof actionPlanInclude }>) => plan
const crossInclude = { factor1: true, factor2: true } as const
const crossFactorView = (item: { id: string; swotId: string; type: string; description: string; createdAt: Date }) => ({ id: item.id, swotId: item.swotId, type: item.type, description: item.description, createdAt: item.createdAt })
const crossView = (cross: Prisma.StrategicCrossGetPayload<{ include: typeof crossInclude }>) => ({
  id: cross.id,
  diagnosticId: cross.diagnosticId,
  crossType: cross.crossType,
  origin: cross.origin,
  factor1: crossFactorView(cross.factor1),
  factor2: crossFactorView(cross.factor2),
  strategy: cross.strategy,
  aiAnalysis: cross.aiAnalysis && crossAnalysisSchema.safeParse(cross.aiAnalysis).success ? crossAnalysisSchema.parse(cross.aiAnalysis) : null,
  priority: cross.priority,
  createdById: cross.createdById,
  createdAt: cross.createdAt,
  updatedAt: cross.updatedAt,
})

const scopeForUser = (request: Request): Prisma.TicketWhereInput => request.user?.role === Role.SUPERUSER ? {} : { OR: [{ createdBy: { companyId: request.user?.companyId ?? 'none' } }, { assignedTo: { companyId: request.user?.companyId ?? 'none' } }] }

const canAccessTicket = (request: Request, ticket: { createdBy: { companyId: string | null } | null; assignedTo: { companyId: string | null } | null }) => request.user?.role === Role.SUPERUSER || ticket.createdBy?.companyId === request.user?.companyId || ticket.assignedTo?.companyId === request.user?.companyId
const scopeForCompany = (request: Request): Prisma.CompanyWhereInput => request.user?.role === Role.SUPERUSER ? {} : { id: request.user?.companyId ?? 'none' }
const canAccessCompany = (request: Request, company: { id: string }) => request.user?.role === Role.SUPERUSER || company.id === request.user?.companyId

const actionItemToTicketStatus: Record<ActionItemStatus, TicketStatus> = {
  [ActionItemStatus.PENDING]: TicketStatus.OPEN,
  [ActionItemStatus.IN_PROGRESS]: TicketStatus.IN_PROGRESS,
  [ActionItemStatus.COMPLETED]: TicketStatus.RESOLVED,
  [ActionItemStatus.CANCELLED]: TicketStatus.CLOSED,
}

const actionItemToTicketPriority: Record<Priority, TicketPriority> = {
  [Priority.LOW]: TicketPriority.LOW,
  [Priority.MEDIUM]: TicketPriority.MEDIUM,
  [Priority.HIGH]: TicketPriority.HIGH,
}

const ticketDataFromActionItem = (item: { title: string; description: string; status: ActionItemStatus; priority: Priority; responsibleId: string | null; dueDate: Date | null; actionItemId: string; createdById: string }) => ({
  title: item.title,
  description: item.description,
  status: actionItemToTicketStatus[item.status],
  priority: actionItemToTicketPriority[item.priority],
  assignedToId: item.responsibleId,
  dueDate: item.dueDate,
  actionItemId: item.actionItemId,
  createdById: item.createdById,
})

export const createApp = (db: PrismaClient = prisma, aiService: AIService = new AIService()) => {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', env.TRUST_PROXY_HOPS)
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
    response.setHeader('Cache-Control', 'no-store')
    if (env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  })

  const authMiddleware = authenticate(db)
  const userWriteGuard = requireRole(Role.SUPERUSER, Role.COMPANY_ADMIN)
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts' } })
  const aiAnalysisLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many AI analysis requests' } })

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

  app.post('/api/auth/login', loginLimiter, asyncHandler(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid credentials format' })
      return
    }
    const user = await db.user.findUnique({ where: { email: parsed.data.email } })
    const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !valid) {
      response.status(401).json({ error: 'Invalid email or password' })
      return
    }
    await createSession(db, user.id, response)
    response.json({ user: publicUser(user) })
  }))

  app.post('/api/auth/logout', asyncHandler(async (request, response) => {
    const token = request.cookies?.[env.SESSION_COOKIE]
    if (token) {
      await db.session.deleteMany({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })
    }
    clearSessionCookie(response)
    response.status(204).send()
  }))

  app.get('/api/auth/me', authMiddleware, (request, response) => response.json({ user: request.user }))

  app.get('/api/users', authMiddleware, asyncHandler(async (request, response) => {
    const where: Prisma.UserWhereInput = request.user?.role === Role.SUPERUSER ? {} : { companyId: request.user?.companyId ?? 'none' }
    const users = await db.user.findMany({ where, select: { id: true, name: true, role: true, companyId: true }, orderBy: { name: 'asc' } })
    response.json({ users })
  }))

  app.post('/api/users', authMiddleware, asyncHandler(async (request, response) => {
    if (request.user?.role === Role.COMPANY_USER) {
      response.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    const parsed = userCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid user data', details: parsed.error.issues })
      return
    }
    const { password, role, companyId: requestedCompanyId } = parsed.data
    if (role === Role.SUPERUSER) {
      response.status(403).json({ error: 'Superuser accounts cannot be created from the application' })
      return
    }
    let companyId = requestedCompanyId ?? null
    if (request.user?.role === Role.COMPANY_ADMIN) {
      if (role !== Role.COMPANY_USER) {
        response.status(403).json({ error: 'Company admins can only create company users' })
        return
      }
      if (requestedCompanyId !== undefined && requestedCompanyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only create users for your own company' })
        return
      }
      companyId = request.user?.companyId ?? null
    } else if (!companyId) {
      response.status(400).json({ error: 'A company is required for company roles' })
      return
    }
    if (companyId) {
      const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true } })
      if (!company) {
        response.status(400).json({ error: 'Company not found' })
        return
      }
    }
    const user = await db.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await bcrypt.hash(password, 12), role, companyId }, select: { id: true, name: true, email: true, role: true, companyId: true } })
    response.status(201).json({ user })
  }))

  app.patch('/api/users/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = userUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid user data', details: parsed.error.issues })
      return
    }
    const existing = await db.user.findUnique({ where: { id: String(request.params.id) }, select: { id: true, role: true, companyId: true } })
    if (!existing) {
      response.status(404).json({ error: 'User not found' })
      return
    }
    if (request.user?.role === Role.COMPANY_ADMIN) {
      if (existing.companyId !== request.user.companyId || existing.role !== Role.COMPANY_USER) {
        response.status(404).json({ error: 'User not found' })
        return
      }
      if (parsed.data.role && parsed.data.role !== Role.COMPANY_USER) {
        response.status(403).json({ error: 'Company admins can only manage company users' })
        return
      }
      if (parsed.data.companyId !== undefined && parsed.data.companyId !== request.user.companyId) {
        response.status(403).json({ error: 'You can only manage users of your own company' })
        return
      }
    } else if (request.user?.role === Role.SUPERUSER) {
      if (parsed.data.role === Role.SUPERUSER) {
        response.status(403).json({ error: 'Superuser accounts cannot be created from the application' })
        return
      }
      if (existing.role === Role.SUPERUSER && (parsed.data.role || parsed.data.companyId !== undefined)) {
        response.status(403).json({ error: 'A superuser account cannot change its role or company' })
        return
      }
    }
    const finalRole = parsed.data.role ?? existing.role
    const finalCompanyId = parsed.data.companyId !== undefined ? parsed.data.companyId : existing.companyId
    if (finalRole !== Role.SUPERUSER && !finalCompanyId) {
      response.status(400).json({ error: 'A company is required for company roles' })
      return
    }
    if (finalRole === Role.SUPERUSER && finalCompanyId) {
      response.status(400).json({ error: 'A superuser cannot belong to a company' })
      return
    }
    const data: { name?: string; email?: string; passwordHash?: string; role?: Role; companyId?: string | null } = {}
    if (parsed.data.name) data.name = parsed.data.name
    if (parsed.data.email) data.email = parsed.data.email
    if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 12)
    if (parsed.data.role && parsed.data.role !== existing.role) data.role = parsed.data.role
    if (parsed.data.companyId !== undefined && parsed.data.companyId !== existing.companyId) data.companyId = parsed.data.companyId
    const user = await db.user.update({ where: { id: existing.id }, data, select: { id: true, name: true, email: true, role: true, companyId: true } })
    response.json({ user })
  }))

  app.delete('/api/users/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.user.findUnique({ where: { id: String(request.params.id) }, select: { id: true, role: true, companyId: true } })
    if (!existing) {
      response.status(404).json({ error: 'User not found' })
      return
    }
    if (request.user?.role === Role.COMPANY_ADMIN) {
      if (existing.companyId !== request.user.companyId || existing.role !== Role.COMPANY_USER) {
        response.status(404).json({ error: 'User not found' })
        return
      }
    }
    if (existing.role === Role.SUPERUSER) {
      response.status(403).json({ error: 'Superuser accounts cannot be deleted' })
      return
    }
    if (existing.id === request.user?.id) {
      response.status(403).json({ error: 'You cannot delete your own account' })
      return
    }
    await db.user.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/companies', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = companyQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid company filters', details: parsed.error.issues })
      return
    }
    const where: Prisma.CompanyWhereInput = scopeForCompany(request)
    if (parsed.data.search) {
      where.OR = [
        { name: { contains: parsed.data.search, mode: 'insensitive' } },
        { identification: { contains: parsed.data.search, mode: 'insensitive' } },
        { industry: { contains: parsed.data.search, mode: 'insensitive' } },
      ]
    }
    const companies = await db.company.findMany({ where, include: companyInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ companies: companies.map(companyView) })
  }))

  app.post('/api/companies', authMiddleware, requireRole(Role.SUPERUSER), asyncHandler(async (request, response) => {
    const parsed = companyCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid company data', details: parsed.error.issues })
      return
    }
    const admin = parsed.data.admin
    const company = await db.company.create({
      data: {
        name: parsed.data.name,
        identification: parsed.data.identification,
        industry: parsed.data.industry,
        description: parsed.data.description,
        ...(admin ? { users: { create: { name: admin.name, email: admin.email, passwordHash: await bcrypt.hash(admin.password, 12), role: Role.COMPANY_ADMIN } } } : {}),
      },
      include: companyInclude,
    })
    response.status(201).json({ company: companyView(company) })
  }))

  app.get('/api/companies/:id', authMiddleware, asyncHandler(async (request, response) => {
    const company = await db.company.findUnique({ where: { id: String(request.params.id) }, include: companyInclude })
    if (!company || !canAccessCompany(request, company)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    response.json({ company: companyView(company) })
  }))

  app.patch('/api/companies/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = companyUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid company data', details: parsed.error.issues })
      return
    }
    const existing = await db.company.findUnique({ where: { id: String(request.params.id) }, select: { id: true } })
    if (!existing || !canAccessCompany(request, existing)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const company = await db.company.update({ where: { id: existing.id }, data: parsed.data, include: companyInclude })
    response.json({ company: companyView(company) })
  }))

  app.delete('/api/companies/:id', authMiddleware, requireRole(Role.SUPERUSER), asyncHandler(async (request, response) => {
    const existing = await db.company.findUnique({ where: { id: String(request.params.id) }, select: { id: true } })
    if (!existing) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    await db.company.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/companies/:companyId/diagnostics', authMiddleware, asyncHandler(async (request, response) => {
    const company = await db.company.findUnique({ where: { id: String(request.params.companyId) }, select: { id: true } })
    if (!company || !canAccessCompany(request, company)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const diagnostics = await db.qualityDiagnostic.findMany({ where: { companyId: company.id }, include: diagnosticInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ diagnostics: diagnostics.map(diagnosticView) })
  }))

  app.post('/api/companies/:companyId/diagnostics', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = diagnosticCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid diagnostic data', details: parsed.error.issues })
      return
    }
    const company = await db.company.findUnique({ where: { id: String(request.params.companyId) }, select: { id: true } })
    if (!company || !canAccessCompany(request, company)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const diagnostic = await db.qualityDiagnostic.create({
      data: { companyId: company.id, title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, createdById: request.user!.id, swotAnalysis: { create: {} } },
      include: diagnosticInclude,
    })
    response.status(201).json({ diagnostic: diagnosticView(diagnostic) })
  }))

  app.get('/api/diagnostics/:id', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: diagnosticInclude })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    response.json({ diagnostic: diagnosticView(diagnostic) })
  }))

  app.patch('/api/diagnostics/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = diagnosticUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid diagnostic data', details: parsed.error.issues })
      return
    }
    const existing = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!existing || !canAccessCompany(request, existing.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const diagnostic = await db.qualityDiagnostic.update({ where: { id: existing.id }, data: parsed.data, include: diagnosticInclude })
    response.json({ diagnostic: diagnosticView(diagnostic) })
  }))

  app.delete('/api/diagnostics/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!existing || !canAccessCompany(request, existing.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    await db.qualityDiagnostic.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.post('/api/diagnostics/:id/swot/items', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = swotItemCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid SWOT item data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } }, swotAnalysis: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    if (!diagnostic.swotAnalysis) {
      response.status(409).json({ error: 'Diagnostic SWOT analysis is unavailable' })
      return
    }
    const item = await db.sWOTItem.create({ data: { type: parsed.data.type, description: parsed.data.description, swotId: diagnostic.swotAnalysis.id }, include: swotItemAccessInclude })
    response.status(201).json({ item: swotItemView(item) })
  }))

  app.patch('/api/swot/items/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = swotItemUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid SWOT item data', details: parsed.error.issues })
      return
    }
    const existing = await db.sWOTItem.findUnique({ where: { id: String(request.params.id) }, include: swotItemAccessInclude })
    if (!existing || !canAccessCompany(request, existing.swot.diagnostic.company)) {
      response.status(404).json({ error: 'SWOT item not found' })
      return
    }
    const item = await db.sWOTItem.update({ where: { id: existing.id }, data: parsed.data, include: swotItemAccessInclude })
    response.json({ item: swotItemView(item) })
  }))

  app.delete('/api/swot/items/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.sWOTItem.findUnique({ where: { id: String(request.params.id) }, include: swotItemAccessInclude })
    if (!existing || !canAccessCompany(request, existing.swot.diagnostic.company)) {
      response.status(404).json({ error: 'SWOT item not found' })
      return
    }
    await db.sWOTItem.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/diagnostics/:id/crosses', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const crosses = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ crosses: crosses.map(crossView) })
  }))

  app.post('/api/diagnostics/:id/crosses', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = crossCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid cross data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({
      where: { id: String(request.params.id) },
      include: { company: { select: { id: true } }, swotAnalysis: { include: { items: { select: { id: true, type: true } } } } },
    })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    if (!diagnostic.swotAnalysis) {
      response.status(409).json({ error: 'Diagnostic SWOT analysis is unavailable' })
      return
    }
    const items = diagnostic.swotAnalysis.items
    const factor1 = items.find((item) => item.id === parsed.data.factor1Id)
    const factor2 = items.find((item) => item.id === parsed.data.factor2Id)
    if (!factor1 || !factor2) {
      response.status(400).json({ error: 'Both factors must belong to this diagnostic' })
      return
    }
    if (factor1.id === factor2.id) {
      response.status(400).json({ error: 'Factors must be different' })
      return
    }
    const crossType = crossTypeFor(factor1.type, factor2.type)
    if (!crossType) {
      response.status(400).json({ error: 'These factors do not form a valid strategic cross (FO, DO, FA or DA)' })
      return
    }
    const internal = factor1.type === 'STRENGTH' || factor1.type === 'WEAKNESS' ? factor1 : factor2
    const external = internal.id === factor1.id ? factor2 : factor1
    const existing = await db.strategicCross.findUnique({ where: { factor1Id_factor2Id: { factor1Id: internal.id, factor2Id: external.id } } })
    if (existing) {
      response.status(409).json({ error: 'A strategic cross between these factors already exists' })
      return
    }
    const cross = await db.strategicCross.create({
      data: { diagnosticId: diagnostic.id, crossType: crossType as CrossType, origin: 'USER', factor1Id: internal.id, factor2Id: external.id, strategy: parsed.data.strategy ?? null, createdById: request.user!.id },
      include: crossInclude,
    })
    response.status(201).json({ cross: crossView(cross) })
  }))

  app.patch('/api/crosses/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = crossUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid cross data', details: parsed.error.issues })
      return
    }
    const existing = await db.strategicCross.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Cross not found' })
      return
    }
    const cross = await db.strategicCross.update({ where: { id: existing.id }, data: parsed.data, include: crossInclude })
    response.json({ cross: crossView(cross) })
  }))

  app.delete('/api/crosses/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.strategicCross.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Cross not found' })
      return
    }
    await db.strategicCross.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.post('/api/diagnostics/:id/crosses/generate', authMiddleware, userWriteGuard, aiAnalysisLimiter, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: diagnosticInclude })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const items = diagnostic.swotAnalysis?.items ?? []
    if (items.length === 0) {
      response.status(400).json({ error: 'Add at least one SWOT factor before generating crosses' })
      return
    }
    let generated: GeneratedCrossForAI[]
    try {
      generated = await aiService.generateCrosses(items.map((item) => ({ id: item.id, type: item.type, description: item.description })))
    } catch (error) {
      if (error instanceof AIServiceError) {
        response.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.code === 'NOT_CONFIGURED' ? 'AI analysis is not configured' : 'AI returned an invalid analysis' })
        return
      }
      throw error
    }
    const existingCrosses = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, select: { id: true, factor1Id: true, factor2Id: true, origin: true, strategy: true } })
    const existingByPair = new Map(existingCrosses.map((existing) => [`${existing.factor1Id}:${existing.factor2Id}`, existing]))
    const typeById = new Map(items.map((item) => [item.id, item.type]))
    const seenPairs = new Set<string>()
    for (const cross of generated) {
      const type1 = typeById.get(cross.factor1Id)
      const ordered = type1 === 'STRENGTH' || type1 === 'WEAKNESS' ? { factor1Id: cross.factor1Id, factor2Id: cross.factor2Id } : { factor1Id: cross.factor2Id, factor2Id: cross.factor1Id }
      const pairKey = `${ordered.factor1Id}:${ordered.factor2Id}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      const existing = existingByPair.get(pairKey)
      if (existing) {
        if (existing.origin !== 'BOTH' || !existing.strategy) {
          await db.strategicCross.update({ where: { id: existing.id }, data: { origin: 'BOTH', strategy: existing.strategy ?? cross.strategy } })
        }
        continue
      }
      await db.strategicCross.create({ data: { diagnosticId: diagnostic.id, crossType: cross.type, origin: 'AI', factor1Id: ordered.factor1Id, factor2Id: ordered.factor2Id, strategy: cross.strategy, createdById: request.user!.id } })
    }
    const crosses = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ crosses: crosses.map(crossView) })
  }))

  app.post('/api/diagnostics/:id/crosses/analyze', authMiddleware, userWriteGuard, aiAnalysisLimiter, asyncHandler(async (request, response) => {
    const parsed = crossAnalyzeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid cross analysis request', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const where: Prisma.StrategicCrossWhereInput = { diagnosticId: diagnostic.id }
    if (parsed.data?.crosses) where.id = { in: parsed.data.crosses }
    if (parsed.data?.origin) where.origin = parsed.data.origin as CrossOrigin
    const crosses = await db.strategicCross.findMany({ where, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    if (crosses.length === 0) {
      response.status(400).json({ error: 'There are no crosses to analyze yet' })
      return
    }
    let analyses: Array<{ crossId: string; analysis: CrossAnalysisResult }>
    try {
      analyses = await aiService.analyzeCrosses(crosses.map((cross) => ({ id: cross.id, type: cross.crossType, origin: cross.origin, strategy: cross.strategy, factor1: { type: cross.factor1.type, description: cross.factor1.description }, factor2: { type: cross.factor2.type, description: cross.factor2.description } })))
    } catch (error) {
      if (error instanceof AIServiceError) {
        response.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.code === 'NOT_CONFIGURED' ? 'AI analysis is not configured' : 'AI returned an invalid analysis' })
        return
      }
      throw error
    }
    await Promise.all(analyses.map(async (entry) => {
      const cross = crosses.find((item) => item.id === entry.crossId)
      if (!cross) return
      await db.strategicCross.update({ where: { id: cross.id }, data: { aiAnalysis: entry.analysis, priority: entry.analysis.priority } })
    }))
    const updated = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ crosses: updated.map(crossView) })
  }))

  app.post('/api/diagnostics/:id/ai-analysis', authMiddleware, userWriteGuard, aiAnalysisLimiter, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: diagnosticInclude })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    let result
    try {
      result = await aiService.analyze({
        title: diagnostic.title,
        description: diagnostic.description,
        status: diagnostic.status,
        swotItems: diagnostic.swotAnalysis?.items.map((item) => ({ type: item.type, description: item.description })) ?? [],
      })
    } catch (error) {
      if (error instanceof AIServiceError) {
        if (error.code === 'NOT_CONFIGURED') {
          response.status(503).json({ error: 'AI analysis is not configured' })
          return
        }
        if (error.code === 'INVALID_RESPONSE') {
          response.status(502).json({ error: 'AI returned an invalid analysis' })
          return
        }
        response.status(502).json({ error: 'AI analysis is temporarily unavailable' })
        return
      }
      throw error
    }
    const analysis = await db.aIAnalysis.upsert({
      where: { diagnosticId: diagnostic.id },
      create: { diagnosticId: diagnostic.id, ...result },
      update: { ...result },
    })
    response.json({ analysis: aiAnalysisView(analysis) })
  }))

  app.get('/api/diagnostics/:id/ai-analysis', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const analysis = await db.aIAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } })
    if (!analysis) {
      response.status(404).json({ error: 'AI analysis not found' })
      return
    }
    response.json({ analysis: aiAnalysisView(analysis) })
  }))

  app.get('/api/diagnostics/:id/recommendations', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const recommendations = await db.recommendation.findMany({ where: { diagnosticId: diagnostic.id }, orderBy: { createdAt: 'desc' } })
    response.json({ recommendations: recommendations.map(recommendationView) })
  }))

  app.post('/api/diagnostics/:id/recommendations/import', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const analysis = await db.aIAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } })
    if (!analysis) {
      response.status(404).json({ error: 'AI analysis not found' })
      return
    }
    const aiRecommendations = aiAnalysisSchema.parse({ executiveSummary: analysis.executiveSummary, diagnosis: analysis.diagnosis, keyFindings: analysis.keyFindings, foStrategies: analysis.foStrategies, doStrategies: analysis.doStrategies, faStrategies: analysis.faStrategies, daStrategies: analysis.daStrategies, priorityRisks: analysis.priorityRisks, priorityOpportunities: analysis.priorityOpportunities, recommendations: analysis.recommendations }).recommendations
    const existing = await db.recommendation.findMany({ where: { diagnosticId: diagnostic.id }, select: { title: true } })
    const existingTitles = new Set(existing.map((item) => item.title))
    const toImport = aiRecommendations.filter((recommendation) => !existingTitles.has(recommendation.title))
    const imported = await Promise.all(toImport.map((recommendation) => db.recommendation.create({ data: { diagnosticId: diagnostic.id, ...recommendation } })))
    response.json({ imported: imported.map(recommendationView), skipped: aiRecommendations.length - imported.length })
  }))

  app.patch('/api/recommendations/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = recommendationUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid recommendation data', details: parsed.error.issues })
      return
    }
    const existing = await db.recommendation.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Recommendation not found' })
      return
    }
    const recommendation = await db.recommendation.update({ where: { id: existing.id }, data: parsed.data })
    response.json({ recommendation: recommendationView(recommendation) })
  }))

  app.get('/api/diagnostics/:id/action-plans', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const actionPlans = await db.actionPlan.findMany({ where: { diagnosticId: diagnostic.id }, include: actionPlanInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ actionPlans: actionPlans.map(actionPlanView) })
  }))

  app.post('/api/diagnostics/:id/action-plans', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionPlanCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action plan data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const actionPlan = await db.actionPlan.create({ data: { diagnosticId: diagnostic.id, title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, createdById: request.user!.id }, include: actionPlanInclude })
    response.status(201).json({ actionPlan: actionPlanView(actionPlan) })
  }))

  app.get('/api/action-plans/:id', authMiddleware, asyncHandler(async (request, response) => {
    const actionPlan = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, include: { ...actionPlanInclude, diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!actionPlan || !canAccessCompany(request, actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    response.json({ actionPlan: actionPlanView(actionPlan) })
  }))

  app.patch('/api/action-plans/:id', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionPlanUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action plan data', details: parsed.error.issues })
      return
    }
    const existing = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    const actionPlan = await db.actionPlan.update({ where: { id: existing.id }, data: parsed.data, include: actionPlanInclude })
    response.json({ actionPlan: actionPlanView(actionPlan) })
  }))

  app.delete('/api/action-plans/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    await db.actionPlan.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.post('/api/action-plans/:id/items', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionItemCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action item data', details: parsed.error.issues })
      return
    }
    const actionPlan = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, select: { id: true, diagnosticId: true, diagnostic: { select: { company: { select: { id: true } } } } } })
    if (!actionPlan || !canAccessCompany(request, actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    if (parsed.data.recommendationId) {
      const recommendation = await db.recommendation.findUnique({ where: { id: parsed.data.recommendationId }, select: { diagnosticId: true } })
      if (!recommendation || recommendation.diagnosticId !== actionPlan.diagnosticId) {
        response.status(400).json({ error: 'Recommendation not found for this diagnostic' })
        return
      }
    }
    if (parsed.data.responsibleId) {
      const responsible = await db.user.findUnique({ where: { id: parsed.data.responsibleId }, select: { id: true, companyId: true } })
      if (!responsible) {
        response.status(400).json({ error: 'Responsible user not found' })
        return
      }
      if (request.user?.role !== Role.SUPERUSER && responsible.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign responsibilities to users of your own company' })
        return
      }
    }
    const { item, ticket } = await db.$transaction(async (tx) => {
      const created = await tx.actionItem.create({ data: { actionPlanId: actionPlan.id, ...parsed.data }, include: actionItemInclude })
      const existingTicket = await tx.ticket.findUnique({ where: { actionItemId: created.id }, include: userInclude })
      const linkedTicket = existingTicket ?? await tx.ticket.create({ data: ticketDataFromActionItem({ title: created.title, description: created.description, status: created.status, priority: created.priority, responsibleId: created.responsibleId, dueDate: created.dueDate, actionItemId: created.id, createdById: request.user!.id }), include: userInclude })
      return { item: created, ticket: linkedTicket }
    })
    response.status(201).json({ item: actionItemView(item), ticket: ticketView(ticket) })
  }))

  app.patch('/api/action-items/:id', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionItemUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action item data', details: parsed.error.issues })
      return
    }
    const existing = await db.actionItem.findUnique({ where: { id: String(request.params.id) }, include: { actionPlan: { include: { diagnostic: { include: { company: { select: { id: true } } } } } } } })
    if (!existing || !canAccessCompany(request, existing.actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action item not found' })
      return
    }
    if (parsed.data.recommendationId) {
      const recommendation = await db.recommendation.findUnique({ where: { id: parsed.data.recommendationId }, select: { diagnosticId: true } })
      if (!recommendation || recommendation.diagnosticId !== existing.actionPlan.diagnosticId) {
        response.status(400).json({ error: 'Recommendation not found for this diagnostic' })
        return
      }
    }
    if (parsed.data.responsibleId) {
      const responsible = await db.user.findUnique({ where: { id: parsed.data.responsibleId }, select: { id: true, companyId: true } })
      if (!responsible) {
        response.status(400).json({ error: 'Responsible user not found' })
        return
      }
      if (request.user?.role !== Role.SUPERUSER && responsible.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign responsibilities to users of your own company' })
        return
      }
    }
    const item = await db.$transaction(async (tx) => {
      const updated = await tx.actionItem.update({ where: { id: existing.id }, data: parsed.data, include: actionItemInclude })
      const linked = await tx.ticket.findUnique({ where: { actionItemId: updated.id }, select: { id: true } })
      const ticketData: Prisma.TicketUncheckedUpdateInput = {}
      if (parsed.data.title !== undefined) ticketData.title = parsed.data.title
      if (parsed.data.description !== undefined) ticketData.description = parsed.data.description
      if (parsed.data.priority !== undefined) ticketData.priority = actionItemToTicketPriority[parsed.data.priority]
      if (parsed.data.responsibleId !== undefined) ticketData.assignedToId = parsed.data.responsibleId
      if (parsed.data.dueDate !== undefined) ticketData.dueDate = parsed.data.dueDate
      if (parsed.data.status !== undefined) ticketData.status = actionItemToTicketStatus[parsed.data.status]
      if (linked) {
        if (Object.keys(ticketData).length > 0) {
          await tx.ticket.update({ where: { id: linked.id }, data: ticketData })
        }
      } else {
        await tx.ticket.create({ data: ticketDataFromActionItem({ title: updated.title, description: updated.description, status: updated.status, priority: updated.priority, responsibleId: updated.responsibleId, dueDate: updated.dueDate, actionItemId: updated.id, createdById: request.user!.id }) })
      }
      return updated
    })
    response.json({ item: actionItemView(item) })
  }))

  app.delete('/api/action-items/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.actionItem.findUnique({ where: { id: String(request.params.id) }, include: { actionPlan: { include: { diagnostic: { include: { company: { select: { id: true } } } } } } } })
    if (!existing || !canAccessCompany(request, existing.actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action item not found' })
      return
    }
    await db.$transaction(async (tx) => {
      const linked = await tx.ticket.findUnique({ where: { actionItemId: existing.id }, select: { id: true } })
      if (linked) {
        await tx.ticket.delete({ where: { id: linked.id } })
      }
      await tx.actionItem.delete({ where: { id: existing.id } })
    })
    response.status(204).send()
  }))

  app.get('/api/tickets', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = ticketQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid filters', details: parsed.error.issues })
      return
    }
    const { status, priority, search } = parsed.data
    const where: Prisma.TicketWhereInput = { ...scopeForUser(request), ...(status ? { status } : {}), ...(priority ? { priority } : {}) }
    if (search) where.AND = [{ OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] }]
    const tickets = await db.ticket.findMany({ where, include: userInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ tickets: tickets.map(ticketView) })
  }))

  const canAssignTickets = (request: Request) => request.user?.role === Role.SUPERUSER || request.user?.role === Role.COMPANY_ADMIN

  app.post('/api/tickets', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = ticketCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid ticket data', details: parsed.error.issues })
      return
    }
    if (parsed.data.assignedToId !== undefined && !canAssignTickets(request)) {
      response.status(403).json({ error: 'Only company admins and superusers can assign tickets' })
      return
    }
    if (parsed.data.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: parsed.data.assignedToId }, select: { id: true, companyId: true } })
      if (!assignee) {
        response.status(400).json({ error: 'Assigned user not found' })
        return
      }
      if (request.user?.role === Role.COMPANY_ADMIN && assignee.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign tickets to users of your own company' })
        return
      }
    }
    const ticket = await db.ticket.create({ data: { title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, priority: parsed.data.priority, createdById: request.user!.id, assignedToId: parsed.data.assignedToId }, include: userInclude })
    response.status(201).json({ ticket: ticketView(ticket) })
  }))

  app.get('/api/tickets/:id', authMiddleware, asyncHandler(async (request, response) => {
    const ticket = await db.ticket.findUnique({ where: { id: String(request.params.id) }, include: userInclude })
    if (!ticket || !canAccessTicket(request, ticket)) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    response.json({ ticket: ticketView(ticket) })
  }))

  app.patch('/api/tickets/:id', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = ticketUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid ticket data', details: parsed.error.issues })
      return
    }
    const existing = await db.ticket.findUnique({ where: { id: String(request.params.id) }, include: userInclude })
    if (!existing || !canAccessTicket(request, existing)) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    if (parsed.data.assignedToId !== undefined && !canAssignTickets(request)) {
      response.status(403).json({ error: 'Only company admins and superusers can assign tickets' })
      return
    }
    if (parsed.data.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: parsed.data.assignedToId }, select: { id: true, companyId: true } })
      if (!assignee) {
        response.status(400).json({ error: 'Assigned user not found' })
        return
      }
      if (request.user?.role === Role.COMPANY_ADMIN && assignee.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign tickets to users of your own company' })
        return
      }
    }
    const ticket = await db.ticket.update({ where: { id: existing.id }, data: parsed.data, include: userInclude })
    response.json({ ticket: ticketView(ticket) })
  }))

  app.delete('/api/tickets/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.ticket.findUnique({
      where: { id: String(request.params.id) },
      select: { id: true, createdById: true, assignedToId: true, createdBy: { select: { companyId: true } }, assignedTo: { select: { companyId: true } } },
    })
    if (!existing || !canAccessTicket(request, existing)) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    if (request.user?.role !== Role.SUPERUSER && existing.createdById !== request.user?.id) {
      response.status(403).json({ error: 'Only the creator or a superuser can delete a ticket' })
      return
    }
    await db.ticket.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/dashboard', authMiddleware, asyncHandler(async (request, response) => {
    const dashboard = await getDashboardData(db, request)
    response.json(dashboard)
  }))

  app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Invalid JSON body' })
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      response.status(409).json({ error: 'A resource with that value already exists' })
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      response.status(409).json({ error: 'The resource cannot be deleted because it is referenced by other records' })
      return
    }
    console.error(error instanceof Error ? error.message : error)
    response.status(500).json({ error: 'Internal server error' })
  })
  return app
}

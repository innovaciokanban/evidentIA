import type { Request } from 'express'
import { Prisma, PrismaClient, Role } from '@prisma/client'

export type DashboardScopes = {
  company: Prisma.CompanyWhereInput
  diagnostic: Prisma.QualityDiagnosticWhereInput
  recommendation: Prisma.RecommendationWhereInput
  actionPlan: Prisma.ActionPlanWhereInput
  actionItem: Prisma.ActionItemWhereInput
}

const globalScopes: DashboardScopes = { company: {}, diagnostic: {}, recommendation: {}, actionPlan: {}, actionItem: {} }

const scopedToCompany = (companyId: string | undefined): DashboardScopes => ({
  company: { id: companyId },
  diagnostic: { company: { id: companyId } },
  recommendation: { diagnostic: { company: { id: companyId } } },
  actionPlan: { diagnostic: { company: { id: companyId } } },
  actionItem: { actionPlan: { diagnostic: { company: { id: companyId } } } },
})

export const dashboardScopesFor = (request: Request): DashboardScopes => request.user?.role === Role.SUPERUSER ? globalScopes : scopedToCompany(request.user?.companyId ?? undefined)

export const getDashboardData = async (db: PrismaClient, request: Request) => {
  const scopes = dashboardScopesFor(request)
  const now = new Date()
  const openItemStatuses: Prisma.EnumActionItemStatusFilter = { in: ['PENDING', 'IN_PROGRESS'] }
  const [totalCompanies, totalDiagnostics, draftDiagnostics, inProgressDiagnostics, completedDiagnostics, pendingRecommendations, activeActionPlans, pendingActionItems, overdueActionItems, recentDiagnostics, priorityRecommendations, upcomingActions, recentCompanies] = await Promise.all([
    db.company.count({ where: scopes.company }),
    db.qualityDiagnostic.count({ where: scopes.diagnostic }),
    db.qualityDiagnostic.count({ where: { AND: [scopes.diagnostic, { status: 'DRAFT' }] } }),
    db.qualityDiagnostic.count({ where: { AND: [scopes.diagnostic, { status: 'IN_PROGRESS' }] } }),
    db.qualityDiagnostic.count({ where: { AND: [scopes.diagnostic, { status: 'COMPLETED' }] } }),
    db.recommendation.count({ where: { AND: [scopes.recommendation, { status: 'PENDING' }] } }),
    db.actionPlan.count({ where: { AND: [scopes.actionPlan, { status: 'ACTIVE' }] } }),
    db.actionItem.count({ where: { AND: [scopes.actionItem, { status: openItemStatuses }] } }),
    db.actionItem.count({ where: { AND: [scopes.actionItem, { status: openItemStatuses, dueDate: { lt: now } }] } }),
    db.qualityDiagnostic.findMany({ where: scopes.diagnostic, include: { company: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    db.recommendation.findMany({ where: { AND: [scopes.recommendation, { status: 'PENDING' }] }, include: { diagnostic: { select: { id: true, title: true, company: { select: { id: true, name: true } } } } }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 5 }),
    db.actionItem.findMany({ where: { AND: [scopes.actionItem, { status: openItemStatuses, dueDate: { gte: now } }] }, include: { actionPlan: { select: { id: true, title: true, diagnostic: { select: { id: true, title: true, company: { select: { id: true, name: true } } } } } }, responsible: { select: { id: true, name: true } } }, orderBy: { dueDate: 'asc' }, take: 5 }),
    db.company.findMany({ where: scopes.company, include: { users: { where: { role: Role.COMPANY_ADMIN }, select: { id: true, name: true }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 5 }),
  ])
  return {
    summary: { totalCompanies, totalDiagnostics, draftDiagnostics, inProgressDiagnostics, completedDiagnostics, pendingRecommendations, activeActionPlans, pendingActionItems, overdueActionItems },
    recentDiagnostics,
    priorityRecommendations,
    upcomingActions,
    recentCompanies: recentCompanies.map((company) => ({ id: company.id, name: company.name, industry: company.industry, updatedAt: company.updatedAt, admin: company.users[0] ?? null })),
  }
}
import { z } from 'zod'

const nullableText = z.string().nullable()

const reportPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
}).strict()

const reportActionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  objective: nullableText,
  implementationPlan: nullableText,
  responsible: reportPersonSchema.nullable(),
  priority: z.string(),
  status: z.string(),
  required: z.boolean(),
  dueDate: nullableText,
  completedAt: nullableText,
  progressPercent: z.number().int(),
  followUpId: nullableText,
  followUpReason: nullableText,
  followUpJustification: nullableText,
  progress: z.array(z.object({
    note: z.string(),
    percent: z.number().int().nullable(),
    createdAt: z.string(),
  }).strict()),
}).strict()

const reportEvaluationSchema = z.object({
  id: z.string(),
  status: z.string(),
  outcome: z.string(),
  responsible: reportPersonSchema.nullable(),
  scope: z.string(),
  conclusion: nullableText,
  recurrenceDetected: z.boolean(),
  completedAt: nullableText,
}).strict()

export const auditReportSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  official: z.object({
    identification: z.object({
      code: z.string(),
      title: z.string(),
      auditType: nullableText,
      process: z.object({ id: z.string(), code: nullableText, name: z.string() }).strict(),
    }).strict(),
    objectives: nullableText,
    scope: z.string(),
    criteria: z.string(),
    dates: z.object({ plannedDate: nullableText, startDate: nullableText }).strict(),
    team: z.array(z.object({
      id: z.string(),
      auditorId: z.string(),
      name: z.string(),
      role: z.string(),
      isActive: z.boolean(),
      independenceStatus: z.string(),
      independenceDeclaration: nullableText,
      conflictDescription: nullableText,
      mitigationMeasures: nullableText,
    }).strict()),
    processes: z.array(z.object({ id: z.string(), code: nullableText, name: z.string() }).strict()),
    procedures: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() }).strict()),
    plan: z.object({
      methodology: nullableText,
      samplingMethod: nullableText,
      resources: nullableText,
      status: nullableText,
      activities: z.array(z.object({
        id: z.string(),
        title: z.string(),
        type: z.string(),
        status: z.string(),
        scheduledStart: z.string(),
        scheduledEnd: z.string(),
        executionResult: nullableText,
        executionObservations: nullableText,
      }).strict()),
    }).strict().nullable(),
    checklists: z.array(z.object({
      id: z.string(),
      name: z.string(),
      items: z.array(z.object({
        id: z.string(),
        description: z.string(),
        criteria: z.string(),
        result: z.string(),
        observations: nullableText,
        required: z.boolean(),
      }).strict()),
    }).strict()),
    results: z.object({
      checklistTotal: z.number().int(),
      checklistEvaluated: z.number().int(),
      conform: z.number().int(),
      nonConform: z.number().int(),
      findingsTotal: z.number().int(),
      findingsOpen: z.number().int(),
    }).strict(),
    findings: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      type: z.string(),
      severity: z.string(),
      status: z.string(),
      dueDate: nullableText,
      responsible: reportPersonSchema.nullable(),
      resolution: nullableText,
      checklistItem: z.object({ id: z.string(), description: z.string() }).nullable(),
      process: z.object({ id: z.string(), code: nullableText, name: z.string() }).nullable(),
      procedure: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
      evidences: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), url: z.string() }).strict()),
      evidenceFiles: z.array(z.object({ id: z.string(), filename: z.string(), storageState: z.string(), size: z.number().int() }).strict()),
      actions: z.array(reportActionSchema),
      efficacyEvaluations: z.array(reportEvaluationSchema),
    }).strict()),
    evidences: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), url: z.string() }).strict()),
    evidenceFiles: z.array(z.object({ id: z.string(), filename: z.string(), storageState: z.string(), size: z.number().int() }).strict()),
  }).strict(),
  editable: z.object({
    executiveSummary: z.string().max(20000),
    conclusions: z.string().max(20000),
    recommendations: z.string().max(20000),
  }).strict(),
}).strict()

export type AuditReportSnapshot = z.infer<typeof auditReportSnapshotSchema>

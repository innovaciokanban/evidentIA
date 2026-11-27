import type { AuditProgramProcessPriorityLevel } from '../../types'

export const priorityForScore = (score: number): AuditProgramProcessPriorityLevel => score <= 4 ? 'LOW' : score <= 7 ? 'MEDIUM' : 'HIGH'

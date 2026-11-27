import { ApiError } from '../../api'

export const correctiveActionRequestMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

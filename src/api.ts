const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  /** Motivo estructurado que devuelve la API (p. ej. CHANGE_HISTORY | RELATED_RECORDS). */
  reason?: string

  constructor(message: string, status: number, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('app:unauthorized'))
    }
    const body = await response.json().catch(() => ({})) as { error?: string; reason?: string }
    throw new ApiError(body.error ?? 'No se pudo completar la solicitud', response.status, body.reason)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

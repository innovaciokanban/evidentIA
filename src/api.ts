const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new ApiError(body.error ?? 'No se pudo completar la solicitud', response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

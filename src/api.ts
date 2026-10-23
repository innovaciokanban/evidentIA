const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '')

/** Límite del backend (10 MB) repetido aquí solo para no subir un archivo que va a ser rechazado. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

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

/** URL completa de un recurso de la API, para enlaces que el navegador resuelve solo (descargas). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}

async function failureFrom(response: Response): Promise<never> {
  if (response.status === 401) {
    window.dispatchEvent(new Event('app:unauthorized'))
  }
  const body = await response.json().catch(() => ({})) as { error?: string; reason?: string }
  throw new ApiError(body.error ?? 'No se pudo completar la solicitud', response.status, body.reason)
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) await failureFrom(response)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/**
 * Sube un archivo como multipart/form-data sin tocar la cabecera Content-Type: el navegador pone
 * él solo el boundary. El blob se reetiqueta como application/pdf porque es el único MIME que el
 * backend acepta y el tipo que reporta el sistema de archivos no siempre lo es (arrastrar un PDF,
 * por ejemplo, puede llegar vacío o como application/octet-stream). `fields` permite adjuntar
 * campos de texto adicionales (p. ej. el anclaje de una evidencia de auditoría).
 */
export async function apiUpload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  if (!/\.pdf$/i.test(file.name)) throw new ApiError('La evidencia debe ser un archivo PDF (.pdf).', 415)
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError('El PDF supera el tamaño máximo de 10 MB.', 413)
  const form = new FormData()
  const blob = new Blob([await file.arrayBuffer()], { type: 'application/pdf' })
  form.append('file', blob, file.name)
  for (const [key, value] of Object.entries(fields)) {
    if (value) form.append(key, value)
  }
  const response = await fetch(apiUrl(path), { method: 'POST', credentials: 'include', body: form })
  if (!response.ok) await failureFrom(response)
  return response.json() as Promise<T>
}

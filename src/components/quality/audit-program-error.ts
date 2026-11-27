import { ApiError } from '../../api'

export const auditProgramLoadErrorMessage = (error: unknown) => {
  if (error instanceof ApiError && error.status === 404 && error.message === 'Not found') {
    return 'La API de programas de auditoría no está disponible en el servidor actual. Inténtalo de nuevo cuando la API esté actualizada.'
  }
  return error instanceof ApiError ? error.message : 'No pudimos cargar los programas de auditoría.'
}

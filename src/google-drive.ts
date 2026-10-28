import type { Role } from './types'

export const canManageGoogleDrive = (role: Role) => role === 'SUPERUSER' || role === 'COMPANY_ADMIN'

export const googleDrivePaths = (companyId: string) => {
  const basePath = `/companies/${encodeURIComponent(companyId)}/google-drive`
  return { connection: basePath, oauthStart: `${basePath}/oauth/start` }
}

export const googleDriveScopeLabel = (scope: string) => {
  if (scope.includes('drive.file')) return 'Archivos creados o seleccionados en EvidentIA'
  if (scope.includes('drive.readonly')) return 'Lectura de archivos de Google Drive'
  if (scope.includes('drive')) return 'Acceso a archivos de Google Drive'
  return scope
}

export type DrivePickerViewConfig = {
  parentFolderId: string
  mimeTypes: string
  includeFolders: boolean
  selectFolderEnabled: boolean
  mode: string
}

/**
 * El Picker se abre dentro de la carpeta de la empresa, no en la raíz: la raíz solo contiene la
 * carpeta por empresa, así que con la raíz como padre la lista sale vacía ("No documents").
 * Las carpetas se muestran para poder navegar a subcarpetas (el servidor acepta cualquier
 * descendiente de la carpeta de la empresa), pero su selección queda deshabilitada porque solo
 * se admiten archivos PDF.
 */
export const drivePickerViewConfig = (folders: { rootFolderId: string; companyFolderId: string }): DrivePickerViewConfig => ({
  parentFolderId: folders.companyFolderId,
  mimeTypes: 'application/pdf',
  includeFolders: true,
  selectFolderEnabled: false,
  mode: 'LIST',
})

import { describe, expect, it } from 'vitest'
import { canManageGoogleDrive, drivePickerViewConfig, googleDrivePaths, googleDriveScopeLabel } from './google-drive'

describe('Google Drive permissions', () => {
  it('only allows superusers and company admins to manage a connection', () => {
    expect(canManageGoogleDrive('SUPERUSER')).toBe(true)
    expect(canManageGoogleDrive('COMPANY_ADMIN')).toBe(true)
    expect(canManageGoogleDrive('COMPANY_USER')).toBe(false)
  })

  it('shows a safe label for known Drive scopes without exposing credentials', () => {
    expect(googleDriveScopeLabel('https://www.googleapis.com/auth/drive.file')).toBe('Archivos creados o seleccionados en EvidentIA')
    expect(googleDriveScopeLabel('custom-scope')).toBe('custom-scope')
  })

  it('builds company-scoped connection paths', () => {
    expect(googleDrivePaths('company/42')).toEqual({
      connection: '/companies/company%2F42/google-drive',
      oauthStart: '/companies/company%2F42/google-drive/oauth/start',
    })
  })
})

describe('Google Drive Picker view configuration', () => {
  it('opens inside the company folder instead of the root folder', () => {
    const config = drivePickerViewConfig({ rootFolderId: 'root-1', companyFolderId: 'company-1' })
    expect(config.parentFolderId).toBe('company-1')
    expect(config.parentFolderId).not.toBe('root-1')
  })

  it('shows folders for navigation but only allows picking PDF files', () => {
    const config = drivePickerViewConfig({ rootFolderId: 'root-1', companyFolderId: 'company-1' })
    expect(config).toEqual({
      parentFolderId: 'company-1',
      mimeTypes: 'application/pdf',
      includeFolders: true,
      selectFolderEnabled: false,
      mode: 'LIST',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { activeUserOptions, userOptionLabel } from './user-status'

describe('user status options', () => {
  it('keeps only active users for new assignments', () => {
    const users = [{ id: 'active', name: 'Activa', isActive: true }, { id: 'inactive', name: 'Inactiva', isActive: false }]
    expect(activeUserOptions(users).map((user) => user.id)).toEqual(['active'])
  })

  it('keeps an inactive historical value only when it is already assigned', () => {
    const active = { id: 'active', name: 'Activa', isActive: true }
    const inactive = { id: 'inactive', name: 'Inactiva', isActive: false }
    expect(activeUserOptions([active], [inactive]).map((user) => user.id)).toEqual(['active', 'inactive'])
    expect(userOptionLabel(inactive)).toBe('Inactiva (Inactivo)')
  })
})

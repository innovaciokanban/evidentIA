import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
import { createOAuthState, createPkcePair, decryptOAuthSecret, encryptOAuthSecret, hashOAuthState } from './oauth-crypto.js'

describe('OAuth cryptography helpers', () => {
  it('round-trips an authenticated refresh token envelope', () => {
    const encrypted = encryptOAuthSecret('refresh-token-value')
    expect(encrypted).not.toContain('refresh-token-value')
    expect(decryptOAuthSecret(encrypted)).toBe('refresh-token-value')
  })

  it('rejects a tampered token envelope', () => {
    const encrypted = encryptOAuthSecret('refresh-token-value')
    const pieces = encrypted.split('.')
    pieces[3] = `${pieces[3]}x`
    expect(() => decryptOAuthSecret(pieces.join('.'))).toThrow()
  })

  it('creates unique state and a valid S256 PKCE pair', () => {
    const first = createOAuthState()
    const second = createOAuthState()
    const pkce = createPkcePair()
    expect(first).not.toBe(second)
    expect(hashOAuthState(first)).toHaveLength(64)
    expect(pkce.verifier).not.toBe(pkce.challenge)
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

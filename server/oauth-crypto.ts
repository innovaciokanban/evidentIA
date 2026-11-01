import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from './env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

const encryptionKey = (): Buffer => {
  const key = env.OAUTH_TOKEN_ENCRYPTION_KEY ? Buffer.from(env.OAUTH_TOKEN_ENCRYPTION_KEY, 'base64') : null
  if (!key || key.length !== 32) throw new Error('OAuth token encryption is not configured')
  return key
}

export const encryptOAuthSecret = (value: string): string => {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`
}

export const decryptOAuthSecret = (encoded: string): string => {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = encoded.split('.')
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('OAuth secret format is invalid')
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivEncoded, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8')
}

export const hashOAuthState = (state: string): string => createHash('sha256').update(state).digest('hex')

export const createPkcePair = () => {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export const createOAuthState = (): string => randomBytes(32).toString('base64url')

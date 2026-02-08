/**
 * E2EE key storage. Phase 1: in-memory + localStorage (dev convenience; will be replaced by secure storage).
 * Key is persisted so it survives reloads; in DEV, a fixed key is used when none is set.
 */

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const STORAGE_KEY = 'e2ee_encryption_key'

/** Fixed password and salt for dev-only key derivation. Same key every run. */
const DEV_KEY_PASSWORD = 'e2ee-dev-fixed-key-v1'
const DEV_KEY_SALT = new Uint8Array([0xe2, 0xee, 0xde, 0x76, 0x6b, 0x65, 0x79, 0x73, 0x61, 0x6c, 0x74])

let inMemoryKey: CryptoKey | null = null

/** Base64-encode ArrayBuffer for storage. */
const base64Encode = (ab: ArrayBuffer): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(ab).toString('base64')
  const bytes = new Uint8Array(ab)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/** Base64-decode to ArrayBuffer. */
const base64Decode = (s: string): ArrayBuffer => {
  if (typeof Buffer !== 'undefined') {
    const b = Buffer.from(s, 'base64')
    return new Uint8Array(b).buffer.slice(0, b.length)
  }
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!
  return bytes.buffer
}

const serializeKey = async (key: CryptoKey): Promise<string> => {
  const raw = await crypto.subtle.exportKey('raw', key)
  return base64Encode(raw)
}

const deserializeKey = async (s: string): Promise<CryptoKey> => {
  const raw = base64Decode(s)
  return crypto.subtle.importKey('raw', raw, { name: ALGORITHM, length: KEY_LENGTH }, true, ['encrypt', 'decrypt'])
}

/** Derives a deterministic AES-GCM key from the fixed dev password. Development only. */
const deriveFixedDevKey = async (): Promise<CryptoKey> => {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(DEV_KEY_PASSWORD), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: DEV_KEY_SALT, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return crypto.subtle.importKey('raw', bits, { name: ALGORITHM, length: KEY_LENGTH }, true, ['encrypt', 'decrypt'])
}

/** Generates a new AES-GCM key for data encryption. */
export const generateEncryptionKey = async (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_LENGTH }, true, ['encrypt', 'decrypt'])

/** Returns the current encryption key. Checks memory, then localStorage, then in DEV derives fixed key and persists. */
export const getEncryptionKey = async (): Promise<CryptoKey | null> => {
  if (inMemoryKey) return inMemoryKey
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      inMemoryKey = await deserializeKey(stored)
      return inMemoryKey
    }
  } catch {
    // ignore
  }
  if (typeof import.meta.env !== 'undefined' && import.meta.env?.DEV) {
    inMemoryKey = await deriveFixedDevKey()
    try {
      localStorage.setItem(STORAGE_KEY, await serializeKey(inMemoryKey))
    } catch {
      // ignore
    }
    return inMemoryKey
  }
  return null
}

/** Stores the encryption key in memory and localStorage. */
export const setEncryptionKey = async (key: CryptoKey): Promise<void> => {
  inMemoryKey = key
  try {
    localStorage.setItem(STORAGE_KEY, await serializeKey(key))
  } catch {
    // ignore
  }
}

/** Returns true if a key is currently stored (memory or localStorage). */
export const hasStoredKey = async (): Promise<boolean> => {
  if (inMemoryKey) return true
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/** Clears the in-memory key and removes it from localStorage. */
export const clearKey = async (): Promise<void> => {
  inMemoryKey = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

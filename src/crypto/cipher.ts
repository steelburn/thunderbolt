import { getEncryptionKey } from './key-storage'
import type { EnvelopeV1 } from './types'
import { buildAad, E2EE_STORAGE_PREFIX } from './types'

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const TAG_LENGTH = 128

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/**
 * Encrypts plaintext for a given table/column. Returns storage string (prefix + base64 JSON envelope) or null if no key.
 */
export const encrypt = async (plaintext: string, table: string, column: string): Promise<string | null> => {
  const key = await getEncryptionKey()
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const aad = new TextEncoder().encode(buildAad(table, column))
  const ct = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: aad, tagLength: TAG_LENGTH },
    key,
    new TextEncoder().encode(plaintext),
  )
  const ctArray = new Uint8Array(ct)
  const tagStart = ctArray.length - TAG_LENGTH / 8
  const ciphertext = ctArray.slice(0, tagStart)
  const tag = ctArray.slice(tagStart)
  const envelope: EnvelopeV1 = {
    v: 1,
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    ct: bytesToBase64(ciphertext),
  }
  return E2EE_STORAGE_PREFIX + btoa(JSON.stringify(envelope))
}

/**
 * Decrypts a storage value. If value does not start with E2EE prefix, returns as-is (legacy plaintext).
 */
export const decrypt = async (value: string | null, table: string, column: string): Promise<string | null> => {
  if (value === null || value === undefined) return value
  if (!value.startsWith(E2EE_STORAGE_PREFIX)) return value
  const key = await getEncryptionKey()
  if (!key) return null
  const json = atob(value.slice(E2EE_STORAGE_PREFIX.length))
  const envelope = JSON.parse(json) as EnvelopeV1
  if (envelope.v !== 1) throw new Error('Unsupported envelope version')
  const iv = Uint8Array.from(atob(envelope.iv), (c) => c.charCodeAt(0))
  const tag = Uint8Array.from(atob(envelope.tag), (c) => c.charCodeAt(0))
  const ct = Uint8Array.from(atob(envelope.ct), (c) => c.charCodeAt(0))
  const combined = new Uint8Array(ct.length + tag.length)
  combined.set(ct)
  combined.set(tag, ct.length)
  const aad = new TextEncoder().encode(buildAad(table, column))
  const dec = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, additionalData: aad, tagLength: TAG_LENGTH },
    key,
    combined,
  )
  return new TextDecoder().decode(dec)
}

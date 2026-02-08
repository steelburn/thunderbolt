import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { clearKey, decrypt, encrypt, generateEncryptionKey, setEncryptionKey } from '@/crypto'

describe('E2EE cipher', () => {
  beforeEach(async () => {
    await setEncryptionKey(await generateEncryptionKey())
  })

  afterEach(async () => {
    await clearKey()
  })

  describe('round-trip', () => {
    it('encrypts and decrypts plaintext', async () => {
      const plain = 'hello world'
      const ct = await encrypt(plain, 'tasks', 'item')
      expect(ct).not.toBeNull()
      expect(ct).toMatch(/^e2ee:v1:/)
      const dec = await decrypt(ct!, 'tasks', 'item')
      expect(dec).toBe(plain)
    })

    it('returns legacy plaintext unchanged when no prefix', async () => {
      const dec = await decrypt('legacy item', 'tasks', 'item')
      expect(dec).toBe('legacy item')
    })

    it('returns null when value is null', async () => {
      const dec = await decrypt(null, 'tasks', 'item')
      expect(dec).toBeNull()
    })

    it('uses AAD so same plaintext in different column yields different ciphertext', async () => {
      const plain = 'secret'
      const ct1 = await encrypt(plain, 'tasks', 'item')
      const ct2 = await encrypt(plain, 'tasks', 'other')
      expect(ct1).not.toBe(ct2)
      expect(await decrypt(ct1!, 'tasks', 'item')).toBe(plain)
      expect(await decrypt(ct2!, 'tasks', 'other')).toBe(plain)
    })
  })

  describe('wrong key', () => {
    it('decrypt with wrong key throws', async () => {
      const plain = 'secret'
      const ct = await encrypt(plain, 'tasks', 'item')
      await clearKey()
      await setEncryptionKey(await generateEncryptionKey())
      await expect(decrypt(ct!, 'tasks', 'item')).rejects.toThrow()
    })
  })
})

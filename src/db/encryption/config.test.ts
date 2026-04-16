import { afterEach, describe, expect, it } from 'bun:test'
import { isEncryptionEnabled, setEncryptionEnabled } from './config'

describe('encryption config', () => {
  afterEach(() => {
    localStorage.removeItem('e2ee_enabled')
  })

  describe('isEncryptionEnabled', () => {
    it('returns false when no value is stored', () => {
      expect(isEncryptionEnabled()).toBe(false)
    })

    it('returns false when stored value is "false"', () => {
      localStorage.setItem('e2ee_enabled', 'false')
      expect(isEncryptionEnabled()).toBe(false)
    })

    it('returns true when stored value is "true"', () => {
      localStorage.setItem('e2ee_enabled', 'true')
      expect(isEncryptionEnabled()).toBe(true)
    })
  })

  describe('setEncryptionEnabled', () => {
    it('persists true to localStorage', () => {
      setEncryptionEnabled(true)
      expect(localStorage.getItem('e2ee_enabled')).toBe('true')
      expect(isEncryptionEnabled()).toBe(true)
    })

    it('persists false to localStorage', () => {
      setEncryptionEnabled(false)
      expect(localStorage.getItem('e2ee_enabled')).toBe('false')
      expect(isEncryptionEnabled()).toBe(false)
    })
  })
})

import { describe, expect, it } from 'bun:test'
import { defaultAgentBuiltIn, defaultAgents, hashAgent } from './agents'

describe('defaults/agents', () => {
  describe('defaultAgentBuiltIn', () => {
    it('should have the expected id', () => {
      expect(defaultAgentBuiltIn.id).toBe('agent-built-in')
    })

    it('should be a built-in type with in-process transport', () => {
      expect(defaultAgentBuiltIn.type).toBe('built-in')
      expect(defaultAgentBuiltIn.transport).toBe('in-process')
    })

    it('should be a system agent and enabled', () => {
      expect(defaultAgentBuiltIn.isSystem).toBe(1)
      expect(defaultAgentBuiltIn.enabled).toBe(1)
    })

    it('should have no command, args, url, or authMethod', () => {
      expect(defaultAgentBuiltIn.command).toBeNull()
      expect(defaultAgentBuiltIn.args).toBeNull()
      expect(defaultAgentBuiltIn.url).toBeNull()
      expect(defaultAgentBuiltIn.authMethod).toBeNull()
    })

    it('should have a bot icon', () => {
      expect(defaultAgentBuiltIn.icon).toBe('bot')
    })
  })

  describe('defaultAgents', () => {
    it('should contain the built-in agent', () => {
      expect(defaultAgents).toContain(defaultAgentBuiltIn)
    })

    it('should have exactly one default agent', () => {
      expect(defaultAgents).toHaveLength(1)
    })
  })

  describe('hashAgent', () => {
    it('should return a consistent hash for the same agent', () => {
      const hash1 = hashAgent(defaultAgentBuiltIn)
      const hash2 = hashAgent(defaultAgentBuiltIn)
      expect(hash1).toBe(hash2)
    })

    it('should return different hashes for different agents', () => {
      const otherAgent = { ...defaultAgentBuiltIn, name: 'Other Agent' }
      expect(hashAgent(defaultAgentBuiltIn)).not.toBe(hashAgent(otherAgent))
    })

    it('should detect changes to name', () => {
      const original = hashAgent(defaultAgentBuiltIn)
      const modified = hashAgent({ ...defaultAgentBuiltIn, name: 'Modified' })
      expect(original).not.toBe(modified)
    })

    it('should detect changes to enabled', () => {
      const original = hashAgent(defaultAgentBuiltIn)
      const modified = hashAgent({ ...defaultAgentBuiltIn, enabled: 0 })
      expect(original).not.toBe(modified)
    })

    it('should detect changes to deletedAt', () => {
      const original = hashAgent(defaultAgentBuiltIn)
      const modified = hashAgent({ ...defaultAgentBuiltIn, deletedAt: '2024-01-01' })
      expect(original).not.toBe(modified)
    })

    it('should return a string', () => {
      expect(typeof hashAgent(defaultAgentBuiltIn)).toBe('string')
    })
  })
})

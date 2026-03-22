import { getDb } from '@/db/database'
import { agentsTable } from '@/db/tables'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { defaultAgentBuiltIn } from '@/defaults/agents'
import type { Agent } from '@/types'
import {
  createAgent,
  deleteAgent,
  getAgent,
  getAllAgents,
  getEnabledAgents,
  getSelectedAgent,
  getSystemAgent,
  updateAgent,
} from './agents'
import { updateSettings } from './settings'
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from './test-utils'

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await teardownTestDatabase()
})

describe('Agents DAL', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  describe('getAgent', () => {
    it('should return null when agent does not exist', async () => {
      const agent = await getAgent(getDb(), 'nonexistent-agent-id')
      expect(agent).toBe(null)
    })

    it('should return null when agent ID is empty string', async () => {
      const agent = await getAgent(getDb(), '')
      expect(agent).toBe(null)
    })

    it('should return agent when it exists', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Test Agent',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
      })

      const agent = await getAgent(getDb(), agentId)
      expect(agent).not.toBe(null)
      expect(agent?.id).toBe(agentId)
      expect(agent?.name).toBe('Test Agent')
    })

    it('should not return soft-deleted agents', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Deleted Agent',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
        deletedAt: '2024-01-01T00:00:00.000Z',
      })

      const agent = await getAgent(getDb(), agentId)
      expect(agent).toBe(null)
    })
  })

  describe('getAllAgents', () => {
    it('should return empty array when no agents exist', async () => {
      const agents = await getAllAgents(getDb())
      expect(agents).toEqual([])
    })

    it('should return all non-deleted agents', async () => {
      const db = getDb()
      const agentId1 = uuidv7()
      const agentId2 = uuidv7()

      await db.insert(agentsTable).values([
        { id: agentId1, name: 'Agent 1', type: 'local', transport: 'stdio', enabled: 1 },
        { id: agentId2, name: 'Agent 2', type: 'remote', transport: 'websocket', enabled: 1 },
      ])

      const agents = await getAllAgents(getDb())
      expect(agents).toHaveLength(2)
    })

    it('should sort system agents first', async () => {
      const db = getDb()

      await db.insert(agentsTable).values([
        { id: uuidv7(), name: 'Custom Agent', type: 'local', transport: 'stdio', isSystem: 0, enabled: 1 },
        { id: uuidv7(), name: 'System Agent', type: 'built-in', transport: 'in-process', isSystem: 1, enabled: 1 },
      ])

      const agents = await getAllAgents(getDb())
      expect(agents[0]?.isSystem).toBe(1)
      expect(agents[1]?.isSystem).toBe(0)
    })

    it('should exclude soft-deleted agents', async () => {
      const db = getDb()

      await db.insert(agentsTable).values([
        { id: uuidv7(), name: 'Active Agent', type: 'local', transport: 'stdio', enabled: 1 },
        {
          id: uuidv7(),
          name: 'Deleted Agent',
          type: 'local',
          transport: 'stdio',
          enabled: 1,
          deletedAt: '2024-01-01T00:00:00.000Z',
        },
      ])

      const agents = await getAllAgents(getDb())
      expect(agents).toHaveLength(1)
      expect(agents[0]?.name).toBe('Active Agent')
    })
  })

  describe('getEnabledAgents', () => {
    it('should return only enabled agents', async () => {
      const db = getDb()

      await db.insert(agentsTable).values([
        { id: uuidv7(), name: 'Enabled Agent', type: 'local', transport: 'stdio', enabled: 1 },
        { id: uuidv7(), name: 'Disabled Agent', type: 'local', transport: 'stdio', enabled: 0 },
      ])

      const agents = await getEnabledAgents(getDb())
      expect(agents).toHaveLength(1)
      expect(agents[0]?.name).toBe('Enabled Agent')
    })

    it('should return empty array when no enabled agents exist', async () => {
      const db = getDb()

      await db.insert(agentsTable).values({
        id: uuidv7(),
        name: 'Disabled Agent',
        type: 'local',
        transport: 'stdio',
        enabled: 0,
      })

      const agents = await getEnabledAgents(getDb())
      expect(agents).toEqual([])
    })
  })

  describe('getSystemAgent', () => {
    it('should return null when no system agent exists', async () => {
      const db = getDb()

      await db.insert(agentsTable).values({
        id: uuidv7(),
        name: 'Custom Agent',
        type: 'local',
        transport: 'stdio',
        isSystem: 0,
        enabled: 1,
      })

      const systemAgent = await getSystemAgent(getDb())
      expect(systemAgent).toBe(null)
    })

    it('should return the system agent when it exists', async () => {
      const db = getDb()
      const systemAgentId = uuidv7()

      await db.insert(agentsTable).values({
        id: systemAgentId,
        name: 'Built-in',
        type: 'built-in',
        transport: 'in-process',
        isSystem: 1,
        enabled: 1,
      })

      const systemAgent = await getSystemAgent(getDb())
      expect(systemAgent).not.toBe(null)
      expect(systemAgent?.id).toBe(systemAgentId)
      expect(systemAgent?.isSystem).toBe(1)
    })
  })

  describe('getSelectedAgent', () => {
    it('should return system agent when no selected_agent setting exists', async () => {
      const db = getDb()
      const systemAgentId = uuidv7()

      await db.insert(agentsTable).values({
        id: systemAgentId,
        name: 'Built-in',
        type: 'built-in',
        transport: 'in-process',
        isSystem: 1,
        enabled: 1,
      })

      const agent = await getSelectedAgent(getDb())
      expect(agent.id).toBe(systemAgentId)
    })

    it('should return selected agent when selected_agent setting exists', async () => {
      const db = getDb()

      // Create system agent
      await db.insert(agentsTable).values({
        id: uuidv7(),
        name: 'Built-in',
        type: 'built-in',
        transport: 'in-process',
        isSystem: 1,
        enabled: 1,
      })

      // Create selected agent
      const selectedId = uuidv7()
      await db.insert(agentsTable).values({
        id: selectedId,
        name: 'Claude Code',
        type: 'local',
        transport: 'stdio',
        isSystem: 0,
        enabled: 1,
      })

      await updateSettings(getDb(), { selected_agent: selectedId })

      const agent = await getSelectedAgent(getDb())
      expect(agent.id).toBe(selectedId)
      expect(agent.name).toBe('Claude Code')
    })

    it('should fall back to system agent when selected agent is disabled', async () => {
      const db = getDb()
      const systemAgentId = uuidv7()

      await db.insert(agentsTable).values({
        id: systemAgentId,
        name: 'Built-in',
        type: 'built-in',
        transport: 'in-process',
        isSystem: 1,
        enabled: 1,
      })

      const disabledId = uuidv7()
      await db.insert(agentsTable).values({
        id: disabledId,
        name: 'Disabled Agent',
        type: 'local',
        transport: 'stdio',
        isSystem: 0,
        enabled: 0,
      })

      await updateSettings(getDb(), { selected_agent: disabledId })

      const agent = await getSelectedAgent(getDb())
      expect(agent.id).toBe(systemAgentId)
    })

    it('should fall back to system agent when selected agent is deleted', async () => {
      const db = getDb()
      const systemAgentId = uuidv7()

      await db.insert(agentsTable).values({
        id: systemAgentId,
        name: 'Built-in',
        type: 'built-in',
        transport: 'in-process',
        isSystem: 1,
        enabled: 1,
      })

      const deletedId = uuidv7()
      await db.insert(agentsTable).values({
        id: deletedId,
        name: 'Deleted Agent',
        type: 'local',
        transport: 'stdio',
        isSystem: 0,
        enabled: 1,
        deletedAt: '2024-01-01T00:00:00.000Z',
      })

      await updateSettings(getDb(), { selected_agent: deletedId })

      const agent = await getSelectedAgent(getDb())
      expect(agent.id).toBe(systemAgentId)
    })

    it('should throw when no system agent exists and no selection', async () => {
      await expect(getSelectedAgent(getDb())).rejects.toThrow('No system agent found')
    })
  })

  describe('createAgent', () => {
    it('should create a new agent', async () => {
      const agentId = uuidv7()

      await createAgent(getDb(), {
        id: agentId,
        name: 'Claude Code',
        type: 'local',
        transport: 'stdio',
        command: 'claude',
        args: JSON.stringify(['--acp']),
        enabled: 1,
      })

      const agent = await getAgent(getDb(), agentId)
      expect(agent).not.toBe(null)
      expect(agent?.name).toBe('Claude Code')
      expect(agent?.type).toBe('local')
      expect(agent?.transport).toBe('stdio')
      expect(agent?.command).toBe('claude')
    })

    it('should create a remote agent with url', async () => {
      const agentId = uuidv7()

      await createAgent(getDb(), {
        id: agentId,
        name: 'Haystack',
        type: 'remote',
        transport: 'websocket',
        url: 'wss://haystack.example.com',
        enabled: 1,
      })

      const agent = await getAgent(getDb(), agentId)
      expect(agent?.url).toBe('wss://haystack.example.com')
    })
  })

  describe('updateAgent', () => {
    it('should update agent name', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Original Name',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
      })

      await updateAgent(getDb(), agentId, { name: 'Updated Name' })

      const agent = await getAgent(getDb(), agentId)
      expect(agent?.name).toBe('Updated Name')
    })

    it('should update agent enabled status', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Test Agent',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
      })

      await updateAgent(getDb(), agentId, { enabled: 0 })

      const enabledAgents = await getEnabledAgents(getDb())
      expect(enabledAgents.map((a) => a.id)).not.toContain(agentId)
    })

    it('should not update defaultHash field', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Test Agent',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
        defaultHash: 'original-hash',
      })

      await updateAgent(getDb(), agentId, { name: 'Updated', defaultHash: 'new-hash' } as Parameters<
        typeof updateAgent
      >[2])

      const rawAgent = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).get()
      expect(rawAgent?.defaultHash).toBe('original-hash')
      expect(rawAgent?.name).toBe('Updated')
    })

    it('should not throw when updating non-existent agent', async () => {
      await expect(updateAgent(getDb(), 'non-existent-id', { name: 'test' })).resolves.toBeUndefined()
    })
  })

  describe('deleteAgent', () => {
    it('should soft delete an agent by id', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Agent to delete',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
      })

      const agentBefore = await getAgent(getDb(), agentId)
      expect(agentBefore).not.toBe(null)

      await deleteAgent(getDb(), agentId)

      const agentAfter = await getAgent(getDb(), agentId)
      expect(agentAfter).toBe(null)

      // Should still exist in database with deletedAt set
      const rawAgent = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).get()
      expect(rawAgent).not.toBeUndefined()
      expect(rawAgent?.deletedAt).not.toBeNull()
    })

    it('should not throw when deleting non-existent agent', async () => {
      await expect(deleteAgent(getDb(), 'non-existent-id')).resolves.toBeUndefined()
    })

    it('should preserve original deletedAt for already-deleted agent', async () => {
      const db = getDb()
      const agentId = uuidv7()
      const originalDeletedAt = '2024-01-15T12:00:00.000Z'

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Already deleted',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
        deletedAt: originalDeletedAt,
      })

      await deleteAgent(getDb(), agentId)

      const rawAgent = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).get()
      expect(rawAgent?.deletedAt).toBe(originalDeletedAt)
    })

    it('should not return soft-deleted agent via getAllAgents', async () => {
      const db = getDb()
      const agentId = uuidv7()

      await db.insert(agentsTable).values({
        id: agentId,
        name: 'Agent to delete',
        type: 'local',
        transport: 'stdio',
        enabled: 1,
      })

      const agentsBefore = await getAllAgents(getDb())
      expect(agentsBefore).toHaveLength(1)

      await deleteAgent(getDb(), agentId)

      const agentsAfter = await getAllAgents(getDb())
      expect(agentsAfter).toHaveLength(0)
    })
  })
})

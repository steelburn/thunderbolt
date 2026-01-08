import { DatabaseSingleton } from '@/db/singleton'
import { promptsTable, triggersTable } from '@/db/tables'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import {
  createTrigger,
  deleteTrigger,
  deleteTriggerByPromptId,
  getAllTriggers,
  getTriggersByPromptId,
  updateTrigger,
  updateTriggerByPromptId,
} from './triggers'
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from './test-utils'

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await teardownTestDatabase()
})

/** Helper to create a prompt in the database */
const createPrompt = async (id: string) => {
  const db = DatabaseSingleton.instance.db
  await db.insert(promptsTable).values({
    id,
    title: 'Test Prompt',
    prompt: 'This is a test prompt',
    modelId: uuidv7(),
  })
}

describe('Triggers DAL', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  describe('getAllTriggers', () => {
    it('should return empty array when no triggers exist', async () => {
      const triggers = await getAllTriggers()
      expect(triggers).toEqual([])
    })

    it('should return only enabled triggers', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId1 = uuidv7()
      const promptId2 = uuidv7()

      await createPrompt(promptId1)
      await createPrompt(promptId2)

      const enabledTriggerId = uuidv7()
      const disabledTriggerId = uuidv7()

      await db.insert(triggersTable).values([
        {
          id: enabledTriggerId,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId: promptId1,
          isEnabled: 1,
        },
        {
          id: disabledTriggerId,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId: promptId2,
          isEnabled: 0,
        },
      ])

      const triggers = await getAllTriggers()
      expect(triggers).toHaveLength(1)
      expect(triggers[0]?.id).toBe(enabledTriggerId)
    })

    it('should return all enabled triggers', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId1 = uuidv7()
      const promptId2 = uuidv7()

      await createPrompt(promptId1)
      await createPrompt(promptId2)

      const triggerId1 = uuidv7()
      const triggerId2 = uuidv7()

      await db.insert(triggersTable).values([
        {
          id: triggerId1,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId: promptId1,
          isEnabled: 1,
        },
        {
          id: triggerId2,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId: promptId2,
          isEnabled: 1,
        },
      ])

      const triggers = await getAllTriggers()
      expect(triggers).toHaveLength(2)
      expect(triggers.map((t) => t.id)).toContain(triggerId1)
      expect(triggers.map((t) => t.id)).toContain(triggerId2)
    })
  })

  describe('getTriggersByPromptId', () => {
    it('should return empty array when no triggers exist for prompt', async () => {
      const triggers = await getTriggersByPromptId('nonexistent-prompt-id')
      expect(triggers).toEqual([])
    })

    it('should return triggers for a specific prompt', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const otherPromptId = uuidv7()

      await createPrompt(promptId)
      await createPrompt(otherPromptId)

      const triggerId1 = uuidv7()
      const triggerId2 = uuidv7()
      const otherTriggerId = uuidv7()

      await db.insert(triggersTable).values([
        {
          id: triggerId1,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId,
          isEnabled: 1,
        },
        {
          id: triggerId2,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId,
          isEnabled: 0,
        },
        {
          id: otherTriggerId,
          triggerType: 'time',
          triggerTime: '10:00',
          promptId: otherPromptId,
          isEnabled: 1,
        },
      ])

      const triggers = await getTriggersByPromptId(promptId)
      expect(triggers).toHaveLength(2)
      expect(triggers.map((t) => t.id)).toContain(triggerId1)
      expect(triggers.map((t) => t.id)).toContain(triggerId2)
      expect(triggers.map((t) => t.id)).not.toContain(otherTriggerId)
    })
  })

  describe('createTrigger', () => {
    it('should create a new trigger', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await createTrigger({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '08:00',
        promptId,
        isEnabled: 1,
      })

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result).not.toBeUndefined()
      expect(result?.id).toBe(triggerId)
      expect(result?.triggerType).toBe('time')
      expect(result?.triggerTime).toBe('08:00')
      expect(result?.promptId).toBe(promptId)
      expect(result?.isEnabled).toBe(1)
    })

    it('should create a disabled trigger', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await createTrigger({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '12:00',
        promptId,
        isEnabled: 0,
      })

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result?.isEnabled).toBe(0)
    })
  })

  describe('updateTrigger', () => {
    it('should update trigger time', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '08:00',
        promptId,
        isEnabled: 1,
      })

      await updateTrigger(triggerId, { triggerTime: '10:00' })

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result?.triggerTime).toBe('10:00')
    })

    it('should update isEnabled status', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '08:00',
        promptId,
        isEnabled: 1,
      })

      await updateTrigger(triggerId, { isEnabled: 0 })

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result?.isEnabled).toBe(0)
    })

    it('should update multiple fields at once', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '08:00',
        promptId,
        isEnabled: 1,
      })

      await updateTrigger(triggerId, { triggerTime: '14:30', isEnabled: 0 })

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result?.triggerTime).toBe('14:30')
      expect(result?.isEnabled).toBe(0)
    })
  })

  describe('updateTriggerByPromptId', () => {
    it('should update trigger by prompt ID', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '08:00',
        promptId,
        isEnabled: 1,
      })

      await updateTriggerByPromptId(promptId, { triggerTime: '16:00', isEnabled: 0 })

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result?.triggerTime).toBe('16:00')
      expect(result?.isEnabled).toBe(0)
    })

    it('should update all triggers for a prompt ID', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId1 = uuidv7()
      const triggerId2 = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values([
        {
          id: triggerId1,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId,
          isEnabled: 1,
        },
        {
          id: triggerId2,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId,
          isEnabled: 1,
        },
      ])

      await updateTriggerByPromptId(promptId, { isEnabled: 0 })

      const triggers = await db.select().from(triggersTable).where(eq(triggersTable.promptId, promptId))
      expect(triggers).toHaveLength(2)
      expect(triggers.every((t) => t.isEnabled === 0)).toBe(true)
    })
  })

  describe('deleteTrigger', () => {
    it('should delete a trigger by ID', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values({
        id: triggerId,
        triggerType: 'time',
        triggerTime: '08:00',
        promptId,
        isEnabled: 1,
      })

      await deleteTrigger(triggerId)

      const result = await db.select().from(triggersTable).where(eq(triggersTable.id, triggerId)).get()
      expect(result).toBeUndefined()
    })

    it('should not affect other triggers when deleting', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId1 = uuidv7()
      const triggerId2 = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values([
        {
          id: triggerId1,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId,
          isEnabled: 1,
        },
        {
          id: triggerId2,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId,
          isEnabled: 1,
        },
      ])

      await deleteTrigger(triggerId1)

      const remainingTriggers = await db.select().from(triggersTable)
      expect(remainingTriggers).toHaveLength(1)
      expect(remainingTriggers[0]?.id).toBe(triggerId2)
    })
  })

  describe('deleteTriggerByPromptId', () => {
    it('should delete all triggers for a prompt ID', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId = uuidv7()
      const triggerId1 = uuidv7()
      const triggerId2 = uuidv7()

      await createPrompt(promptId)

      await db.insert(triggersTable).values([
        {
          id: triggerId1,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId,
          isEnabled: 1,
        },
        {
          id: triggerId2,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId,
          isEnabled: 1,
        },
      ])

      await deleteTriggerByPromptId(promptId)

      const result = await db.select().from(triggersTable).where(eq(triggersTable.promptId, promptId))
      expect(result).toHaveLength(0)
    })

    it('should not affect triggers for other prompts', async () => {
      const db = DatabaseSingleton.instance.db
      const promptId1 = uuidv7()
      const promptId2 = uuidv7()
      const triggerId1 = uuidv7()
      const triggerId2 = uuidv7()

      await createPrompt(promptId1)
      await createPrompt(promptId2)

      await db.insert(triggersTable).values([
        {
          id: triggerId1,
          triggerType: 'time',
          triggerTime: '08:00',
          promptId: promptId1,
          isEnabled: 1,
        },
        {
          id: triggerId2,
          triggerType: 'time',
          triggerTime: '09:00',
          promptId: promptId2,
          isEnabled: 1,
        },
      ])

      await deleteTriggerByPromptId(promptId1)

      const remainingTriggers = await db.select().from(triggersTable)
      expect(remainingTriggers).toHaveLength(1)
      expect(remainingTriggers[0]?.id).toBe(triggerId2)
      expect(remainingTriggers[0]?.promptId).toBe(promptId2)
    })
  })
})

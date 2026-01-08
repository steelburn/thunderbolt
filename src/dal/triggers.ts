import { DatabaseSingleton } from '@/db/singleton'
import { triggersTable } from '@/db/tables'
import { type Trigger } from '@/types'
import { eq } from 'drizzle-orm'

/**
 * Gets all triggers
 */
export const getAllTriggers = async (): Promise<Trigger[]> => {
  const db = DatabaseSingleton.instance.db
  return await db.select().from(triggersTable).where(eq(triggersTable.isEnabled, 1))
}

/**
 * Gets triggers by prompt ID
 */
export const getTriggersByPromptId = async (promptId: string): Promise<Trigger[]> => {
  const db = DatabaseSingleton.instance.db
  return await db.select().from(triggersTable).where(eq(triggersTable.promptId, promptId))
}

/**
 * Create a new trigger
 */
export const createTrigger = async (data: Trigger): Promise<void> => {
  const db = DatabaseSingleton.instance.db

  await db.insert(triggersTable).values(data)
}

/**
 * Updates a specific trigger by ID
 */
export const updateTrigger = async (
  id: string,
  data: Partial<Pick<Trigger, 'triggerType' | 'triggerTime' | 'isEnabled'>>,
): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  await db.update(triggersTable).set(data).where(eq(triggersTable.id, id))
}

/**
 * Updates a specific trigger by prompt ID
 */
export const updateTriggerByPromptId = async (
  promptId: string,
  data: Partial<Pick<Trigger, 'triggerType' | 'triggerTime' | 'isEnabled'>>,
): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  await db.update(triggersTable).set(data).where(eq(triggersTable.promptId, promptId))
}

/**
 * Deletes a specific trigger by ID
 */
export const deleteTrigger = async (id: string): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  await db.delete(triggersTable).where(eq(triggersTable.id, id))
}

/**
 * Deletes a specific trigger by prompt ID
 */
export const deleteTriggerByPromptId = async (promptId: string): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  await db.delete(triggersTable).where(eq(triggersTable.promptId, promptId))
}

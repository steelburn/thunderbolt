import { and, desc, eq, isNull } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from '../db/database-interface'
import { agentsTable, settingsTable } from '../db/tables'
import { clearNullableColumns, nowIso } from '../lib/utils'
import type { Agent } from '@/types'
import { getSettings } from './settings'

/**
 * Gets all agents from the database (excluding soft-deleted)
 * Sorted with system agents first, then alphabetically by name
 */
export const getAllAgents = async (db: AnyDrizzleDatabase): Promise<Agent[]> => {
  const results = await db
    .select()
    .from(agentsTable)
    .where(isNull(agentsTable.deletedAt))
    .orderBy(desc(agentsTable.isSystem), agentsTable.name)

  return results as Agent[]
}

/**
 * Gets all enabled agents from the database (excluding soft-deleted)
 */
export const getEnabledAgents = async (db: AnyDrizzleDatabase): Promise<Agent[]> => {
  const results = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.enabled, 1), isNull(agentsTable.deletedAt)))
    .orderBy(desc(agentsTable.isSystem), agentsTable.name)

  return results as Agent[]
}

/**
 * Gets a specific agent by ID (excluding soft-deleted)
 */
export const getAgent = async (db: AnyDrizzleDatabase, id: string): Promise<Agent | null> => {
  const agent = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
    .get()

  return agent ? (agent as Agent) : null
}

/**
 * Gets the system agent (built-in)
 */
export const getSystemAgent = async (db: AnyDrizzleDatabase): Promise<Agent | null> => {
  const agent = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.isSystem, 1), isNull(agentsTable.deletedAt)))
    .orderBy(agentsTable.name)
    .get()

  return agent ? (agent as Agent) : null
}

/**
 * Gets the currently selected agent from settings, or falls back to the system agent
 */
export const getSelectedAgent = async (db: AnyDrizzleDatabase): Promise<Agent> => {
  const settings = await getSettings(db, { selected_agent: String })
  const selectedAgentId = settings.selectedAgent

  if (selectedAgentId) {
    const agent = await getAgent(db, selectedAgentId)
    if (agent && agent.enabled) {
      return agent
    }
  }

  const systemAgent = await getSystemAgent(db)

  if (!systemAgent) {
    throw new Error('No system agent found')
  }

  return systemAgent
}

/**
 * Creates a new agent
 */
export const createAgent = async (
  db: AnyDrizzleDatabase,
  data: Partial<Agent> & Pick<Agent, 'id' | 'name' | 'type' | 'transport'>,
): Promise<void> => {
  await db.insert(agentsTable).values(data)
}

/**
 * Updates an agent (preserves defaultHash for modification tracking)
 */
export const updateAgent = async (db: AnyDrizzleDatabase, id: string, updates: Partial<Agent>): Promise<void> => {
  const { defaultHash, ...updateFields } = updates as Partial<Agent> & { defaultHash?: string }
  await db.update(agentsTable).set(updateFields).where(eq(agentsTable.id, id))
}

/**
 * Soft deletes an agent by ID (sets deletedAt datetime)
 */
export const deleteAgent = async (db: AnyDrizzleDatabase, id: string): Promise<void> => {
  await db
    .update(agentsTable)
    .set({ ...clearNullableColumns(agentsTable), deletedAt: nowIso() })
    .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
}

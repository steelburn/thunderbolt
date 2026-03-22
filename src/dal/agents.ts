import { and, desc, eq, isNull } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from '../db/database-interface'
import { agentsTable } from '../db/tables'
import type { Agent, DrizzleQueryWithPromise } from '@/types'

/**
 * Gets all agents (excluding soft-deleted).
 * System agents first, then alphabetically by name.
 */
export const getAllAgents = (db: AnyDrizzleDatabase) => {
  const query = db
    .select()
    .from(agentsTable)
    .where(isNull(agentsTable.deletedAt))
    .orderBy(desc(agentsTable.isSystem), agentsTable.name)

  return query as typeof query & DrizzleQueryWithPromise<Agent>
}

/**
 * Gets all enabled agents (excluding soft-deleted).
 */
export const getAvailableAgents = (db: AnyDrizzleDatabase) => {
  const query = db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.enabled, 1), isNull(agentsTable.deletedAt)))
    .orderBy(desc(agentsTable.isSystem), agentsTable.name)

  return query as typeof query & DrizzleQueryWithPromise<Agent>
}

/**
 * Gets a single agent by ID.
 */
export const getAgent = async (db: AnyDrizzleDatabase, id: string): Promise<Agent | undefined> => {
  const results = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))

  return results[0] as Agent | undefined
}

/**
 * Gets the currently selected agent from settings, falling back to the built-in agent.
 */
export const getSelectedAgent = async (db: AnyDrizzleDatabase): Promise<Agent> => {
  const { settingsTable } = await import('../db/tables')
  const settings = await db.select().from(settingsTable).where(eq(settingsTable.key, 'selected_agent'))

  if (settings.length > 0 && settings[0].value) {
    const agent = await getAgent(db, settings[0].value)
    if (agent) {
      return agent
    }
  }

  // Fall back to built-in agent
  const builtIn = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.type, 'built-in'), isNull(agentsTable.deletedAt)))

  if (builtIn.length > 0) {
    return builtIn[0] as Agent
  }

  throw new Error('No agents available')
}

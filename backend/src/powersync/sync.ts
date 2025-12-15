import {
  chatMessagesTable,
  chatThreadsTable,
  mcpServersTable,
  modelsTable,
  promptsTable,
  settingsTable,
  tasksTable,
  triggersTable,
} from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'

export type CrudOperation = {
  op: 'PUT' | 'PATCH' | 'DELETE'
  table: string
  id: string
  data?: Record<string, unknown>
}

/**
 * Map of table names to their Drizzle table definitions
 */
const TABLE_MAP = {
  settings: settingsTable,
  chat_threads: chatThreadsTable,
  chat_messages: chatMessagesTable,
  tasks: tasksTable,
  models: modelsTable,
  mcp_servers: mcpServersTable,
  prompts: promptsTable,
  triggers: triggersTable,
} as const

type AllowedTable = keyof typeof TABLE_MAP

const isAllowedTable = (table: string): table is AllowedTable => {
  return table in TABLE_MAP
}

/**
 * Build the values object for a table insert/update.
 * Maps the client data to the correct column names.
 */
const buildValues = (table: AllowedTable, id: string, userId: string, data: Record<string, unknown> = {}) => {
  const base = { id, userId }

  switch (table) {
    case 'settings':
      return {
        ...base,
        value: data.value as string | undefined,
        updatedAt: data.updated_at as number | undefined,
        defaultHash: data.default_hash as string | undefined,
      }

    case 'chat_threads':
      return {
        ...base,
        title: data.title as string | undefined,
        isEncrypted: data.is_encrypted as number | undefined,
        triggeredBy: data.triggered_by as string | undefined,
        wasTriggeredByAutomation: data.was_triggered_by_automation as number | undefined,
        contextSize: data.context_size as number | undefined,
      }

    case 'chat_messages':
      return {
        ...base,
        content: (data.content as string) ?? '',
        role: (data.role as string) ?? 'user',
        parts: data.parts as string | undefined,
        chatThreadId: (data.chat_thread_id as string) ?? '',
        modelId: data.model_id as string | undefined,
        parentId: data.parent_id as string | undefined,
        cache: data.cache as string | undefined,
        metadata: data.metadata as string | undefined,
      }

    case 'tasks':
      return {
        ...base,
        item: (data.item as string) ?? '',
        order: data.order as number | undefined,
        isComplete: data.is_complete as number | undefined,
        defaultHash: data.default_hash as string | undefined,
      }

    case 'models':
      return {
        ...base,
        provider: (data.provider as string) ?? 'custom',
        name: (data.name as string) ?? '',
        model: (data.model as string) ?? '',
        url: data.url as string | undefined,
        apiKey: data.api_key as string | undefined,
        isSystem: data.is_system as number | undefined,
        enabled: data.enabled as number | undefined,
        toolUsage: data.tool_usage as number | undefined,
        isConfidential: data.is_confidential as number | undefined,
        startWithReasoning: data.start_with_reasoning as number | undefined,
        contextWindow: data.context_window as number | undefined,
        deletedAt: data.deleted_at as number | undefined,
        defaultHash: data.default_hash as string | undefined,
        vendor: data.vendor as string | undefined,
        description: data.description as string | undefined,
      }

    case 'mcp_servers':
      return {
        ...base,
        name: (data.name as string) ?? '',
        type: data.type as string | undefined,
        url: data.url as string | undefined,
        command: data.command as string | undefined,
        args: data.args as string | undefined,
        enabled: data.enabled as number | undefined,
        createdAt: data.created_at as number | undefined,
        updatedAt: data.updated_at as number | undefined,
      }

    case 'prompts':
      return {
        ...base,
        title: data.title as string | undefined,
        prompt: (data.prompt as string) ?? '',
        modelId: (data.model_id as string) ?? '',
        deletedAt: data.deleted_at as number | undefined,
        defaultHash: data.default_hash as string | undefined,
      }

    case 'triggers':
      return {
        ...base,
        triggerType: (data.trigger_type as string) ?? 'time',
        triggerTime: data.trigger_time as string | undefined,
        promptId: (data.prompt_id as string) ?? '',
        isEnabled: data.is_enabled as number | undefined,
      }
  }
}

/**
 * Build the set object for a table update (excludes id and userId).
 */
const buildUpdateSet = (table: AllowedTable, data: Record<string, unknown> = {}) => {
  const values = buildValues(table, '', '', data)
  // Remove id and userId from the update set
  const { id: _id, userId: _userId, ...updateFields } = values as Record<string, unknown>
  // Filter out undefined values
  return Object.fromEntries(Object.entries(updateFields).filter(([, v]) => v !== undefined))
}

/**
 * Apply a CRUD operation from PowerSync to the appropriate table.
 *
 * PowerSync operations:
 * - PUT: Insert or replace (upsert)
 * - PATCH: Update specific fields
 * - DELETE: Set deleted_at timestamp (soft delete)
 */
export const applyOperation = async (database: unknown, userId: string, operation: CrudOperation): Promise<void> => {
  const { op, table: tableName, id, data } = operation
  const db = database as PgDatabase<never, never, never>

  if (!isAllowedTable(tableName)) {
    throw new Error(`Table '${tableName}' is not allowed for sync`)
  }

  const table = TABLE_MAP[tableName]

  switch (op) {
    case 'PUT': {
      const values = buildValues(tableName, id, userId, data)
      await db
        .insert(table)
        .values(values as never)
        .onConflictDoUpdate({
          target: table.id,
          set: buildUpdateSet(tableName, data) as never,
        })
      break
    }

    case 'PATCH': {
      if (!data || Object.keys(data).length === 0) {
        return
      }
      const updateSet = buildUpdateSet(tableName, data)
      if (Object.keys(updateSet).length > 0) {
        await db
          .update(table)
          .set(updateSet as never)
          .where(and(eq(table.id, id), eq((table as typeof settingsTable).userId, userId)))
      }
      break
    }

    case 'DELETE': {
      // Soft delete - set deleted_at timestamp
      // Only applicable for tables that have deletedAt column
      if (tableName === 'models' || tableName === 'prompts') {
        await db
          .update(table)
          .set({ deletedAt: Math.floor(Date.now() / 1000) } as never)
          .where(and(eq(table.id, id), eq((table as typeof modelsTable).userId, userId)))
      }
      // For other tables, we could either hard delete or ignore
      // For now, ignoring as per "rows are never deleted" requirement
      break
    }
  }
}

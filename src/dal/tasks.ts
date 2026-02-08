import { decrypt, encrypt } from '@/crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { DatabaseSingleton } from '../db/singleton'
import { tasksTable } from '../db/tables'
import { clearNullableColumns, nowIso } from '../lib/utils'
import type { Task } from '../types'

const TASKS_TABLE = 'tasks'
const ITEM_COLUMN = 'item'

const decryptItem = async (value: string | null): Promise<string | null> => decrypt(value, TASKS_TABLE, ITEM_COLUMN)

const encryptItem = async (plain: string | null): Promise<string | null> => {
  if (plain === null || plain === undefined) return plain
  return encrypt(plain, TASKS_TABLE, ITEM_COLUMN)
}

/**
 * Gets all tasks (excluding soft-deleted). Decrypts items in parallel when encrypted.
 */
export const getAllTasks = async (): Promise<Task[]> => {
  const db = DatabaseSingleton.instance.db
  const rows = (await db.select().from(tasksTable).where(isNull(tasksTable.deletedAt))) as Task[]
  const items = await Promise.all(rows.map((row) => decryptItem(row.item ?? null)))
  const tasks: Task[] = []
  for (let i = 0; i < rows.length; i++) {
    const item = items[i]
    if (item != null) tasks.push({ ...rows[i], item } as Task)
  }
  return tasks
}

/**
 * Gets all incomplete tasks, optionally filtered by search query (excluding soft-deleted).
 * Search is applied in memory after decryption (encrypted column cannot use SQL LIKE).
 */
export const getIncompleteTasks = async (searchQuery?: string): Promise<Task[]> => {
  const db = DatabaseSingleton.instance.db
  const result = (await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.isComplete, 0), isNull(tasksTable.deletedAt)))
    .orderBy(asc(tasksTable.order), desc(tasksTable.id))
    .limit(50)) as Task[]

  const items = await Promise.all(result.map((row) => decryptItem(row.item ?? null)))
  const decrypted: Task[] = []
  for (let i = 0; i < result.length; i++) {
    const item = items[i]
    if (item == null || item.trim() === '') continue
    const task = { ...result[i], item } as Task
    if (!searchQuery || item.toLowerCase().includes(searchQuery.toLowerCase())) decrypted.push(task)
  }
  return decrypted
}

/**
 * Gets the count of incomplete tasks (excluding soft-deleted)
 */
export const getIncompleteTasksCount = async (): Promise<number> => {
  const db = DatabaseSingleton.instance.db
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasksTable)
    .where(and(eq(tasksTable.isComplete, 0), isNull(tasksTable.deletedAt)))
  return count
}

/**
 * Update a task (preserves defaultHash for modification tracking). Encrypts item when writing.
 */
export const updateTask = async (id: string, updates: Partial<Task>): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  const { defaultHash, item, ...rest } = updates as Partial<Task> & { defaultHash?: string }
  const updateFields: Partial<Task> = { ...rest }
  if (item !== undefined) updateFields.item = (await encryptItem(item)) ?? undefined
  await db.update(tasksTable).set(updateFields).where(eq(tasksTable.id, id))
}

/**
 * Soft deletes a single task by ID (sets deletedAt datetime)
 * Scrubs all data for privacy
 * Only updates records that haven't been deleted yet to preserve original deletion datetimes
 */
export const deleteTask = async (id: string): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  await db
    .update(tasksTable)
    .set({ ...clearNullableColumns(tasksTable), deletedAt: nowIso() })
    .where(and(eq(tasksTable.id, id), isNull(tasksTable.deletedAt)))
}

/**
 * Soft deletes multiple tasks by their IDs (sets deletedAt datetime)
 * Scrubs all data for privacy
 * Only updates records that haven't been deleted yet to preserve original deletion datetimes
 */
export const deleteTasks = async (ids: string[]): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  await db
    .update(tasksTable)
    .set({ ...clearNullableColumns(tasksTable), deletedAt: nowIso() })
    .where(and(inArray(tasksTable.id, ids), isNull(tasksTable.deletedAt)))
}

/**
 * Creates a new task. Encrypts item when writing.
 */
export const createTask = async (data: Pick<Task, 'id' | 'item' | 'order' | 'isComplete'>): Promise<void> => {
  const db = DatabaseSingleton.instance.db
  const encryptedItem = await encryptItem(data.item ?? null)
  await db.insert(tasksTable).values({ ...data, item: encryptedItem ?? undefined })
}

/**
 * Creates multiple tasks by calling createTask for each (encrypt + insert in parallel).
 */
export const createTasks = async (
  data: ReadonlyArray<Pick<Task, 'id' | 'item' | 'order' | 'isComplete'>>,
): Promise<void> => {
  await Promise.all(data.map((d) => createTask(d)))
}

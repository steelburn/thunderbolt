import { sql } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from '@/db/database-interface'
import type { ColumnInfo, DbObject, QueryResult, SqliteExplorerAdapter } from './types'

const TEMP_VIEW_NAME = '__db_explorer_temp'

/** Escape a SQLite identifier (table/view name) */
const escapeId = (name: string): string => `"${name.replace(/"/g, '""')}"`

/** Check if a SQL string is a SELECT-like statement (safe to create a view from) */
const isSelectStatement = (query: string): boolean => {
  const trimmed = query.trim().toUpperCase()
  return trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')
}

/**
 * Parse PRAGMA table_info results from positional arrays.
 * PRAGMA table_info returns: [cid, name, type, notnull, dflt_value, pk]
 */
const parsePragmaRow = (row: unknown[]): ColumnInfo => ({
  name: String(row[1]),
  type: String(row[2] ?? 'TEXT'),
  notnull: row[3] === 1,
  pk: row[5] === 1,
  defaultValue: row[4] != null ? String(row[4]) : null,
})

/**
 * Extract column names from an arbitrary SQL query using a temp view.
 * Creates a temp view from the query, reads its column info, then drops it.
 */
const getColumnsFromQuery = async (db: AnyDrizzleDatabase, query: string): Promise<string[]> => {
  try {
    await db.run(sql.raw(`DROP VIEW IF EXISTS ${escapeId(TEMP_VIEW_NAME)}`))
    await db.run(sql.raw(`CREATE TEMP VIEW ${escapeId(TEMP_VIEW_NAME)} AS ${query}`))
    const pragmaRows = (await db.all(sql.raw(`PRAGMA table_info(${escapeId(TEMP_VIEW_NAME)})`))) as unknown[][]
    await db.run(sql.raw(`DROP VIEW IF EXISTS ${escapeId(TEMP_VIEW_NAME)}`))
    return pragmaRows.map((row) => String(row[1]))
  } catch {
    // Cleanup on error
    try {
      await db.run(sql.raw(`DROP VIEW IF EXISTS ${escapeId(TEMP_VIEW_NAME)}`))
    } catch {
      // Ignore cleanup errors
    }
    return []
  }
}

/**
 * Create a SqliteExplorerAdapter for a Drizzle SQLite database.
 * Works with any Drizzle sqlite-proxy backend (wa-sqlite, bun-sqlite, libsql-tauri, powersync).
 */
export const createDrizzleExplorerAdapter = (db: AnyDrizzleDatabase): SqliteExplorerAdapter => ({
  async getObjects(): Promise<DbObject[]> {
    const rows = (await db.all(
      sql.raw(
        `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' AND name NOT LIKE '__db_explorer_%' ORDER BY type, name`,
      ),
    )) as unknown[][]

    return rows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]) as 'table' | 'view',
    }))
  },

  async getColumns(objectName: string): Promise<ColumnInfo[]> {
    const rows = (await db.all(sql.raw(`PRAGMA table_info(${escapeId(objectName)})`))) as unknown[][]
    return rows.map(parsePragmaRow)
  },

  async getRowCount(objectName: string): Promise<number> {
    const rows = (await db.all(sql.raw(`SELECT COUNT(*) FROM ${escapeId(objectName)}`))) as unknown[][]
    return Number(rows[0]?.[0] ?? 0)
  },

  async execute(query: string): Promise<QueryResult> {
    if (!isSelectStatement(query)) {
      await db.run(sql.raw(query))
      return { columns: ['result'], rows: [['Statement executed successfully']] }
    }

    // Get column names via temp view approach
    const columns = await getColumnsFromQuery(db, query)

    // Execute the actual query
    const rows = (await db.all(sql.raw(query))) as unknown[][]

    // If temp view approach didn't yield columns, generate indexed names
    const finalColumns =
      columns.length > 0
        ? columns
        : rows.length > 0
          ? Array.from({ length: (rows[0] as unknown[]).length }, (_, i) => `col_${i}`)
          : []

    return { columns: finalColumns, rows }
  },
})

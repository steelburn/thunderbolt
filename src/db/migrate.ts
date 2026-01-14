import { migrations } from '@/drizzle/_migrations'
import { sql } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from './database-interface'

export type ProxyMigrator = (migrationQueries: string[]) => Promise<void>

/**
 * Get the latest migration version hash
 * Used for sync version compatibility checking between devices
 */
export function getLatestMigrationVersion(): string {
  return migrations[migrations.length - 1]?.hash ?? '0000_initial'
}

/**
 * List of tables to mark as CRRs (Conflict-free Replicated Relations) for cr-sqlite sync
 */
const CRR_TABLES = [
  'settings',
  'chat_threads',
  'chat_messages',
  'tasks',
  'models',
  'mcp_servers',
  'prompts',
  'triggers',
] as const

/**
 * Splits a SQL string into separate statements
 * @param sql SQL string that may contain multiple statements
 * @returns Array of SQL statements
 */
function splitSqlStatements(sql: string): string[] {
  // Split by semicolons, but handle the special case of statement-breakpoint comments
  return sql
    .split(/(?:-->\s*statement-breakpoint|;)/g)
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0)
}

/**
 * Extract table name from an ALTER TABLE statement
 * @param statement SQL ALTER TABLE statement
 * @returns Table name or null if not an ALTER TABLE statement
 */
function extractAlterTableName(statement: string): string | null {
  // Match: ALTER TABLE `table_name` or ALTER TABLE "table_name" or ALTER TABLE table_name
  const match = statement.match(/^\s*ALTER\s+TABLE\s+[`"]?(\w+)[`"]?/i)
  return match ? match[1] : null
}

/**
 * Check if cr-sqlite extension is loaded by testing for crsql_begin_alter function
 * @param db Database instance
 * @returns true if cr-sqlite is available
 */
async function isCrSqliteAvailable(db: AnyDrizzleDatabase): Promise<boolean> {
  try {
    // Try to call a cr-sqlite function - if it fails, cr-sqlite is not loaded
    await db.run(sql.raw(`SELECT crsql_db_version()`))
    return true
  } catch {
    return false
  }
}

/**
 * Check if a table is already registered as a CRR by looking for its clock table
 * @param db Database instance
 * @param tableName Name of the table to check
 * @returns true if the table is already a CRR
 */
async function isTableCRR(db: AnyDrizzleDatabase, tableName: string): Promise<boolean> {
  const clockTableExists = await db.all(
    sql.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}__crsql_clock'`),
  )
  return clockTableExists.length > 0
}

/**
 * Executes database migrations.
 *
 * ============================================================================
 * CR-SQLITE SCHEMA MIGRATION HANDLING
 * ============================================================================
 *
 * When running with cr-sqlite, ALTER TABLE statements on CRR tables need special
 * handling. cr-sqlite maintains internal metadata (shadow tables, triggers) for
 * CRDT sync, and this metadata must be updated when the schema changes.
 *
 * We wrap ALTER TABLE statements with:
 * - crsql_begin_alter('table') - tells cr-sqlite to prepare for schema changes
 * - crsql_commit_alter('table') - updates the CRDT metadata to reflect new schema
 *
 * KNOWN ISSUE - DB_VERSION RESET:
 * The crsql_begin_alter/crsql_commit_alter functions have a side effect: they reset
 * the crsql_db_version() and clear pending changes from crsql_changes. This causes
 * local changes made before migration to be "forgotten" by cr-sqlite.
 *
 * We've implemented a workaround in use-app-initialization.ts that:
 * 1. Captures pending changes BEFORE migrations run
 * 2. Runs migrations (with the cr-sqlite functions to update CRR metadata)
 * 3. Pushes the captured changes AFTER migrations complete
 *
 * WHY WE CAN'T SKIP THE CR-SQLITE FUNCTIONS:
 * If we run ALTER TABLE without crsql_begin_alter/crsql_commit_alter, the CRR
 * metadata becomes stale and queries fail with "expected X values, got Y" errors.
 * The triggers expect the old schema but the table has the new columns.
 *
 * IMPORTANT: begin_alter/commit_alter can only be used on tables that are ALREADY
 * CRRs. For tables that haven't been registered as CRRs yet, we:
 * 1. Run the ALTER TABLE normally
 * 2. The table will be registered as a CRR (with the new schema) in initializeCRRs()
 *
 * FUTURE RESEARCH:
 * - Investigate if cr-sqlite has a way to preserve changes during alter
 * - Consider filing a bug report with vlcn-io/cr-sqlite
 * - Look into manually preserving clock table data during migrations
 *
 * @returns A promise that resolves when the migrations are complete.
 */
export async function migrate(db: AnyDrizzleDatabase) {
  const startTime = performance.now()

  await db.run(sql`
		CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash text NOT NULL UNIQUE,
			created_at numeric
		)
	`)

  // Get current migrations from database
  const rows = await db.all(sql`SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY created_at DESC`)

  // Convert the rows to a more usable format
  const dbMigrations = rows.map(([id, hash, created_at]: any) => ({
    id,
    hash,
    created_at,
  }))

  const hasBeenRun = (hash: string) =>
    dbMigrations.find((dbMigration: any) => {
      return dbMigration?.hash === hash
    })

  // Check if cr-sqlite is available for ALTER TABLE handling
  const hasCrSqlite = await isCrSqliteAvailable(db)

  // Apply migrations that haven't been run yet
  let migrationsRun = 0

  for (const migration of migrations) {
    if (!hasBeenRun(migration.hash)) {
      try {
        // Split migration into separate statements and execute each one
        const statements = splitSqlStatements(migration.sql)

        for (const statement of statements) {
          try {
            // Check if this is an ALTER TABLE statement that needs special cr-sqlite handling
            const alterTableName = extractAlterTableName(statement)

            if (alterTableName && hasCrSqlite && CRR_TABLES.includes(alterTableName as (typeof CRR_TABLES)[number])) {
              // Only use begin_alter/commit_alter if the table is ALREADY a CRR
              // On fresh databases, tables aren't CRRs yet, so we just run the ALTER
              // The table will be registered as a CRR with the correct schema in initializeCRRs()
              const isCRR = await isTableCRR(db, alterTableName)

              if (isCRR) {
                // Table is already a CRR - wrap ALTER with cr-sqlite functions
                // This updates the CRDT metadata to reflect the schema change
                await db.run(sql.raw(`SELECT crsql_begin_alter('${alterTableName}')`))
                await db.run(sql.raw(statement))
                await db.run(sql.raw(`SELECT crsql_commit_alter('${alterTableName}')`))
              } else {
                // Table is not yet a CRR - just run the ALTER normally
                // initializeCRRs() will register it with the new schema after all migrations
                await db.run(sql.raw(statement))
              }
            } else {
              await db.run(sql.raw(statement))
            }
          } catch (statementError) {
            console.error(`Error executing statement in migration ${migration.name}:`, statementError)
            console.error('Statement:', statement)
            throw statementError
          }
        }

        // Record the migration as complete
        await db.run(
          sql`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${migration.hash}, ${Date.now()})`,
        )
        migrationsRun++
      } catch (error) {
        console.error(`Failed to apply migration ${migration.name}:`, error)
        throw error
      }
    }
  }

  const elapsedMs = Math.round(performance.now() - startTime)
  console.info(`Ran ${migrationsRun} migration${migrationsRun === 1 ? '' : 's'} in ${elapsedMs} ms`)

  return Promise.resolve()
}

/**
 * Initialize tables as CRRs (Conflict-free Replicated Relations) for cr-sqlite sync.
 * This should be called after migrations when using cr-sqlite.
 *
 * This function handles two scenarios:
 * 1. New tables that haven't been registered as CRRs yet → uses crsql_as_crr()
 * 2. Existing CRRs that may have stale metadata → uses begin_alter/commit_alter
 *
 * IMPORTANT - SIDE EFFECT:
 * For existing CRRs (scenario 2), the crsql_begin_alter/crsql_commit_alter calls
 * will reset the crsql_db_version() and clear pending changes. This is why we
 * capture pending changes BEFORE migrations in use-app-initialization.ts.
 *
 * The begin_alter/commit_alter calls are necessary to refresh CRR metadata after
 * any schema changes. Without them, queries would fail with column count mismatches.
 *
 * @param db - The database instance
 * @returns A promise that resolves when CRR initialization is complete
 */
export async function initializeCRRs(db: AnyDrizzleDatabase): Promise<void> {
  const startTime = performance.now()
  let tablesInitialized = 0

  for (const tableName of CRR_TABLES) {
    try {
      // Check if table exists before trying to make it a CRR
      const tableExists = await db.all(
        sql.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`),
      )

      if (tableExists.length > 0) {
        // Check if this table is already a CRR by looking for its clock table
        const clockTableExists = await db.all(
          sql.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}__crsql_clock'`),
        )

        if (clockTableExists.length > 0) {
          // Table is already a CRR - refresh its metadata to handle any schema changes
          // that may have been applied without proper cr-sqlite handling
          await db.run(sql.raw(`SELECT crsql_begin_alter('${tableName}')`))
          await db.run(sql.raw(`SELECT crsql_commit_alter('${tableName}')`))
        } else {
          // New table - register it as a CRR for the first time
          await db.run(sql.raw(`SELECT crsql_as_crr('${tableName}')`))
        }
        tablesInitialized++
      }
    } catch (error) {
      // If cr-sqlite is not loaded, this will fail - that's expected for non-crsqlite databases
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('no such function: crsql_as_crr')) {
        console.warn('CRR initialization skipped - cr-sqlite extension not loaded')
        return
      }
      console.error(`Failed to initialize CRR for table ${tableName}:`, error)
      throw error
    }
  }

  const elapsedMs = Math.round(performance.now() - startTime)
  console.info(`Initialized ${tablesInitialized} table${tablesInitialized === 1 ? '' : 's'} as CRRs in ${elapsedMs} ms`)
}

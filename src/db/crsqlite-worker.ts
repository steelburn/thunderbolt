/**
 * Web Worker for cr-sqlite database operations
 * This worker handles all SQLite operations with CRDT sync support
 */

// Suppress console output in test environments (worker has separate console from main thread)
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
  console.error = () => {}
  console.warn = () => {}
  console.info = () => {}
}

import initWasm, { type DB } from '@vlcn.io/crsqlite-wasm'
import tblrx from '@vlcn.io/rx-tbl'

// SQLite compatible types for parameter binding
type SQLiteCompatibleType = number | string | Uint8Array | Array<number> | bigint | null

type WorkerRequest = {
  id: number
  method:
    | 'init'
    | 'exec'
    | 'close'
    | 'getSiteId'
    | 'getChanges'
    | 'applyChanges'
    | 'subscribeToChanges'
    | 'unsubscribeFromChanges'
  params?: {
    filename?: string
    sql?: string
    params?: unknown[]
    method?: 'get' | 'all' | 'values' | 'run'
    sinceVersion?: string // BigInt serialized as string for postMessage
    changes?: unknown[] // Changes with BigInt serialized as strings
  }
}

type WorkerResponse = {
  id: number
  result?: {
    rows?: unknown[] | unknown
    success?: boolean
    siteId?: string
    changes?: unknown[] // Changes with BigInt serialized as strings
    dbVersion?: string // BigInt serialized as string for postMessage
  }
  error?: string
}

/**
 * Represents a change record from crsql_changes
 */
export type CRSQLChange = {
  table: string
  pk: Uint8Array
  cid: string
  val: unknown
  col_version: bigint
  db_version: bigint
  site_id: Uint8Array
  cl: number
  seq: number
}

let db: DB | null = null
let rxDispose: (() => void) | null = null
let changeSubscription: (() => void) | null = null

// Queue to serialize all database operations
type QueuedOperation = {
  fn: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

const operationQueue: QueuedOperation[] = []
let processingPromise: Promise<void> | null = null

/**
 * Execute an operation serially in the queue to prevent concurrent access issues
 */
const queueOperation = <T>(fn: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    operationQueue.push({
      fn,
      resolve: resolve as (value: unknown) => void,
      reject: reject as (error: unknown) => void,
    })

    // Start processing if not already processing
    if (!processingPromise) {
      processingPromise = processQueue()
    }
  })
}

/**
 * Process queued operations one at a time
 */
const processQueue = async (): Promise<void> => {
  while (operationQueue.length > 0) {
    const operation = operationQueue.shift()!
    try {
      const result = await operation.fn()
      operation.resolve(result)
    } catch (error) {
      operation.reject(error)
    }
  }

  // Mark as no longer processing
  processingPromise = null
}

/**
 * Initialize the SQLite database with cr-sqlite extension
 */
const initDatabase = async (filename: string): Promise<void> => {
  if (db !== null) {
    // Already initialized
    return
  }

  // Load cr-sqlite WASM module
  //
  // Why we copy crsqlite.wasm to the public folder:
  // 1. The @vlcn.io/crsqlite-wasm package doesn't export the .wasm file in its package.json
  //    exports, so Vite's ?url import syntax fails with "Missing specifier" error
  // 2. Web Workers have a different base URL context, so relative imports don't resolve
  //    correctly when the worker is bundled
  // 3. Serving from /public ensures the file is available at a known, absolute URL
  //    that works in both development (Vite dev server) and production builds
  // 4. The postinstall script in package.json copies the file automatically after
  //    `bun install` to keep it in sync with the package version
  const sqlite3 = await initWasm(() => '/crsqlite.wasm')

  // For in-memory databases, pass undefined to skip IndexedDB persistence
  const isInMemory = filename === ':memory:'

  // Open database (cr-sqlite automatically uses IDBBatchAtomicVFS for persistence)
  db = await sqlite3.open(isInMemory ? undefined : filename)

  if (isInMemory) {
    console.warn('Using in-memory SQLite database (data will not persist)')
  } else {
    console.info(`cr-sqlite worker: Database opened with site_id: ${db.siteid}`)
  }

  // Set up reactive table listener for change notifications
  const rx = tblrx(db)
  rxDispose = () => rx.dispose()
}

/**
 * Execute SQL statement (internal - should be called through queueOperation)
 */
const execSqlInternal = async (
  sql: string,
  params: unknown[],
  returnMode: 'get' | 'all' | 'values' | 'run',
): Promise<WorkerResponse['result']> => {
  if (!db) {
    throw new Error('Database not initialized')
  }

  try {
    if (returnMode === 'run') {
      await db.exec(sql, params as any)
      return { rows: [] }
    }

    // Execute and get results as arrays (matches Drizzle's expected format)
    const results = await db.execA(sql, params as any)

    if (returnMode === 'get') {
      return { rows: results.length > 0 ? results[0] : undefined }
    }

    return { rows: results }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[Worker] Error executing SQL:`, errorMsg, '\nSQL:', sql.substring(0, 100))
    throw error
  }
}

/**
 * Execute SQL statement (queued to prevent concurrent access)
 */
const execSql = async (
  sql: string,
  params: unknown[],
  returnMode: 'get' | 'all' | 'values' | 'run',
): Promise<WorkerResponse['result']> => {
  return queueOperation(() => execSqlInternal(sql, params, returnMode))
}

/**
 * Get the site ID of the current database
 */
const getSiteId = (): string => {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db.siteid
}

/**
 * Type for serialized changes returned via postMessage (BigInt as strings)
 */
type SerializedCRSQLChangeOut = Omit<CRSQLChange, 'col_version' | 'db_version'> & {
  col_version: string
  db_version: string
}

/**
 * Get changes from crsql_changes since the given version
 * Returns BigInt values as strings for postMessage compatibility
 *
 * IMPORTANT: Only returns changes from the LOCAL site (our own changes).
 * Changes received from other devices (via applyChanges) have different site_ids
 * and should not be re-pushed to the server.
 *
 * This prevents a race condition where:
 * 1. Push captures dbVersion at start
 * 2. Pull applies remote changes, incrementing dbVersion
 * 3. Without site_id filtering, those remote changes would be re-pushed
 */
const getChangesInternal = async (
  sinceVersion: string | bigint,
): Promise<{ changes: SerializedCRSQLChangeOut[]; dbVersion: string }> => {
  if (!db) {
    throw new Error('Database not initialized')
  }

  // Convert sinceVersion from string if needed (from postMessage)
  const sinceVersionBigInt = typeof sinceVersion === 'string' ? BigInt(sinceVersion) : sinceVersion

  // Get the current db version
  const versionResult = await db.execA<[bigint]>('SELECT crsql_db_version()')
  const dbVersion = versionResult[0]?.[0] ?? 0n

  // Get only LOCAL changes since the given version
  // Filter by site_id = crsql_site_id() to exclude changes from other devices
  // This is crucial for preventing re-pushing of changes received via sync
  const changes = await db.execO<CRSQLChange>(
    `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
       FROM crsql_changes
       WHERE db_version > ? AND site_id = crsql_site_id()
       ORDER BY db_version, seq`,
    [sinceVersionBigInt],
  )

  // Serialize BigInt values as strings for postMessage
  const serializedChanges: SerializedCRSQLChangeOut[] = changes.map((change) => ({
    ...change,
    col_version: change.col_version.toString(),
    db_version: change.db_version.toString(),
  }))

  return { changes: serializedChanges, dbVersion: dbVersion.toString() }
}

/**
 * Get changes since a given version (queued)
 */
const getChanges = async (
  sinceVersion: string | bigint,
): Promise<{ changes: SerializedCRSQLChangeOut[]; dbVersion: string }> => {
  return queueOperation(() => getChangesInternal(sinceVersion))
}

/**
 * Apply remote changes to the local database
 */
/**
 * Type for changes received from postMessage (BigInt serialized as strings)
 */
type SerializedCRSQLChange = Omit<CRSQLChange, 'col_version' | 'db_version'> & {
  col_version: string | bigint
  db_version: string | bigint
}

const applyChangesInternal = async (changes: SerializedCRSQLChange[]): Promise<{ dbVersion: string }> => {
  if (!db) {
    throw new Error('Database not initialized')
  }

  if (changes.length === 0) {
    // Still return current db version even if no changes to apply
    const versionResult = await db.execA<[bigint]>('SELECT crsql_db_version()')
    const currentDbVersion = versionResult[0]?.[0] ?? 0n
    return { dbVersion: currentDbVersion.toString() }
  }

  // Insert changes into crsql_changes - cr-sqlite will merge them
  // Note: Using db.exec instead of prepared statements because stmt.run doesn't
  // correctly bind Uint8Array and BigInt parameters for virtual tables
  for (const change of changes) {
    // Convert string versions back to BigInt (they were serialized for postMessage)
    const colVersion = typeof change.col_version === 'string' ? BigInt(change.col_version) : change.col_version
    const dbVersion = typeof change.db_version === 'string' ? BigInt(change.db_version) : change.db_version

    await db.exec(
      `INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        change.table,
        change.pk,
        change.cid,
        change.val as SQLiteCompatibleType,
        colVersion,
        dbVersion,
        change.site_id,
        change.cl,
        change.seq,
      ],
    )
  }

  // Return the current db version after applying changes
  const versionResult = await db.execA<[bigint]>('SELECT crsql_db_version()')
  const currentDbVersion = versionResult[0]?.[0] ?? 0n
  return { dbVersion: currentDbVersion.toString() }
}

/**
 * Apply changes (queued)
 * Changes come from postMessage with BigInt serialized as strings
 * Returns the current db version after applying changes
 */
const applyChanges = async (changes: SerializedCRSQLChange[]): Promise<{ dbVersion: string }> => {
  return queueOperation(() => applyChangesInternal(changes))
}

/**
 * Subscribe to database changes
 * Notifies main thread when any table changes (for sync push triggers)
 */
const subscribeToChanges = (): void => {
  if (!db) {
    throw new Error('Database not initialized')
  }

  // Unsubscribe from any existing subscription
  if (changeSubscription) {
    changeSubscription()
    changeSubscription = null
  }

  // Get the reactive wrapper (recreate it since we disposed in init)
  const rx = tblrx(db)

  // Subscribe to all table changes
  // The callback is triggered whenever any table is modified
  changeSubscription = rx.onAny(() => {
    // Notify main thread that local changes occurred
    // The main thread will then fetch and push the changes
    self.postMessage({
      id: -2, // Special ID for change notifications
      result: { tablesChanged: true },
    })
  })

  // Store dispose function
  rxDispose = () => {
    if (changeSubscription) {
      changeSubscription()
      changeSubscription = null
    }
    rx.dispose()
  }
}

/**
 * Unsubscribe from database changes
 */
const unsubscribeFromChanges = (): void => {
  if (changeSubscription) {
    changeSubscription()
    changeSubscription = null
  }
}

/**
 * Close the database
 */
const closeDatabase = async (): Promise<void> => {
  // Clean up rx-tbl subscription first
  if (rxDispose) {
    rxDispose()
    rxDispose = null
  }

  if (db !== null) {
    // Finalize cr-sqlite before closing
    await db.exec('SELECT crsql_finalize()')
    await db.close()
    db = null
    console.info('cr-sqlite worker: Database closed')
  }
}

/**
 * Handle incoming messages from the main thread
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, params } = event.data
  const response: WorkerResponse = { id }

  try {
    switch (method) {
      case 'init':
        await initDatabase(params?.filename ?? ':memory:')
        response.result = { success: true }
        break

      case 'exec':
        response.result = await execSql(params?.sql ?? '', params?.params ?? [], params?.method ?? 'all')
        break

      case 'getSiteId':
        response.result = { siteId: getSiteId() }
        break

      case 'getChanges': {
        // sinceVersion comes as string from postMessage, default to '0'
        const { changes, dbVersion } = await getChanges(params?.sinceVersion ?? '0')
        response.result = { changes, dbVersion }
        break
      }

      case 'applyChanges': {
        const applyResult = await applyChanges((params?.changes ?? []) as SerializedCRSQLChange[])
        response.result = { success: true, dbVersion: applyResult.dbVersion }
        break
      }

      case 'subscribeToChanges':
        subscribeToChanges()
        response.result = { success: true }
        break

      case 'unsubscribeFromChanges':
        unsubscribeFromChanges()
        response.result = { success: true }
        break

      case 'close':
        await closeDatabase()
        response.result = { success: true }
        break

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  } catch (error) {
    // Suppress expected "no such table" errors during migrations
    const errorMsg = error instanceof Error ? error.message : String(error)
    // Only log in non-test environments to reduce test noise
    if (!errorMsg.includes('no such table: __drizzle_migrations')) {
      if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
        console.error('cr-sqlite worker error:', error)
      }
    }
    response.error = errorMsg
  }

  self.postMessage(response)
}

// Signal that worker is ready
self.postMessage({ id: -1, result: { ready: true } })

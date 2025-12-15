import { type PowerSyncSQLiteDatabase, wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver'
import { PowerSyncDatabase } from '@powersync/web'
import type { AnyDrizzleDatabase, DatabaseInterface } from './database-interface'
import { PowerSyncConnector, type PowerSyncConfig } from './powersync-connector'
import { drizzleSchema, PowerSyncAppSchema } from './powersync-schema'

/**
 * PowerSync database wrapper that syncs data across devices.
 *
 * This wraps PowerSync's web SDK and integrates it with Drizzle ORM,
 * allowing us to use the same Drizzle query syntax while getting
 * automatic sync capabilities.
 */
export class PowerSyncDatabaseWrapper implements DatabaseInterface {
  private powerSyncDb: PowerSyncDatabase | null = null
  private _db: PowerSyncSQLiteDatabase<typeof drizzleSchema> | null = null
  private connector: PowerSyncConnector | null = null
  private config: PowerSyncConfig | null = null

  get db(): AnyDrizzleDatabase {
    if (!this._db) {
      throw new Error('PowerSyncDatabase not initialized. Call initialize() first.')
    }
    // Cast to AnyDrizzleDatabase - the schemas are compatible for the synced tables
    return this._db as unknown as AnyDrizzleDatabase
  }

  get powerSync(): PowerSyncDatabase {
    if (!this.powerSyncDb) {
      throw new Error('PowerSyncDatabase not initialized. Call initialize() first.')
    }
    return this.powerSyncDb
  }

  /**
   * Configure PowerSync connection settings.
   * Must be called before initialize().
   */
  configure(config: PowerSyncConfig): void {
    this.config = config
  }

  async initialize(path: string): Promise<void> {
    if (this._db) {
      return // Already initialized
    }

    // Extract filename from path
    const dbFilename = path.includes('/') ? path.split('/').pop() || 'thunderbolt.db' : path

    // Create the PowerSync database instance
    this.powerSyncDb = new PowerSyncDatabase({
      database: {
        dbFilename,
      },
      schema: PowerSyncAppSchema,
    })

    // Wrap PowerSync with Drizzle for type-safe queries
    this._db = wrapPowerSyncWithDrizzle(this.powerSyncDb, {
      schema: drizzleSchema,
    })

    console.warn(`PowerSync database initialized with filename: ${dbFilename}`)

    // If config is set, connect to the PowerSync service
    if (this.config) {
      await this.connect()
    }
  }

  /**
   * Connect to the PowerSync service for syncing.
   * Requires configure() to be called first with valid config.
   */
  async connect(): Promise<void> {
    if (!this.powerSyncDb) {
      throw new Error('PowerSyncDatabase not initialized. Call initialize() first.')
    }

    if (!this.config) {
      throw new Error('PowerSync config not set. Call configure() first.')
    }

    this.connector = new PowerSyncConnector(this.config)
    await this.powerSyncDb.connect(this.connector)
    console.info('PowerSync connected to sync service')
  }

  /**
   * Disconnect from the PowerSync service.
   * The local database will still work, just without syncing.
   */
  async disconnect(): Promise<void> {
    if (this.powerSyncDb) {
      await this.powerSyncDb.disconnect()
      console.info('PowerSync disconnected from sync service')
    }
  }

  /**
   * Wait for the first sync to complete.
   * Useful for ensuring data is available before rendering UI.
   */
  async waitForFirstSync(): Promise<void> {
    if (!this.powerSyncDb) {
      throw new Error('PowerSyncDatabase not initialized. Call initialize() first.')
    }

    await this.powerSyncDb.waitForFirstSync()
    console.info('PowerSync first sync completed')
  }

  /**
   * Get the current sync status.
   */
  get syncStatus() {
    return this.powerSyncDb?.currentStatus ?? null
  }

  async close(): Promise<void> {
    if (this.powerSyncDb) {
      await this.disconnect()
      await this.powerSyncDb.close()
      this.powerSyncDb = null
      this._db = null
      this.connector = null
      console.info('PowerSync database closed')
    }
  }
}

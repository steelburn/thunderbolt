/**
 * HTTP-based sync utilities for initial app sync operations
 * Used during app initialization to push/pull changes before WebSocket is established
 */

import type { KyInstance } from 'ky'
import type { CRSQLChange } from './crsqlite-worker'
import { getLatestMigrationVersion } from './migrate'
import { DatabaseSingleton } from './singleton'

const SYNC_VERSION_KEY = 'thunderbolt_sync_version'
const SYNC_SERVER_VERSION_KEY = 'thunderbolt_server_version'
const SITE_ID_KEY = 'thunderbolt_site_id'

/**
 * Serialized change format for network transport
 */
export type SerializedChange = {
  table: string
  pk: string // base64 encoded
  cid: string
  val: unknown
  col_version: string // bigint as string
  db_version: string // bigint as string
  site_id: string // base64 encoded
  cl: number
  seq: number
}

/**
 * Response from sync push endpoint
 */
type SyncPushResponse = {
  success: boolean
  serverVersion: string
  needsUpgrade?: boolean
  requiredVersion?: string
}

/**
 * Response from sync pull endpoint
 */
type SyncPullResponse = {
  changes: SerializedChange[]
  serverVersion: string
  needsUpgrade?: boolean
  requiredVersion?: string
}

/**
 * Encode Uint8Array to base64 string
 */
const encodeBase64 = (data: Uint8Array): string => {
  const bytes = Array.from(data)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Decode base64 string to Uint8Array
 */
const decodeBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Serialize a CRSQLChange for network transport
 */
const serializeChange = (change: CRSQLChange): SerializedChange => ({
  table: change.table,
  pk: encodeBase64(change.pk),
  cid: change.cid,
  val: change.val,
  col_version: change.col_version.toString(),
  db_version: change.db_version.toString(),
  site_id: encodeBase64(change.site_id),
  cl: change.cl,
  seq: change.seq,
})

/**
 * Deserialize a network change to CRSQLChange
 */
const deserializeChange = (serialized: SerializedChange): CRSQLChange => ({
  table: serialized.table,
  pk: decodeBase64(serialized.pk),
  cid: serialized.cid,
  val: serialized.val,
  col_version: BigInt(serialized.col_version),
  db_version: BigInt(serialized.db_version),
  site_id: decodeBase64(serialized.site_id),
  cl: serialized.cl,
  seq: serialized.seq,
})

/**
 * Get the last synced local db version
 */
const getLastSyncedVersion = (): bigint => {
  const stored = localStorage.getItem(SYNC_VERSION_KEY)
  return stored ? BigInt(stored) : 0n
}

/**
 * Set the last synced local db version
 */
const setLastSyncedVersion = (version: bigint): void => {
  localStorage.setItem(SYNC_VERSION_KEY, version.toString())
}

/**
 * Get the last known server version
 */
const getServerVersion = (): bigint => {
  const stored = localStorage.getItem(SYNC_SERVER_VERSION_KEY)
  return stored ? BigInt(stored) : 0n
}

/**
 * Set the last known server version
 */
const setServerVersion = (version: bigint): void => {
  localStorage.setItem(SYNC_SERVER_VERSION_KEY, version.toString())
}

/**
 * Get or register site ID for this device
 */
export const getSiteId = async (): Promise<string> => {
  const storedSiteId = localStorage.getItem(SITE_ID_KEY)
  if (storedSiteId) {
    return storedSiteId
  }

  const db = DatabaseSingleton.instance.syncableDatabase
  const siteId = await db.getSiteId()
  localStorage.setItem(SITE_ID_KEY, siteId)
  return siteId
}

/**
 * Push local changes to the server via HTTP
 * Used during initial sync before WebSocket is established
 */
export const pushChangesHttp = async (httpClient: KyInstance): Promise<void> => {
  if (!DatabaseSingleton.instance.supportsSyncing) {
    return
  }

  const db = DatabaseSingleton.instance.syncableDatabase
  const lastSyncedVersion = getLastSyncedVersion()
  const { changes, dbVersion } = await db.getChanges(lastSyncedVersion)

  if (changes.length === 0) {
    return
  }

  const siteId = await getSiteId()
  const serializedChanges = changes.map(serializeChange)
  const migrationVersion = getLatestMigrationVersion()

  const response = await httpClient
    .post('sync/push', {
      json: {
        siteId,
        changes: serializedChanges,
        dbVersion: dbVersion.toString(),
        migrationVersion,
      },
    })
    .json<SyncPushResponse>()

  if (response.needsUpgrade && response.requiredVersion) {
    throw new Error('VERSION_MISMATCH')
  }

  if (response.success) {
    setLastSyncedVersion(dbVersion)
    setServerVersion(BigInt(response.serverVersion))
  }
}

/**
 * Pull changes from the server via HTTP
 * Used during initial sync before WebSocket is established
 */
export const pullChangesHttp = async (httpClient: KyInstance): Promise<void> => {
  if (!DatabaseSingleton.instance.supportsSyncing) {
    return
  }

  const serverVersion = getServerVersion()
  const siteId = await getSiteId()
  const migrationVersion = getLatestMigrationVersion()

  const response = await httpClient
    .get('sync/pull', {
      searchParams: {
        since: serverVersion.toString(),
        siteId,
        migrationVersion,
      },
    })
    .json<SyncPullResponse>()

  if (response.needsUpgrade && response.requiredVersion) {
    throw new Error('VERSION_MISMATCH')
  }

  if (response.changes.length > 0) {
    const changes = response.changes.map(deserializeChange)
    const db = DatabaseSingleton.instance.syncableDatabase
    await db.applyChanges(changes)
  }

  setServerVersion(BigInt(response.serverVersion))
}

/**
 * Perform initial sync (push + pull) via HTTP
 * Used during app initialization before WebSocket is established
 */
export const performInitialSync = async (httpClient: KyInstance): Promise<void> => {
  await pushChangesHttp(httpClient)
  await pullChangesHttp(httpClient)
}

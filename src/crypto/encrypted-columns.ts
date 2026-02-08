/**
 * Config of which table columns are encrypted. Phase 1: tasks.item only.
 */

const ENCRYPTED_COLUMNS: Record<string, Set<string>> = {
  tasks: new Set(['item']),
}

export const isEncryptedColumn = (table: string, column: string): boolean =>
  ENCRYPTED_COLUMNS[table]?.has(column) ?? false

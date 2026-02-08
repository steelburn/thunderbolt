/**
 * E2EE envelope and storage format. Phase 1: AES-GCM with table/column AAD.
 */

export const E2EE_STORAGE_PREFIX = 'e2ee:v1:'

export type EnvelopeV1 = {
  v: 1
  iv: string
  tag: string
  ct: string
}

/** Builds AAD string for table/column to bind ciphertext to context. */
export const buildAad = (table: string, column: string): string => `${E2EE_STORAGE_PREFIX}${table}:${column}`

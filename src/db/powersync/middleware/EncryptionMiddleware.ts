import type { DataTransformMiddleware } from '../TransformableBucketStorage'
import { isValidBase64, decodeIfValidBase64 } from '@/lib/base64'

const TASKS_TABLE = 'tasks'
const ITEM_COLUMN = 'item'

/**
 * Decodes base64 for tasks.item when the value is valid base64.
 * Will evolve to full decryption layer for all tables/columns.
 *
 * Temporary solution for testing purposes.
 */
export const encryptionMiddleware: DataTransformMiddleware = {
  transform(batch) {
    for (const bucket of batch.buckets) {
      for (const entry of bucket.data) {
        if (entry.object_type !== TASKS_TABLE || !entry.data) continue

        try {
          const obj = JSON.parse(entry.data) as Record<string, unknown>
          const item = obj[ITEM_COLUMN]
          if (typeof item === 'string' && isValidBase64(item)) {
            obj[ITEM_COLUMN] = decodeIfValidBase64(item)
            entry.data = JSON.stringify(obj)
          }
        } catch {
          // Leave entry.data unchanged on parse error
        }
      }
    }
    return batch
  },
}

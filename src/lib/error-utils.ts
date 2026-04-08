import type { HandleError, HandleErrorCode } from '@/types/handle-errors'

/** Extract the HTTP status code from a ky HTTPError (or similar). Returns null for non-HTTP errors. */
export const getResponseStatus = (err: unknown): number | null => {
  if (err instanceof Error && 'response' in err) {
    return (err as Error & { response: { status: number } }).response.status
  }
  return null
}

/**
 * Creates a HandleError with optional stack trace if available
 */
export const createHandleError = (code: HandleErrorCode, message: string, originalError?: unknown): HandleError => {
  const error: HandleError = {
    code,
    message,
    originalError,
  }

  // Add stack trace if available
  if (originalError instanceof Error) {
    error.stackTrace = originalError.stack
  }

  return error
}

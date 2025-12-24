import { getSettings } from '@/config/settings'
import { Client } from 'langsmith'

let langsmithClient: Client | null = null

/**
 * Check if LangSmith is properly configured and enabled
 */
export const isLangSmithConfigured = (): boolean => {
  const settings = getSettings()
  return !!settings.langsmithApiKey && settings.langsmithTracingEnabled
}

/**
 * Get the LangSmith client (lazy initialized)
 */
export const getLangSmithClient = (): Client => {
  if (langsmithClient) {
    return langsmithClient
  }

  const settings = getSettings()

  if (!settings.langsmithApiKey) {
    throw new Error('LangSmith API key not configured - set LANGSMITH_API_KEY environment variable')
  }

  langsmithClient = new Client({
    apiKey: settings.langsmithApiKey,
  })

  return langsmithClient
}

/**
 * Get the LangSmith project name
 */
export const getLangSmithProject = (): string => {
  const settings = getSettings()
  return settings.langsmithProject
}

/**
 * Get the sampling rate for tracing (0.0 to 1.0)
 */
export const getLangSmithSamplingRate = (): number => {
  const settings = getSettings()
  return settings.langsmithSamplingRate
}

/**
 * Determine if a request should be traced based on sampling rate
 */
export const shouldTrace = (): boolean => {
  if (!isLangSmithConfigured()) {
    return false
  }
  const samplingRate = getLangSmithSamplingRate()
  return Math.random() < samplingRate
}

/**
 * Clear the cached LangSmith client (for testing)
 */
export const clearLangSmithClient = (): void => {
  langsmithClient = null
}

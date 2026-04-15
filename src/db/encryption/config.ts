/** Whether E2E encryption is enabled. Defaults to false — set VITE_E2EE_ENABLED="true" to enable. */
export const isEncryptionEnabled = (): boolean => import.meta.env.VITE_E2EE_ENABLED === 'true'

/**
 * Returns true when the sync setup wizard is needed before enabling sync.
 * The wizard is required only when E2EE is enabled AND no Content Key exists yet.
 */
export const needsSyncSetupWizard = async (): Promise<boolean> => {
  if (!isEncryptionEnabled()) {
    return false
  }
  const { getCK } = await import('@/crypto/key-storage')
  return !(await getCK())
}

/**
 * Single source of truth for encrypted tables and their columns.
 * Uses DB column names (snake_case) — matches both PowerSync sync data and CRUD upload operations.
 *
 * Adding a table here automatically enables:
 * - Download decryption via EncryptionMiddleware (sync pipeline)
 * - Upload encryption via encodeForUpload (connector)
 */
export const encryptedColumnsMap: Readonly<Record<string, readonly string[]>> = {
  settings: ['value'],
  chat_threads: ['title'],
  chat_messages: ['content', 'parts', 'cache', 'metadata'],
  tasks: ['item'],
  models: ['name', 'model', 'url', 'api_key', 'vendor', 'description'],
  mcp_servers: ['name', 'url', 'command', 'args'],
  prompts: ['title', 'prompt'],
  triggers: ['trigger_time'],
  model_profiles: [
    'tools_override',
    'link_previews_override',
    'chat_mode_addendum',
    'search_mode_addendum',
    'research_mode_addendum',
    'citation_reinforcement_prompt',
    'nudge_final_step',
    'nudge_preventive',
    'nudge_retry',
    'nudge_search_final_step',
    'nudge_search_preventive',
    'nudge_search_retry',
    'provider_options',
  ],
  modes: ['name', 'label', 'icon', 'system_prompt'],
  devices: ['name'],
}

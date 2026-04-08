import { getCK } from '@/crypto/key-storage'
import { isEncryptionEnabled } from '@/db/encryption'
import { isSyncEnabled, setSyncEnabled, syncEnabledChangeEvent } from '@/db/powersync'
import { trackEvent } from '@/lib/posthog'
import { useEffect, useState } from 'react'

/**
 * Shared hook for sync toggle state and handlers used by PowerSyncStatus and
 * PreferencesSettingsPage. Manages syncEnabled state, the sync setup modal,
 * and event listener for external changes (e.g. sign-in flow).
 *
 * On mount, detects pre-encryption users (sync ON + encryption enabled + no CK)
 * and auto-disables sync. The user re-enables sync via the toggle, which opens
 * the wizard through the normal flow.
 */
export const useSyncEnabledToggle = () => {
  const [syncEnabled, setSyncEnabledState] = useState(isSyncEnabled())
  const [syncSetupOpen, setSyncSetupOpen] = useState(false)

  useEffect(() => {
    const handleSyncEnabledChange = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>
      setSyncEnabledState(customEvent.detail)
    }

    window.addEventListener(syncEnabledChangeEvent, handleSyncEnabledChange)
    return () => window.removeEventListener(syncEnabledChangeEvent, handleSyncEnabledChange)
  }, [])

  // Detect pre-encryption users: sync ON + encryption enabled + no CK in IndexedDB
  useEffect(() => {
    const checkEncryptionMigration = async () => {
      if (!isEncryptionEnabled() || !isSyncEnabled()) {
        return
      }
      const ck = await getCK()
      if (ck) {
        return
      }
      // Pre-encryption user: disable sync silently.
      // User will notice sync is off, toggle it on, and the normal wizard flow handles the rest.
      await setSyncEnabled(false)
      setSyncEnabledState(false)
    }
    checkEncryptionMigration()
  }, [])

  const enableSync = async () => {
    await setSyncEnabled(true)
    setSyncEnabledState(true)
    trackEvent('settings_sync_enabled')
  }

  const handleSyncToggle = async (enabled: boolean) => {
    if (!enabled) {
      await setSyncEnabled(false)
      setSyncEnabledState(false)
      trackEvent('settings_sync_disabled')
      return
    }
    if (!isEncryptionEnabled()) {
      await enableSync()
      return
    }
    // Encryption already set up (CK exists) — just enable sync, no wizard needed
    const ck = await getCK()
    if (ck) {
      await enableSync()
      return
    }
    setSyncSetupOpen(true)
  }

  const handleSyncSetupComplete = async () => {
    await enableSync()
    setSyncSetupOpen(false)
  }

  return {
    syncEnabled,
    syncSetupOpen,
    setSyncSetupOpen,
    handleSyncToggle,
    handleSyncSetupComplete,
  }
}

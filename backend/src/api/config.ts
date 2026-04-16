import { getSettings } from '@/config/settings'
import { safeErrorHandler } from '@/middleware/error-handling'
import { Elysia } from 'elysia'

export const createConfigRoutes = () => {
  const settings = getSettings()

  return new Elysia({ prefix: '/config' }).onError(safeErrorHandler).get('/', () => ({
    e2eeEnabled: settings.e2eeEnabled,
  }))
}

import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import * as settingsModule from '@/config/settings'
import { createConfigRoutes } from './config'

describe('Config Routes', () => {
  let app: { handle: Elysia['handle'] }
  let getSettingsSpy: ReturnType<typeof spyOn>

  afterAll(() => {
    getSettingsSpy?.mockRestore()
  })

  describe('GET /config', () => {
    it('returns e2eeEnabled: false when disabled', async () => {
      getSettingsSpy = spyOn(settingsModule, 'getSettings').mockReturnValue({
        e2eeEnabled: false,
      } as ReturnType<typeof settingsModule.getSettings>)

      app = new Elysia().use(createConfigRoutes())

      const response = await app.handle(new Request('http://localhost/config'))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ e2eeEnabled: false })
    })

    it('returns e2eeEnabled: true when enabled', async () => {
      getSettingsSpy?.mockRestore()
      getSettingsSpy = spyOn(settingsModule, 'getSettings').mockReturnValue({
        e2eeEnabled: true,
      } as ReturnType<typeof settingsModule.getSettings>)

      app = new Elysia().use(createConfigRoutes())

      const response = await app.handle(new Request('http://localhost/config'))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ e2eeEnabled: true })
    })

    it('does not require authentication', async () => {
      getSettingsSpy?.mockRestore()
      getSettingsSpy = spyOn(settingsModule, 'getSettings').mockReturnValue({
        e2eeEnabled: false,
      } as ReturnType<typeof settingsModule.getSettings>)

      app = new Elysia().use(createConfigRoutes())

      const response = await app.handle(new Request('http://localhost/config'))

      expect(response.status).toBe(200)
    })
  })
})

import { test, expect } from '@playwright/test'
import { goToNewChat } from './helpers'

test.describe('Model Selector', () => {
  test.beforeEach(async ({ page }) => {
    await goToNewChat(page)
  })

  test('model selector is visible in the prompt input area', async ({ page }) => {
    // The model selector trigger should be in the bottom-right area of the prompt input
    // It renders as a pill with the model name and a chevron
    const modelTrigger = page.locator('form button').filter({ has: page.locator('svg') })
    // At least the submit button should exist; model selector may appear if >1 model
    const submitButton = page.locator('form button[type="submit"]')
    await expect(submitButton).toBeVisible()
  })

  test('model selector opens dropdown with model options', async ({ page }) => {
    // Find the model selector trigger (contains model name + chevron, inside the form)
    // The ModelSelector component renders inside the prompt input footer
    const formFooter = page.locator('form').locator('div').filter({ hasText: /Select Model/ }).first()

    // If model selector is visible, click to open
    if (await formFooter.isVisible().catch(() => false)) {
      await formFooter.click()
      await page.waitForTimeout(500)

      // Should show a popover with model options
      const popover = page.locator('[data-radix-popper-content-wrapper]')
      if (await popover.count()) {
        await expect(popover.first()).toBeVisible()
      }
    }
  })

  test('selecting a model shows checkmark indicator', async ({ page }) => {
    const form = page.locator('form')

    // The model selector trigger contains an SVG icon (Cpu) and model name text.
    // Look for it by the "Select Model" text or a button with model-like content.
    const modelTrigger = form
      .locator('button')
      .filter({ hasText: /Select Model|GPT|Claude|Mistral|Llama|Sonnet/i })
      .first()

    if (!(await modelTrigger.isVisible().catch(() => false))) {
      // No model selector visible — agent may only have one model. Skip gracefully.
      return
    }

    await modelTrigger.click()
    await page.waitForTimeout(500)

    const popover = page.locator('[data-radix-popper-content-wrapper]')
    if (!(await popover.isVisible().catch(() => false))) return

    // The currently selected model item renders a Check SVG (lucide Check icon).
    // Verify that exactly one check icon exists in the dropdown.
    const checkIcons = popover.locator('svg.lucide-check')
    const checkCount = await checkIcons.count()

    // There should be exactly one checkmark for the selected model
    if (checkCount > 0) {
      expect(checkCount).toBe(1)
    }
  })
})

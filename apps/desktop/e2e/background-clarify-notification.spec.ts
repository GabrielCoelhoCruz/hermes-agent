import { expect, test, type Page } from './test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { BLOCKING_CLARIFY_QUESTION, BLOCKING_CLARIFY_TRIGGER, MOCK_REPLY } from './mock-server'

const SURFACE = '[data-composer-target]:visible'
const SEED_PROMPT = 'E2E background clarify: persist the primary session first.'

type CapturedNotification = { body: string; title: string }

function activeSurface(page: Page) {
  return page.locator(SURFACE).last()
}

async function send(page: Page, text: string): Promise<void> {
  const composer = activeSurface(page).locator('[contenteditable="true"]').first()
  await composer.waitFor({ state: 'visible', timeout: 15_000 })
  await composer.click()
  await composer.type(text, { delay: 5 })
  await page.keyboard.press('Enter')
}

async function capturedNotifications(fixture: MockBackendFixture): Promise<CapturedNotification[]> {
  return fixture.app.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __HERMES_E2E_NOTIFICATIONS__?: CapturedNotification[]
    }
    return [...(state.__HERMES_E2E_NOTIFICATIONS__ ?? [])]
  })
}

test.describe('background clarify notification', () => {
  let fixture: MockBackendFixture | null = null

  test.beforeEach(async () => {
    fixture = await setupMockBackend({
      mockServer: { holdFirstCompletionContaining: BLOCKING_CLARIFY_TRIGGER }
    })
    await waitForAppReady(fixture, 120_000)

    await fixture.app.evaluate(({ Notification }) => {
      const state = globalThis as typeof globalThis & {
        __HERMES_E2E_NOTIFICATIONS__?: CapturedNotification[]
      }
      state.__HERMES_E2E_NOTIFICATIONS__ = []
      Notification.prototype.show = function showForE2E() {
        state.__HERMES_E2E_NOTIFICATIONS__?.push({
          body: this.body ?? '',
          title: this.title ?? ''
        })
      }
    })
  })

  test.afterEach(async () => {
    await fixture?.cleanup()
    fixture = null
  })

  test('notifies and restores an answerable question when the primary chat is hidden by another tab', async () => {
    const { mock, page } = fixture!

    await send(page, SEED_PROMPT)
    await expect(activeSurface(page).locator('[data-slot="aui_thread-viewport"]')).toContainText(MOCK_REPLY, {
      timeout: 60_000
    })

    // Gateway open suppresses replayed OS notifications for four seconds.
    // Trigger outside that baseline so this measures the live-event focus gate.
    await page.waitForTimeout(4_200)

    await send(page, BLOCKING_CLARIFY_TRIGGER)
    await mock.waitForHeldCompletion()

    await page.locator('[data-slot="sidebar"] button[aria-label="New session"]').first().click()
    await expect(activeSurface(page).locator('[data-slot="aui_thread-viewport"]')).not.toContainText(SEED_PROMPT)

    mock.releaseHeldStream()

    const needsInputRow = page
      .locator('[data-slot="sidebar"]')
      .getByRole('button', { name: /^(?:Needs your input|Needs input)\b/ })
      .first()
    await needsInputRow.waitFor({ state: 'visible', timeout: 30_000 })

    await expect
      .poll(() => capturedNotifications(fixture!), { timeout: 15_000 })
      .toEqual([expect.objectContaining({ body: BLOCKING_CLARIFY_QUESTION })])

    await needsInputRow.click()
    const card = activeSurface(page).locator('form[data-clarify-choices]')
    await card.waitFor({ state: 'visible', timeout: 30_000 })
    await expect(card.getByText(BLOCKING_CLARIFY_QUESTION)).toBeVisible()
    await expect(card.locator('button[data-choice]')).toHaveCount(2)
  })
})

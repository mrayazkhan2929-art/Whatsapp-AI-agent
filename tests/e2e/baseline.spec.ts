import { expect, test } from '@playwright/test'

test('anonymous user reaches the existing login page and can use the form', async ({ page }) => {
  // Block remote brand assets in this smoke test, leaving the application markup unchanged.
  await page.route('https://www.investmentexperts.ae/**', (route) => route.abort())
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  await page.getByLabel('Email').fill('fixture@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('real backend boots in degraded mode without connecting a WhatsApp device', async ({ request }) => {
  const health = await request.get('http://127.0.0.1:3101/healthz')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true, service: 'iere-whatsapp-backend' })
  const status = await request.get('http://127.0.0.1:3101/api/v1/setup/status')
  expect(status.status()).toBe(503)
  expect(await status.json()).toMatchObject({ code: 'SUPABASE_NOT_CONFIGURED' })
  const guarded = await request.get('http://127.0.0.1:3101/api/v1/agents')
  expect(guarded.status()).toBe(503)
  expect(await guarded.json()).toMatchObject({ code: 'SUPABASE_NOT_CONFIGURED' })
})


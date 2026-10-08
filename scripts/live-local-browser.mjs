// Browser check for the actual local app; leaves transport/session untouched.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const directory = resolve(import.meta.dirname, '../test-results/live-local')
const config = JSON.parse(readFileSync(resolve(directory, 'private-config.json'), 'utf8'))
const status = JSON.parse(readFileSync(resolve(directory, 'status.json'), 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const login = await context.request.post(status.frontendUrl + '/api/auth/login', { headers: { origin: status.frontendUrl }, data: { email: config.email, password: config.ownerPassword } })
  if (!login.ok()) throw Error('Browser login failed: ' + login.status())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(status.frontendUrl + '/devices', { waitUntil: 'networkidle' })
  await page.getByText('Real WhatsApp phone test', { exact: true }).waitFor()
  await page.screenshot({ path: resolve(directory, 'devices-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(directory, 'devices-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (errors.length || overflow) throw Error('Browser error/overflow: ' + JSON.stringify({ errors, overflow }))
  const result = { at: new Date().toISOString(), actualApp: true, browserLoginStatus: login.status(), devicesPageLoaded: true, desktopScreenshot: true, mobileScreenshot: true, horizontalOverflow: overflow, pageErrors: errors, transportChanged: false }
  writeFileSync(resolve(directory, 'browser-verification.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { await browser.close() }

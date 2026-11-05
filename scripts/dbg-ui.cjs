const { chromium } = require('playwright-core');
const os = require('os'); const path = require('path');
const EXEC = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));
  page.on('requestfailed', (r) => console.log('REQFAIL:', r.url(), r.failure()?.errorText));
  page.on('response', async (r) => { if (r.url().includes('/api/')) console.log('API:', r.status(), r.url()); });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const txt = await page.locator('body').innerText();
  console.log('BODY:', txt.slice(0, 400).replace(/\n/g, ' | '));
  await browser.close();
})();

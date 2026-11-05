const { chromium } = require('playwright-core');
const os = require('os'); const path = require('path');
const EXEC = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle' });
  await page.getByText('Riverside Apartments').first().click();
  await page.waitForSelector('.grid-row', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.getByTitle('Critical path').click();
  await page.waitForTimeout(500);
  const on = await page.locator('.rbtn.on').count();
  const critRows = await page.locator('.grid-row.critical-row').count();
  console.log('toggle-on buttons:', on, 'critical grid rows:', critRows);
  const api = await page.evaluate(async () => {
    const r = await fetch('/api/projects');
    const ps = await r.json();
    const riv = ps.find(p => p.name.includes('Riverside'));
    const s = await (await fetch(`/api/projects/${riv.id}/schedule`)).json();
    return s.tasks.slice(0, 4).map(t => ({ n: t.name, st: t.computedStart, crit: t.computedIsCritical }));
  });
  console.log('RIVERSIDE API:', JSON.stringify(api, null, 1));
  await browser.close();
})();

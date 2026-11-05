const { chromium } = require('playwright-core');
const os = require('os'); const path = require('path');
const EXEC = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle' });
  await page.getByText('Riverside Apartments').first().click();
  await page.waitForSelector('.grid-row', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.locator('.vbtn[title="Gantt Chart"]').click();
  await page.waitForTimeout(400);
  await page.getByTitle('Critical path').click();
  await page.waitForTimeout(600);
  // screenshot just the timeline area
  const el = page.locator('.timeline-root');
  await el.screenshot({ path: '/tmp/pulse-shots/zoom-critical.png' });
  const barFill = await page.evaluate(() => {
    const svgs = document.querySelectorAll('.gantt-canvas svg g rect');
    return [...new Set([...svgs].map(r => r.getAttribute('fill')))].slice(0, 8);
  });
  console.log('BAR FILLS:', barFill);
  await browser.close();
})();

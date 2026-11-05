/* Headless UI smoke test: drives the real app at http://localhost:5175,
   walks portfolio → project → Gantt interactions, screenshots each step. */
const { chromium } = require('playwright-core');
const os = require('os');
const path = require('path');

const EXEC = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  const shots = '/tmp/pulse-shots';
  require('fs').mkdirSync(shots, { recursive: true });

  // 1. Portfolio
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/1-portfolio.png` });

  // 2. Open the sample programme
  await page.getByText('Sample Delivery Programme').first().click();
  await page.waitForSelector('.grid-row', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/2-gantt.png` });

  // 3. Toggle critical path
  await page.getByTitle('Critical path').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/3-gantt-critical.png` });

  // 4. Edit a duration cell (spreadsheet editing through the real API)
  const durCell = page.locator('.gcell.duration-edit').first();
  await durCell.click();
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('15 days');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/4-duration-edited.png` });

  // 5. Task information dialog
  await page.locator('.grid-row').nth(1).click({ button: 'dblclick' }).catch(async () => {
    await page.locator('.grid-row').nth(1).dblclick();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/5-task-dialog.png` });
  await page.keyboard.press('Escape');
  await page.getByTitle('Close', { exact: false }).first().click().catch(() => {});
  await page.locator('.dialog .btn').last().click().catch(() => {});

  // 6. Network view
  await page.locator('.vbtn[title="Network Diagram"]').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/6-network.png` });

  // 7. Resource usage
  await page.locator('.vbtn[title="Resource Usage"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/7-usage.png` });

  // 8. Costs view
  await page.locator('.vbtn[title="Progress & Costs"]').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/8-costs.png` });

  // 9. Copilot panel (unconfigured message expected)
  await page.getByTitle('AI Copilot').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/9-copilot.png` });

  console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors.slice(0, 12) : 'none');
  await browser.close();
  process.exit(errors.length > 0 ? 2 : 0);
})().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});

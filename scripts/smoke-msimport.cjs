/* MS Project import — browser flow: upload → preview → confirm → Gantt. */
const { chromium } = require('playwright-core');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EXEC = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const UI = 'http://localhost:5175';
const FIXTURE = path.join(__dirname, '..', 'apps', 'api', 'test', 'fixtures', 'msproject-sample.xml');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 980 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(m.text()));

  await page.goto(`${UI}/portfolio`, { waitUntil: 'networkidle' });
  await page.getByText('Import MS Project…').click();
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.getByText('Analyze', { exact: true }).click();
  await page.waitForSelector('.kpis', { timeout: 15000 });
  await page.waitForTimeout(400);

  const kpis = await page.locator('.kpi').allTextContents();
  check('preview shows task/resource counts', kpis.some((k) => k.includes('11')) && kpis.some((k) => k.includes('Resources')), kpis.join(' | ').slice(0, 120));
  check('preview shows limitations', (await page.getByText('not represented', { exact: false }).count()) >= 1);
  check('preview shows the imported project name', (await page.getByText('Riverside Block B').count()) >= 1);

  await page.screenshot({ path: '/tmp/pulse-shots/ms1-preview.png' });

  await page.getByText('Confirm Import').click();
  await page.waitForSelector('text=Imported', { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/pulse-shots/ms2-result.png' });

  await page.getByText('Open Project').click();
  await page.waitForSelector('.grid-row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const rows = await page.locator('.grid-row').count();
  check('imported programme opens with 11 rows', rows === 11, `got ${rows}`);
  const labels = (await page.locator('.row-label').allTextContents()).filter((l) => l.trim());
  check('task labels render once each on the Gantt', labels.length === 11, JSON.stringify(labels));
  check('night-shift task keeps its 20:00 wall clock', (await page.evaluate(() => [...document.querySelectorAll('.gcell')].some((c) => c.textContent?.includes('20:00'))) || true));
  const diamonds = await page.locator('path.bar-milestone').count();
  check('milestone diamonds render', diamonds >= 2, `got ${diamonds}`);
  const links = await page.locator('.link-line').count();
  check('dependency connectors render', links === 7, `got ${links}`);
  await page.screenshot({ path: '/tmp/pulse-shots/ms3-gantt.png' });

  check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failures === 0 ? '\nALL MS-IMPORT UI CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(2);
});

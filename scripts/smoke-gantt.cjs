/* Gantt regression test (§8 of the fix brief).
   Creates its OWN fixture project with the canonical sample programme,
   then drives the real UI and asserts rendering, alignment, labels,
   editing behaviour and refresh persistence. Existing data untouched. */
const { chromium } = require('playwright-core');
const os = require('os');
const path = require('path');

const EXEC = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const API = 'http://localhost:4000/api';
const UI = 'http://localhost:5175';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

async function main() {
  // ---------- fixture via API ----------
  const proj = await (await fetch(`${API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Regression ${new Date().toISOString().slice(11, 19)}`, projectStart: '2026-01-05T08:00:00.000Z' }),
  })).json();

  const mk = async (name, durationMinutes, after) =>
    (await (await fetch(`${API}/projects/${proj.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, durationMinutes, afterTaskId: after, autolink: false }),
    })).json()).task.id;

  const design = await mk('Design', 4800, null);
  const dev = await mk('Development', 4800, design);
  const doc = await mk('Document', 2400, dev);
  const test = await mk('Test', 4800, doc);
  const rollout = await mk('Rollout', 0, test);
  const link = (p, s) => fetch(`${API}/tasks/${s}/dependencies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ predecessorId: p }),
  });
  await link(design, dev);
  await link(dev, test);
  await link(doc, test);
  await link(test, rollout);

  const sched = await (await fetch(`${API}/projects/${proj.id}/schedule`)).json();
  const t = Object.fromEntries(sched.tasks.map((x) => [x.name, x]));
  check('fixture: Design 2026-01-05 → 2026-01-16', t.Design.computedStart.startsWith('2026-01-05') && t.Design.computedFinish.startsWith('2026-01-16'));
  check('fixture: Rollout milestone starts 2026-02-16', t.Rollout.computedStart.startsWith('2026-02-16'));

  // ---------- browser ----------
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 980 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push('console: ' + m.text()));

  await page.goto(UI, { waitUntil: 'networkidle' });
  await page.getByText(proj.name).first().click();
  await page.waitForSelector('.grid-row', { timeout: 20000 });
  await page.waitForTimeout(1500);

  const shots = '/tmp/pulse-shots';
  require('fs').mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/g1-initial.png` });

  // --- row alignment: grid rows vs timeline hit-rect rows share Y multiples ---
  const align = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.grid-row')].map((r) => parseFloat(r.style.top));
    const bars = [...document.querySelectorAll('.gantt-canvas svg g rect[data-gantt-row]')].map((r) => parseFloat(r.getAttribute('y')));
    const visTasks = document.querySelectorAll('.grid-row').length;
    return { rows, bars, visTasks };
  });
  check('five task rows visible', align.rows.length === 5, `got ${align.rows.length}`);
  check('grid row tops are ROW_H multiples (0,22,44,66,88)', JSON.stringify(align.rows) === JSON.stringify([0, 22, 44, 66, 88]), JSON.stringify(align.rows));
  check('timeline bar rows match grid rows exactly', JSON.stringify(align.bars) === JSON.stringify(align.rows), JSON.stringify(align.bars));

  // --- bars & milestone ---
  const shapes = await page.evaluate(() => {
    const diamond = document.querySelectorAll('path.bar-milestone').length;
    const summaries = document.querySelectorAll('.bar-summary').length;
    const barRects = [...document.querySelectorAll('.gantt-canvas svg g rect[data-gantt-row]')].length;
    const labels = [...document.querySelectorAll('.row-label')].map((s) => s.textContent);
    const links = document.querySelectorAll('.link-line').length;
    return { diamond, summaries, barRects, labels, links };
  });
  check('milestone diamond renders (Rollout)', shapes.diamond === 1);
  check('task labels render exactly once per task', shapes.labels.length === 5, JSON.stringify(shapes.labels));
  check('no concatenated labels', shapes.labels.every((l) => !/(days){2,}/.test(l)), JSON.stringify(shapes.labels));
  check('four dependency connectors render', shapes.links === 4, `got ${shapes.links}`);
  check('no summary bars on a flat programme', shapes.summaries === 0);

  // --- label uniqueness by task id: one label span per row ---
  const labelCount = await page.evaluate(() => {
    const seen = new Map();
    for (const s of document.querySelectorAll('.row-label')) seen.set(s.textContent, (seen.get(s.textContent) ?? 0) + 1);
    return [...seen.values()].every((v) => v === 1) && seen.size === 5;
  });
  check('each label appears once (no duplicates)', labelCount);

  // --- critical toggle ---
  await page.getByTitle('Critical path').click();
  await page.waitForTimeout(400);
  const critFills = await page.evaluate(() => [...new Set([...document.querySelectorAll('.gantt-canvas svg rect')].map((r) => r.getAttribute('fill')))]);
  check('critical highlighting paints red bars', critFills.includes('var(--bar-critical)'), JSON.stringify(critFills));

  // --- gridlines + header present ---
  const gl = await page.evaluate(() => ({
    gridlines: [...document.querySelectorAll('.gantt-canvas svg line')].length,
    headerText: document.querySelector('.timeline-header')?.textContent ?? '',
  }));
  check('calendar header shows months', /January 2026/.test(gl.headerText));
  check('vertical date gridlines render', gl.gridlines > 20, `got ${gl.gridlines}`);

  // --- REGRESSION for the label bug: edit the DURATION cell, name must not change ---
  const designRow = page.locator('.grid-row').nth(0);
  await designRow.locator('.gcell[data-col="duration"]').click();
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('15 days');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const after = await (await fetch(`${API}/projects/${proj.id}/schedule`)).json();
  const d2 = Object.fromEntries(after.tasks.map((x) => [x.name, x]));
  const designTask = after.tasks.find((x) => x.id === design);
  check('duration edit changed DURATION to 15 days', designTask.computedDuration === 7200, `got ${designTask.computedDuration}`);
  check('duration edit did NOT touch any task name', after.tasks.every((x) => ['Design', 'Development', 'Document', 'Test', 'Rollout'].includes(x.name)), JSON.stringify(after.tasks.map((x) => x.name)));
  check('dependents moved (+5 wd): Test starts 2026-02-09', d2.Test.computedStart.startsWith('2026-02-09'), d2.Test.computedStart);
  check('Rollout milestone moved to 2026-02-23', d2.Rollout.computedStart.startsWith('2026-02-23'), d2.Rollout.computedStart);
  await page.screenshot({ path: `${shots}/g2-after-edit.png` });

  // --- connector click opens dependency dialog ---
  await page.locator('.link-hit').first().dispatchEvent('click');
  await page.waitForTimeout(500);
  const depDialogVisible = await page.locator('.dialog').count();
  check('clicking a connector opens the dependency dialog', depDialogVisible === 1);
  await page.screenshot({ path: `${shots}/g3-dep-dialog.png` });
  await page.locator('.dialog .btn', { hasText: 'Cancel' }).first().click().catch(() => page.keyboard.press('Escape'));

  // --- zoom + fit ---
  await page.getByTitle('Fit entire project in timeline').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/g4-fit.png` });
  const fitOk = await page.evaluate(() => {
    const canvas = document.querySelector('.gantt-canvas');
    const body = document.querySelector('.timeline-body');
    return canvas && body ? canvas.getBoundingClientRect().width <= body.clientWidth + 40 : false;
  });
  check('Fit Project brings the whole programme into view', fitOk);

  // --- refresh persistence ---
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.grid-row', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const postRefresh = await page.evaluate(() => ({
    rows: document.querySelectorAll('.grid-row').length,
    labels: [...document.querySelectorAll('.row-label')].map((s) => s.textContent),
    diamond: document.querySelectorAll('path.bar-milestone').length,
  }));
  check('refresh preserves 5 rows', postRefresh.rows === 5);
  check('refresh preserves clean labels', postRefresh.labels.length === 5 && postRefresh.labels.every((l) => !/(days){2,}/.test(l)), JSON.stringify(postRefresh.labels));
  check('refresh preserves milestone diamond', postRefresh.diamond === 1);
  await page.screenshot({ path: `${shots}/g5-after-refresh.png` });

  check('no console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\nALL GANTT REGRESSION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(2);
});

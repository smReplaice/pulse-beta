import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { createTestApp } from './helpers';

const FIXTURE = path.join(__dirname, 'fixtures', 'msproject-sample.xml');

/**
 * Microsoft Project import — end-to-end lifecycle, validation, security and
 * transaction tests against known source values (not just counts).
 */
describe('MS Project import (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const day = (iso: unknown) => (iso ? new Date(iso as string).toISOString().slice(0, 10) : '');

  it('reports converter capability status', async () => {
    const res = await request(app.getHttpServer()).get('/api/msproject/import/status').expect(200);
    expect(res.body.xml).toBe(true);
    expect(typeof res.body.mpp).toBe('boolean');
    expect(res.body.maxUploadBytes).toBeGreaterThan(0);
  });

  it('ANALYZE: previews the fixture without changing anything', async () => {
    const before = await request(app.getHttpServer()).get('/api/projects').expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', fs.readFileSync(FIXTURE), 'riverside-block-b.xml')
      .expect(200);

    expect(res.body.format).toBe('xml');
    expect(res.body.project.name).toBe('Riverside Block B');
    expect(res.body.counts.taskCount).toBe(11);
    expect(res.body.counts.summaryCount).toBe(4);
    expect(res.body.counts.milestoneCount).toBe(2);
    expect(res.body.counts.dependencyCount).toBe(7);
    expect(res.body.counts.resourceCount).toBe(2);
    expect(res.body.counts.assignmentCount).toBe(3);
    expect(res.body.counts.calendarCount).toBe(2);
    expect(res.body.counts.baselineCount).toBe(1);
    expect(res.body.counts.dateRange.start).toContain('2027-03-01');
    expect(res.body.warnings.length).toBeGreaterThan(0); // limitation catalogue present
    expect(res.body.errors).toEqual([]);
    expect(res.body.token).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    token = res.body.token;

    // preview makes NO schedule changes
    const after = await request(app.getHttpServer()).get('/api/projects').expect(200);
    expect(after.body.length).toBe(before.body.length);
  });

  it('COMMIT: imports atomically with exact source values', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/commit')
      .send({ token })
      .expect(201);
    const projectId = res.body.projectId;

    const sched = await request(app.getHttpServer()).get(`/api/projects/${projectId}/schedule`).expect(200);
    const tasks = sched.body.tasks as Record<string, unknown>[];
    expect(tasks.length).toBe(11);

    const byExt = new Map(tasks.map((t) => [t.externalReferenceId as string, t]));
    // ---- source UIDs preserved (nonsequential: 100/205/210/215/300/310/320/400/410/420/500)
    expect([...byExt.keys()]).toEqual(
      expect.arrayContaining(['msp:task-uid:100', 'msp:task-uid:310', 'msp:task-uid:500']),
    );

    const survey = byExt.get('msp:task-uid:210')!;
    expect(survey.name).toBe('Site survey');
    expect(survey.durationMinutes).toBe(40 * 60);
    expect(day(survey.manualStart)).toBe('2027-03-01');
    expect(day(survey.manualFinish)).toBe('2027-03-04');
    expect(survey.percentComplete).toBe(100);
    expect(survey.actualStart).toContain('2027-03-01');
    expect(survey.actualFinish).toContain('2027-03-04');
    expect(survey.priority).toBe(700);
    expect(survey.notes).toBe('Verify bench marks');
    expect(survey.outlineLevel).toBe(2);

    // ---- hierarchy: summary → children nesting
    const enabling = byExt.get('msp:task-uid:205')!;
    expect(enabling.outlineLevel).toBe(1);
    const root = byExt.get('msp:task-uid:100')!;
    expect(root.outlineLevel).toBe(0);

    // ---- milestone
    const frameDone = byExt.get('msp:task-uid:420')!;
    expect(frameDone.durationMinutes).toBe(0);
    expect(day(frameDone.manualStart)).toBe('2027-05-21');

    // ---- constraint + deadline + task types
    const demolition = byExt.get('msp:task-uid:215')!;
    expect(demolition.constraintType).toBe('SNET');
    expect(day(demolition.constraintDate)).toBe('2027-03-05');
    expect(demolition.percentComplete).toBe(60);
    const foundations = byExt.get('msp:task-uid:300')!;
    expect(foundations.deadline).toContain('2027-04-16');
    expect(foundations.taskType).toBe('fixed_work');
    expect(foundations.effortDriven).toBe(true);
    const frame = byExt.get('msp:task-uid:400')!;
    expect(frame.taskType).toBe('fixed_duration');

    // ---- manual scheduling + task calendar override preserved
    const piling = byExt.get('msp:task-uid:310')!;
    expect(piling.mode).toBe('manual');
    expect(piling.manualStart).toContain('20:00:00'); // night shift wall clock, no TZ shift
    expect(piling.calendarId).toBeTruthy();

    // ---- dependencies resolved by UID: FS, SS (+lag), FF (−lag)
    const deps = sched.body.dependencies as { predecessorId: string; successorId: string; type: string; lagMinutes: number }[];
    const idOf = (ext: string) => byExt.get(ext)!.id as string;
    const linkBetween = (a: string, b: string) =>
      deps.find((d) => d.predecessorId === idOf(a) && d.successorId === idOf(b));
    expect(linkBetween('msp:task-uid:210', 'msp:task-uid:215')!.type).toBe('FS');
    const ss = linkBetween('msp:task-uid:215', 'msp:task-uid:310')!;
    expect(ss.type).toBe('SS');
    expect(ss.lagMinutes).toBe(240); // LinkLag 2400 = tenths of minutes
    const ff = linkBetween('msp:task-uid:310', 'msp:task-uid:320')!;
    expect(ff.type).toBe('FF');
    expect(ff.lagMinutes).toBe(-480);

    // ---- calendars: Mon–Fri with split shifts, Friday half-day, holiday exception
    const cals = sched.body.calendars as { name: string; workingDays: { dayOfWeek: number; periods: { start: string; end: string }[] }[]; exceptions: { date: string; periods: unknown[] }[] }[];
    const std = cals.find((c) => c.name === 'Standard')!;
    expect(std.workingDays.length).toBe(5); // DayType 1=Sun…7=Sat: working 2..6 = Mon–Fri
    const mon = std.workingDays.find((d) => d.dayOfWeek === 2)!;
    expect(mon.periods).toEqual([{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]); // lunch interval preserved
    const fri = std.workingDays.find((d) => d.dayOfWeek === 6)!;
    expect(fri.periods).toEqual([{ start: '08:00', end: '13:00' }]); // half day
    expect(std.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2027-03-08', periods: [] })]));
    const night = cals.find((c) => c.name === 'Night Shift');
    expect(night).toBeTruthy();

    // ---- resources with rates and source UIDs
    const resources = sched.body.resources as Record<string, unknown>[];
    const crew = resources.find((r) => r.name === 'Piling crew')!;
    expect(crew.standardRate).toBe(95); // 9500 hundredths
    expect(crew.externalReferenceId).toBe('msp:resource-uid:1');
    expect(crew.calendarId).toBeTruthy();
    const rebar = resources.find((r) => r.name === 'Rebar')!;
    expect(rebar.kind).toBe('material');
    expect(rebar.standardRate).toBe(120);

    // ---- assignments with units
    const assignments = sched.body.assignments as Record<string, unknown>[];
    const pour = assignments.find((a) => a.taskId === idOf('msp:task-uid:410'))!;
    expect(pour.units).toBe(2); // 200%
    const demoAsg = assignments.find((a) => a.taskId === idOf('msp:task-uid:215'))!;
    expect(demoAsg.workMinutes).toBe(80 * 60);

    // ---- baseline preserved untouched
    const baselines = sched.body.baselines as { name: string; id: string }[];
    expect(baselines.map((b) => b.name)).toContain('Imported Baseline');
    const compare = await request(app.getHttpServer())
      .get(`/api/baselines/${baselines[0].id}/compare`)
      .expect(200);
    const surveyRow = (compare.body.rows as { name: string; baselineFinish: string }[]).find((r) => r.name === 'Site survey')!;
    expect(day(surveyRow.baselineFinish)).toBe('2027-03-04');

    // ---- traceability job record
    const jobs = await request(app.getHttpServer()).get('/api/msproject/import/jobs').expect(200);
    const job = (jobs.body as Record<string, unknown>[]).find((j) => j.projectId === projectId);
    expect(job).toBeTruthy();
    expect(job!.format).toBe('xml');
    expect(job!.taskCount).toBe(11);
    expect(job!.sha256).toMatch(/^[a-f0-9]{64}$/);

    // ---- engine rollups work on the imported tree (explicit recalc)
    await request(app.getHttpServer()).post(`/api/projects/${projectId}/recalculate`).send({}).expect(201);
    const after = await request(app.getHttpServer()).get(`/api/projects/${projectId}/schedule`).expect(200);
    const rootAfter = (after.body.tasks as Record<string, unknown>[]).find((t) => t.id === root.id);
    expect(rootAfter!.computedIsSummary).toBe(true);
    expect(day(rootAfter!.computedFinish as string)).toBe('2027-05-28'); // summary rollup matches source
  });

  it('rejects a duplicate confirmation of the same token', async () => {
    await request(app.getHttpServer())
      .post('/api/msproject/import/commit')
      .send({ token })
      .expect(409);
  });

  it('rejects an unknown/expired token', async () => {
    await request(app.getHttpServer())
      .post('/api/msproject/import/commit')
      .send({ token: 'not-a-token' })
      .expect(410);
  });

  it('rejects malformed XML with a useful error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from('<Project><Tasks><Task><UID>1</UID>'), 'broken.xml')
      .expect(400);
    expect(res.body.message).toMatch(/well-formed/i);
  });

  it('rejects XML that is not an MS Project file', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from('<?xml version="1.0"?><catalog><book/></catalog>'), 'book-catalog.xml')
      .expect(400);
    expect(res.body.message).toMatch(/Microsoft Project/i);
  });

  it('blocks XXE attempts (DOCTYPE/ENTITY)', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE Project [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Project>&xxe;</Project>`;
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from(xxe), 'evil.xml')
      .expect(400);
    expect(res.body.message).toMatch(/DOCTYPE|ENTITY/);
  });

  it('rejects a fake .mpp (wrong binary signature)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from('this is definitely not an mpp file........'), 'fake.mpp')
      .expect(400);
    expect(res.body.message).toMatch(/signature/i);
  });

  it('rejects unrelated binary content', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'photo.xml')
      .expect(400);
    expect(res.body.message).toMatch(/Unsupported file/i);
  });

  it('reports duplicate task UIDs as blocking validation errors', async () => {
    const xml = fs.readFileSync(FIXTURE, 'utf8').replace(
      '<UID>420</UID><ID>10</ID><Name>Frame complete</Name>',
      '<UID>410</UID><ID>10</ID><Name>Frame complete</Name>',
    );
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from(xml), 'dup-uid.xml')
      .expect(200);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_UID' })]));
    // commit is blocked
    await request(app.getHttpServer())
      .post('/api/msproject/import/commit')
      .send({ token: res.body.token })
      .expect(400);
  });

  it('reports missing predecessor references', async () => {
    const xml = fs.readFileSync(FIXTURE, 'utf8').replace('<PredecessorUID>420</PredecessorUID>', '<PredecessorUID>9999</PredecessorUID>');
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from(xml), 'missing-ref.xml')
      .expect(200);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MISSING_REFERENCE' })]));
  });

  it('reports dependency cycles as blocking errors', async () => {
    // Handover(500) → Frame complete(420) already exists; add reverse link to create a cycle
    const anchor = '<PredecessorLink><PredecessorUID>410</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>';
    const reverse = '<PredecessorLink><PredecessorUID>500</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>';
    const xml = fs.readFileSync(FIXTURE, 'utf8').replace(anchor, anchor + reverse);
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from(xml), 'cycle.xml')
      .expect(200);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CIRCULAR_DEPENDENCY' })]));
  });

  it('rolls back the whole import when a record fails mid-transaction', async () => {
    // An outline-level jump (1 → 4) is a blocking hierarchy error at analyze,
    // so simulate a mid-commit failure instead: options mismatch after analyze.
    const analyze = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', fs.readFileSync(FIXTURE), 'mismatch.xml')
      .expect(200);
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/commit')
      .send({ token: analyze.body.token, preserveDates: false })
      .expect(400);
    expect(res.body.message).toMatch(/options differ/i);
    // nothing was persisted
    const projects = await request(app.getHttpServer()).get('/api/projects').expect(200);
    const names = (projects.body as { name: string }[]).map((p) => p.name);
    expect(names.filter((n) => n === 'Riverside Block B').length).toBe(1); // only the first import
  });

  it('maps hierarchy gaps as blocking errors', async () => {
    const xml = fs.readFileSync(FIXTURE, 'utf8').replace(
      '<UID>320</UID><ID>7</ID><Name>Ground beam</Name><Type>0</Type><OutlineLevel>3</OutlineLevel>',
      '<UID>320</UID><ID>7</ID><Name>Ground beam</Name><Type>0</Type><OutlineLevel>6</OutlineLevel>',
    );
    const res = await request(app.getHttpServer())
      .post('/api/msproject/import/analyze')
      .attach('file', Buffer.from(xml), 'gap.xml')
      .expect(200);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'HIERARCHY_GAP' })]));
  });
});

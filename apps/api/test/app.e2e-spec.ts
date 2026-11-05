import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers';

describe('BiltFlow Pulse API (e2e)', () => {
  let app: INestApplication;
  let projectId: string;
  let designId: string;
  let devId: string;
  let docId: string;
  let testId: string;
  let rolloutId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const day = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

  it('creates a project with a default calendar', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/projects')
      .send({ name: 'Acceptance Programme', projectStart: '2026-01-05T08:00:00.000Z' })
      .expect(201);
    projectId = res.body.id;
    expect(projectId).toBeTruthy();

    const cals = await request(app.getHttpServer()).get(`/api/projects/${projectId}/calendars`).expect(200);
    expect(cals.body.length).toBeGreaterThan(0);
    expect(cals.body[0].workingDays.length).toBe(5);
  });

  it('creates the sample programme (Design 10d → Dev 10d, Doc 5d ∥, Test 10d, Rollout milestone)', async () => {
    const mk = (name: string, durationMinutes: number, after?: string) =>
      request(app.getHttpServer())
        .post(`/api/projects/${projectId}/tasks`)
        .send({ name, durationMinutes, afterTaskId: after, autolink: false });

    const design = await mk('Design', 4800).expect(201);
    designId = design.body.task.id;
    const dev = await mk('Development', 4800, designId).expect(201);
    devId = dev.body.task.id;
    const doc = await mk('Document', 2400, devId).expect(201);
    docId = doc.body.task.id;
    const test = await mk('Test', 4800, docId).expect(201);
    testId = test.body.task.id;
    const rollout = await mk('Rollout', 0, testId).expect(201);
    rolloutId = rollout.body.task.id;

    const link = (pred: string, succ: string) =>
      request(app.getHttpServer()).post(`/api/tasks/${succ}/dependencies`).send({ predecessorId: pred });

    await link(designId, devId).expect(201);
    await link(devId, testId).expect(201);
    await link(docId, testId).expect(201);
    await link(testId, rolloutId).expect(201);

    const schedule = await request(app.getHttpServer()).get(`/api/projects/${projectId}/schedule`).expect(200);
    const tasks = schedule.body.tasks as Record<string, { name: string; computedStart: string; computedFinish: string; computedIsCritical: boolean; computedTotalFloat: number | null }>;
    const byName = Object.fromEntries(Object.values(tasks).map((t) => [t.name, t]));

    expect(day(byName.Design.computedFinish)).toBe('2026-01-16');
    expect(day(byName.Development.computedFinish)).toBe('2026-01-30');
    expect(day(byName.Test.computedFinish)).toBe('2026-02-13');
    expect(day(byName.Rollout.computedStart)).toBe('2026-02-16');
    expect(byName.Design.computedIsCritical).toBe(true);
    expect(byName.Document.computedIsCritical).toBe(false);
  });

  it('PATCH /api/tasks/:id extends Design 10→15d and moves dependents by 5 working days', async () => {
    const scheduleBefore = await request(app.getHttpServer()).get(`/api/projects/${projectId}/schedule`).expect(200);
    const version = scheduleBefore.body.project.currentScheduleVersion;

    const res = await request(app.getHttpServer())
      .patch(`/api/tasks/${designId}`)
      .send({ durationMinutes: 7200, expectedScheduleVersion: version })
      .expect(200);

    expect(res.body.scheduleVersion).toBe(version + 1);
    const changed = res.body.changedTasks as { taskId: string; before: { finish: string }; after: { finish: string } }[];
    const changedIds = changed.map((c) => c.taskId);
    expect(changedIds).toContain(devId);
    expect(changedIds).toContain(testId);
    expect(changedIds).toContain(rolloutId);
    // Document's DATES must not move (its float legitimately grows): asserted below via the schedule

    const schedule = await request(app.getHttpServer()).get(`/api/projects/${projectId}/schedule`).expect(200);
    const byId = new Map((schedule.body.tasks as { id: string; computedStart: string; computedFinish: string }[]).map((t) => [t.id, t]));
    expect(day(byId.get(devId)!.computedStart)).toBe('2026-01-26');
    expect(day(byId.get(rolloutId)!.computedStart)).toBe('2026-02-23');
    expect(day(byId.get(docId)!.computedStart)).toBe('2026-01-05'); // independent — unmoved
  });

  it('rejects optimistic-concurrency conflicts with 409', async () => {
    await request(app.getHttpServer())
      .patch(`/api/tasks/${designId}`)
      .send({ durationMinutes: 4800, expectedScheduleVersion: 1 })
      .expect(409);
  });

  it('rejects circular dependencies with 400 and the cycle path', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/tasks/${designId}/dependencies`)
      .send({ predecessorId: rolloutId })
      .expect(400);
    expect(res.body.code).toBe('CIRCULAR_DEPENDENCY');
    expect(res.body.message).toContain('→');
  });

  it('rejects duplicate dependency pairs with 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/tasks/${devId}/dependencies`)
      .send({ predecessorId: designId })
      .expect(400);
  });

  it('assigns resources and recalculates work-driven duration (fixed work)', async () => {
    const mkRes = (name: string) =>
      request(app.getHttpServer()).post(`/api/projects/${projectId}/resources`).send({ name, kind: 'work', standardRate: 60 });

    const r1 = await mkRes('Worker One').expect(201);
    const r2 = await mkRes('Worker Two').expect(201);

    // 80h of fixed work; with one resource it runs 10 days
    const task = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .send({ name: 'Fixed Work Task', durationMinutes: 4800, taskType: 'fixed_work', autolink: false })
      .expect(201);
    const taskId = task.body.task.id;

    const first = await request(app.getHttpServer())
      .post(`/api/tasks/${taskId}/assignments`)
      .send({ resourceId: r1.body.id, units: 1 })
      .expect(201);
    expect(first.body.calculated.durationMinutes).toBe(4800);
    expect(day(first.body.calculated.finish)).toBe('2026-01-16');

    // Adding a second resource splits the fixed work → 2 × 100% → 5 working days
    const second = await request(app.getHttpServer())
      .post(`/api/tasks/${taskId}/assignments`)
      .send({ resourceId: r2.body.id, units: 1 })
      .expect(201);
    expect(second.body.calculated.durationMinutes).toBe(2400);
    expect(day(second.body.calculated.finish)).toBe('2026-01-09');
  });

  it('detects over-allocation and previews leveling without mutating', async () => {
    const usage = await request(app.getHttpServer()).get(`/api/projects/${projectId}/resource-usage`).expect(200);
    expect(usage.body.resources.length).toBeGreaterThan(0);

    const res1 = await request(app.getHttpServer()).post(`/api/projects/${projectId}/resources`).send({ name: 'Overloaded Worker', kind: 'work', maxUnits: 1 }).expect(201);
    const t1 = await request(app.getHttpServer()).post(`/api/projects/${projectId}/tasks`).send({ name: 'Parallel A', durationMinutes: 2400, autolink: false }).expect(201);
    const t2 = await request(app.getHttpServer()).post(`/api/projects/${projectId}/tasks`).send({ name: 'Parallel B', durationMinutes: 2400, autolink: false }).expect(201);
    await request(app.getHttpServer()).post(`/api/tasks/${t1.body.task.id}/assignments`).send({ resourceId: res1.body.id, units: 1 }).expect(201);
    await request(app.getHttpServer()).post(`/api/tasks/${t2.body.task.id}/assignments`).send({ resourceId: res1.body.id, units: 1 }).expect(201);

    const usage2 = await request(app.getHttpServer()).get(`/api/projects/${projectId}/resource-usage`).expect(200);
    const over = usage2.body.resources.find((r: { name: string }) => r.name === 'Overloaded Worker');
    expect(over.overallocatedDays.length).toBeGreaterThan(0);

    const preview = await request(app.getHttpServer()).post(`/api/projects/${projectId}/leveling/preview`).send({}).expect(201);
    expect(preview.body.delays.length).toBeGreaterThan(0);
    expect(preview.body.feasible).toBe(true);
  });

  it('saves a baseline that survives schedule changes', async () => {
    const baseline = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/baselines`)
      .send({ name: 'Original Plan' })
      .expect(201);
    const baselineId = baseline.body.id;

    await request(app.getHttpServer())
      .patch(`/api/tasks/${designId}`)
      .send({ durationMinutes: 9600 })
      .expect(200);

    const compare = await request(app.getHttpServer()).get(`/api/baselines/${baselineId}/compare`).expect(200);
    const designRow = (compare.body.rows as { name: string; finishVarianceMinutes: number }[]).find((r) => r.name === 'Design')!;
    expect(designRow).toBeTruthy();
    expect(designRow.finishVarianceMinutes).toBeGreaterThan(0);

    const snapshot = await request(app.getHttpServer()).get(`/api/baselines/${baselineId}`).expect(200);
    const designSnap = (snapshot.body as { name: string; durationMinutes: number }[]).find((r) => r.name === 'Design')!;
    expect(designSnap.durationMinutes).toBe(7200); // baseline untouched by the live change
  });

  it('records progress and reports tracking', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/tasks/${devId}/progress`)
      .send({ percentComplete: 40, actualWorkMinutes: 1920 })
      .expect(201);
    expect(res.body.task.percentComplete).toBe(40);

    const tracking = await request(app.getHttpServer()).get(`/api/projects/${projectId}/progress`).expect(200);
    expect(tracking.body.tasks.length).toBeGreaterThan(5);
  });

  it('returns the critical path with float', async () => {
    const res = await request(app.getHttpServer()).get(`/api/projects/${projectId}/critical-path`).expect(200);
    expect(res.body.criticalPathIds.length).toBeGreaterThan(0);
    expect(res.body.criticalTasks.length).toBeGreaterThan(0);
  });

  it('indent + outdent maintain summary rollups', async () => {
    const t1 = await request(app.getHttpServer()).post(`/api/projects/${projectId}/tasks`).send({ name: 'Group A', durationMinutes: 0, autolink: false }).expect(201);
    const t2 = await request(app.getHttpServer()).post(`/api/projects/${projectId}/tasks`).send({ name: 'Child A1', durationMinutes: 2400, afterTaskId: t1.body.task.id, autolink: false }).expect(201);
    const t3 = await request(app.getHttpServer()).post(`/api/projects/${projectId}/tasks`).send({ name: 'Child A2', durationMinutes: 2400, afterTaskId: t2.body.task.id, autolink: false }).expect(201);

    await request(app.getHttpServer()).post(`/api/tasks/${t2.body.task.id}/indent`).expect(201);
    await request(app.getHttpServer()).post(`/api/tasks/${t3.body.task.id}/indent`).expect(201);

    const schedule = await request(app.getHttpServer()).get(`/api/projects/${projectId}/schedule`).expect(200);
    const group = (schedule.body.tasks as { id: string; computedIsSummary: boolean; wbs: string }[]).find((t) => t.id === t1.body.task.id)!;
    expect(group.computedIsSummary).toBe(true);
    expect(group.wbs).toBeTruthy();

    await request(app.getHttpServer()).post(`/api/tasks/${t3.body.task.id}/outdent`).expect(201);
  });

  it('exports the programme as CSV with predecessors', async () => {
    const res = await request(app.getHttpServer()).get(`/api/projects/${projectId}/export?format=csv`).expect(200);
    expect(res.body.format).toBe('csv');
    expect(res.body.body).toContain('Predecessors');
  });

  it('imports a CSV programme into a new project', async () => {
    const csv = [
      'Name,Duration,Outline Level,Predecessors',
      'Mobilise,5,0,',
      'Build,10,0,1FS',
      'Close out,0,0,2FS',
    ].join('\n');
    const res = await request(app.getHttpServer())
      .post('/api/projects/import')
      .send({ format: 'csv', csv })
      .expect(201);
    expect(res.body.importedTasks).toBe(3);
    expect(res.body.project.id).toBeTruthy();
  });
});

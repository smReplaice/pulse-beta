import { DataSource } from 'typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  OrganizationEntity,
  PortfolioEntity,
  ProjectEntity,
  ProjectSettingsEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../entities';

/**
 * Seeds the BiltFlow organization, a portfolio, and the reference sample
 * programme used by the acceptance tests:
 *   Design 10d → Development 10d (Document 5d in parallel) → Test 10d → Rollout milestone
 * = 30 working days.
 */
export async function seedProgrammes(em: DataSource): Promise<void> {

  const orgRepo = em.getRepository(OrganizationEntity);
  let org = await orgRepo.findOne({ where: { slug: 'biltoflow' } });
  if (!org) {
    org = await orgRepo.save(orgRepo.create({ slug: 'biltoflow', name: 'BiltFlow Construction' }));
  }

  const portfolioRepo = em.getRepository(PortfolioEntity);
  let portfolio = await portfolioRepo.findOne({ where: { organizationId: org.id } });
  if (!portfolio) {
    portfolio = await portfolioRepo.save(
      portfolioRepo.create({
        organizationId: org.id,
        name: 'Main Portfolio',
        description: 'All live programmes',
      }),
    );
  }

  const projectRepo = em.getRepository(ProjectEntity);
  const existingSample = await projectRepo.findOne({ where: { name: 'Sample Delivery Programme' } });
  if (existingSample) {
    console.log('Seed data already present — skipping.');
    return;
  }

  const standardDay = [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ];

  const mkProject = async (name: string, code: string, start: Date): Promise<string> => {
    const project = await projectRepo.save(
      projectRepo.create({
        organizationId: org.id,
        portfolioId: portfolio.id,
        code,
        name,
        description: 'Seeded reference programme',
        projectStart: start,
        minutesPerDay: 480,
        minutesPerWeek: 2400,
        daysPerMonth: 20,
      }),
    );
    const calRepo = em.getRepository(CalendarEntity);
    const cal = await calRepo.save(
      calRepo.create({
        organizationId: org.id,
        projectId: project.id,
        name: 'Standard',
        isDefault: true,
      }),
    );
    await em.getRepository(CalendarWorkingDayEntity).insert(
      [1, 2, 3, 4, 5].map((dow) => ({ calendarId: cal.id, dayOfWeek: dow, periods: standardDay })),
    );
    await em.getRepository(ProjectSettingsEntity).insert({
      projectId: project.id,
      defaultCalendarId: cal.id,
    });
    return project.id;
  };

  // ---------------------------------------------------------- sample programme
  const nextMonday = new Date();
  nextMonday.setUTCHours(8, 0, 0, 0);
  const dow = nextMonday.getUTCDay();
  nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - dow) % 7 || 7));

  const sampleId = await mkProject('Sample Delivery Programme', 'SAMPLE-01', nextMonday);
  const calRepo = em.getRepository(CalendarEntity);
  const sampleCal = await calRepo.findOneByOrFail({ projectId: sampleId });

  const taskRepo = em.getRepository(TaskEntity);
  const mkTask = (
    projectId: string,
    rowOrder: number,
    outlineLevel: number,
    name: string,
    durationMinutes: number,
    extra: Partial<TaskEntity> = {},
  ) => taskRepo.create({ projectId, rowOrder, outlineLevel, name, durationMinutes, ...extra });

  const design = await taskRepo.save(mkTask(sampleId, 1000, 0, 'Design', 10 * 480, { stage: 'Design', priority: 600 }));
  const dev = await taskRepo.save(mkTask(sampleId, 2000, 0, 'Development', 10 * 480, { stage: 'Build' }));
  const doc = await taskRepo.save(mkTask(sampleId, 3000, 0, 'Document', 5 * 480, { stage: 'Design' }));
  const test = await taskRepo.save(mkTask(sampleId, 4000, 0, 'Test', 10 * 480, { stage: 'Commission' }));
  const rollout = await taskRepo.save(mkTask(sampleId, 5000, 0, 'Rollout', 0));

  const depRepo = em.getRepository(TaskDependencyEntity);
  await depRepo.insert([
    { projectId: sampleId, predecessorId: design.id, successorId: dev.id, type: 'FS', lagMinutes: 0 },
    { projectId: sampleId, predecessorId: dev.id, successorId: test.id, type: 'FS', lagMinutes: 0 },
    { projectId: sampleId, predecessorId: doc.id, successorId: test.id, type: 'FS', lagMinutes: 0 },
    { projectId: sampleId, predecessorId: test.id, successorId: rollout.id, type: 'FS', lagMinutes: 0 },
  ]);

  // Resources + assignments
  const resRepo = em.getRepository(ResourceEntity);
  const alice = await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: sampleId, kind: 'work', name: 'Alice Chen', initials: 'AC', group: 'Engineering', maxUnits: 1, standardRate: 85, overtimeRate: 110 }),
  );
  const bob = await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: sampleId, kind: 'work', name: 'Bob Silva', initials: 'BS', group: 'Engineering', maxUnits: 1, standardRate: 75, overtimeRate: 95 }),
  );
  await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: sampleId, kind: 'material', name: 'Ready-mix concrete', code: 'MAT-CONC', maxUnits: 0, standardRate: 120 }),
  );

  const assignRepo = em.getRepository(ResourceAssignmentEntity);
  await assignRepo.insert([
    { projectId: sampleId, taskId: design.id, resourceId: alice.id, units: 1, workMinutes: null, cost: null },
    { projectId: sampleId, taskId: dev.id, resourceId: bob.id, units: 1, workMinutes: null, cost: null },
  ]);

  // ---------------------------------------------------------- construction demo
  const demoId = await mkProject(
    'Riverside Apartments — 20 Storeys',
    'RIV-2027',
    new Date('2027-01-04T08:00:00.000Z'),
  );
  const demoCal = await calRepo.findOneByOrFail({ projectId: demoId });
  const calExcRepo = em.getRepository(CalendarExceptionEntity);
  // UK-ish example holidays on the demo calendar
  await calExcRepo.insert([
    { calendarId: demoCal.id, date: '2027-01-01', periods: [], label: 'New Year' },
    { calendarId: demoCal.id, date: '2027-04-02', periods: [], label: 'Good Friday' },
    { calendarId: demoCal.id, date: '2027-04-05', periods: [], label: 'Easter Monday' },
    { calendarId: demoCal.id, date: '2027-05-03', periods: [], label: 'Early May bank holiday' },
    { calendarId: sampleCal.id, date: '2026-12-25', periods: [], label: 'Christmas Day' },
  ]);

  const demo: [string, number, number, Partial<TaskEntity>][] = [
    ['Residential tower — 20 storeys', 0, 0, {}],
    ['Enabling & approvals', 1000, 1, { stage: 'Pre-construction', isApproval: true }],
    ['Design development', 2000, 2, { stage: 'Pre-construction', trade: 'Design' }],
    ['Authority approvals', 3000, 2, { stage: 'Pre-construction', isApproval: true }],
    ['Long-lead procurement', 4000, 1, { stage: 'Procurement', isProcurement: true }],
    ['Substructure', 5000, 1, { stage: 'Substructure' }],
    ['Excavation & shoring', 6000, 2, { trade: 'Earthworks' }],
    ['Piling', 7000, 2, { trade: 'Piling' }],
    ['Raft & foundations', 8000, 2, { trade: 'Concrete' }],
    ['Superstructure', 9000, 1, { stage: 'Superstructure' }],
    ['Structural frame (20 floors)', 10000, 2, { trade: 'Concrete' }],
    ['Façade & envelope', 11000, 2, { trade: 'Façade' }],
    ['MEP & fit-out', 12000, 1, { stage: 'Fit-out' }],
    ['MEP first fix', 13000, 2, { trade: 'MEP' }],
    ['Internal fit-out', 14000, 2, { trade: 'Finishes' }],
    ['MEP second fix', 15000, 2, { trade: 'MEP' }],
    ['Commissioning & inspections', 16000, 1, { stage: 'Commission', isInspection: true }],
    ['Handover', 17000, 0, {}],
  ];
  const demoIds: string[] = [];
  for (const [name, rowOrder, level, extra] of demo) {
    const t = await taskRepo.save(mkTask(demoId, rowOrder, level, name, level === 0 || (demo.findIndex((x) => x[0] === name) === demo.length - 1) ? 0 : 25 * 480, extra));
    demoIds.push(t.id);
  }
  // durations: summaries/milestones 0, activities 25d — then set specific ones
  const setDur = async (idx: number, days: number) => {
    await taskRepo.update({ id: demoIds[idx] }, { durationMinutes: days * 480 });
  };
  await setDur(0, 0);
  await setDur(1, 0);
  await setDur(2, 60); await setDur(3, 30); await setDur(4, 40);
  await setDur(5, 0);
  await setDur(6, 25); await setDur(7, 30); await setDur(8, 35);
  await setDur(9, 0);
  await setDur(10, 120); await setDur(11, 90);
  await setDur(12, 0);
  await setDur(13, 80); await setDur(14, 70); await setDur(15, 45);
  await setDur(16, 20);
  await setDur(17, 0);

  const link = async (from: number, to: number, type = 'FS', lagDays = 0) => {
    await depRepo.insert({
      projectId: demoId,
      predecessorId: demoIds[from],
      successorId: demoIds[to],
      type,
      lagMinutes: lagDays * 480,
    });
  };
  await link(2, 3); // design → approvals
  await link(2, 4); // design → procurement
  await link(3, 6); // approvals → excavation
  await link(6, 7); // excavation → piling
  await link(7, 8); // piling → raft
  await link(8, 10); // raft → frame
  await link(10, 11, 'FS', 30); // frame → façade (+30d lag / overlap)
  await link(10, 13, 'FS', 45);
  await link(13, 14);
  await link(14, 15);
  await link(11, 16, 'FS', 15);
  await link(15, 16);
  await link(16, 17);

  // Demo resources: labour + subcontractors + equipment
  const crew = await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: demoId, kind: 'work', name: 'Concrete crew A', group: 'Direct labour', maxUnits: 8, standardRate: 62 }),
  );
  const crane = await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: demoId, kind: 'work', name: 'Tower crane TC-1', group: 'Equipment', maxUnits: 1, standardRate: 400 }),
  );
  const mep = await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: demoId, kind: 'work', name: 'MEP subcontractor', group: 'Subcontractors', maxUnits: 12, standardRate: 95 }),
  );
  const facade = await resRepo.save(
    resRepo.create({ organizationId: org.id, projectId: demoId, kind: 'work', name: 'Façade subcontractor', group: 'Subcontractors', maxUnits: 10, standardRate: 88 }),
  );
  await assignRepo.insert([
    { projectId: demoId, taskId: demoIds[10], resourceId: crew.id, units: 6, workMinutes: null, cost: null },
    { projectId: demoId, taskId: demoIds[10], resourceId: crane.id, units: 1, workMinutes: null, cost: null },
    { projectId: demoId, taskId: demoIds[11], resourceId: facade.id, units: 8, workMinutes: null, cost: null },
    { projectId: demoId, taskId: demoIds[13], resourceId: mep.id, units: 10, workMinutes: null, cost: null },
    { projectId: demoId, taskId: demoIds[14], resourceId: mep.id, units: 6, workMinutes: null, cost: null },
  ]);

  console.log('Seed complete: organization, portfolio, 2 projects (sample + demo), resources.');
}

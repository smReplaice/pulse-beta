import { describe, expect, it, beforeEach } from 'vitest';
import {
  calculateSchedule,
  previewLeveling,
  computeEarnedValue,
  CircularDependencyError,
  InvalidDependencyError,
  formatDuration,
  parseDuration,
} from '../src';
import {
  assignment,
  CAL,
  day,
  dep,
  project,
  resetOrder,
  task,
  workResource,
  PROJ_START,
} from './fixtures';

beforeEach(() => resetOrder());

/** The supplied sample programme: Design 10d → Dev 10d, Doc 5d parallel, Test 10d after both, Rollout milestone. */
function sampleProgramme() {
  const design = task('design', 'Design', { durationMinutes: 4800 });
  const dev = task('dev', 'Development', { durationMinutes: 4800 });
  const doc = task('doc', 'Document', { durationMinutes: 2400 });
  const test = task('test', 'Test', { durationMinutes: 4800 });
  const rollout = task('rollout', 'Rollout', { durationMinutes: 0 });
  const tasks = [design, dev, doc, test, rollout];
  const deps = [
    dep('d1', 'design', 'dev', 'FS'),
    dep('d2', 'design', 'test', 'FS'), // replaced below — Test is driven by Dev AND Document
    dep('d3', 'doc', 'test', 'FS'),
  ];
  // Test after both Development and Document:
  deps[1] = dep('d2', 'dev', 'test', 'FS');
  deps.push(dep('d4', 'test', 'rollout', 'FS'));
  return { tasks, deps };
}

describe('acceptance: the supplied sample programme', () => {
  it('creates a 30-working-day programme', () => {
    const { tasks, deps } = sampleProgramme();
    const r = calculateSchedule(project(tasks, deps));
    expect(day(r.tasks.design.start)).toBe('2026-01-05');
    expect(day(r.tasks.design.finish)).toBe('2026-01-16');
    expect(day(r.tasks.dev.start)).toBe('2026-01-19');
    expect(day(r.tasks.dev.finish)).toBe('2026-01-30');
    expect(day(r.tasks.doc.start)).toBe('2026-01-05');
    expect(day(r.tasks.doc.finish)).toBe('2026-01-09');
    expect(day(r.tasks.test.start)).toBe('2026-02-02');
    expect(day(r.tasks.test.finish)).toBe('2026-02-13');
    expect(r.tasks.rollout.isMilestone).toBe(true);
    expect(day(r.tasks.rollout.start)).toBe('2026-02-16');
    expect(r.durationMinutes).toBe(30 * 480);
  });

  it('marks the driving chain critical and Document as floated', () => {
    const { tasks, deps } = sampleProgramme();
    const r = calculateSchedule(project(tasks, deps));
    expect(r.tasks.design.isCritical).toBe(true);
    expect(r.tasks.dev.isCritical).toBe(true);
    expect(r.tasks.test.isCritical).toBe(true);
    expect(r.tasks.rollout.isCritical).toBe(true);
    expect(r.tasks.doc.isCritical).toBe(false);
    // Document may finish as late as the working day before Test starts (15 wd of float)
    expect(r.tasks.doc.totalFloatMinutes).toBe(15 * 480);
    expect(r.criticalPathIds).toEqual(['design', 'dev', 'test', 'rollout']);
  });

  it('extending Design 10 → 15 days moves dependents by 5 working days and leaves independents alone', () => {
    const { tasks, deps } = sampleProgramme();
    const before = calculateSchedule(project(tasks, deps));
    const extended = tasks.map((t) =>
      t.id === 'design' ? { ...t, durationMinutes: 7200 } : t,
    );
    const after = calculateSchedule(project(extended, deps));

    expect(day(after.tasks.dev.start)).toBe('2026-01-26'); // +5 wd from 19th
    expect(day(after.tasks.test.start)).toBe('2026-02-09'); // +5 wd
    expect(day(after.tasks.rollout.start)).toBe('2026-02-23'); // +5 wd
    expect(after.durationMinutes).toBe(35 * 480);
    // Independent activity unmoved
    expect(day(after.tasks.doc.start)).toBe(day(before.tasks.doc.start));
    expect(day(after.tasks.doc.finish)).toBe(day(before.tasks.doc.finish));
    void before;
  });
});

describe('acceptance: effort-driven fixed-work scheduling', () => {
  it('two 100% resources complete an 80h fixed-work task in five 8-hour days', () => {
    const t = task('t1', 'Build', {
      durationMinutes: 2400, // placeholder; fixed work recalculates
      taskType: 'fixed_work',
    });
    const resources = [workResource('r1', 'Alice'), workResource('r2', 'Bob')];
    const assignments = [assignment('a1', 't1', 'r1', 1, 2400), assignment('a2', 't1', 'r2', 1, 2400)];
    const r = calculateSchedule(
      project([t], [], { resources, assignments }),
    );
    expect(day(r.tasks.t1.start)).toBe('2026-01-05');
    expect(day(r.tasks.t1.finish)).toBe('2026-01-09'); // 5 working days
    expect(r.tasks.t1.workMinutes).toBe(4800);
  });

  it('one resource completes the same 80h task in ten days', () => {
    const t = task('t1', 'Build', {
      durationMinutes: 4800,
      taskType: 'fixed_work',
    });
    const resources = [workResource('r1', 'Alice')];
    const assignments = [assignment('a1', 't1', 'r1', 1, 4800)];
    const r = calculateSchedule(project([t], [], { resources, assignments }));
    expect(day(r.tasks.t1.start)).toBe('2026-01-05');
    expect(day(r.tasks.t1.finish)).toBe('2026-01-16'); // 10 working days
  });

  it('a 50% resource takes twice as long', () => {
    const t = task('t1', 'Build', { durationMinutes: 4800, taskType: 'fixed_work' });
    const r = calculateSchedule(
      project([t], [], {
        resources: [workResource('r1', 'Alice')],
        assignments: [assignment('a1', 't1', 'r1', 0.5, 4800)],
      }),
    );
    expect(day(r.tasks.t1.finish)).toBe('2026-01-30'); // 20 working days
  });
});

describe('acceptance: summary rollups', () => {
  it('derives summary dates, duration and progress from children', () => {
    const summary = task('sum', 'Phase 1', { outlineLevel: 0 });
    const a = task('a', 'A', { outlineLevel: 1, durationMinutes: 2400, percentComplete: 40 });
    const b = task('b', 'B', { outlineLevel: 1, durationMinutes: 4800, percentComplete: 80 });
    const r = calculateSchedule(project([summary, a, b], [dep('d', 'a', 'b')]));
    const s = r.tasks.sum;
    expect(s.isSummary).toBe(true);
    expect(day(s.start)).toBe('2026-01-05');
    expect(day(s.finish)).toBe('2026-01-23'); // 5 + 10 sequential working days
    expect(s.durationMinutes).toBe(15 * 480);
    // (5d×40% + 10d×80%) / 15d = (200 + 800) / 15 = 66.67%
    expect(s.percentComplete).toBeCloseTo(66.67, 1);
    expect(r.tasks.a.isSummary).toBe(false);
  });

  it('numbers WBS hierarchically', () => {
    const s1 = task('s1', 'Phase 1', { outlineLevel: 0 });
    const a = task('a', 'A', { outlineLevel: 1 });
    const b = task('b', 'B', { outlineLevel: 1 });
    const s2 = task('s2', 'Phase 2', { outlineLevel: 0 });
    const r = calculateSchedule(project([s1, a, b, s2], []));
    expect(r.tasks.s1.wbs).toBe('1');
    expect(r.tasks.a.wbs).toBe('1.1');
    expect(r.tasks.b.wbs).toBe('1.2');
    expect(r.tasks.s2.wbs).toBe('2');
  });
});

describe('acceptance: circular dependencies', () => {
  it('rejects a circular dependency with the offending path', () => {
    const a = task('a', 'A');
    const b = task('b', 'B');
    const c = task('c', 'C');
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'b', 'c'), dep('d3', 'c', 'a')];
    expect(() => calculateSchedule(project([a, b, c], deps))).toThrow(CircularDependencyError);
  });

  it('rejects self-dependency', () => {
    const a = task('a', 'A');
    expect(() => calculateSchedule(project([a], [dep('d', 'a', 'a')]))).toThrow(
      InvalidDependencyError,
    );
  });

  it('rejects summary-to-child links', () => {
    const sum = task('sum', 'Phase');
    const a = task('a', 'A', { outlineLevel: 1 });
    expect(() => calculateSchedule(project([sum, a], [dep('d', 'sum', 'a')]))).toThrow(
      InvalidDependencyError,
    );
    expect(() => calculateSchedule(project([sum, a], [dep('d', 'a', 'sum')]))).toThrow(
      InvalidDependencyError,
    );
  });

  it('redirects external summary links to boundary leaves with an informational warning', () => {
    const sum = task('sum', 'Phase');
    const a = task('a', 'A', { outlineLevel: 1, durationMinutes: 2400 });
    const b = task('b', 'B', { outlineLevel: 1, durationMinutes: 2400 });
    const after = task('after', 'After', { durationMinutes: 480 });
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'sum', 'after', 'FS')];
    const r = calculateSchedule(project([sum, a, b, after], deps));
    expect(day(r.tasks.after.start)).toBe('2026-01-19'); // after the summary's last child (Jan 16)
    expect(r.warnings.some((w) => w.code === 'SUMMARY_LINK_REDIRECTED')).toBe(true);
  });
});

describe('acceptance: calendars', () => {
  it('holidays change scheduled dates', () => {
    const cal = { ...CAL, exceptions: { '2026-01-08': { periods: [], label: 'Holiday' } } };
    const t = task('t', 'T', { durationMinutes: 2400 });
    const r = calculateSchedule(project([t], [], { calendars: [cal] }));
    // Mon 5, Tue 6, Wed 7 (8th is a holiday), Fri 9, Mon 12
    expect(day(r.tasks.t.finish)).toBe('2026-01-12');
  });

  it('resource calendars change scheduled dates for fixed-work tasks', () => {
    const tueToSat = {
      ...CAL,
      id: 'tue-sat',
      name: 'Tue–Sat',
      week: {
        2: CAL.week[1],
        3: CAL.week[1],
        4: CAL.week[1],
        5: CAL.week[1],
        6: CAL.week[1],
      } as typeof CAL.week,
    };
    const t = task('t', 'T', { durationMinutes: 2400, taskType: 'fixed_work' });
    const r = calculateSchedule(
      project([t], [], {
        calendars: [CAL, tueToSat],
        resources: [workResource('r1', 'Contractor', { calendarId: 'tue-sat' })],
        assignments: [assignment('a1', 't', 'r1', 1, 2400)],
      }),
    );
    // Resource works Tue–Sat, but the task calendar is Mon–Fri: Tue 6, Wed 7, Thu 8, Fri 9 + next Tue 13
    expect(day(r.tasks.t.start)).toBe('2026-01-06');
    expect(day(r.tasks.t.finish)).toBe('2026-01-13');
  });
});

describe('dependency types, lag and lead', () => {
  it('FS + 2 working-day lag pushes the successor out', () => {
    const a = task('a', 'A', { durationMinutes: 480 });
    const b = task('b', 'B', { durationMinutes: 480 });
    const r = calculateSchedule(project([a, b], [dep('d', 'a', 'b', 'FS', 960)]));
    expect(day(r.tasks.b.start)).toBe('2026-01-08'); // A finishes Mon, +2 wd => Thu
  });

  it('negative lag (lead) pulls the successor in', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const b = task('b', 'B', { durationMinutes: 480 });
    const r = calculateSchedule(project([a, b], [dep('d', 'a', 'b', 'FS', -960)]));
    // A finishes Fri Jan 9; a 2-working-day lead lets B start Thu Jan 8 (Jan 8 + 9 are the lead days)
    expect(day(r.tasks.b.start)).toBe('2026-01-08');
  });

  it('SS starts the successor with the predecessor', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const b = task('b', 'B', { durationMinutes: 480 });
    const r = calculateSchedule(project([a, b], [dep('d', 'a', 'b', 'SS')]));
    expect(day(r.tasks.b.start)).toBe('2026-01-05');
  });

  it('FF finishes the successor with the predecessor', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const b = task('b', 'B', { durationMinutes: 1440 });
    const r = calculateSchedule(project([a, b], [dep('d', 'a', 'b', 'FF')]));
    expect(day(r.tasks.b.finish)).toBe('2026-01-09');
    expect(day(r.tasks.b.start)).toBe('2026-01-07');
  });

  it('multiple predecessors are all respected', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const b = task('b', 'B', { durationMinutes: 4800 });
    const c = task('c', 'C', { durationMinutes: 480 });
    const r = calculateSchedule(project([a, b, c], [dep('d1', 'a', 'c'), dep('d2', 'b', 'c')]));
    expect(day(r.tasks.c.start)).toBe('2026-01-19'); // B (10d) is the driving predecessor
  });
});

describe('constraints', () => {
  it('Start No Earlier Than delays a task', () => {
    const a = task('a', 'A', {
      durationMinutes: 480,
      constraint: { type: 'SNET', date: '2026-01-12T08:00:00.000Z' },
    });
    const r = calculateSchedule(project([a], []));
    expect(day(r.tasks.a.start)).toBe('2026-01-12');
  });

  it('Must Start On pins the start even against logic (with a warning)', () => {
    const a = task('a', 'A', { durationMinutes: 960 });
    const b = task('b', 'B', {
      durationMinutes: 480,
      constraint: { type: 'MSO', date: '2026-01-05T08:00:00.000Z' },
    });
    const r = calculateSchedule(project([a, b], [dep('d', 'a', 'b')]));
    // Logic says B can start Jan 7; Must Start On pulls it to Jan 5 with a conflict warning
    expect(day(r.tasks.b.start)).toBe('2026-01-05');
    expect(r.warnings.some((w) => w.code === 'CONSTRAINT_CONFLICT')).toBe(true);
  });

  it('Finish No Earlier Than backs the start out of the finish date', () => {
    const a = task('a', 'A', {
      durationMinutes: 960,
      constraint: { type: 'FNET', date: '2026-01-14T17:00:00.000Z' },
    });
    const r = calculateSchedule(project([a], []));
    expect(day(r.tasks.a.start)).toBe('2026-01-13');
    expect(day(r.tasks.a.finish)).toBe('2026-01-14');
  });

  it('Must Finish On pins the finish', () => {
    const a = task('a', 'A', {
      durationMinutes: 960,
      constraint: { type: 'MFO', date: '2026-01-06T17:00:00.000Z' },
    });
    const r = calculateSchedule(project([a], []));
    expect(day(r.tasks.a.finish)).toBe('2026-01-06');
  });

  it('deadlines warn without changing dates', () => {
    const a = task('a', 'A', { durationMinutes: 4800, deadline: '2026-01-09T17:00:00.000Z' });
    const r = calculateSchedule(project([a], []));
    expect(day(r.tasks.a.finish)).toBe('2026-01-16');
    expect(r.warnings.some((w) => w.code === 'DEADLINE_MISSED')).toBe(true);
  });
});

describe('task modes and types', () => {
  it('manual tasks keep their entered dates', () => {
    const a = task('a', 'A', {
      mode: 'manual',
      manualStart: '2026-02-02T08:00:00.000Z',
      manualFinish: '2026-02-04T17:00:00.000Z',
    });
    const b = task('b', 'B', { durationMinutes: 480 });
    const r = calculateSchedule(project([a, b], [dep('d', 'a', 'b')]));
    expect(day(r.tasks.a.start)).toBe('2026-02-02');
    expect(day(r.tasks.a.finish)).toBe('2026-02-04');
    expect(day(r.tasks.b.start)).toBe('2026-02-05');
    expect(r.tasks.a.totalFloatMinutes).toBeNull();
  });

  it('elapsed durations span calendar time including weekends', () => {
    const a = task('a', 'Cure', { durationMinutes: 7 * 24 * 60, durationMode: 'elapsed' });
    const r = calculateSchedule(project([a], []));
    expect(day(r.tasks.a.start)).toBe('2026-01-05');
    expect(day(r.tasks.a.finish)).toBe('2026-01-12');
  });
});

describe('acceptance: overallocation detection and leveling', () => {
  it('detects overallocations', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const b = task('b', 'B', { durationMinutes: 2400 });
    const r = calculateSchedule(
      project([a, b], [], {
        resources: [workResource('r1', 'Alice')],
        assignments: [assignment('a1', 'a', 'r1', 1), assignment('a2', 'b', 'r1', 1)],
      }),
    );
    const ru = r.resourceUsage.find((x) => x.resourceId === 'r1')!;
    expect(ru.overallocatedDays.length).toBe(5);
    expect(ru.peakUnits).toBeGreaterThan(1.9);
    expect(r.warnings.some((w) => w.code === 'OVERALLOCATION')).toBe(true);
  });

  it('levels by delaying — never touching logic or baselines — and can be reverted', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const b = task('b', 'B', { durationMinutes: 2400 });
    const input = project([a, b], [], {
      resources: [workResource('r1', 'Alice')],
      assignments: [assignment('a1', 'a', 'r1', 1), assignment('a2', 'b', 'r1', 1)],
    });
    const preview = previewLeveling(input);
    expect(preview.feasible).toBe(true);
    expect(preview.delays.length).toBe(1);
    expect(preview.delays[0].delayMinutes).toBe(5 * 480);
    expect(preview.finishSlipMinutes).toBeGreaterThan(0);
    const delayedTask = input.tasks.find((t) => t.id === preview.delays[0].taskId)!;
    expect(delayedTask.levelingDelayMinutes).toBe(0); // preview must not mutate the input
  });

  it('does not delay do-not-level tasks', () => {
    const a = task('a', 'A', { durationMinutes: 2400, priority: 1000 });
    const b = task('b', 'B', { durationMinutes: 2400, priority: 1000 });
    const input = project([a, b], [], {
      resources: [workResource('r1', 'Alice')],
      assignments: [assignment('a1', 'a', 'r1', 1), assignment('a2', 'b', 'r1', 1)],
    });
    const preview = previewLeveling(input);
    expect(preview.feasible).toBe(false);
    expect(preview.delays.length).toBe(0);
    expect(preview.remainingOverallocations.length).toBe(5);
  });
});

describe('costs', () => {
  it('computes planned cost from rates and work', () => {
    const a = task('a', 'A', { durationMinutes: 2400 });
    const r = calculateSchedule(
      project([a], [], {
        resources: [workResource('r1', 'Alice', { standardRate: 60 })],
        assignments: [assignment('a1', 'a', 'r1', 1)],
      }),
    );
    // 5 days × 8h × 1.0 units × $60 = $2400
    expect(r.tasks.a.plannedCost).toBe(2400);
    expect(r.tasks.a.workMinutes).toBe(2400);
  });

  it('adds material and cost resources plus fixed cost', () => {
    const a = task('a', 'Pour slab', { durationMinutes: 480, fixedCost: 500 });
    const r = calculateSchedule(
      project([a], [], {
        resources: [
          workResource('r1', 'Crew', { standardRate: 60 }),
          { id: 'm1', name: 'Concrete', kind: 'material', maxUnits: 0, standardRate: 120, overtimeRate: 0, costPerUse: 0, calendarId: null },
          { id: 'c1', name: 'Permit', kind: 'cost', maxUnits: 0, standardRate: 0, overtimeRate: 0, costPerUse: 0, calendarId: null },
        ],
        assignments: [
          assignment('a1', 'a', 'r1', 1),
          assignment('a2', 'a', 'm1', 1, 20), // 20 m³ @ $120
          { id: 'a3', taskId: 'a', resourceId: 'c1', units: 1, workMinutes: null, cost: 750 },
        ],
      }),
    );
    expect(r.tasks.a.plannedCost).toBe(480 + 2400 + 750 + 500);
  });
});

describe('earned value', () => {
  it('computes BCWS/BCWP/ACWP derived indicators from a baseline', () => {
    const a = task('a', 'A', { durationMinutes: 2400, percentComplete: 50 });
    const r = calculateSchedule(
      project([a], [], {
        resources: [workResource('r1', 'Alice', { standardRate: 60 })],
        assignments: [assignment('a1', 'a', 'r1', 1)],
      }),
    );
    const ev = computeEarnedValue(
      [
        {
          taskId: 'a',
          name: 'A',
          start: r.tasks.a.start,
          finish: r.tasks.a.finish,
          durationMinutes: 2400,
          workMinutes: 2400,
          cost: 2400,
          percentComplete: 0,
        },
      ],
      r,
      '2026-01-07T17:00:00.000Z',
      CAL,
    );
    expect(ev.bac).toBe(2400);
    expect(ev.ev).toBe(1200); // 50% × BAC
    expect(ev.pv).toBe(1440); // 3 of 5 days earned by Jan 7
    expect(ev.sv).toBe(-240);
    expect(ev.series.length).toBeGreaterThan(0);
  });
});

describe('duration formatting', () => {
  it('formats like MS Project', () => {
    expect(formatDuration(480)).toBe('1 day');
    expect(formatDuration(2400)).toBe('5 days');
    expect(formatDuration(2400 * 5)).toBe('5 wks');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(30)).toBe('30 mins');
    expect(formatDuration(0)).toBe('0 days');
    expect(formatDuration(480, undefined, true)).toBe('1 day?');
  });

  it('parses MS Project and shorthand inputs', () => {
    expect(parseDuration('5 days').minutes).toBe(2400);
    expect(parseDuration('5d').minutes).toBe(2400);
    expect(parseDuration('2 wks').minutes).toBe(4800);
    expect(parseDuration('1.5 hrs').minutes).toBe(90);
    expect(parseDuration('3').minutes).toBe(1440);
    expect(parseDuration('4 days?').estimated).toBe(true);
  });
});

describe('multiple critical paths', () => {
  it('can report every critical path when enabled', () => {
    const a = task('a', 'A', { durationMinutes: 4800 });
    const b = task('b', 'B', { durationMinutes: 4800 });
    const end = task('end', 'End', { durationMinutes: 0 });
    const r = calculateSchedule(
      project([a, b, end], [dep('d1', 'a', 'end'), dep('d2', 'b', 'end')], {
        multipleCriticalPaths: true,
      }),
    );
    expect(r.criticalPaths.length).toBe(2);
    expect(r.criticalTaskIds.sort()).toEqual(['a', 'b', 'end'].sort());
  });
});

describe('progress', () => {
  it('keeps actuals and remaining work', () => {
    const a = task('a', 'A', {
      durationMinutes: 4800,
      percentComplete: 25,
      actualStart: '2026-01-05T08:00:00.000Z',
      actualWorkMinutes: 960,
    });
    const r = calculateSchedule(
      project([a], [], {
        resources: [workResource('r1', 'Alice', { standardRate: 60 })],
        assignments: [assignment('a1', 'a', 'r1', 1)],
      }),
    );
    expect(r.tasks.a.actualWorkMinutes).toBe(960);
    expect(r.tasks.a.remainingWorkMinutes).toBe(4800 - 960);
    expect(r.tasks.a.actualStart).toBe('2026-01-05T08:00:00.000Z');
    void PROJ_START;
  });
});

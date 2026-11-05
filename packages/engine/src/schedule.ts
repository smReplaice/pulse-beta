import {
  AssignmentInput,
  AssignmentResult,
  CalendarSpec,
  DependencyInput,
  EngineProjectInput,
  ResourceInput,
  ResourceUsageResult,
  ScheduleResult,
  ScheduleWarning,
  TaskInput,
  TaskResult,
  TimephasedPoint,
} from './types';
import {
  addDays,
  addWorkingMinutes,
  alignEnd,
  alignStart,
  dateKey,
  keyToDate,
  subtractWorkingMinutes,
  workingMinutesBetween,
  workingMinutesOnDate,
  workingPeriodsOn,
} from './calendar';
import { buildHierarchy, effectiveEdges, ProgrammeGraph, topoSortLeaves } from './graph';
import { assignmentRefs, distributeWork, walkCapacity } from './capacity';

const MS = 60000;

interface LeafState {
  id: string;
  task: TaskInput;
  cal: CalendarSpec;
  effDur: number;
  assignments: { units: number; cal: CalendarSpec; resource: ResourceInput; workMinutes: number }[];
  assignmentDriven: boolean;
  totalWork: number;
  start: Date;
  finish: Date;
  lateStart: Date;
  lateFinish: Date;
  tf: number | null;
  ff: number | null;
}

interface Intermediate {
  leaves: Record<string, LeafState>;
  order: string[];
  warnings: ScheduleWarning[];
}

export function calculateSchedule(input: EngineProjectInput): ScheduleResult {
  const warnings: ScheduleWarning[] = [];
  const calendarById = new Map(input.calendars.map((c) => [c.id, c]));
  const projCal = calendarById.get(input.defaultCalendarId) ?? input.calendars[0];
  if (!projCal) throw new Error('No calendars supplied to the scheduling engine');

  const graph = buildHierarchy(input.tasks);
  const { order, redirected } = topoSortLeaves(graph, input.dependencies);
  for (const [depId, r] of redirected) {
    warnings.push({
      code: 'SUMMARY_LINK_REDIRECTED',
      severity: 'info',
      dependencyId: depId,
      message: `Dependency involving a summary task is applied to its boundary activity ('${graph.nodes[r.to]?.task.name}')`,
    });
  }
  const { incoming, outgoing } = effectiveEdges(input.dependencies, graph);

  const leaves: Record<string, LeafState> = {};
  for (const id of graph.leafIds) {
    const task = graph.nodes[id].task;
    const cal = task.calendarId ? calendarById.get(task.calendarId) ?? projCal : projCal;
    const refs = assignmentRefs(input.assignments, input.resources, calendarById, projCal, id);
    const workRefs = refs.filter((r) => r.resource.kind === 'work');
    const assignmentDriven =
      workRefs.length > 0 &&
      task.mode === 'auto' &&
      task.durationMode === 'working' &&
      (task.taskType === 'fixed_work' || task.taskType === 'fixed_units' || task.taskType === 'fixed_duration')
        ? task.taskType === 'fixed_work' ||
          (task.taskType === 'fixed_units' && task.effortDriven && workRefs.some((r) => (r.assignment.workMinutes ?? 0) > 0))
        : false;

    const assignments = workRefs.map((r) => ({
      units: r.assignment.units,
      cal: r.calendar,
      resource: r.resource,
      workMinutes: r.assignment.workMinutes ?? r.assignment.units * task.durationMinutes,
    }));
    const totalWork =
      task.taskType === 'fixed_work' || (task.taskType === 'fixed_units' && task.effortDriven)
        ? assignments.reduce((s, a) => s + a.workMinutes, 0)
        : assignments.reduce((s, a) => s + a.units * task.durationMinutes, 0);

    leaves[id] = {
      id,
      task,
      cal,
      effDur: task.durationMinutes,
      assignments,
      assignmentDriven,
      totalWork,
      start: new Date(0),
      finish: new Date(0),
      lateStart: new Date(0),
      lateFinish: new Date(0),
      tf: null,
      ff: null,
    };
  }

  const projectStartInstant = alignStart(projCal, new Date(input.start));

  // ------------------------------------------------------------------ forward
  const runForward = (fixedStarts: Map<string, Date>) => {
    for (const id of order) {
      const L = leaves[id];
      const t = L.task;
      if (t.mode === 'manual') {
        L.start = t.manualStart ? new Date(t.manualStart) : projectStartInstant;
        L.finish = t.manualFinish
          ? new Date(t.manualFinish)
          : t.durationMode === 'elapsed'
            ? new Date(L.start.getTime() + L.effDur * MS)
            : addWorkingMinutes(L.cal, L.start, L.effDur);
        continue;
      }
      if (t.active === false) {
        L.start = projectStartInstant;
        L.finish = t.durationMode === 'elapsed'
          ? new Date(L.start.getTime() + L.effDur * MS)
          : addWorkingMinutes(L.cal, L.start, L.effDur);
        continue;
      }
      let es = fixedStarts.has(id) ? fixedStarts.get(id)! : projectStartInstant;

      if (!fixedStarts.has(id)) {
        for (const { pred, dep } of incoming.get(id) ?? []) {
          const P = leaves[pred];
          if (!P) continue;
          let cand: Date;
          switch (dep.type) {
            case 'FS':
              cand = alignStart(L.cal, addWorkingMinutes(L.cal, P.finish, dep.lagMinutes));
              break;
            case 'SS':
              cand = alignStart(L.cal, addWorkingMinutes(L.cal, P.start, dep.lagMinutes));
              break;
            case 'FF':
              cand = subtractWorkingMinutes(
                L.cal,
                addWorkingMinutes(L.cal, P.finish, dep.lagMinutes),
                L.effDur,
              );
              break;
            case 'SF':
            default:
              cand = subtractWorkingMinutes(
                L.cal,
                addWorkingMinutes(L.cal, P.start, dep.lagMinutes),
                L.effDur,
              );
              break;
          }
          if (cand > es) es = cand;
        }

        // Leveling delay
        if (t.levelingDelayMinutes > 0) {
          es = alignStart(L.cal, addWorkingMinutes(L.cal, es, t.levelingDelayMinutes));
        }

        // Constraints
        const c = t.constraint;
        if (c && c.date) {
          const cdate = new Date(c.date);
          switch (c.type) {
            case 'SNET': {
              const s = alignStart(L.cal, cdate);
              if (s > es) es = s;
              break;
            }
            case 'MSO': {
              const s = alignStart(L.cal, cdate);
              if (es > s) {
                warnings.push({
                  code: 'CONSTRAINT_CONFLICT',
                  severity: 'warning',
                  taskId: id,
                  message: `Must Start On ${cdate.toISOString().slice(0, 10)} conflicts with predecessor dates for '${t.name}'`,
                });
              }
              es = s;
              break;
            }
            case 'FNET': {
              const s = subtractWorkingMinutes(L.cal, alignEnd(L.cal, cdate), L.effDur);
              if (s > es) es = s;
              break;
            }
            case 'MFO': {
              const f = alignEnd(L.cal, cdate);
              const s = subtractWorkingMinutes(L.cal, f, L.effDur);
              if (es > s) {
                warnings.push({
                  code: 'CONSTRAINT_CONFLICT',
                  severity: 'warning',
                  taskId: id,
                  message: `Must Finish On ${cdate.toISOString().slice(0, 10)} pulls '${t.name}' earlier than its logic allows`,
                });
              }
              es = s;
              break;
            }
            case 'SNLT': {
              const s = alignStart(L.cal, cdate);
              if (es > s) {
                warnings.push({
                  code: 'CONSTRAINT_CONFLICT',
                  severity: 'warning',
                  taskId: id,
                  message: `'${t.name}' cannot start by ${cdate.toISOString().slice(0, 10)} (Start No Later Than)`,
                });
              }
              break;
            }
            case 'FNLT': {
              const f = addWorkingMinutes(L.cal, es, L.effDur);
              if (f > alignEnd(L.cal, cdate)) {
                warnings.push({
                  code: 'CONSTRAINT_CONFLICT',
                  severity: 'warning',
                  taskId: id,
                  message: `'${t.name}' cannot finish by ${cdate.toISOString().slice(0, 10)} (Finish No Later Than)`,
                });
              }
              break;
            }
            default:
              break;
          }
        }
      }

      L.start = es;
      if (t.durationMode === 'elapsed') {
        L.finish = new Date(es.getTime() + L.effDur * MS);
      } else if (L.assignmentDriven && L.totalWork > 0) {
        const walk = walkCapacity(
          L.cal,
          L.assignments.map((a) => ({ units: a.units, cal: a.cal })),
          es,
          L.totalWork,
        );
        L.finish = walk.finish;
        if (walk.firstWork && walk.firstWork > es) L.start = walk.firstWork;
        if (!walk.complete) {
          warnings.push({
            code: 'ASSIGNMENT_CAPACITY',
            severity: 'error',
            taskId: id,
            message: `Assigned resources have no working capacity to complete the work of '${t.name}'`,
          });
        }
      } else {
        L.finish = addWorkingMinutes(L.cal, es, L.effDur);
      }
    }
  };

  runForward(new Map());

  // ------------------------------------------------------------------ backward
  const runBackward = () => {
    let projectFinish = projectStartInstant;
    for (const id of order) {
      const L = leaves[id];
      if (L.task.active === false) continue;
      if (L.finish > projectFinish) projectFinish = L.finish;
    }
    for (let oi = order.length - 1; oi >= 0; oi--) {
      const id = order[oi];
      const L = leaves[id];
      const t = L.task;
      if (t.mode === 'manual' || t.active === false) {
        L.lateStart = L.start;
        L.lateFinish = L.finish;
        L.tf = null;
        L.ff = null;
        continue;
      }
      let lf = projectFinish;
      for (const { succ, dep } of outgoing.get(id) ?? []) {
        const S = leaves[succ];
        if (!S) continue;
        const succCal = S.cal;
        let candLS: Date | null = null;
        let candLF: Date | null = null;
        switch (dep.type) {
          case 'FS':
            candLF = alignEnd(L.cal, subtractWorkingMinutes(succCal, S.lateStart, dep.lagMinutes));
            break;
          case 'SS':
            candLS = alignStartBack(L.cal, subtractWorkingMinutes(succCal, S.lateStart, dep.lagMinutes));
            break;
          case 'FF':
            candLF = alignEnd(L.cal, subtractWorkingMinutes(succCal, S.lateFinish, dep.lagMinutes));
            break;
          case 'SF':
          default:
            candLS = alignStartBack(L.cal, subtractWorkingMinutes(succCal, S.lateFinish, dep.lagMinutes));
            break;
        }
        if (candLF && candLF < lf) lf = candLF;
        if (candLS) {
          const impliedLF = t.durationMode === 'elapsed'
            ? new Date(candLS.getTime() + L.effDur * MS)
            : addWorkingMinutes(L.cal, candLS, L.effDur);
          if (impliedLF < lf) lf = impliedLF;
        }
      }
      L.lateFinish = lf;
      L.lateStart = t.durationMode === 'elapsed'
        ? new Date(lf.getTime() - L.effDur * MS)
        : subtractWorkingMinutes(L.cal, lf, L.effDur);

      // Hard constraints pin the task to zero float
      const c = t.constraint;
      if (c && (c.type === 'MSO' || c.type === 'MFO')) {
        L.lateStart = L.start;
        L.lateFinish = L.finish;
      }

      L.tf = t.durationMode === 'elapsed'
        ? Math.round((L.lateFinish.getTime() - L.finish.getTime()) / MS)
        : Math.round(workingMinutesBetween(L.cal, L.finish, L.lateFinish));

      // Free float
      let ff: number | null = null;
      for (const { succ, dep } of outgoing.get(id) ?? []) {
        const S = leaves[succ];
        if (!S) continue;
        let latestFinish: Date;
        switch (dep.type) {
          case 'FS':
            latestFinish = alignEnd(L.cal, subtractWorkingMinutes(S.cal, S.start, dep.lagMinutes));
            break;
          case 'SS': {
            const ls = alignStartBack(L.cal, subtractWorkingMinutes(S.cal, S.start, dep.lagMinutes));
            latestFinish = addWorkingMinutes(L.cal, ls, L.effDur);
            break;
          }
          case 'FF':
            latestFinish = alignEnd(L.cal, subtractWorkingMinutes(S.cal, S.finish, dep.lagMinutes));
            break;
          case 'SF':
          default: {
            const ls2 = alignStartBack(L.cal, subtractWorkingMinutes(S.cal, S.finish, dep.lagMinutes));
            latestFinish = addWorkingMinutes(L.cal, ls2, L.effDur);
            break;
          }
        }
        const v = L.task.durationMode === 'elapsed'
          ? Math.round((latestFinish.getTime() - L.finish.getTime()) / MS)
          : Math.round(workingMinutesBetween(L.cal, L.finish, latestFinish));
        if (ff === null || v < ff) ff = v;
      }
      L.ff = ff;
    }
    return projectFinish;
  };

  let projectFinish = runBackward();

  // ------------------------------------------------------------------ ALAP second pass
  const alapIds = order.filter((id) => {
    const t = leaves[id].task;
    return t.mode === 'auto' && t.active !== false && t.constraint?.type === 'ALAP';
  });
  if (alapIds.length > 0) {
    const fixed = new Map<string, Date>();
    for (const id of alapIds) {
      const L = leaves[id];
      fixed.set(id, L.lateStart > L.start ? L.lateStart : L.start);
    }
    runForward(fixed);
    projectFinish = runBackward();
    for (const id of alapIds) {
      const L = leaves[id];
      // After the cascade, keep float relative to the moved dates
      L.tf = Math.round(workingMinutesBetween(L.cal, L.finish, L.lateFinish));
    }
  }

  // ------------------------------------------------------------------ deadlines
  for (const id of order) {
    const t = leaves[id].task;
    if (t.deadline) {
      const dl = alignEnd(leaves[id].cal, new Date(t.deadline));
      if (leaves[id].finish > dl) {
        warnings.push({
          code: 'DEADLINE_MISSED',
          severity: 'warning',
          taskId: id,
          message: `'${t.name}' finishes after its deadline ${dateKey(dl)}`,
        });
      }
    }
  }
  if (input.deadline && projectFinish > alignEnd(projCal, new Date(input.deadline))) {
    warnings.push({
      code: 'PROJECT_DEADLINE_MISSED',
      severity: 'warning',
      message: `Project finishes after the project deadline ${dateKey(new Date(input.deadline))}`,
    });
  }

  // ------------------------------------------------------------------ rollups + results
  const threshold = input.criticalSlackThresholdMinutes ?? 0;
  const results: Record<string, TaskResult> = {};
  const usage: { assignment: AssignmentInput; resource: ResourceInput; task: TaskInput; byDay: Map<string, { planned: number; actual: number }> }[] = [];
  const plannedCostByTask = new Map<string, number>();
  const actualCostByTask = new Map<string, number>();

  const buildLeafResult = (id: string): TaskResult => {
    const L = leaves[id];
    const t = L.task;
    const isCritical = L.tf !== null && L.tf <= threshold && t.active !== false;
    let planned = t.fixedCost;
    let actual = t.actualCost ?? 0;
    for (const ref of L.assignments) {
      if (ref.resource.kind === 'work') planned += (ref.workMinutes / 60) * ref.resource.standardRate;
    }
    const matRefs = assignmentRefs(input.assignments, input.resources, calendarById, projCal, id).filter(
      (r) => r.resource.kind === 'material',
    );
    for (const m of matRefs) planned += (m.assignment.workMinutes ?? 0) * m.resource.standardRate;
    const costRefs = assignmentRefs(input.assignments, input.resources, calendarById, projCal, id).filter(
      (r) => r.resource.kind === 'cost',
    );
    for (const c of costRefs) planned += c.assignment.cost ?? 0;
    plannedCostByTask.set(id, planned);
    const aw = t.actualWorkMinutes;
    const rate = L.assignments.length > 0
      ? L.assignments.reduce((s, a) => s + a.resource.standardRate * a.units, 0) /
        Math.max(L.assignments.reduce((s, a) => s + a.units, 0), 1e-9)
      : 0;
    if (t.actualCost === null) actual = (aw / 60) * rate;
    actualCostByTask.set(id, actual);

    const work = L.totalWork > 0 || L.assignments.length > 0 ? L.totalWork : 0;
    return {
      id,
      wbs: graph.nodes[id].wbs,
      outlineLevel: t.outlineLevel,
      isSummary: false,
      isMilestone: L.effDur === 0,
      start: L.start.toISOString(),
      finish: L.finish.toISOString(),
      earlyStart: L.start.toISOString(),
      earlyFinish: L.finish.toISOString(),
      lateStart: L.lateStart.toISOString(),
      lateFinish: L.lateFinish.toISOString(),
      totalFloatMinutes: L.tf,
      freeFloatMinutes: L.ff,
      isCritical,
      durationMinutes: L.task.durationMode === 'elapsed'
        ? L.effDur
        : Math.round(workingMinutesBetween(L.cal, L.start, L.finish)) || (L.effDur === 0 ? 0 : L.effDur),
      workMinutes: work,
      actualWorkMinutes: aw,
      remainingWorkMinutes: Math.max(0, work - aw),
      percentComplete: Math.min(100, Math.max(0, t.percentComplete)),
      plannedCost: round2(planned),
      actualCost: round2(actual),
      levelingDelayMinutes: t.levelingDelayMinutes,
      calendarId: t.calendarId ?? input.defaultCalendarId,
      actualStart: t.actualStart,
      actualFinish: t.actualFinish,
    };
  };

  // Usage per assignment (needs final leaf dates)
  const assignmentResults: AssignmentResult[] = [];
  const statusDate = input.statusDate ? new Date(input.statusDate) : null;
  for (const a of input.assignments) {
    const task = input.tasks.find((t2) => t2.id === a.taskId);
    const resource = input.resources.find((r) => r.id === a.resourceId);
    if (!task || !resource) continue;
    const L = leaves[a.taskId];
    const taskCal = L ? L.cal : projCal;
    const resCal = resource.calendarId ? calendarById.get(resource.calendarId) ?? projCal : projCal;
    if (resource.kind !== 'work') {
      const qty = a.workMinutes ?? 0;
      assignmentResults.push({
        assignmentId: a.id,
        taskId: a.taskId,
        resourceId: a.resourceId,
        units: a.units,
        workMinutes: qty,
        actualWorkMinutes: 0,
        remainingWorkMinutes: qty,
        plannedCost: round2(resource.kind === 'material' ? qty * resource.standardRate : (a.cost ?? 0)),
        actualCost: 0,
        byDay: [],
      });
      continue;
    }
    const work = L
      ? (L.totalWork > 0 && (task.taskType === 'fixed_work' || (task.taskType === 'fixed_units' && task.effortDriven))
          ? L.assignments.find((x) => x.resource.id === resource.id)?.workMinutes ?? a.units * L.effDur
          : a.units * L.effDur)
      : a.workMinutes ?? 0;
    const plannedByDay = L
      ? distributeWork(taskCal, [{ units: a.units, cal: resCal }], L.start, L.finish, work)
      : new Map<string, number>();
    // Actual work distributed over the reported-actual window, same contour,
    // pro-rated by this assignment's share of the task's total planned work.
    const share = L && L.totalWork > 0 ? work / L.totalWork : 0;
    const actualWork = task.actualWorkMinutes > 0 ? task.actualWorkMinutes * share : 0;
    const aStart = task.actualStart ? new Date(task.actualStart) : L ? L.start : projectStartInstant;
    const aEnd = task.actualFinish
      ? new Date(task.actualFinish)
      : statusDate && statusDate > aStart && L
        ? (statusDate < L.finish ? statusDate : L.finish)
        : L
          ? L.finish
          : aStart;
    const actualByDay = distributeWork(
      taskCal,
      [{ units: a.units, cal: resCal }],
      aStart,
      aEnd,
      Math.min(actualWork, work) || 0,
    );

    const keys = new Set([...plannedByDay.keys(), ...actualByDay.keys()]);
    const byDay: TimephasedPoint[] = [...keys].sort().map((k) => ({
      dateKey: k,
      plannedMinutes: round1(plannedByDay.get(k) ?? 0),
      actualMinutes: round1(actualByDay.get(k) ?? 0),
      plannedCost: round2(((plannedByDay.get(k) ?? 0) / 60) * resource.standardRate),
      actualCost: round2(((actualByDay.get(k) ?? 0) / 60) * resource.standardRate),
    }));
    assignmentResults.push({
      assignmentId: a.id,
      taskId: a.taskId,
      resourceId: a.resourceId,
      units: a.units,
      workMinutes: round1(work),
      actualWorkMinutes: round1(actualWork),
      remainingWorkMinutes: round1(Math.max(0, work - actualWork)),
      plannedCost: round2((work / 60) * resource.standardRate + (resource.costPerUse ?? 0)),
      actualCost: round2((actualWork / 60) * resource.standardRate),
      byDay,
    });
    usage.push({ assignment: a, resource, task, byDay: mergeByDay(byDay) });
  }

  for (const id of order) {
    results[id] = buildLeafResult(id);
  }

  // Summaries (deepest first)
  const summaryIdsByDepth = [...graph.summaryIds].sort(
    (a, b) => graph.nodes[b].depth - graph.nodes[a].depth,
  );
  for (const sid of summaryIdsByDepth) {
    const node = graph.nodes[sid];
    const t = node.task;
    const cal = t.calendarId ? calendarById.get(t.calendarId) ?? projCal : projCal;
    const childResults = node.childIds.map((c) => results[c]);
    const start = childResults.reduce((m, c) => (new Date(c.start) < m ? new Date(c.start) : m), new Date(childResults[0].start));
    const finish = childResults.reduce((m, c) => (new Date(c.finish) > m ? new Date(c.finish) : m), new Date(childResults[0].finish));
    const es = childResults.reduce((m, c) => (new Date(c.earlyStart) < m ? new Date(c.earlyStart) : m), new Date(childResults[0].earlyStart));
    const ef = childResults.reduce((m, c) => (new Date(c.earlyFinish) > m ? new Date(c.earlyFinish) : m), new Date(childResults[0].earlyFinish));
    const ls = childResults.reduce((m, c) => (new Date(c.lateStart) < m ? new Date(c.lateStart) : m), new Date(childResults[0].lateStart));
    const lf = childResults.reduce((m, c) => (new Date(c.lateFinish) > m ? new Date(c.lateFinish) : m), new Date(childResults[0].lateFinish));
    const durSum = childResults.reduce((s, c) => s + c.durationMinutes, 0);
    const pct = durSum > 0
      ? childResults.reduce((s, c) => s + c.durationMinutes * c.percentComplete, 0) / durSum
      : 0;
    const tf = childResults
      .map((c) => c.totalFloatMinutes)
      .filter((v): v is number => v !== null);
    results[sid] = {
      id: sid,
      wbs: node.wbs,
      outlineLevel: t.outlineLevel,
      isSummary: true,
      isMilestone: false,
      start: start.toISOString(),
      finish: finish.toISOString(),
      earlyStart: es.toISOString(),
      earlyFinish: ef.toISOString(),
      lateStart: ls.toISOString(),
      lateFinish: lf.toISOString(),
      totalFloatMinutes: tf.length > 0 ? Math.min(...tf) : null,
      freeFloatMinutes: null,
      isCritical: childResults.some((c) => c.isCritical),
      durationMinutes: Math.round(workingMinutesBetween(cal, start, finish)),
      workMinutes: round1(childResults.reduce((s, c) => s + c.workMinutes, 0)),
      actualWorkMinutes: round1(childResults.reduce((s, c) => s + c.actualWorkMinutes, 0)),
      remainingWorkMinutes: round1(childResults.reduce((s, c) => s + c.remainingWorkMinutes, 0)),
      percentComplete: Math.round(pct * 100) / 100,
      plannedCost: round2(childResults.reduce((s, c) => s + c.plannedCost, 0)),
      actualCost: round2(childResults.reduce((s, c) => s + c.actualCost, 0)),
      levelingDelayMinutes: 0,
      calendarId: t.calendarId ?? input.defaultCalendarId,
      actualStart: childResults.map((c) => c.actualStart).filter(Boolean).sort()[0] ?? null,
      actualFinish: childResults.every((c) => c.actualFinish)
        ? childResults.map((c) => c.actualFinish!).sort().slice(-1)[0]
        : null,
    };
  }

  // ------------------------------------------------------------------ resource usage & overallocation
  const resourceUsage: ResourceUsageResult[] = [];
  for (const r of input.resources) {
    if (r.kind !== 'work') continue;
    const resCal = r.calendarId ? calendarById.get(r.calendarId) ?? projCal : projCal;
    const dayMap = new Map<string, TimephasedPoint>();
    for (const u of usage.filter((x) => x.resource.id === r.id)) {
      for (const [k, v] of u.byDay) {
        const cur = dayMap.get(k) ?? { dateKey: k, plannedMinutes: 0, actualMinutes: 0, plannedCost: 0, actualCost: 0 };
        cur.plannedMinutes += v.planned;
        cur.actualMinutes += v.actual;
        dayMap.set(k, cur);
      }
    }
    const overallocatedDays: string[] = [];
    let peakUnits = 0;
    for (const [k, v] of dayMap) {
      const capMinutes = workingMinutesOnDate(resCal, keyToDate(k));
      if (capMinutes > 0) {
        const units = v.plannedMinutes / capMinutes;
        if (units > peakUnits) peakUnits = units;
        if (units > r.maxUnits + 1e-9) overallocatedDays.push(k);
      }
    }
    if (overallocatedDays.length > 0) {
      warnings.push({
        code: 'OVERALLOCATION',
        severity: 'warning',
        resourceId: r.id,
        message: `Resource '${r.name}' is over-allocated on ${overallocatedDays.length} day(s), e.g. ${overallocatedDays.slice(0, 3).join(', ')}`,
      });
    }
    resourceUsage.push({
      resourceId: r.id,
      byDay: [...dayMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map((p) => ({
        ...p,
        plannedMinutes: round1(p.plannedMinutes),
        actualMinutes: round1(p.actualMinutes),
      })),
      overallocatedDays: overallocatedDays.sort(),
      peakUnits: Math.round(peakUnits * 1000) / 1000,
      totalWorkMinutes: round1([...dayMap.values()].reduce((s, p) => s + p.plannedMinutes, 0)),
    });
  }

  // ------------------------------------------------------------------ critical paths
  const criticalTaskIds = Object.values(results)
    .filter((t2) => t2.isCritical)
    .map((t2) => t2.id);
  const criticalSet = new Set(criticalTaskIds);
  const ends = order.filter(
    (id) => criticalSet.has(id) && !(outgoing.get(id) ?? []).some((e) => criticalSet.has(e.succ)),
  );
  const paths: string[][] = [];
  const traceBack = (id: string, acc: string[]) => {
    acc.unshift(id);
    const preds = (incoming.get(id) ?? []).filter((e) => criticalSet.has(e.pred));
    if (preds.length === 0) {
      paths.push([...acc]);
      return;
    }
    for (const p of preds) traceBack(p.pred, acc.slice());
  };
  for (const e2 of ends) traceBack(e2, []);
  paths.sort(
    (a, b) =>
      b.reduce((s, id) => s + results[id].durationMinutes, 0) -
      a.reduce((s, id) => s + results[id].durationMinutes, 0),
  );
  const allPaths = input.multipleCriticalPaths ? paths : paths.slice(0, 1);

  const allStarts = Object.values(results).map((t2) => new Date(t2.start));
  const allFinishes = Object.values(results).map((t2) => new Date(t2.finish));
  const pStart = allStarts.length > 0 ? allStarts.reduce((m, d) => (d < m ? d : m), allStarts[0]) : projectStartInstant;
  const pFinish = allFinishes.length > 0 ? allFinishes.reduce((m, d) => (d > m ? d : m), allFinishes[0]) : projectFinish;

  return {
    projectId: input.projectId,
    projectStart: pStart.toISOString(),
    projectFinish: pFinish.toISOString(),
    durationMinutes: Math.round(workingMinutesBetween(projCal, pStart, pFinish)),
    tasks: results,
    criticalPathIds: allPaths[0] ?? [],
    criticalTaskIds,
    criticalPaths: allPaths,
    assignments: assignmentResults,
    resourceUsage,
    warnings,
    stats: {
      taskCount: input.tasks.length,
      summaryCount: graph.summaryIds.size,
      milestoneCount: Object.values(results).filter((t2) => t2.isMilestone).length,
      criticalCount: criticalTaskIds.length,
      projectFinishMoved: false,
    },
  };
}

function alignStartBack(cal: CalendarSpec, instant: Date): Date {
  // largest working-period start <= instant
  let d = keyToDate(dateKey(instant));
  for (let i = 0; i < 3660 * 3; i++) {
    const periods = workingPeriodsOn(cal, d);
    for (let j = periods.length - 1; j >= 0; j--) {
      const ps = new Date(`${dateKey(d)}T${periods[j].start}:00.000Z`);
      if (ps <= instant) return ps;
    }
    d = addDays(d, -1);
  }
  return instant;
}

function mergeByDay(byDay: TimephasedPoint[]): Map<string, { planned: number; actual: number }> {
  const out = new Map<string, { planned: number; actual: number }>();
  for (const p of byDay) {
    out.set(p.dateKey, { planned: p.plannedMinutes, actual: p.actualMinutes });
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

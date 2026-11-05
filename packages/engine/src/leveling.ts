import { EngineProjectInput, LevelingCandidate, LevelingPreview, ScheduleResult } from './types';
import { calculateSchedule } from './schedule';
import { keyToDate, workingMinutesOnDate } from './calendar';

export interface LevelingOptions {
  /** Delay granularity in working minutes (default: one working day). */
  stepMinutes?: number;
  maxIterations?: number;
  /** Level only within available slack — never push the project finish. */
  levelOnlyWithinSlack?: boolean;
}

interface Contribution {
  taskId: string;
  minutes: number;
  priority: number;
  totalFloat: number | null;
  percentComplete: number;
  actualStart: string | null;
  rowOrder: number;
}

/**
 * Greedy serial leveling, mirroring MS Project's "level day by day" behaviour:
 * for the earliest over-allocated resource-day, delay the least-important
 * contributing task by one leveling step, re-run CPM, and repeat.
 * Only leveling DELAY is ever introduced — logic (dependencies, durations,
 * constraints) is never modified, and baseline data is never touched.
 */
export function previewLeveling(
  input: EngineProjectInput,
  opts: LevelingOptions = {},
): LevelingPreview {
  const step = opts.stepMinutes ?? input.minutesPerDay;
  const maxIterations = opts.maxIterations ?? 800;
  const delays = new Map<string, number>();
  const reasons = new Map<string, string>();

  let current: EngineProjectInput = {
    ...input,
    tasks: input.tasks.map((t) => ({ ...t, levelingDelayMinutes: t.levelingDelayMinutes ?? 0 })),
  };
  let result = calculateSchedule(current);
  const finishBefore = result.projectFinish;

  const resourceById = new Map(input.resources.map((r) => [r.id, r]));
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));

  for (let iter = 0; iter < maxIterations; iter++) {
    const incident = findEarliestOverload(current, result);
    if (!incident) break;

    const contributors = contributorsFor(current, result, incident.resourceId, incident.dateKey);
    const delayable = contributors
      .filter((c) => c.priority < 1000)
      .filter((c) => !c.actualStart)
      .filter((c) => !result.tasks[c.taskId]?.isSummary)
      .filter((c) => {
        if (!opts.levelOnlyWithinSlack) return true;
        const tf = c.totalFloat;
        const cur = delays.get(c.taskId) ?? 0;
        return tf !== null && cur + step <= tf;
      })
      .sort((a, b) => {
        // Stable serial-leveling preference: lower priority number is delayed
        // first; started work is never pulled; then the LATER row gives way.
        // (Float is deliberately NOT preferred — chasing float makes the victim
        // alternate between tasks and never converge.)
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (a.percentComplete !== b.percentComplete) return a.percentComplete - b.percentComplete;
        if (b.rowOrder !== a.rowOrder) return b.rowOrder - a.rowOrder;
        const fa = a.totalFloat ?? 1e9;
        const fb = b.totalFloat ?? 1e9;
        return fb - fa;
      });

    if (delayable.length === 0) break; // cannot resolve further without violating rules

    const victim = delayable[0];
    const curDelay = current.tasks.find((t) => t.id === victim.taskId)!.levelingDelayMinutes ?? 0;
    const newDelay = curDelay + step;
    reasons.set(
      victim.taskId,
      `Delayed to resolve ${resourceById.get(incident.resourceId)?.name ?? 'resource'} over-allocation on ${incident.dateKey}`,
    );
    delays.set(victim.taskId, newDelay);

    current = {
      ...current,
      tasks: current.tasks.map((t) =>
        t.id === victim.taskId ? { ...t, levelingDelayMinutes: newDelay } : t,
      ),
    };
    result = calculateSchedule(current);
  }

  const remaining = listOverloads(current, result);
  const finishAfter = result.projectFinish;

  const previewDelays = [...delays.entries()].map(([taskId, delayMinutes]) => {
    const base = taskById.get(taskId)?.levelingDelayMinutes ?? 0;
    return {
      taskId,
      delayMinutes,
      newStart: result.tasks[taskId]?.start ?? '',
      reason: reasons.get(taskId) ?? '',
      // how much of the delay is newly introduced by this leveling run
      addedMinutes: delayMinutes - base,
    };
  });

  return {
    feasible: remaining.length === 0,
    delays: previewDelays,
    resolvedOverallocations: countOverloads(input, calculateSchedule(input)) - countOverloads(current, result),
    remainingOverallocations: remaining,
    projectFinishBefore: finishBefore,
    projectFinishAfter: finishAfter,
    finishSlipMinutes: Math.round(
      (new Date(finishAfter).getTime() - new Date(finishBefore).getTime()) / 60000,
    ),
    warnings: result.warnings.filter((w) => w.code === 'OVERALLOCATION'),
  };
}

export function applyLevelingDelays(
  input: EngineProjectInput,
  delays: { taskId: string; delayMinutes: number }[],
): EngineProjectInput {
  const map = new Map(delays.map((d) => [d.taskId, d.delayMinutes]));
  return {
    ...input,
    tasks: input.tasks.map((t) =>
      map.has(t.id) ? { ...t, levelingDelayMinutes: map.get(t.id)! } : t,
    ),
  };
}

export function clearLevelingDelays(input: EngineProjectInput): EngineProjectInput {
  return {
    ...input,
    tasks: input.tasks.map((t) => ({ ...t, levelingDelayMinutes: 0 })),
  };
}

function findEarliestOverload(
  input: EngineProjectInput,
  result: ScheduleResult,
): { resourceId: string; dateKey: string } | null {
  let best: { resourceId: string; dateKey: string } | null = null;
  for (const ru of result.resourceUsage) {
    for (const day of ru.overallocatedDays) {
      if (!best || day < best.dateKey || (day === best.dateKey && ru.resourceId < best.resourceId)) {
        best = { resourceId: ru.resourceId, dateKey: day };
      }
    }
  }
  void input;
  return best;
}

function listOverloads(input: EngineProjectInput, result: ScheduleResult): LevelingCandidate[] {
  const out: LevelingCandidate[] = [];
  const resById = new Map(input.resources.map((r) => [r.id, r]));
  for (const ru of result.resourceUsage) {
    const cap = (key: string) => workingMinutesOnDate(
      resById.get(ru.resourceId)?.calendarId
        ? (input.calendars.find((c) => c.id === resById.get(ru.resourceId)!.calendarId) ?? input.calendars[0])
        : input.calendars.find((c) => c.id === input.defaultCalendarId) ?? input.calendars[0],
      keyToDate(key),
    );
    for (const day of ru.overallocatedDays) {
      const planned = ru.byDay.find((p) => p.dateKey === day)?.plannedMinutes ?? 0;
      const overload = planned - cap(day) * (resById.get(ru.resourceId)?.maxUnits ?? 1);
      out.push({
        resourceId: ru.resourceId,
        resourceName: resById.get(ru.resourceId)?.name ?? '',
        dateKey: day,
        overloadMinutes: Math.round(overload),
        taskId: '',
      });
    }
  }
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function countOverloads(input: EngineProjectInput, result: ScheduleResult): number {
  return result.resourceUsage.reduce((s, ru) => s + ru.overallocatedDays.length, 0);
}

function contributorsFor(
  input: EngineProjectInput,
  result: ScheduleResult,
  resourceId: string,
  day: string,
): Contribution[] {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const byTask = new Map<string, number>();
  for (const ar of result.assignments) {
    if (ar.resourceId !== resourceId) continue;
    const p = ar.byDay.find((x) => x.dateKey === day);
    if (p && p.plannedMinutes > 0) {
      byTask.set(ar.taskId, (byTask.get(ar.taskId) ?? 0) + p.plannedMinutes);
    }
  }
  return [...byTask.entries()].map(([taskId, minutes]) => {
    const t = taskById.get(taskId)!;
    const r = result.tasks[taskId];
    return {
      taskId,
      minutes,
      priority: t?.priority ?? 500,
      totalFloat: r?.totalFloatMinutes ?? null,
      percentComplete: t?.percentComplete ?? 0,
      actualStart: t?.actualStart ?? null,
      rowOrder: t?.rowOrder ?? 0,
    };
  });
}

import { MsProjectModel, MsTask } from './msdi-parser';

/* ================================================================
   Maps a parsed MsProjectModel to Pulse persistence payloads, validates
   referential integrity, and collects warnings for anything Pulse
   cannot represent. Pure — no database access.
   ================================================================ */

export interface ValidationError {
  code: string;
  message: string;
  uid?: number;
}

export interface PlannedEntities {
  project: {
    name: string;
    projectStart: string;
    currency: string;
    minutesPerDay: number;
    minutesPerWeek: number;
    daysPerMonth: number;
  };
  settings: {
    schedulingFrom: 'start';
    defaultCalendarId?: string;
  };
  calendars: {
    localId: string;
    sourceUid: number;
    name: string;
    isDefault: boolean;
    week: Record<number, { start: string; end: string }[]>;
    exceptions: { date: string; periods: { start: string; end: string }[]; label: string | null }[];
  }[];
  tasks: {
    localId: string;
    sourceUid: number;
    sourceDisplayId: number | null;
    name: string;
    rowOrder: number;
    outlineLevel: number; // Pulse 0-based
    durationMinutes: number;
    mode: 'auto' | 'manual';
    manualStart: string | null;
    manualFinish: string | null;
    constraintType: string | null;
    constraintDate: string | null;
    deadline: string | null;
    taskType: string;
    effortDriven: boolean;
    percentComplete: number;
    actualStart: string | null;
    actualFinish: string | null;
    actualWorkMinutes: number;
    fixedCost: number;
    priority: number;
    notes: string | null;
    calendarLocalId: string | null;
    workMinutes: number | null;
  }[];
  dependencies: { localId: string; predecessorLocalId: string; successorLocalId: string; type: string; lagMinutes: number }[];
  resources: {
    localId: string;
    sourceUid: number;
    name: string;
    kind: string;
    maxUnits: number;
    standardRate: number;
    costPerUse: number;
    notes: string | null;
    calendarLocalId: string | null;
  }[];
  assignments: {
    localId: string;
    taskLocalId: string;
    resourceLocalId: string;
    units: number;
    workMinutes: number | null;
    cost: number | null;
  }[];
  baselines: { name: string; tasks: { taskLocalId: string; taskName: string; start: string; finish: string; durationMinutes: number; workMinutes: number; cost: number; percentComplete: number }[] }[];
}

const hhmmssToHhmm = (t: string): string => t.slice(0, 5);

export function mapModel(
  model: MsProjectModel,
  opts: { preserveDates: boolean },
): { planned: PlannedEntities; errors: ValidationError[]; warnings: string[] } {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // ---------- calendars ----------
  const calendarByUid = new Map(model.calendars.map((c) => [c.uid, c]));
  if (model.calendars.length === 0) {
    warnings.push('The source contains no calendars; Pulse will use its standard Mon–Fri 8h calendar.');
  }
  const derivedWithoutBase = model.calendars.filter((c) => !c.isBase && (c.baseCalendarUid == null || !calendarByUid.has(c.baseCalendarUid)));
  for (const c of derivedWithoutBase) {
    warnings.push(`Calendar "${c.name}" references a missing base calendar (UID ${c.baseCalendarUid}); its own working times are used.`);
  }
  const defaultCal =
    (model.defaultCalendarUid != null ? calendarByUid.get(model.defaultCalendarUid) : undefined) ??
    model.calendars.find((c) => c.isBase) ??
    model.calendars[0];

  const calendars: PlannedEntities['calendars'] = model.calendars.map((c) => ({
    localId: `cal-${c.uid}`,
    sourceUid: c.uid,
    name: c.name,
    isDefault: c.uid === defaultCal?.uid,
    week: Object.fromEntries(
      Object.entries(c.weekdayWorking)
        .filter(([, v]) => v.working && v.times.length > 0)
        .map(([dow, v]) => [
          Number(dow),
          v.times.map((t) => ({ start: hhmmssToHhmm(t.from), end: hhmmssToHhmm(t.to) })),
        ]),
    ),
    exceptions: c.exceptions.flatMap((ex) => {
      // expand multi-day exception ranges into per-day Pulse exceptions
      const days: PlannedEntities['calendars'][0]['exceptions'] = [];
      const from = new Date(`${ex.fromDate.slice(0, 10)}T00:00:00Z`);
      const to = new Date(`${ex.toDate.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
        warnings.push(`Calendar "${c.name}" has an exception with an invalid date range (${ex.fromDate}..${ex.toDate}); it was skipped.`);
        return days;
      }
      for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
        days.push({
          date: d.toISOString().slice(0, 10),
          periods: ex.working ? ex.times.map((t) => ({ start: hhmmssToHhmm(t.from), end: hhmmssToHhmm(t.to) })) : [],
          label: ex.name ?? (ex.working ? 'Working exception' : 'Non-working'),
        });
      }
      return days;
    }),
  }));

  // ---------- tasks ----------
  const taskByUid = new Map(model.tasks.map((t) => [t.uid, t]));
  const seenUids = new Set<number>();
  const sorted = [...model.tasks].sort((a, b) => (a.id ?? a.uid) - (b.id ?? b.uid));
  const tasks: PlannedEntities['tasks'] = [];
  let prevLevel = 0;
  let rowOrder = 1000;
  for (const t of sorted) {
    if (seenUids.has(t.uid)) {
      errors.push({ code: 'DUPLICATE_UID', message: `Duplicate task UID ${t.uid} ("${t.name}") in the source file.`, uid: t.uid });
      continue;
    }
    seenUids.add(t.uid);
    // hierarchy sanity: outline level may jump by at most 1 per row
    if (t.outlineLevel > prevLevel + 1) {
      errors.push({
        code: 'HIERARCHY_GAP',
        message: `Task "${t.name}" (UID ${t.uid}) jumps from outline level ${prevLevel} to ${t.outlineLevel}; the hierarchy is invalid.`,
        uid: t.uid,
      });
    }
    prevLevel = t.outlineLevel;

    const preserve = opts.preserveDates && !t.isSummary;
    const start = t.isManual || preserve ? (t.manualStart ?? t.start) : t.start;
    const finish = t.isManual || preserve ? (t.manualFinish ?? t.finish) : t.finish;
    const duration = t.durationMinutes ?? 480;

    tasks.push({
      localId: `task-${t.uid}`,
      sourceUid: t.uid,
      sourceDisplayId: t.id,
      name: t.name,
      rowOrder,
      outlineLevel: t.outlineLevel - 1, // MSP is 1-based, Pulse 0-based
      durationMinutes: t.isMilestone ? 0 : duration,
      mode: t.isSummary ? 'auto' : t.isManual || preserve ? 'manual' : 'auto',
      manualStart: start,
      manualFinish: finish,
      constraintType: t.constraintType && t.constraintDate ? t.constraintType : null,
      constraintDate: t.constraintDate,
      deadline: t.deadline,
      taskType: t.taskType,
      effortDriven: t.effortDriven,
      percentComplete: Math.min(100, Math.max(0, t.percentComplete)),
      actualStart: t.actualStart,
      actualFinish: t.actualFinish,
      actualWorkMinutes: t.actualWorkMinutes ?? 0,
      fixedCost: t.fixedCost,
      priority: t.priority,
      notes: t.notes,
      calendarLocalId: t.calendarUid != null && calendarByUid.has(t.calendarUid) ? `cal-${t.calendarUid}` : null,
      workMinutes: t.workMinutes,
    });
    rowOrder += 1000;

    if (t.calendarUid != null && !calendarByUid.has(t.calendarUid)) {
      warnings.push(`Task "${t.name}" references a missing calendar (UID ${t.calendarUid}); the project calendar applies.`);
    }
    if (t.extraBaselines.length > 0) {
      warnings.push(`Task "${t.name}" carries ${t.extraBaselines.length} additional baseline(s) (Baseline 1–9); they are imported as named Pulse baselines at task level only.`);
    }
  }
  if (sorted.some((t) => t.predecessors.some((p) => p.lagUnsupported))) {
    warnings.push('One or more links use percentage-based lag, which Pulse does not support; they were imported with zero lag.');
  }

  // ---------- dependencies (resolved by source UID, never row numbers) ----------
  const localIdByUid = new Map(tasks.map((t) => [t.sourceUid, t.localId]));
  const dependencies: PlannedEntities['dependencies'] = [];
  const seenPairs = new Set<string>();
  for (const t of sorted) {
    for (const p of t.predecessors) {
      const pred = taskByUid.get(p.predecessorUid);
      if (!pred) {
        errors.push({
          code: 'MISSING_REFERENCE',
          message: `Task "${t.name}" (UID ${t.uid}) links to predecessor UID ${p.predecessorUid}, which does not exist.`,
          uid: t.uid,
        });
        continue;
      }
      if (p.predecessorUid === t.uid) {
        errors.push({ code: 'SELF_DEPENDENCY', message: `Task "${t.name}" (UID ${t.uid}) links to itself.`, uid: t.uid });
        continue;
      }
      const key = `${p.predecessorUid}->${t.uid}`;
      if (seenPairs.has(key)) continue; // first occurrence wins
      seenPairs.add(key);
      dependencies.push({
        localId: `dep-${p.predecessorUid}-${t.uid}`,
        predecessorLocalId: localIdByUid.get(p.predecessorUid)!,
        successorLocalId: localIdByUid.get(t.uid)!,
        type: p.type,
        lagMinutes: Math.round(p.lagMinutes),
      });
    }
  }

  // ---------- resources ----------
  const resources: PlannedEntities['resources'] = model.resources.map((r) => ({
    localId: `res-${r.uid}`,
    sourceUid: r.uid,
    name: r.name,
    kind: r.kind,
    maxUnits: r.maxUnits ?? 1,
    standardRate: r.standardRatePerHour ?? 0,
    costPerUse: r.costPerUse ?? 0,
    notes: r.notes,
    calendarLocalId: r.calendarUid != null && calendarByUid.has(r.calendarUid) ? `cal-${r.calendarUid}` : null,
  }));

  // ---------- assignments ----------
  const resourceLocalByUid = new Map(resources.map((r) => [r.sourceUid, r.localId]));
  const assignments: PlannedEntities['assignments'] = [];
  for (const a of model.assignments) {
    if (!localIdByUid.has(a.taskUid)) {
      errors.push({ code: 'MISSING_REFERENCE', message: `Assignment ${a.uid} points at task UID ${a.taskUid}, which does not exist.` });
      continue;
    }
    if (a.resourceUid == null) {
      warnings.push(`Assignment ${a.uid} has no resource (unassigned); it was skipped.`);
      continue;
    }
    if (!resourceLocalByUid.has(a.resourceUid)) {
      errors.push({ code: 'MISSING_REFERENCE', message: `Assignment ${a.uid} points at resource UID ${a.resourceUid}, which does not exist.` });
      continue;
    }
    if (!Number.isFinite(a.units) || a.units <= 0 || a.units > 60) {
      errors.push({ code: 'INVALID_UNITS', message: `Assignment ${a.uid} has invalid units (${a.units}).` });
      continue;
    }
    assignments.push({
      localId: `asg-${a.uid}`,
      taskLocalId: localIdByUid.get(a.taskUid)!,
      resourceLocalId: resourceLocalByUid.get(a.resourceUid)!,
      units: a.units,
      workMinutes: a.workMinutes,
      cost: a.cost,
    });
  }

  // ---------- baselines ----------
  const baselines: PlannedEntities['baselines'] = [];
  const mainRows = sorted
    .filter((t) => t.baseline)
    .map((t) => ({
      taskLocalId: localIdByUid.get(t.uid)!,
      taskName: t.name,
      start: t.baseline!.start ?? t.start ?? '',
      finish: t.baseline!.finish ?? t.finish ?? '',
      durationMinutes: t.baseline!.durationMinutes ?? t.durationMinutes ?? 0,
      workMinutes: t.baseline!.workMinutes ?? t.workMinutes ?? 0,
      cost: t.baseline!.cost ?? 0,
      percentComplete: 0,
    }));
  if (mainRows.length > 0) baselines.push({ name: 'Imported Baseline', tasks: mainRows });
  for (let i = 1; i <= 9; i++) {
    const rows = sorted
      .filter((t) => t.extraBaselines.find((b) => b.name === `Baseline ${i}`))
      .map((t) => {
        const b = t.extraBaselines.find((x) => x.name === `Baseline ${i}`)!.baseline;
        return {
          taskLocalId: localIdByUid.get(t.uid)!,
          taskName: t.name,
          start: b.start ?? t.start ?? '',
          finish: b.finish ?? t.finish ?? '',
          durationMinutes: b.durationMinutes ?? t.durationMinutes ?? 0,
          workMinutes: b.workMinutes ?? t.workMinutes ?? 0,
          cost: b.cost ?? 0,
          percentComplete: 0,
        };
      });
    if (rows.length > 0) baselines.push({ name: `Imported Baseline ${i}`, tasks: rows });
  }
  if (model.tasks.some((t) => t.baseline) && baselines.length > 0) {
    warnings.push('Baselines are imported at task level; assignment-level baseline fields (AB start/finish/work) are not represented.');
  }

  // ---------- global limitation catalogue ----------
  warnings.push('Fields without a Pulse representation are not imported: extended attributes/custom fields, outline codes, WBS masks, text/number custom columns, deliverable links, enterprise fields.');
  warnings.push('Recurring task definitions and task splits are not recalculated by Pulse; only the expanded occurrences import as plain tasks.');

  const projectStart =
    model.startDate ??
    model.tasks.map((t) => t.start ?? t.manualStart).filter(Boolean).sort()[0] ??
    new Date().toISOString();

  const planned: PlannedEntities = {
    project: {
      name: model.name ?? 'Imported MS Project file',
      projectStart,
      currency: model.currencySymbol === '£' ? 'GBP' : model.currencySymbol === '€' ? 'EUR' : 'USD',
      minutesPerDay: Math.round(model.hoursPerDay * 60),
      minutesPerWeek: Math.round(model.hoursPerWeek * 60),
      daysPerMonth: model.daysPerMonth,
    },
    settings: { schedulingFrom: 'start' },
    calendars,
    tasks,
    dependencies,
    resources,
    assignments,
    baselines,
  };

  return { planned, errors, warnings };
}

export function summarise(planned: PlannedEntities): {
  taskCount: number;
  summaryCount: number;
  milestoneCount: number;
  dependencyCount: number;
  resourceCount: number;
  assignmentCount: number;
  calendarCount: number;
  baselineCount: number;
  dateRange: { start: string | null; finish: string | null };
  hierarchyPreview: { wbs: string; name: string; level: number; milestone: boolean; start: string | null; finish: string | null }[];
} {
  const starts = planned.tasks.map((t) => t.manualStart).filter((s): s is string => !!s).sort();
  const finishes = planned.tasks.map((t) => t.manualFinish).filter((s): s is string => !!s).sort();
  const depth = new Map<number, number>();
  const hierarchy: PlannedEntities['tasks'] = [];
  for (const t of planned.tasks) {
    depth.set(t.outlineLevel, (depth.get(t.outlineLevel) ?? 0) + 1);
    hierarchy.push(t);
  }
  void depth;
  return {
    taskCount: planned.tasks.length,
    summaryCount: countSummaries(planned),
    milestoneCount: planned.tasks.filter((t) => t.durationMinutes === 0).length,
    dependencyCount: planned.dependencies.length,
    resourceCount: planned.resources.length,
    assignmentCount: planned.assignments.length,
    calendarCount: planned.calendars.length,
    baselineCount: planned.baselines.length,
    dateRange: { start: starts[0] ?? null, finish: finishes[finishes.length - 1] ?? null },
    hierarchyPreview: hierarchy.slice(0, 25).map((t) => ({
      wbs: '',
      name: t.name,
      level: t.outlineLevel,
      milestone: t.durationMinutes === 0,
      start: t.manualStart?.slice(0, 10) ?? null,
      finish: t.manualFinish?.slice(0, 10) ?? null,
    })),
  };
}

function countSummaries(planned: PlannedEntities): number {
  // a task is a summary when the next row is deeper
  let n = 0;
  for (let i = 0; i < planned.tasks.length; i++) {
    if (planned.tasks[i + 1] && planned.tasks[i + 1].outlineLevel > planned.tasks[i].outlineLevel) n++;
  }
  return n;
}

export function wbsPreview(planned: PlannedEntities): string[] {
  const counters: number[] = [];
  const out: string[] = [];
  for (const t of planned.tasks) {
    if (counters.length > t.outlineLevel + 1) counters.length = t.outlineLevel + 1;
    counters[t.outlineLevel] = (counters[t.outlineLevel] ?? 0) + 1;
    out.push(counters.slice(0, t.outlineLevel + 1).join('.'));
  }
  return out;
}

export type { MsTask };

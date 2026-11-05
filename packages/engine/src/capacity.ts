import { AssignmentInput, CalendarSpec, ResourceInput } from './types';
import { addDays, dateKey, keyToDate, parseHM, workingPeriodsOn } from './calendar';

interface SegInstant {
  start: Date;
  end: Date;
  /** Σ units of resources working during this segment. */
  rate: number;
}

function dayInstant(key: string, hm: string): Date {
  return new Date(`${key}T${hm.padStart(5, '0')}:00.000Z`);
}

/**
 * Build the minute-segments of a task-calendar day where the set of available
 * resources is constant. rate = Σ units of resources whose calendar covers the segment.
 */
function segmentsForDay(
  taskCal: CalendarSpec,
  resCals: { units: number; cal: CalendarSpec }[],
  d: Date,
): SegInstant[] {
  const key = dateKey(d);
  const taskPeriods = workingPeriodsOn(taskCal, d);
  if (taskPeriods.length === 0) return [];
  // Collect boundary points inside each task period
  const segs: SegInstant[] = [];
  for (const tp of taskPeriods) {
    const boundaries: number[] = [parseHM(tp.start), parseHM(tp.end)];
    for (const rc of resCals) {
      for (const rp of workingPeriodsOn(rc.cal, d)) {
        const rs = parseHM(rp.start);
        const re = parseHM(rp.end);
        if (rs > parseHM(tp.start) && rs < parseHM(tp.end)) boundaries.push(rs);
        if (re > parseHM(tp.start) && re < parseHM(tp.end)) boundaries.push(re);
      }
    }
    boundaries.sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const s = boundaries[i];
      const e = boundaries[i + 1];
      if (e <= s) continue;
      let rate = 0;
      for (const rc of resCals) {
        for (const rp of workingPeriodsOn(rc.cal, d)) {
          const rs = parseHM(rp.start);
          const re = parseHM(rp.end);
          if (rs <= s && re >= e) {
            rate += rc.units;
            break;
          }
        }
      }
      segs.push({ start: dayInstant(key, hmOf(s)), end: dayInstant(key, hmOf(e)), rate });
    }
  }
  return segs;
}

function hmOf(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface CapacityWalkResult {
  finish: Date;
  /** First instant at which work is actually performed (task display start). */
  firstWork: Date | null;
  /** Per-day work minutes actually accomplished by the assignment pool. */
  perDay: Map<string, number>;
  complete: boolean;
}

/**
 * Walk forward from `start` accumulating work at rate Σunits over task-calendar
 * time intersected with resource availability, until `totalWorkMinutes` is done.
 * Returns the finish instant (the moment the last work is completed) and the
 * per-day distribution (used for timephased usage and histograms).
 */
export function walkCapacity(
  taskCal: CalendarSpec,
  resources: { units: number; cal: CalendarSpec }[],
  start: Date,
  totalWorkMinutes: number,
): CapacityWalkResult {
  const perDay = new Map<string, number>();
  if (totalWorkMinutes <= 0) return { finish: new Date(start.getTime()), firstWork: null, perDay, complete: true };
  if (resources.length === 0 || resources.every((r) => r.units <= 0)) {
    return { finish: new Date(start.getTime()), firstWork: null, perDay, complete: false };
  }
  let remaining = totalWorkMinutes;
  let firstWork: Date | null = null;
  let d = keyToDate(dateKey(start));
  for (let i = 0; i < 3660 * 3; i++) {
    const segs = segmentsForDay(taskCal, resources, d);
    for (const seg of segs) {
      if (seg.end <= start) continue;
      const effStart = seg.start < start ? start : seg.start;
      if (effStart >= seg.end) continue;
      if (seg.rate <= 0) continue;
      if (firstWork === null) firstWork = new Date(effStart.getTime());
      const lengthMin = (seg.end.getTime() - effStart.getTime()) / 60000;
      const capacity = lengthMin * seg.rate;
      const key = dateKey(d);
      if (capacity >= remaining) {
        const needMin = remaining / seg.rate;
        const finish = new Date(effStart.getTime() + needMin * 60000);
        perDay.set(key, (perDay.get(key) ?? 0) + remaining);
        return { finish, firstWork, perDay, complete: true };
      }
      remaining -= capacity;
      perDay.set(key, (perDay.get(key) ?? 0) + capacity);
    }
    d = addDays(d, 1);
  }
  return { finish: new Date(start.getTime()), firstWork, perDay, complete: false };
}

/**
 * Distribute a known amount of work uniformly over the working segments of a task
 * (fixed-duration / fixed-units tasks and actual-work contours).
 * Distribution weight per segment = Σ units available in the segment.
 */
export function distributeWork(
  taskCal: CalendarSpec,
  resources: { units: number; cal: CalendarSpec }[],
  start: Date,
  finish: Date,
  totalWorkMinutes: number,
): Map<string, number> {
  const perDay = new Map<string, number>();
  if (totalWorkMinutes <= 0) return perDay;
  // Weight = rate × length per segment
  const weights: { key: string; weight: number }[] = [];
  let totalWeight = 0;
  let d = keyToDate(dateKey(start));
  const endKey = dateKey(finish);
  for (let i = 0; i < 3660 * 3; i++) {
    const key = dateKey(d);
    for (const seg of segmentsForDay(taskCal, resources, d)) {
      const s = seg.start < start ? start : seg.start;
      const effEnd = seg.end > finish ? finish : seg.end;
      if (effEnd <= s) continue;
      const weight = ((effEnd.getTime() - s.getTime()) / 60000) * Math.max(seg.rate, 0);
      weights.push({ key, weight });
      totalWeight += weight;
    }
    if (key === endKey) break;
    d = addDays(d, 1);
  }
  if (totalWeight <= 0) {
    // Degenerate calendar: spread evenly across calendar days
    const days = Math.max(1, Math.ceil((finish.getTime() - start.getTime()) / 86400000));
    let assigned = 0;
    for (let i2 = 0; i2 < days; i2++) {
      const k = dateKey(addDays(keyToDate(dateKey(start)), i2));
      const amt = i2 === days - 1 ? totalWorkMinutes - assigned : totalWorkMinutes / days;
      assigned += amt;
      perDay.set(k, (perDay.get(k) ?? 0) + amt);
    }
    return perDay;
  }
  let assigned = 0;
  for (const w of weights) {
    const amt = (w.weight / totalWeight) * totalWorkMinutes;
    assigned += amt;
    perDay.set(w.key, (perDay.get(w.key) ?? 0) + amt);
  }
  const drift = totalWorkMinutes - assigned;
  if (Math.abs(drift) > 1e-6 && perDay.size > 0) {
    const lastKey = weights[weights.length - 1].key;
    perDay.set(lastKey, (perDay.get(lastKey) ?? 0) + drift);
  }
  return perDay;
}

export interface ResourceAssignmentRef {
  assignment: AssignmentInput;
  resource: ResourceInput;
  calendar: CalendarSpec;
}

export function assignmentRefs(
  assignments: AssignmentInput[],
  resources: ResourceInput[],
  calendarById: Map<string, CalendarSpec>,
  defaultCalendar: CalendarSpec,
  taskId: string,
): ResourceAssignmentRef[] {
  const resById = new Map(resources.map((r) => [r.id, r]));
  return assignments
    .filter((a) => a.taskId === taskId)
    .map((a) => {
      const resource = resById.get(a.resourceId);
      if (!resource) return null;
      const cal = resource.calendarId ? calendarById.get(resource.calendarId) ?? defaultCalendar : defaultCalendar;
      return { assignment: a, resource, calendar: cal };
    })
    .filter((x): x is ResourceAssignmentRef => x !== null);
}

import { CalendarSpec, TimePeriod } from './types';
import { CalendarError } from './errors';

export const MINUTES_PER_DAY_MS = 60000;
const MAX_DAYS_WALK = 3660 * 3; // ~10 years guard for pathological calendars

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function parseHM(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) throw new CalendarError(`Invalid time-of-day '${hm}' (expected HH:mm)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) throw new CalendarError(`Invalid time-of-day '${hm}'`);
  return h * 60 + min;
}

export function minutesToHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function periodInstant(key: string, hm: string): Date {
  return new Date(`${key}T${hm.padStart(5, '0')}:00.000Z`);
}

/** Working periods for the calendar-day containing `d`; exceptions override the weekly pattern. */
export function workingPeriodsOn(cal: CalendarSpec, d: Date): TimePeriod[] {
  const key = dateKey(d);
  const ex = cal.exceptions[key];
  if (ex) return ex.periods;
  return cal.week[d.getUTCDay()] ?? [];
}

export function isWorkingDay(cal: CalendarSpec, d: Date): boolean {
  return workingPeriodsOn(cal, d).length > 0;
}

export function workingMinutesOnDate(cal: CalendarSpec, d: Date): number {
  return workingPeriodsOn(cal, d).reduce(
    (sum, p) => sum + (parseHM(p.end) - parseHM(p.start)),
    0,
  );
}

/** Working minutes available on a date, intersected with another calendar (used for resource availability). */
export function intersectedMinutesOnDate(a: CalendarSpec, b: CalendarSpec, d: Date): number {
  const pa = workingPeriodsOn(a, d);
  const pb = workingPeriodsOn(b, d);
  let total = 0;
  for (const x of pa) {
    const xs = parseHM(x.start);
    const xe = parseHM(x.end);
    for (const y of pb) {
      const ys = parseHM(y.start);
      const ye = parseHM(y.end);
      const overlap = Math.min(xe, ye) - Math.max(xs, ys);
      if (overlap > 0) total += overlap;
    }
  }
  return total;
}

/**
 * Smallest working-period START at or after `from` (strict=false) or strictly after (strict=true).
 * A finish boundary such as Fri 17:00 is NOT a period start, so alignStart snaps forward to the
 * next real working start — this is exactly the FS successor rule.
 */
export function alignStart(cal: CalendarSpec, from: Date, strict = false): Date {
  let d = keyToDate(dateKey(from));
  for (let i = 0; i < MAX_DAYS_WALK; i++) {
    for (const p of workingPeriodsOn(cal, d)) {
      const ps = periodInstant(dateKey(d), p.start);
      if (strict ? ps > from : ps >= from) return ps;
    }
    d = addDays(d, 1);
  }
  throw new CalendarError('No working time found within 10 years — check the calendar');
}

/** Largest working-period END at or before `from`. */
export function alignEnd(cal: CalendarSpec, from: Date): Date {
  let d = keyToDate(dateKey(from));
  for (let i = 0; i < MAX_DAYS_WALK; i++) {
    const periods = workingPeriodsOn(cal, d);
    for (let i2 = periods.length - 1; i2 >= 0; i2--) {
      const pe = periodInstant(dateKey(d), periods[i2].end);
      if (pe <= from) return pe;
    }
    d = addDays(d, -1);
  }
  throw new CalendarError('No working time found within 10 years — check the calendar');
}

/**
 * Add working minutes to an instant. The instant may sit inside a working period
 * (counting starts from that instant), on a boundary (the closed period contributes
 * nothing), or outside working time (walk to the next working period).
 */
export function addWorkingMinutes(cal: CalendarSpec, from: Date, minutes: number): Date {
  if (minutes === 0) return new Date(from.getTime());
  if (minutes < 0) return subtractWorkingMinutes(cal, from, -minutes);
  let remaining = minutes;
  let d = keyToDate(dateKey(from));
  for (let i = 0; i < MAX_DAYS_WALK; i++) {
    for (const p of workingPeriodsOn(cal, d)) {
      const ps = periodInstant(dateKey(d), p.start);
      const pe = periodInstant(dateKey(d), p.end);
      const segStart = ps > from ? ps : from;
      if (segStart >= pe) continue;
      const avail = (pe.getTime() - segStart.getTime()) / MINUTES_PER_DAY_MS;
      if (avail >= remaining) {
        return new Date(segStart.getTime() + remaining * MINUTES_PER_DAY_MS);
      }
      remaining -= avail;
    }
    d = addDays(d, 1);
  }
  throw new CalendarError('Cannot add working time within 10 years — check the calendar');
}

/**
 * Subtract working minutes from a boundary: returns the earliest instant S such that the
 * working time in [S, boundary] equals `minutes`. This is the LS-from-LF rule.
 */
export function subtractWorkingMinutes(cal: CalendarSpec, boundary: Date, minutes: number): Date {
  if (minutes <= 0) return new Date(boundary.getTime());
  let remaining = minutes;
  let d = keyToDate(dateKey(boundary));
  for (let i = 0; i < MAX_DAYS_WALK; i++) {
    const periods = workingPeriodsOn(cal, d);
    for (let i2 = periods.length - 1; i2 >= 0; i2--) {
      const ps = periodInstant(dateKey(d), periods[i2].start);
      const pe = periodInstant(dateKey(d), periods[i2].end);
      const segEnd = pe <= boundary ? pe : boundary;
      if (segEnd <= ps) continue;
      const avail = (segEnd.getTime() - ps.getTime()) / MINUTES_PER_DAY_MS;
      if (avail >= remaining) {
        return new Date(segEnd.getTime() - remaining * MINUTES_PER_DAY_MS);
      }
      remaining -= avail;
    }
    d = addDays(d, -1);
  }
  throw new CalendarError('Cannot subtract working time within 10 years — check the calendar');
}

/** Working minutes in [a, b) — negative when b < a. */
export function workingMinutesBetween(cal: CalendarSpec, a: Date, b: Date): number {
  if (b < a) return -workingMinutesBetween(cal, b, a);
  let total = 0;
  let d = keyToDate(dateKey(a));
  const endKey = dateKey(b);
  for (let i = 0; i < MAX_DAYS_WALK; i++) {
    const key = dateKey(d);
    for (const p of workingPeriodsOn(cal, d)) {
      const ps = periodInstant(key, p.start);
      const pe = periodInstant(key, p.end);
      const s = ps > a ? ps : a;
      const e = pe < b ? pe : b;
      if (e > s) total += (e.getTime() - s.getTime()) / MINUTES_PER_DAY_MS;
    }
    if (key === endKey) break;
    d = addDays(d, 1);
  }
  return total;
}

/** Standard Mon–Fri 08:00–12:00 / 13:00–17:00 calendar (8h/day). */
export function standardWeek(weekendOnlyOff = false): Record<number, TimePeriod[]> {
  const day: TimePeriod[] = [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ];
  return weekendOnlyOff
    ? { 1: day, 2: day, 3: day, 4: day, 5: day }
    : { 1: day, 2: day, 3: day, 4: day, 5: day };
}

export function standardCalendar(id = 'standard'): CalendarSpec {
  return {
    id,
    name: 'Standard',
    week: standardWeek(),
    exceptions: {},
  };
}

/** 24/7 calendar for elapsed-time work. */
export function fullTimeCalendar(id = '24hours'): CalendarSpec {
  const day: TimePeriod[] = [{ start: '00:00', end: '24:00' }];
  return {
    id,
    name: '24 Hours',
    week: { 0: day, 1: day, 2: day, 3: day, 4: day, 5: day, 6: day },
    exceptions: {},
  };
}

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { BadRequestException } from '@nestjs/common';

/* ================================================================
   MSPDI (Microsoft Project XML interchange) parser.
   Produces an intermediate MsProjectModel; mapping to Pulse entities
   lives in mapper.ts. Pure and unit-testable.
   ================================================================ */

export interface MsWorkingTime {
  from: string; // HH:mm:ss
  to: string;
}

export interface MsCalendarException {
  name?: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
  working: boolean;
  times: MsWorkingTime[];
}

export interface MsCalendar {
  uid: number;
  name: string;
  isBase: boolean;
  baseCalendarUid: number | null;
  /** 1 = Sunday … 7 = Saturday */
  weekdayWorking: Record<number, { working: boolean; times: MsWorkingTime[] }>;
  exceptions: MsCalendarException[];
}

export interface MsPredecessorLink {
  predecessorUid: number;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagMinutes: number;
  lagUnsupported?: string;
}

export interface MsTask {
  uid: number;
  id: number | null; // display/row ID from source
  name: string;
  wbs: string | null;
  outlineLevel: number;
  isSummary: boolean;
  isMilestone: boolean;
  isActive: boolean;
  isManual: boolean;
  durationMinutes: number | null;
  start: string | null;
  finish: string | null;
  manualStart: string | null;
  manualFinish: string | null;
  percentComplete: number;
  actualStart: string | null;
  actualFinish: string | null;
  workMinutes: number | null;
  actualWorkMinutes: number | null;
  remainingWorkMinutes: number | null;
  fixedCost: number;
  priority: number;
  notes: string | null;
  constraintType: 'ASAP' | 'ALAP' | 'MSO' | 'MFO' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | null;
  constraintDate: string | null;
  deadline: string | null;
  taskType: 'fixed_units' | 'fixed_duration' | 'fixed_work';
  effortDriven: boolean;
  calendarUid: number | null;
  predecessors: MsPredecessorLink[];
  baseline: MsBaseline | null;
  extraBaselines: { name: string; baseline: MsBaseline }[];
}

export interface MsBaseline {
  start: string | null;
  finish: string | null;
  durationMinutes: number | null;
  workMinutes: number | null;
  cost: number | null;
}

export interface MsResource {
  uid: number;
  id: number | null;
  name: string;
  kind: 'work' | 'material' | 'cost';
  maxUnits: number | null;
  standardRatePerHour: number | null;
  costPerUse: number | null;
  notes: string | null;
  calendarUid: number | null;
}

export interface MsAssignment {
  uid: number;
  taskUid: number;
  resourceUid: number | null; // -65535 = unassigned
  units: number;
  workMinutes: number | null;
  actualWorkMinutes: number | null;
  cost: number | null;
}

export interface MsProjectModel {
  format: 'xml';
  name: string | null;
  startDate: string | null;
  scheduleFromStart: boolean;
  hoursPerDay: number;
  hoursPerWeek: number;
  daysPerMonth: number;
  defaultCalendarUid: number | null;
  currencySymbol: string | null;
  calendars: MsCalendar[];
  tasks: MsTask[];
  resources: MsResource[];
  assignments: MsAssignment[];
}

/* ------------------------------- security guards */

export const MAX_XML_BYTES = 26 * 1024 * 1024;

/** OLE2 Compound File Binary signature — every classic .mpp starts with it. */
export function isCompoundFile(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
    buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1;
}

export function looksLikeXml(buf: Buffer): boolean {
  const s = buf.subarray(0, 256).toString('latin1').replace(/^﻿/, '').trimStart();
  return s.startsWith('<');
}

/**
 * Reject DOCTYPE / ENTITY declarations outright — no external entities,
 * no entity expansion (billion-laughs). fast-xml-parser additionally runs
 * with processEntities disabled.
 */
export function assertNoEntities(xmlText: string): void {
  const head = xmlText.slice(0, 8192);
  if (/<!DOCTYPE/i.test(head) || /<!ENTITY/i.test(xmlText)) {
    throw new BadRequestException(
      'Rejected: the XML contains a DOCTYPE/ENTITY declaration. External entities and entity expansion are disabled for security.',
    );
  }
}

/* ------------------------------- value parsing */

/** MSPDI dates are naive local ISO strings ("2026-01-05T08:00:00").
 *  Pulse stores UTC; we pin the wall-clock time as UTC (no TZ shift). */
export function parseMsDate(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const s = v.trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(s);
  if (m) return `${m[1]}T${m[2]}.000Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  return null;
}

/** ISO-8601 duration (PT240H30M0S, P1DT8H) → minutes. MSPDI expresses
 *  working durations in hours/minutes via this format. */
export function parseIsoDurationMinutes(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (s === 'PT0H0M0S') return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return null;
  const days = m[1] ? parseFloat(m[1]) : 0;
  const hours = m[2] ? parseFloat(m[2]) : 0;
  const mins = m[3] ? parseFloat(m[3]) : 0;
  const secs = m[4] ? parseFloat(m[4]) : 0;
  const total = secs / 60 + mins + hours * 60 + days * 24 * 60;
  return Number.isFinite(total) ? Math.round(total) : null;
}

/** MSPDI rate fields are currency in hundredths (6000 → 60.00/h). */
export function parseRate(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : null;
}

function num(v: unknown, fallback: number | null = null): number | null {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown): boolean {
  return v === 1 || v === '1' || v === 'true' || v === true;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** fast-xml-parser collapses repeated elements only with arrays enabled;
 *  this normalises either shape to an array. */
function arr<T>(v: unknown): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? (v as T[]) : [v as T];
}

// MSPDI enumerations
const CONSTRAINT_MAP: Record<number, MsTask['constraintType']> = {
  0: 'ASAP', 1: 'ALAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT',
};
const LINK_TYPE_MAP: Record<number, MsPredecessorLink['type']> = {
  0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS',
};
const TASK_TYPE_MAP: Record<number, MsTask['taskType']> = {
  0: 'fixed_units', 1: 'fixed_duration', 2: 'fixed_work',
};
const RESOURCE_TYPE_MAP: Record<number, MsResource['kind']> = {
  1: 'work', 2: 'material', 3: 'cost', 4: 'cost',
};

/**
 * Lag: per the MSPDI specification LinkLag is in TENTHS OF MINUTES;
 * LagFormat declares display/elapsed semantics (3=m, 5=h, 7=d, 9=w, 11=mo
 * and their elapsed variants; 13/14 are percentage-based).
 */
function parseLinkLag(link: Record<string, unknown>): MsPredecessorLink['lagMinutes'] | 'unsupported' {
  const raw = num(link.LinkLag, 0) ?? 0;
  const fmt = num(link.LagFormat, 7) ?? 7;
  if (fmt === 13 || fmt === 14) return 'unsupported';
  return raw / 10; // tenths of minutes → minutes, already working-time
}

/* ------------------------------- main parse */

export function parseMspdi(xmlText: string, warnings: string[]): MsProjectModel {
  assertNoEntities(xmlText);
  const validity = XMLValidator.validate(xmlText, { allowBooleanAttributes: false });
  if (validity !== true) {
    throw new BadRequestException(
      `The file is not well-formed XML: ${validity.err.msg} (line ${validity.err.line}, column ${validity.err.col})`,
    );
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    isArray: (name) => ['Task', 'Calendar', 'Resource', 'Assignment', 'WeekDay', 'WorkingTime', 'PredecessorLink', 'Exception'].includes(name),
    processEntities: false,
    parseTagValue: false,
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xmlText) as Record<string, unknown>;
  } catch (e) {
    throw new BadRequestException(`The file is not well-formed XML: ${e instanceof Error ? e.message : String(e)}`);
  }
  const project = (doc.Project ?? doc.project) as Record<string, unknown> | undefined;
  if (!project || typeof project !== 'object') {
    throw new BadRequestException('This does not look like a Microsoft Project XML file: no <Project> root element.');
  }

  // ---- calendars
  const calendars: MsCalendar[] = [];
  for (const c of arr<Record<string, unknown>>((project.Calendars as Record<string, unknown> | undefined)?.Calendar)) {
    const weekdayWorking: MsCalendar['weekdayWorking'] = {};
    for (const wd of arr<Record<string, unknown>>((c.WeekDays as Record<string, unknown> | undefined)?.WeekDay)) {
      const dayType = num(wd.DayType);
      if (dayType == null || dayType < 1 || dayType > 7) continue;
      const times = arr<Record<string, unknown>>((wd.WorkingTimes as Record<string, unknown> | undefined)?.WorkingTime)
        .map((t) => ({ from: String(t.FromTime ?? '08:00:00'), to: String(t.ToTime ?? '17:00:00') }));
      weekdayWorking[dayType] = { working: bool(wd.DayWorking), times };
    }
    const exceptions: MsCalendarException[] = arr<Record<string, unknown>>((c.Exceptions as Record<string, unknown> | undefined)?.Exception)
      .map((ex) => {
        const tp = (ex.TimePeriod ?? {}) as Record<string, unknown>;
        const times = arr<Record<string, unknown>>((ex.WorkingTimes as Record<string, unknown> | undefined)?.WorkingTime)
          .map((t) => ({ from: String(t.FromTime ?? '08:00:00'), to: String(t.ToTime ?? '17:00:00') }));
        return {
          name: str(ex.Name) ?? undefined,
          fromDate: String(tp.FromDate ?? ''),
          toDate: String(tp.ToDate ?? tp.FromDate ?? ''),
          working: bool(ex.DayWorking),
          times,
        };
      })
      .filter((e) => e.fromDate);
    // Legacy pre-2007 exceptions ride inside WeekDays with DayType 0 + TimePeriod
    for (const wd of arr<Record<string, unknown>>((c.WeekDays as Record<string, unknown> | undefined)?.WeekDay)) {
      const tp = (wd.TimePeriod ?? undefined) as Record<string, unknown> | undefined;
      if (num(wd.DayType) === 0 && tp?.FromDate) {
        exceptions.push({
          fromDate: String(tp.FromDate),
          toDate: String(tp.ToDate ?? tp.FromDate),
          working: bool(wd.DayWorking),
          times: arr<Record<string, unknown>>((wd.WorkingTimes as Record<string, unknown> | undefined)?.WorkingTime)
            .map((t) => ({ from: String(t.FromTime ?? '08:00:00'), to: String(t.ToTime ?? '17:00:00') })),
        });
      }
    }
    calendars.push({
      uid: num(c.UID, -1)!,
      name: str(c.Name) ?? `Calendar ${num(c.UID)}`,
      isBase: bool(c.IsBaseCalendar),
      baseCalendarUid: num(c.BaseCalendarUID),
      weekdayWorking,
      exceptions,
    });
  }

  // ---- tasks
  const tasks: MsTask[] = [];
  for (const t of arr<Record<string, unknown>>((project.Tasks as Record<string, unknown> | undefined)?.Task)) {
    const predecessors: MsPredecessorLink[] = arr<Record<string, unknown>>((t.PredecessorLinks as Record<string, unknown> | undefined)?.PredecessorLink)
      .map((l) => {
        const type = LINK_TYPE_MAP[num(l.Type, 1) ?? 1] ?? 'FS';
        const lag = parseLinkLag(l);
        return {
          predecessorUid: num(l.PredecessorUID, -1)!,
          type,
          lagMinutes: lag === 'unsupported' ? 0 : lag,
          lagUnsupported: lag === 'unsupported' ? 'Percentage-based lag is not supported; imported as 0' : undefined,
        };
      });
    const readBaseline = (prefix: string): MsBaseline | null => {
      // Nested container form: <Baseline><Start>…</Start>…</Baseline>
      // (and <Baseline1>…</Baseline1> for the numbered slots)
      const nested = t[prefix] as Record<string, unknown> | undefined;
      const pick = (key: string, flat: string): unknown =>
        nested && nested[key] !== undefined ? nested[key] : t[flat];
      const b = {
        start: parseMsDate(pick('Start', `${prefix}Start`)),
        finish: parseMsDate(pick('Finish', `${prefix}Finish`)),
        durationMinutes: parseIsoDurationMinutes(pick('Duration', `${prefix}Duration`)),
        workMinutes: parseIsoDurationMinutes(pick('Work', `${prefix}Work`)),
        cost: pick('Cost', `${prefix}Cost`) != null ? num(pick('Cost', `${prefix}Cost`), 0) : null,
      };
      return b.start || b.finish || b.cost != null ? b : null;
    };
    const extraBaselines: MsTask['extraBaselines'] = [];
    for (let i = 1; i <= 9; i++) {
      const b = readBaseline(`Baseline${i}`);
      if (b) extraBaselines.push({ name: `Baseline ${i}`, baseline: b });
    }
    tasks.push({
      uid: num(t.UID, -1)!,
      id: num(t.ID),
      name: str(t.Name) ?? `Task ${num(t.UID)}`,
      wbs: str(t.WBS),
      outlineLevel: Math.max(1, num(t.OutlineLevel, 1) ?? 1),
      isSummary: bool(t.Summary),
      isMilestone: bool(t.Milestone),
      isActive: t.Active === undefined ? true : bool(t.Active),
      isManual: bool(t.Manual),
      durationMinutes: parseIsoDurationMinutes(t.Duration),
      start: parseMsDate(t.Start),
      finish: parseMsDate(t.Finish),
      manualStart: parseMsDate(t.ManualStart),
      manualFinish: parseMsDate(t.ManualFinish),
      percentComplete: num(t.PercentComplete, 0) ?? 0,
      actualStart: parseMsDate(t.ActualStart),
      actualFinish: parseMsDate(t.ActualFinish),
      workMinutes: parseIsoDurationMinutes(t.Work),
      actualWorkMinutes: parseIsoDurationMinutes(t.ActualWork),
      remainingWorkMinutes: parseIsoDurationMinutes(t.RemainingWork),
      fixedCost: num(t.FixedCost, 0) ?? 0,
      priority: Math.min(1000, Math.max(1, num(t.Priority, 500) ?? 500)),
      notes: str(t.Notes),
      constraintType: CONSTRAINT_MAP[num(t.ConstraintType, 0) ?? 0] ?? null,
      constraintDate: parseMsDate(t.ConstraintDate),
      deadline: parseMsDate(t.Deadline),
      taskType: TASK_TYPE_MAP[num(t.Type, 0) ?? 0] ?? 'fixed_units',
      effortDriven: bool(t.EffortDriven),
      calendarUid: num(t.CalendarUID),
      predecessors,
      baseline: readBaseline('Baseline'),
      extraBaselines,
    });
  }

  // ---- resources
  const resources: MsResource[] = arr<Record<string, unknown>>((project.Resources as Record<string, unknown> | undefined)?.Resource)
    .map((r) => ({
      uid: num(r.UID, -1)!,
      id: num(r.ID),
      name: str(r.Name) ?? `Resource ${num(r.UID)}`,
      kind: RESOURCE_TYPE_MAP[num(r.Type, 1) ?? 1] ?? 'work',
      maxUnits: r.MaxUnits != null ? (num(r.MaxUnits, 1) ?? 1) / 100 : null,
      standardRatePerHour: parseRate(r.StandardRate),
      costPerUse: parseRate(r.CostPerUse),
      notes: str(r.Notes),
      calendarUid: num(r.CalendarUID),
    }));

  // ---- assignments
  const assignments: MsAssignment[] = arr<Record<string, unknown>>((project.Assignments as Record<string, unknown> | undefined)?.Assignment)
    .map((a) => ({
      uid: num(a.UID, -1)!,
      taskUid: num(a.TaskUID, -1)!,
      resourceUid: num(a.ResourceUID) === -65535 ? null : num(a.ResourceUID),
      units: a.Units != null ? (num(a.Units, 1) ?? 1) / 100 : 1,
      workMinutes: parseIsoDurationMinutes(a.Work) ?? parseIsoDurationMinutes(a.RegularWork),
      actualWorkMinutes: parseIsoDurationMinutes(a.ActualWork),
      cost: a.Cost != null ? num(a.Cost, 0) : null,
    }));

  const scheduleFromStart = t3(project.ScheduleFromStart);
  if (!scheduleFromStart) {
    warnings.push('The source is scheduled backward from the project finish date. Pulse schedules from the start date; imported logic is preserved but the scheduling direction is not.');
  }

  return {
    format: 'xml',
    name: str(project.Name),
    startDate: parseMsDate(project.StartDate),
    scheduleFromStart,
    hoursPerDay: (num(project.HoursPerDay, 8) ?? 8) as number,
    hoursPerWeek: (num(project.HoursPerWeek, 40) ?? 40) as number,
    daysPerMonth: (num(project.DaysPerMonth, 20) ?? 20) as number,
    defaultCalendarUid: num(project.CalendarUID),
    currencySymbol: str(project.CurrencySymbol),
    calendars,
    tasks,
    resources,
    assignments,
  };
}

function t3(v: unknown): boolean {
  return v === undefined ? true : bool(v);
}

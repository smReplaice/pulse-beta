import { CalendarSpec, ScheduleResult } from './types';
import { dateKey, keyToDate, workingMinutesOnDate, workingPeriodsOn } from './calendar';

export interface BaselineTaskSnapshot {
  taskId: string;
  name: string;
  start: string;
  finish: string;
  durationMinutes: number;
  workMinutes: number;
  cost: number;
  percentComplete: number;
}

export interface EarnedValuePoint {
  dateKey: string;
  pv: number; // BCWS
  ev: number; // BCWP (cumulative through this date)
  ac: number; // ACWP
}

export interface EarnedValueResult {
  statusDate: string | null;
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number;
  cpi: number;
  eac: number;
  vac: number;
  etc: number;
  baselineStart: string | null;
  baselineFinish: string | null;
  currentFinish: string;
  finishVarianceMinutes: number;
  startVarianceMinutes: number;
  series: EarnedValuePoint[];
  taskVariance: {
    taskId: string;
    name: string;
    baselineStart: string | null;
    baselineFinish: string | null;
    currentStart: string;
    currentFinish: string;
    startVarianceMinutes: number;
    finishVarianceMinutes: number;
    durationVarianceMinutes: number;
    costVariance: number;
  }[];
}

/** Distribute a task's baseline cost uniformly across its baseline working days. */
function dailyCostSpread(
  cal: CalendarSpec,
  start: Date,
  finish: Date,
  cost: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const days: string[] = [];
  let d = keyToDate(dateKey(start));
  for (let i = 0; i < 3660; i++) {
    const key = dateKey(d);
    if (workingPeriodsOn(cal, d).length > 0) days.push(key);
    if (key === dateKey(finish)) break;
    d = new Date(d.getTime() + 86400000);
  }
  if (days.length === 0) {
    out.set(dateKey(start), cost);
    return out;
  }
  for (const k of days) out.set(k, cost / days.length);
  return out;
}

export function computeEarnedValue(
  baseline: BaselineTaskSnapshot[],
  current: ScheduleResult,
  statusDate: string | null,
  projectCalendar: CalendarSpec,
): EarnedValueResult {
  const status = statusDate ? new Date(statusDate) : new Date(current.projectFinish);
  const statusKey = dateKey(status);

  let bac = 0;
  let pv = 0;
  let ev = 0;
  const seriesMap = new Map<string, EarnedValuePoint>();
  const bump = (k: string, field: 'pv' | 'ev' | 'ac', amount: number) => {
    const cur = seriesMap.get(k) ?? { dateKey: k, pv: 0, ev: 0, ac: 0 };
    cur[field] += amount;
    seriesMap.set(k, cur);
  };

  for (const b of baseline) {
    bac += b.cost;
    const spread = dailyCostSpread(projectCalendar, new Date(b.start), new Date(b.finish), b.cost);
    for (const [k, amt] of spread) {
      if (k <= statusKey) pv += amt;
      bump(k, 'pv', amt);
    }
    const cur = current.tasks[b.taskId];
    const pct = (cur?.percentComplete ?? 0) / 100;
    ev += b.cost * pct;
    // EV accumulates through status date proportionally
    const spreadEv = dailyCostSpread(projectCalendar, new Date(b.start), new Date(b.finish), b.cost * pct);
    for (const [k, amt] of spreadEv) {
      if (k <= statusKey) bump(k, 'ev', amt);
    }
    if (cur) {
      const ac = cur.actualCost;
      const spreadAc = dailyCostSpread(
        projectCalendar,
        new Date(cur.actualStart ?? cur.start),
        new Date(Math.min(new Date(cur.actualFinish ?? cur.finish).getTime(), status.getTime())),
        ac,
      );
      for (const [k, amt] of spreadAc) bump(k, 'ac', amt);
    }
  }

  const ac = current.tasks
    ? Object.values(current.tasks).reduce((s, t) => s + t.actualCost, 0)
    : 0;

  const sv = ev - pv;
  const cv = ev - ac;
  const cpi = ev !== 0 ? ac / ev : 1;
  const eac = cpi !== 0 ? bac / cpi : bac;

  const baselineStart = baseline.length
    ? baseline.reduce((m, b) => (new Date(b.start) < m ? new Date(b.start) : m), new Date(baseline[0].start)).toISOString()
    : null;
  const baselineFinish = baseline.length
    ? baseline.reduce((m, b) => (new Date(b.finish) > m ? new Date(b.finish) : m), new Date(baseline[0].finish)).toISOString()
    : null;

  const taskVariance = baseline.map((b) => {
    const cur = current.tasks[b.taskId];
    return {
      taskId: b.taskId,
      name: b.name,
      baselineStart: b.start,
      baselineFinish: b.finish,
      currentStart: cur?.start ?? '',
      currentFinish: cur?.finish ?? '',
      startVarianceMinutes: cur ? Math.round((new Date(cur.start).getTime() - new Date(b.start).getTime()) / 60000) : 0,
      finishVarianceMinutes: cur ? Math.round((new Date(cur.finish).getTime() - new Date(b.finish).getTime()) / 60000) : 0,
      durationVarianceMinutes: cur ? cur.durationMinutes - b.durationMinutes : 0,
      costVariance: cur ? b.cost - cur.actualCost : 0,
    };
  });

  const series = [...seriesMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  // cumulative-ise EV/AC
  let accEv = 0;
  let accAc = 0;
  for (const p of series) {
    accEv += p.ev;
    accAc += p.ac;
    p.ev = round2(accEv);
    p.ac = round2(accAc);
    p.pv = round2(p.pv);
  }

  return {
    statusDate: statusDate ?? null,
    bac: round2(bac),
    pv: round2(pv),
    ev: round2(ev),
    ac: round2(ac),
    sv: round2(sv),
    cv: round2(cv),
    spi: pv !== 0 ? round4(ev / pv) : 1,
    cpi: round4(cpi),
    eac: round2(eac),
    vac: round2(bac - eac),
    etc: round2(Math.max(0, eac - ac)),
    baselineStart,
    baselineFinish,
    currentFinish: current.projectFinish,
    finishVarianceMinutes: baselineFinish
      ? Math.round((new Date(current.projectFinish).getTime() - new Date(baselineFinish).getTime()) / 60000)
      : 0,
    startVarianceMinutes: baselineStart
      ? Math.round((new Date(current.projectStart).getTime() - new Date(baselineStart).getTime()) / 60000)
      : 0,
    series,
    taskVariance,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export { workingMinutesOnDate };

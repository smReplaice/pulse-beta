/**
 * MS Project style duration strings: "1.5 days?", "2 wks", "4 hrs", "30 mins", "0 days".
 * Parsing is tolerant: "5d", "5 days", "5day", "1w 2d" all work.
 */

export interface DurationParseContext {
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
}

export const DEFAULT_CONTEXT: DurationParseContext = {
  minutesPerDay: 480,
  minutesPerWeek: 2400,
  daysPerMonth: 20,
};

export function formatDuration(
  minutes: number,
  ctx: DurationParseContext = DEFAULT_CONTEXT,
  estimated = false,
): string {
  const unit = (v: number, singular: string, plural: string) => {
    const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
    return v === 1 ? `1 ${singular}` : `${n} ${plural}`;
  };
  let out: string;
  if (minutes === 0) {
    out = '0 days';
  } else if (minutes % ctx.minutesPerDay === 0 && minutes < 2 * ctx.minutesPerWeek) {
    // ProjectLibre/MS Project display preference: days under two weeks
    out = unit(minutes / ctx.minutesPerDay, 'day', 'days');
  } else if (minutes % ctx.minutesPerWeek === 0) {
    out = unit(minutes / ctx.minutesPerWeek, 'wk', 'wks');
  } else if (minutes % ctx.minutesPerDay === 0) {
    out = unit(minutes / ctx.minutesPerDay, 'day', 'days');
  } else if (minutes % 60 === 0) {
    out = unit(minutes / 60, 'hr', 'hrs');
  } else {
    out = unit(minutes, 'min', 'mins');
  }
  return estimated ? `${out}?` : out;
}

export function formatElapsedDuration(
  minutes: number,
  ctx: DurationParseContext = DEFAULT_CONTEXT,
): string {
  const days = minutes / (24 * 60);
  const q = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (minutes === 0) return '0 edays';
  if (minutes % (24 * 60) === 0) return `${q(days)} edays`;
  if (minutes % 60 === 0) return `${q(minutes / 60)} ehrs`;
  return `${q(minutes)} emins`;
}

export function parseDuration(
  input: string,
  ctx: DurationParseContext = DEFAULT_CONTEXT,
): { minutes: number; estimated: boolean } {
  const raw = input.trim();
  if (raw === '' || raw === '?') return { minutes: 0, estimated: true };
  const estimated = raw.endsWith('?');
  const s = (estimated ? raw.slice(0, -1) : raw).trim().toLowerCase();

  if (/^\d+(\.\d+)?$/.test(s)) {
    // Bare number means days
    return { minutes: Math.round(parseFloat(s) * ctx.minutesPerDay), estimated };
  }

  const unitMap: Array<[RegExp, number]> = [
    [/^(\d+(?:\.\d+)?)\s*(emins?|eminutes?)/, 1],
    [/^(\d+(?:\.\d+)?)\s*(ehrs?|ehours?)/, 60],
    [/^(\d+(?:\.\d+)?)\s*(edays?)/, 24 * 60],
    [/^(\d+(?:\.\d+)?)\s*(ewks?|eweeks?)/, 24 * 60 * 7],
    [/^(\d+(?:\.\d+)?)\s*(mins?|minutes?|min)/, 1],
    [/^(\d+(?:\.\d+)?)\s*(hrs?|hours?|hr)/, 60],
    [/^(\d+(?:\.\d+)?)\s*(days?|day|d)/, ctx.minutesPerDay],
    [/^(\d+(?:\.\d+)?)\s*(wks?|weeks?|w)/, ctx.minutesPerWeek],
    [/^(\d+(?:\.\d+)?)\s*(mons?|months?|mo)/, ctx.daysPerMonth * ctx.minutesPerDay],
  ];
  for (const [re, unitMinutes] of unitMap) {
    const m = re.exec(s);
    if (m) {
      return { minutes: Math.round(parseFloat(m[1]) * unitMinutes), estimated };
    }
  }
  throw new Error(`Cannot parse duration '${input}'`);
}

export function formatUnits(units: number): string {
  const pct = Math.round(units * 1000) / 10;
  const txt = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${txt}%`;
}

export function parseUnits(input: string): number {
  const s = input.trim();
  if (s === '') return 1;
  if (s.endsWith('%')) return parseFloat(s) / 100;
  const v = parseFloat(s);
  if (Number.isNaN(v)) throw new Error(`Cannot parse units '${input}'`);
  return v;
}

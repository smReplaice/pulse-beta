/**
 * Shared Gantt coordinate system — the ONE place that converts between
 * dates and pixels. The grid and the timeline both derive row positions
 * from the same ROW_H; every bar, link and gridline position comes from
 * these functions so the two panels cannot drift apart.
 *
 * All dates are UTC instants (backend authoritative values).
 * Content coordinates: px offset inside the scrollable canvas (0 = originDate).
 */

export const ROW_H = 22;
export const HEADER_H = 36;
export const BAR_H = 12;
export const BAR_TOP_OFFSET = 5;

export interface Scale {
  originMs: number; // date at canvas x=0
  msPerPx: number;
  pxPerDay: number;
}

export function makeScale(originMs: number, pxPerDay: number): Scale {
  return { originMs, msPerPx: 86400000 / pxPerDay, pxPerDay };
}

/** date → content x (px). */
export function xOf(scale: Scale, ms: number): number {
  return (ms - scale.originMs) / scale.msPerPx;
}

/** content x → date. */
export function dateOfX(scale: Scale, x: number): Date {
  return new Date(scale.originMs + x * scale.msPerPx);
}

/** Content x for the start of the day containing `ms` (UTC midnight). */
export function dayStart(ms: number): number {
  return Math.floor(ms / 86400000) * 86400000;
}

export interface BarGeometry {
  x1: number;
  x2: number;
  y: number; // top of the bar's row
  width: number;
  cy: number; // vertical centre of the bar
}

/** Bar rectangle for a task on a given row index. */
export function barGeometry(
  scale: Scale,
  rowIndex: number,
  startMs: number,
  finishMs: number,
  minWidth = 3,
): BarGeometry {
  const x1 = xOf(scale, startMs);
  const x2 = Math.max(xOf(scale, finishMs), x1 + minWidth);
  const y = rowIndex * ROW_H + BAR_TOP_OFFSET;
  return { x1, x2, y, width: x2 - x1, cy: y + BAR_H / 2 };
}

/** Milestone diamond path centred at (cx, cy). */
export function diamondPath(cx: number, cy: number, r = 6): string {
  return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
}

/**
 * Dependency connector: elbow from the predecessor's endpoint to the
 * successor's endpoint. Stubs point TOWARD the target (works for every
 * relationship type and for back-links), the arrow marker auto-orients.
 */
export function connectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  _forward?: boolean,
): string {
  const dir = x2 >= x1 ? 1 : -1;
  const sx = x1 + 7 * dir;
  const ex = x2 - 7 * dir;
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  if ((dir === 1 && sx < ex) || (dir === -1 && sx > ex)) {
    return `M ${x1} ${y1} L ${sx} ${y1} L ${sx} ${y2} L ${x2} ${y2}`;
  }
  // target lies behind the source: route around via a mid-level shelf
  const midY = y1 + (y2 > y1 ? 10 : -10);
  return `M ${x1} ${y1} L ${sx} ${y1} L ${sx} ${midY} L ${ex} ${midY} L ${ex} ${y2} L ${x2} ${y2}`;
}

/** Which endpoint of a bar a relationship attaches to. */
export function connectorEndpoints(
  depType: 'FS' | 'SS' | 'FF' | 'SF',
): { fromFinish: boolean; toStart: boolean } {
  switch (depType) {
    case 'FS':
      return { fromFinish: true, toStart: true };
    case 'SS':
      return { fromFinish: false, toStart: true };
    case 'FF':
      return { fromFinish: true, toStart: false };
    case 'SF':
      return { fromFinish: false, toStart: false };
  }
}

/** Month/week/day tick rows for the two-tier header. */
export interface HeaderTick {
  ms: number;
  endMs: number;
  label: string;
}

export function monthTicks(fromMs: number, toMs: number): HeaderTick[] {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const out: HeaderTick[] = [];
  let d = new Date(dayStart(fromMs));
  d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  while (d.getTime() <= toMs) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    out.push({ ms: d.getTime(), endMs: next.getTime(), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
    d = next;
  }
  return out;
}

export function dayList(fromMs: number, toMs: number): Date[] {
  const out: Date[] = [];
  let ms = dayStart(fromMs);
  while (ms <= toMs) {
    out.push(new Date(ms));
    ms += 86400000;
  }
  return out;
}

/** Vertical gridline dates: days when zoomed in, week starts (Mon) or month
 *  starts when zoomed out — matched to the header tier below. */
export function gridlineDates(fromMs: number, toMs: number, pxPerDay: number): Date[] {
  if (pxPerDay >= 8) {
    return dayList(fromMs, toMs);
  }
  const monthly = pxPerDay < 4;
  return dayList(fromMs, toMs).filter((d) =>
    monthly ? d.getUTCDate() === 1 : d.getUTCDay() === 1,
  );
}

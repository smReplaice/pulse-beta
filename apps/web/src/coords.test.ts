import { describe, expect, it } from 'vitest';
import {
  barGeometry,
  connectorEndpoints,
  connectorPath,
  dateOfX,
  gridlineDates,
  makeScale,
  monthTicks,
  xOf,
} from './coords';

const ORIGIN = Date.UTC(2026, 0, 5, 8, 0, 0); // Mon 5 Jan 2026 08:00

describe('gantt coordinate scale', () => {
  it('round-trips date ↔ x', () => {
    const s = makeScale(ORIGIN, 26);
    const d = Date.UTC(2026, 1, 10, 13, 30, 0);
    expect(dateOfX(s, xOf(s, d)).getTime()).toBe(d);
  });

  it('places a 5-working-day bar from Monday across 7 calendar days', () => {
    const s = makeScale(ORIGIN, 26);
    const start = Date.UTC(2026, 0, 5, 8, 0, 0);
    const finish = Date.UTC(2026, 0, 9, 17, 0, 0); // Fri 17:00
    const g = barGeometry(s, 0, start, finish);
    expect(g.y).toBe(5); // BAR_TOP_OFFSET
    expect(g.cy).toBe(11);
    // width = (Fri17 - Mon8) in px
    expect(g.width).toBeCloseTo(((finish - start) / 86400000) * 26, 6);
  });

  it('maps rows to multiples of ROW_H so grid and timeline cannot drift', () => {
    const s = makeScale(ORIGIN, 20);
    for (let row = 0; row < 40; row++) {
      const g = barGeometry(s, row, ORIGIN, ORIGIN + 86400000);
      expect(g.y - 5).toBe(row * 22); // BAR_TOP_OFFSET is constant for every row
      expect((g.y - 5) / 22).toBe(row);
    }
  });

  it('enforces a minimum bar width for zero-length spans', () => {
    const s = makeScale(ORIGIN, 26);
    const g = barGeometry(s, 3, ORIGIN, ORIGIN, 3);
    expect(g.width).toBe(3);
  });
});

describe('dependency connectors', () => {
  it('attaches to the correct endpoints per relationship type', () => {
    expect(connectorEndpoints('FS')).toEqual({ fromFinish: true, toStart: true });
    expect(connectorEndpoints('SS')).toEqual({ fromFinish: false, toStart: true });
    expect(connectorEndpoints('FF')).toEqual({ fromFinish: true, toStart: false });
    expect(connectorEndpoints('SF')).toEqual({ fromFinish: false, toStart: false });
  });

  it('draws a straight line when rows are level', () => {
    const p = connectorPath(100, 16, 300, 16, true);
    expect(p).toBe('M 100 16 L 300 16');
  });

  it('drops vertically when the target starts to the right (FS forward link)', () => {
    const p = connectorPath(100, 16, 300, 60, true);
    expect(p).toBe('M 100 16 L 107 16 L 107 60 L 300 60');
  });

  it('back-links run right-to-left into a finish (FF/SF)', () => {
    const p = connectorPath(300, 16, 100, 60, false);
    expect(p).toBe('M 300 16 L 293 16 L 293 60 L 100 60');
  });
});

describe('header ticks and gridlines', () => {
  it('produces non-overlapping month ticks with labels', () => {
    const ticks = monthTicks(ORIGIN, ORIGIN + 60 * 86400000);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0].label).toBe('January 2026');
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].ms).toBe(ticks[i - 1].endMs);
    }
  });

  it('switches gridline density by zoom', () => {
    const from = ORIGIN;
    const to = ORIGIN + 28 * 86400000;
    const daily = gridlineDates(from, to, 14);
    const weekly = gridlineDates(from, to, 6);
    const monthly = gridlineDates(from, to, 3);
    expect(daily.length).toBe(29);
    expect(weekly.every((d) => d.getUTCDay() === 1)).toBe(true);
    expect(monthly.every((d) => d.getUTCDate() === 1)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes,
  alignEnd,
  alignStart,
  subtractWorkingMinutes,
  workingMinutesBetween,
} from '../src/calendar';
import { CAL } from './fixtures';

const D = (s: string) => new Date(s);

describe('working-time calendar arithmetic', () => {
  it('adds minutes across a lunch break', () => {
    // Mon 5 Jan 08:00 + 300 min = 14:00 (240 morning + 60 afternoon after 13:00)
    const r = addWorkingMinutes(CAL, D('2026-01-05T08:00:00.000Z'), 300);
    expect(r.toISOString()).toBe('2026-01-05T14:00:00.000Z');
  });

  it('adds minutes across a weekend', () => {
    // Fri 9 Jan 16:00 + 120 min = Mon 12 Jan 09:00
    const r = addWorkingMinutes(CAL, D('2026-01-09T16:00:00.000Z'), 120);
    expect(r.toISOString()).toBe('2026-01-12T09:00:00.000Z');
  });

  it('treats a period-end boundary as exclusive', () => {
    // Fri 17:00 + 0 = Fri 17:00, but alignStart snaps to the next working start (Mon 08:00)
    const r = addWorkingMinutes(CAL, D('2026-01-09T17:00:00.000Z'), 0);
    expect(r.toISOString()).toBe('2026-01-09T17:00:00.000Z');
    const s = alignStart(CAL, r);
    expect(s.toISOString()).toBe('2026-01-12T08:00:00.000Z');
  });

  it('aligns starts strictly after a finish boundary (FS rule)', () => {
    const s = alignStart(CAL, D('2026-01-09T17:00:00.000Z'), true);
    expect(s.toISOString()).toBe('2026-01-12T08:00:00.000Z');
  });

  it('subtracts working minutes from a finish boundary (LS rule)', () => {
    // Mon 12 Jan 17:00 - 480 = Mon 08:00
    const r = subtractWorkingMinutes(CAL, D('2026-01-12T17:00:00.000Z'), 480);
    expect(r.toISOString()).toBe('2026-01-12T08:00:00.000Z');
    // Mon 12 Jan 17:00 - 960 = Fri 09 Jan 08:00
    const r2 = subtractWorkingMinutes(CAL, D('2026-01-12T17:00:00.000Z'), 960);
    expect(r2.toISOString()).toBe('2026-01-09T08:00:00.000Z');
  });

  it('aligns ends to the latest period end at-or-before an instant', () => {
    const e = alignEnd(CAL, D('2026-01-12T08:00:00.000Z'));
    expect(e.toISOString()).toBe('2026-01-09T17:00:00.000Z');
  });

  it('counts working minutes between instants ignoring nights and weekends', () => {
    expect(
      workingMinutesBetween(CAL, D('2026-01-05T08:00:00.000Z'), D('2026-01-09T17:00:00.000Z')),
    ).toBe(2400); // one working week
    expect(
      workingMinutesBetween(CAL, D('2026-01-05T08:00:00.000Z'), D('2026-01-06T08:00:00.000Z')),
    ).toBe(480);
  });

  it('honours holiday exceptions', () => {
    const cal = {
      ...CAL,
      exceptions: { '2026-01-08': { periods: [], label: 'Holiday' } },
    };
    // Mon..Fri with Wed off => 4 working days
    expect(
      workingMinutesBetween(cal, D('2026-01-05T08:00:00.000Z'), D('2026-01-09T17:00:00.000Z')),
    ).toBe(1920);
  });
});

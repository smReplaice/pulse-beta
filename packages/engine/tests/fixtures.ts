import { CalendarSpec, EngineProjectInput, TaskInput } from '../src';

export const CAL = standardCal();

export function standardCal(): CalendarSpec {
  return {
    id: 'cal',
    name: 'Standard',
    week: {
      1: [
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
      2: [
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
      3: [
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
      4: [
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
      5: [
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
    },
    exceptions: {},
  };
}

/** Monday, 5 January 2026 */
export const PROJ_START = '2026-01-05T08:00:00.000Z';

let orderCounter = 0;
export function resetOrder(): void {
  orderCounter = 0;
}

export function task(id: string, name: string, opts: Partial<TaskInput> = {}): TaskInput {
  orderCounter += 1;
  return {
    id,
    name,
    rowOrder: orderCounter * 10,
    outlineLevel: 0,
    durationMinutes: 480,
    durationMode: 'working',
    mode: 'auto',
    taskType: 'fixed_units',
    effortDriven: false,
    percentComplete: 0,
    constraint: null,
    calendarId: null,
    priority: 500,
    levelingDelayMinutes: 0,
    active: true,
    manualStart: null,
    manualFinish: null,
    fixedCost: 0,
    fixedCostAccrual: 'prorated',
    actualStart: null,
    actualFinish: null,
    actualWorkMinutes: 0,
    actualCost: null,
    deadline: null,
    ...opts,
  };
}

export function project(
  tasks: TaskInput[],
  deps: EngineProjectInput['dependencies'],
  opts: Partial<EngineProjectInput> = {},
): EngineProjectInput {
  return {
    projectId: 'p1',
    start: PROJ_START,
    deadline: null,
    statusDate: null,
    minutesPerDay: 480,
    minutesPerWeek: 2400,
    daysPerMonth: 20,
    defaultCalendarId: 'cal',
    calendars: [CAL],
    tasks,
    dependencies: deps,
    resources: [],
    assignments: [],
    ...opts,
  };
}

export function dep(
  id: string,
  pred: string,
  succ: string,
  type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS',
  lagMinutes = 0,
): EngineProjectInput['dependencies'][number] {
  return { id, predecessorId: pred, successorId: succ, type, lagMinutes };
}

export function workResource(
  id: string,
  name: string,
  opts: Partial<EngineProjectInput['resources'][number]> = {},
): EngineProjectInput['resources'][number] {
  return {
    id,
    name,
    kind: 'work',
    maxUnits: 1,
    standardRate: 50,
    overtimeRate: 75,
    costPerUse: 0,
    calendarId: null,
    ...opts,
  };
}

export function assignment(
  id: string,
  taskId: string,
  resourceId: string,
  units: number,
  workMinutes: number | null = null,
): EngineProjectInput['assignments'][number] {
  return { id, taskId, resourceId, units, workMinutes, cost: null };
}

export const day = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

/**
 * BiltFlow Pulse scheduling engine — types.
 *
 * The engine is a PURE library: no IO, no ORM, no framework.
 * It takes a plain JSON description of a programme and returns calculated
 * results. The NestJS API layer is responsible for loading/saving.
 *
 * All instants are ISO 8601 UTC timestamps; all date keys are 'YYYY-MM-DD'.
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export type ConstraintType =
  | 'ASAP'
  | 'ALAP'
  | 'SNET' // Start No Earlier Than
  | 'SNLT' // Start No Later Than
  | 'FNET' // Finish No Earlier Than
  | 'FNLT' // Finish No Later Than
  | 'MSO' // Must Start On
  | 'MFO'; // Must Finish On

export interface Constraint {
  type: ConstraintType;
  /** ISO timestamp. Null for ASAP / ALAP. */
  date: string | null;
}

/** A working period expressed as 'HH:mm'..'HH:mm' in 24h local-of-calendar time (we use UTC as the calendar frame). */
export interface TimePeriod {
  start: string;
  end: string;
}

export interface CalendarException {
  /** Empty periods array => whole day non-working (holiday). */
  periods: TimePeriod[];
  label?: string;
}

export interface CalendarSpec {
  id: string;
  name: string;
  /** 0 = Sunday … 6 = Saturday. Missing key => non-working day. */
  week: Record<number, TimePeriod[]>;
  /** dateKey 'YYYY-MM-DD' -> override of the weekly pattern. */
  exceptions: Record<string, CalendarException>;
}

export type TaskType = 'fixed_units' | 'fixed_duration' | 'fixed_work';
export type DurationMode = 'working' | 'elapsed';
export type TaskMode = 'auto' | 'manual';
export type Accrual = 'start' | 'prorated' | 'end';

export interface TaskInput {
  /** Stable UUID — NEVER reused as a row-order identifier. */
  id: string;
  name: string;
  /** Display row order (stable across reordering). */
  rowOrder: number;
  /** 0-based outline depth. Parent is the nearest previous task with lower level. */
  outlineLevel: number;
  durationMinutes: number;
  durationMode: DurationMode;
  mode: TaskMode;
  taskType: TaskType;
  effortDriven: boolean;
  percentComplete: number; // 0..100
  constraint: Constraint | null;
  calendarId: string | null;
  priority: number; // 1..1000, 1000 = do not level
  levelingDelayMinutes: number;
  notes?: string;
  active: boolean;
  /** Manual scheduling (Task Mode column, like MS Project). */
  manualStart: string | null;
  manualFinish: string | null;
  fixedCost: number;
  fixedCostAccrual: Accrual;
  /** Actuals */
  actualStart: string | null;
  actualFinish: string | null;
  actualWorkMinutes: number;
  actualCost: number | null; // null => derived from actual work
  /** Deadline (soft constraint — warning only). */
  deadline: string | null;
  /** Construction extras (pass-through, usable by grouping/views). */
  stage?: string | null;
  trade?: string | null;
  location?: string | null;
  packageId?: string | null;
  externalReferenceId?: string | null;
  requiredOnSite?: string | null;
  delayReason?: string | null;
  extensionOfTime?: boolean;
  isProcurement?: boolean;
  isApproval?: boolean;
  isInspection?: boolean;
}

export interface DependencyInput {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Positive or negative offset in working minutes (lag > 0, lead < 0). */
  lagMinutes: number;
}

export type ResourceKind = 'work' | 'material' | 'cost';

export interface ResourceInput {
  id: string;
  name: string;
  kind: ResourceKind;
  /** 1.0 = 100 % available. */
  maxUnits: number;
  /** $/hour for work resources, $/unit for material. */
  standardRate: number;
  overtimeRate: number;
  costPerUse: number;
  calendarId: string | null;
  group?: string | null;
  code?: string | null;
  initials?: string | null;
}

export interface AssignmentInput {
  id: string;
  taskId: string;
  resourceId: string;
  units: number;
  /**
   * Work minutes for work resources (null => derive from units × duration).
   * For material resources this holds the quantity in units (not minutes).
   */
  workMinutes: number | null;
  /** Cost resources: a lump sum. */
  cost: number | null;
}

export interface EngineProjectInput {
  projectId: string;
  /** Project start instant (ISO). */
  start: string;
  deadline: string | null;
  statusDate: string | null;
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
  defaultCalendarId: string;
  calendars: CalendarSpec[];
  tasks: TaskInput[];
  dependencies: DependencyInput[];
  resources: ResourceInput[];
  assignments: AssignmentInput[];
  /** Minutes of total float at/below which a task is critical. Default 0. */
  criticalSlackThresholdMinutes?: number;
  multipleCriticalPaths?: boolean;
}

export interface TimephasedPoint {
  dateKey: string;
  plannedMinutes: number;
  actualMinutes: number;
  plannedCost: number;
  actualCost: number;
}

export interface AssignmentResult {
  assignmentId: string;
  taskId: string;
  resourceId: string;
  units: number;
  workMinutes: number;
  actualWorkMinutes: number;
  remainingWorkMinutes: number;
  plannedCost: number;
  actualCost: number;
  byDay: TimephasedPoint[];
}

export interface ResourceUsageResult {
  resourceId: string;
  byDay: TimephasedPoint[];
  overallocatedDays: string[];
  peakUnits: number;
  totalWorkMinutes: number;
}

export interface TaskResult {
  id: string;
  wbs: string;
  outlineLevel: number;
  isSummary: boolean;
  isMilestone: boolean;
  start: string;
  finish: string;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatMinutes: number | null;
  freeFloatMinutes: number | null;
  isCritical: boolean;
  durationMinutes: number;
  workMinutes: number;
  actualWorkMinutes: number;
  remainingWorkMinutes: number;
  percentComplete: number;
  plannedCost: number;
  actualCost: number;
  levelingDelayMinutes: number;
  calendarId: string;
  actualStart: string | null;
  actualFinish: string | null;
}

export type WarningSeverity = 'info' | 'warning' | 'error';

export interface ScheduleWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  taskId?: string;
  dependencyId?: string;
  resourceId?: string;
}

export interface ScheduleResult {
  projectId: string;
  projectStart: string;
  projectFinish: string;
  durationMinutes: number;
  tasks: Record<string, TaskResult>;
  /** Ordered ids of the driving critical path (first path when multiple). */
  criticalPathIds: string[];
  /** All critical task ids (float <= threshold). */
  criticalTaskIds: string[];
  /** Additional maximal critical paths when multipleCriticalPaths is on. */
  criticalPaths: string[][];
  assignments: AssignmentResult[];
  resourceUsage: ResourceUsageResult[];
  warnings: ScheduleWarning[];
  stats: {
    taskCount: number;
    summaryCount: number;
    milestoneCount: number;
    criticalCount: number;
    projectFinishMoved: boolean;
  };
}

export interface LevelingCandidate {
  taskId: string;
  resourceId: string;
  resourceName: string;
  dateKey: string;
  overloadMinutes: number;
}

export interface LevelingPreview {
  feasible: boolean;
  delays: { taskId: string; delayMinutes: number; newStart: string; reason: string }[];
  resolvedOverallocations: number;
  remainingOverallocations: LevelingCandidate[];
  projectFinishBefore: string;
  projectFinishAfter: string;
  finishSlipMinutes: number;
  warnings: ScheduleWarning[];
}

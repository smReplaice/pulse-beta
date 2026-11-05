/** API client — all schedule math happens in the backend; the frontend only
 *  renders authoritative results and sends edit commands. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.code ?? 'HTTP_ERROR',
      data?.message ?? res.statusText,
      data,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => req<T>('GET', path),
  post: <T>(path: string, body?: unknown) => req<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => req<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => req<T>('DELETE', path),
};

// ---------------------------------------------------------------- types mirroring the API payloads

export interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  projectStart: string | null;
  projectDeadline: string | null;
  statusDate: string | null;
  currency: string;
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
  currentScheduleVersion: number;
  computedStart: string | null;
  computedFinish: string | null;
  computedProgress: number | null;
  computedCriticalCount: number | null;
}

export interface ProjectSettings {
  newTaskType: string;
  newTasksEffortDriven: boolean;
  criticalSlackThresholdMinutes: number;
  multipleCriticalPaths: boolean;
  defaultCalendarId: string | null;
  [k: string]: unknown;
}

export interface Task {
  id: string;
  projectId: string;
  rowOrder: number;
  outlineLevel: number;
  name: string;
  durationMinutes: number;
  durationMode: string;
  mode: string;
  taskType: string;
  effortDriven: boolean;
  percentComplete: number;
  constraintType: string | null;
  constraintDate: string | null;
  deadline: string | null;
  calendarId: string | null;
  priority: number;
  levelingDelayMinutes: number;
  notes: string | null;
  active: boolean;
  manualStart: string | null;
  manualFinish: string | null;
  fixedCost: number;
  actualStart: string | null;
  actualFinish: string | null;
  actualWorkMinutes: number;
  stage: string | null;
  trade: string | null;
  location: string | null;
  requiredOnSite: string | null;
  delayReason: string | null;
  extensionOfTime: boolean;
  // computed (engine output)
  computedStart: string | null;
  computedFinish: string | null;
  computedTotalFloat: number | null;
  computedFreeFloat: number | null;
  computedIsCritical: boolean;
  computedIsSummary: boolean;
  computedIsMilestone: boolean;
  computedDuration: number | null;
  computedWork: number | null;
  computedPercentComplete: number | null;
  computedPlannedCost: number | null;
  computedActualCost: number | null;
  wbs: string | null;
}

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagMinutes: number;
}

export interface Resource {
  id: string;
  name: string;
  kind: 'work' | 'material' | 'cost';
  initials: string | null;
  group: string | null;
  code: string | null;
  maxUnits: number;
  standardRate: number;
  overtimeRate: number;
  costPerUse: number;
  calendarId: string | null;
  isGeneric: boolean;
  notes?: string | null;
}

export interface Assignment {
  id: string;
  taskId: string;
  resourceId: string;
  units: number;
  workMinutes: number | null;
  cost: number | null;
}

export interface CalendarWorkingDay {
  id: string;
  dayOfWeek: number;
  periods: { start: string; end: string }[];
}

export interface CalendarException {
  id: string;
  date: string;
  periods: { start: string; end: string }[];
  label: string | null;
}

export interface ProjectCalendar {
  id: string;
  name: string;
  isDefault: boolean;
  workingDays: CalendarWorkingDay[];
  exceptions: CalendarException[];
}

export interface Baseline {
  id: string;
  name: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface SchedulePayload {
  project: Project;
  settings: ProjectSettings;
  tasks: Task[];
  dependencies: Dependency[];
  calendars: ProjectCalendar[];
  resources: Resource[];
  assignments: Assignment[];
  baselines: Baseline[];
  scheduleVersion: number;
}

export interface MutationResult {
  task?: Task;
  calculated?: Record<string, unknown> | null;
  changedTasks?: { taskId: string; before: { start: string | null; finish: string | null }; after: { start: string | null; finish: string | null } }[];
  warnings?: { code: string; message: string; severity: string }[];
  scheduleVersion?: number;
  [k: string]: unknown;
}

export interface UsagePayload {
  scheduleVersion: number;
  resources: {
    resourceId: string;
    name: string;
    kind: string;
    maxUnits: number;
    peakUnits: number;
    overallocatedDays: string[];
    totalWorkMinutes: number;
    byDay: { dateKey: string; plannedMinutes: number; actualMinutes: number }[];
  }[];
  assignments: {
    assignmentId: string;
    taskId: string;
    resourceId: string;
    units: number;
    workMinutes: number;
    byDay: { dateKey: string; plannedMinutes: number; actualMinutes: number }[];
  }[];
}

export interface LevelingPreviewPayload {
  feasible: boolean;
  delays: { taskId: string; delayMinutes: number; newStart: string; reason: string }[];
  resolvedOverallocations: number;
  remainingOverallocations: { resourceName: string; dateKey: string; overloadMinutes: number }[];
  projectFinishBefore: string;
  projectFinishAfter: string;
  finishSlipMinutes: number;
}

export interface ComparePayload {
  baseline: Baseline;
  rows: {
    taskId: string;
    name: string;
    baselineStart: string;
    baselineFinish: string;
    baselineDuration: number;
    baselineCost: number;
    currentStart: string | null;
    currentFinish: string | null;
    currentDuration: number | null;
    startVarianceMinutes: number | null;
    finishVarianceMinutes: number | null;
    durationVarianceMinutes: number | null;
    costVariance: number | null;
  }[];
}

export interface CopilotResponse {
  reply: string;
  agent?: string;
  proposal?: unknown;
  preview?: { before: { projectFinish: string }; after: { projectFinish: string; criticalCount: number }; changedTasks: { taskId?: string; name: string; start: string; finish: string }[] };
  actionId?: string;
  applied?: boolean;
  configured?: boolean;
  undoToken?: string;
}

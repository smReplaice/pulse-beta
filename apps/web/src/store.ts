import { create } from 'zustand';
import { api, ApiError, MutationResult, SchedulePayload } from './api';

/** An inverse-able edit command for undo/redo. */
export interface Command {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export type ViewMode =
  | 'gantt'
  | 'tracking'
  | 'resource-sheet'
  | 'resource-usage'
  | 'network'
  | 'wbs'
  | 'costs';

interface ScheduleState {
  // data
  projectId: string | null;
  payload: SchedulePayload | null;
  loading: boolean;
  error: string | null;
  // ui
  view: ViewMode;
  selectedTaskIds: string[];
  activeCell: { taskId: string; column: string } | null;
  editingCell: { taskId: string; column: string } | null;
  collapsedSummaries: Set<string>;
  showCritical: boolean;
  showBaseline: boolean;
  showProgress: boolean;
  showSlack: boolean;
  showCopilot: boolean;
  labelMode: 'name' | 'resources' | 'none';
  dialog: null | { kind: 'task-info'; taskId: string } | { kind: 'assign'; taskId: string } | { kind: 'level' } | { kind: 'baseline' } | { kind: 'calendar' } | { kind: 'progress'; taskId: string } | { kind: 'settings' } | { kind: 'wbs-code' } | { kind: 'dep'; depId: string };
  splitRatio: number;
  zoom: number; // px per day
  statusMessage: string;
  clipboard: string[] | null; // copied task ids
  warnings: { code: string; message: string; severity: string }[];
  // undo/redo
  undoStack: Command[];
  redoStack: Command[];
  // actions
  load: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
  setView: (v: ViewMode) => void;
  setDialog: (d: ScheduleState['dialog']) => void;
  select: (taskIds: string[], additive?: boolean) => void;
  setActiveCell: (cell: ScheduleState['activeCell']) => void;
  setEditingCell: (cell: ScheduleState['editingCell']) => void;
  toggleCollapse: (taskId: string) => void;
  setZoom: (z: number) => void;
  setSplitRatio: (r: number) => void;
  setFlag: (flag: 'showCritical' | 'showBaseline' | 'showProgress' | 'showSlack' | 'showCopilot', v: boolean) => void;
  setLabelMode: (m: 'name' | 'resources' | 'none') => void;
  setStatus: (m: string) => void;
  // mutations — each records an inverse command for undo
  updateTask: (taskId: string, changes: Record<string, unknown>, label?: string) => Promise<MutationResult>;
  createTask: (afterTaskId: string | null, name?: string, extra?: Record<string, unknown>) => Promise<MutationResult>;
  deleteTasks: (taskIds: string[]) => Promise<void>;
  indent: (taskId: string) => Promise<void>;
  outdent: (taskId: string) => Promise<void>;
  moveRow: (taskId: string, beforeTaskId: string | null) => Promise<void>;
  link: (predId: string, succId: string, type?: string) => Promise<void>;
  unlink: (taskIds: string[]) => Promise<void>;
  updateDep: (depId: string, changes: Record<string, unknown>) => Promise<void>;
  assignResource: (taskId: string, resourceId: string, units: number) => Promise<MutationResult>;
  removeAssignment: (assignmentId: string) => Promise<void>;
  recordProgress: (taskId: string, body: Record<string, unknown>) => Promise<MutationResult>;
  pushCommand: (cmd: Command) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  applyAuthoritative: (res: MutationResult) => void;
}

const errText = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

export const useSchedule = create<ScheduleState>((set, get) => ({
  projectId: null,
  payload: null,
  loading: false,
  error: null,
  view: 'gantt',
  selectedTaskIds: [],
  activeCell: null,
  editingCell: null,
  collapsedSummaries: new Set(),
  showCritical: false,
  showBaseline: false,
  showProgress: true,
  showSlack: false,
  showCopilot: false,
  labelMode: 'name',
  dialog: null,
  splitRatio: 0.42,
  zoom: 26,
  statusMessage: 'Ready',
  clipboard: null,
  warnings: [],
  undoStack: [],
  redoStack: [],

  load: async (projectId) => {
    set({ loading: true, error: null, projectId, undoStack: [], redoStack: [], selectedTaskIds: [], collapsedSummaries: new Set() });
    try {
      const payload = await api.get<SchedulePayload>(`/api/projects/${projectId}/schedule`);
      set({ payload, loading: false, statusMessage: `Loaded "${payload.project.name}" — ${payload.tasks.length} tasks, schedule v${payload.scheduleVersion}` });
    } catch (e) {
      set({ loading: false, error: errText(e) });
    }
  },

  refresh: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const payload = await api.get<SchedulePayload>(`/api/projects/${projectId}/schedule`);
      set({ payload });
    } catch (e) {
      set({ error: errText(e) });
    }
  },

  setView: (view) => set({ view }),
  setDialog: (dialog) => set({ dialog }),
  select: (taskIds, additive) =>
    set((s) => ({
      selectedTaskIds: additive
        ? Array.from(new Set([...s.selectedTaskIds, ...taskIds]))
        : taskIds,
    })),
  setActiveCell: (activeCell) => set({ activeCell }),
  setEditingCell: (editingCell) => set({ editingCell }),
  toggleCollapse: (taskId) =>
    set((s) => {
      const next = new Set(s.collapsedSummaries);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return { collapsedSummaries: next };
    }),
  setZoom: (zoom) => set({ zoom: Math.min(120, Math.max(6, zoom)) }),
  setSplitRatio: (splitRatio) => set({ splitRatio: Math.min(0.8, Math.max(0.15, splitRatio)) }),
  setFlag: (flag, v) => set({ [flag]: v } as unknown as Partial<ScheduleState>),
  setLabelMode: (labelMode) => set({ labelMode }),
  setStatus: (statusMessage) => set({ statusMessage }),

  applyAuthoritative: (res) => {
    // Apply the authoritative response, then resync fully with the server copy
    set({ statusMessage: `Recalculated — schedule v${res.scheduleVersion ?? '?'}` });
    void get().refresh();
  },

  updateTask: async (taskId, changes, label = 'Edit task') => {
    const { payload } = get();
    const before = payload?.tasks.find((t) => t.id === taskId);
    const version = payload?.scheduleVersion;
    const inverse: Record<string, unknown> = {};
    for (const k of Object.keys(changes)) {
      (inverse as Record<string, unknown>)[k] = (before as unknown as Record<string, unknown>)?.[k] ?? null;
    }
    try {
      const res = await api.patch<MutationResult>(`/api/tasks/${taskId}`, {
        ...changes,
        expectedScheduleVersion: version,
      });
      get().applyAuthoritative(res);
      if (res.warnings) set({ warnings: res.warnings });
      get().pushCommand({
        label,
        undo: async () => {
          await api.patch(`/api/tasks/${taskId}`, inverse);
          await get().refresh();
        },
        redo: async () => {
          await api.patch(`/api/tasks/${taskId}`, changes);
          await get().refresh();
        },
      });
      return res;
    } catch (e) {
      set({ statusMessage: `Error: ${errText(e)}`, error: e instanceof ApiError && e.status === 409 ? errText(e) : null });
      if (e instanceof ApiError && e.status === 409) await get().refresh();
      throw e;
    }
  },

  createTask: async (afterTaskId, name = 'New task', extra = {}) => {
    const res = await api.post<MutationResult>(`/api/projects/${get().projectId}/tasks`, {
      name,
      afterTaskId,
      ...extra,
    });
    get().applyAuthoritative(res);
    if (res.task) {
      const newId = res.task.id;
      get().pushCommand({
        label: 'Insert task',
        undo: async () => {
          await api.del(`/api/tasks/${newId}`);
          await get().refresh();
        },
        redo: async () => {
          await api.post(`/api/projects/${get().projectId}/tasks`, { name, afterTaskId, ...extra });
          await get().refresh();
        },
      });
    }
    return res;
  },

  deleteTasks: async (taskIds) => {
    const { payload } = get();
    for (const id of taskIds) {
      const t = payload?.tasks.find((x) => x.id === id);
      if (!t) continue;
      await api.del(`/api/tasks/${id}`);
    }
    set({ statusMessage: `Deleted ${taskIds.length} task(s)`, selectedTaskIds: [] });
    await get().refresh();
  },

  indent: async (taskId) => {
    await api.post(`/api/tasks/${taskId}/indent`);
    await get().refresh();
  },

  outdent: async (taskId) => {
    await api.post(`/api/tasks/${taskId}/outdent`);
    await get().refresh();
  },

  moveRow: async (taskId, beforeTaskId) => {
    await api.post(`/api/tasks/${taskId}/move`, { beforeTaskId });
    await get().refresh();
  },

  link: async (predId, succId, type = 'FS') => {
    await api.post(`/api/tasks/${succId}/dependencies`, { predecessorId: predId, type });
    await get().refresh();
  },

  unlink: async (taskIds) => {
    const { payload } = get();
    if (!payload) return;
    const deps = payload.dependencies.filter((d) => taskIds.includes(d.predecessorId) && taskIds.includes(d.successorId));
    for (const d of deps) {
      await api.del(`/api/dependencies/${d.id}`);
    }
    await get().refresh();
  },

  updateDep: async (depId, changes) => {
    await api.patch(`/api/dependencies/${depId}`, changes);
    await get().refresh();
  },

  assignResource: async (taskId, resourceId, units) => {
    const res = await api.post<MutationResult>(`/api/tasks/${taskId}/assignments`, {
      resourceId,
      units,
    });
    get().applyAuthoritative(res);
    return res;
  },

  removeAssignment: async (assignmentId) => {
    await api.del(`/api/assignments/${assignmentId}`);
    await get().refresh();
  },

  recordProgress: async (taskId, body) => {
    const res = await api.post<MutationResult>(`/api/tasks/${taskId}/progress`, body);
    get().applyAuthoritative(res);
    return res;
  },

  pushCommand: (cmd) =>
    set((s) => ({ undoStack: [...s.undoStack.slice(-99), cmd], redoStack: [] })),

  undo: async () => {
    const stack = get().undoStack;
    const cmd = stack[stack.length - 1];
    if (!cmd) return;
    set({ undoStack: stack.slice(0, -1) });
    try {
      await cmd.undo();
      set({ statusMessage: `Undo: ${cmd.label}`, redoStack: [...get().redoStack, cmd] });
    } catch (e) {
      set({ statusMessage: `Undo failed: ${errText(e)}` });
    }
  },

  redo: async () => {
    const stack = get().redoStack;
    const cmd = stack[stack.length - 1];
    if (!cmd) return;
    set({ redoStack: stack.slice(0, -1) });
    try {
      await cmd.redo();
      set({ statusMessage: `Redo: ${cmd.label}`, undoStack: [...get().undoStack, cmd] });
    } catch (e) {
      set({ statusMessage: `Redo failed: ${errText(e)}` });
    }
  },
}));

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDuration } from '@pulse/engine';
import { Assignment, Dependency, Task } from './api';
import { fmtDur, fmtDate, parseDateInput } from './format';
import { ROW_H } from './coords';
import { useSchedule } from './store';

export { ROW_H };
const HEADER_H = 26;

export interface ColumnDef {
  key: string;
  label: string;
  width: number;
  type: 'indicator' | 'number' | 'text' | 'duration' | 'date' | 'pct' | 'preds' | 'resources';
  editable?: boolean;
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'ind', label: 'i', width: 22, type: 'indicator' },
  { key: 'id', label: 'ID', width: 34, type: 'number' },
  { key: 'mode', label: 'Task Mode', width: 46, type: 'text' },
  { key: 'name', label: 'Task Name', width: 260, type: 'text', editable: true },
  { key: 'duration', label: 'Duration', width: 66, type: 'duration', editable: true },
  { key: 'start', label: 'Start', width: 72, type: 'date', editable: true },
  { key: 'finish', label: 'Finish', width: 72, type: 'date', editable: true },
  { key: 'preds', label: 'Predecessors', width: 90, type: 'preds', editable: true },
  { key: 'resources', label: 'Resource Names', width: 130, type: 'resources' },
  { key: 'pct', label: '% Comp.', width: 52, type: 'pct', editable: true },
  { key: 'cost', label: 'Cost', width: 76, type: 'number' },
];

/** Visible tasks honouring collapsed summaries. */
export function visibleTasks(tasks: Task[], collapsed: Set<string>): { task: Task; index: number }[] {
  const sorted = [...tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const result: { task: Task; index: number }[] = [];
  const stack: { level: number; collapsed: boolean }[] = [];
  let displayIndex = 0;
  for (const t of sorted) {
    while (stack.length && stack[stack.length - 1].level >= t.outlineLevel) stack.pop();
    const parentHidden = stack.some((s) => s.collapsed);
    if (!parentHidden) {
      result.push({ task: t, index: displayIndex++ });
    }
    stack.push({ level: t.outlineLevel, collapsed: collapsed.has(t.id) });
  }
  return result;
}

export function predecessorsText(task: Task, tasks: Task[], deps: Dependency[]): string {
  const sorted = [...tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const idx = new Map(sorted.map((t, i) => [t.id, i + 1]));
  return deps
    .filter((d) => d.successorId === task.id)
    .map((d) => {
      const lag = d.lagMinutes ? (d.lagMinutes > 0 ? '+' : '') + Math.round((d.lagMinutes / 480) * 10) / 10 + 'd' : '';
      return `${idx.get(d.predecessorId) ?? '?'}${d.type}${lag}`;
    })
    .join(',');
}

function resourcesText(task: Task, assignments: Assignment[], resources: { id: string; name: string; initials: string | null }[]): string {
  const byId = new Map(resources.map((r) => [r.id, r]));
  return assignments
    .filter((a) => a.taskId === task.id)
    .map((a) => {
      const r = byId.get(a.resourceId);
      if (!r) return '';
      const units = a.units !== 1 ? `[${Math.round(a.units * 100)}%]` : '';
      return `${r.name}${units}`;
    })
    .filter(Boolean)
    .join(', ');
}

/* ================================================================ Grid */

export function Grid({ onContextMenu }: { onContextMenu?: (e: React.MouseEvent, taskId: string) => void }) {
  const st = useSchedule();
  const payload = st.payload!;
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [width, setWidth] = useState(900);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(DEFAULT_COLUMNS.map((c) => [c.key, c.width])),
  );
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight);
      setWidth(el.clientWidth);
    });
    ro.observe(el);
    setHeight(el.clientHeight);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { key, startX, startW } = resizeRef.current;
      setColWidths((w) => ({ ...w, [key]: Math.max(28, startW + e.clientX - startX) }));
    };
    const up = () => (resizeRef.current = null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const mpd = payload.project.minutesPerDay;
  const rows = useMemo(
    () => visibleTasks(payload.tasks, st.collapsedSummaries),
    [payload.tasks, st.collapsedSummaries],
  );

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 4);
  const visible = rows.slice(first, last);
  const totalW = DEFAULT_COLUMNS.reduce((s, c) => s + (colWidths[c.key] ?? c.width), 0);
  const byId = new Map(payload.tasks.map((t) => [t.id, t]));
  const sortedAll = useMemo(() => [...payload.tasks].sort((a, b) => a.rowOrder - b.rowOrder), [payload.tasks]);

  return (
    <div
      className="grid-root"
      tabIndex={0}
      onKeyDown={(e) => {
        const { activeCell } = st;
        if (!activeCell || st.editingCell) return;
        const idx = rows.findIndex((r) => r.task.id === activeCell.taskId);
        const colIdx = DEFAULT_COLUMNS.findIndex((c) => c.key === activeCell.column);
        if (e.key === 'ArrowDown' && idx < rows.length - 1) {
          e.preventDefault();
          st.setActiveCell({ taskId: rows[idx + 1].task.id, column: activeCell.column });
        } else if (e.key === 'ArrowUp' && idx > 0) {
          e.preventDefault();
          st.setActiveCell({ taskId: rows[idx - 1].task.id, column: activeCell.column });
        } else if (e.key === 'ArrowRight' && colIdx < DEFAULT_COLUMNS.length - 1) {
          e.preventDefault();
          st.setActiveCell({ taskId: activeCell.taskId, column: DEFAULT_COLUMNS[colIdx + 1].key });
        } else if (e.key === 'ArrowLeft' && colIdx > 0) {
          e.preventDefault();
          st.setActiveCell({ taskId: activeCell.taskId, column: DEFAULT_COLUMNS[colIdx - 1].key });
        }
      }}
    >
      <div className="grid-header-row" style={{ width: Math.max(totalW, width) }}>
        {DEFAULT_COLUMNS.map((c) => (
          <div key={c.key} className="ghcell" style={{ width: colWidths[c.key] ?? c.width }}>
            <span>{c.label}</span>
            {c.key !== 'ind' && (
              <span
                className="resizer"
                onMouseDown={(e) => {
                  resizeRef.current = { key: c.key, startX: e.clientX, startW: colWidths[c.key] ?? c.width };
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div
        className="grid-body"
        ref={bodyRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onScrollCapture={() => {
          document.dispatchEvent(new CustomEvent('pulse:grid-scroll', { detail: bodyRef.current?.scrollTop ?? 0 }));
        }}
      >
        <div style={{ height: rows.length * ROW_H, width: Math.max(totalW, width), position: 'relative' }}>
          {visible.map(({ task, index }) => {
            const isSel = st.selectedTaskIds.includes(task.id);
            const isActive = st.activeCell?.taskId === task.id;
            return (
              <div
                key={task.id}
                className={`grid-row ${isSel ? 'selected' : ''} ${task.computedIsSummary ? 'summary-row' : ''} ${task.computedIsCritical && st.showCritical ? 'critical-row' : ''} ${task.computedIsMilestone ? 'milestone-row' : ''}`}
                style={{ top: index * ROW_H }}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest('.twist')) return;
                  if (e.shiftKey || e.ctrlKey || e.metaKey) st.select([task.id], true);
                  else st.select([task.id]);
                  // The clicked CELL becomes the active cell (column included),
                  // so typing always edits what the user clicked.
                  const cellEl = (e.target as HTMLElement).closest('.gcell');
                  const colKey = cellEl?.getAttribute('data-col');
                  st.setActiveCell({ taskId: task.id, column: colKey ?? 'name' });
                }}
                onDoubleClick={() => st.setDialog({ kind: 'task-info', taskId: task.id })}
                onContextMenu={(e) => {
                  if (!isSel) st.select([task.id]);
                  onContextMenu?.(e, task.id);
                }}
              >
                {DEFAULT_COLUMNS.map((c) => {
                  const editing = st.editingCell?.taskId === task.id && st.editingCell.column === c.key;
                  const cellCls = `gcell ${c.type === 'number' || c.type === 'pct' ? 'num' : ''} ${c.key === 'name' ? 'tname' : ''} ${editing ? 'input-active' : ''}`;
                  const style = { width: colWidths[c.key] ?? c.width };
                  const dataCol = c.key;
                  if (c.key === 'ind') {
                    return (
                      <div key={c.key} className={cellCls} style={style} data-col={dataCol}>
                        {task.computedIsCritical && st.showCritical ? <span className="icon-warn" /> : null}
                        {task.notes ? <span className="icon-flag" /> : null}
                      </div>
                    );
                  }
                  if (editing) {
                    return (
                      <div key={c.key} className={cellCls} style={style} data-col={dataCol}>
                        <CellEditor task={task} column={c} />
                      </div>
                    );
                  }
                  switch (c.key) {
                    case 'id':
                      return <div key={c.key} className={cellCls} style={style} data-col={dataCol}>{task.wbs ?? ''}</div>;
                    case 'mode':
                      return (
                        <div key={c.key} className={cellCls} style={style} data-col={dataCol}>
                          <span className="modeicon">{task.mode === 'manual' ? '📌' : '⚙'}</span>
                          {task.mode === 'manual' ? 'Manual' : 'Auto'}
                        </div>
                      );
                    case 'name': {
                      const hasChildren = sortedAll.some((t2) => t2.rowOrder > task.rowOrder && t2.outlineLevel > task.outlineLevel);
                      const collapsed = st.collapsedSummaries.has(task.id);
                      return (
                        <div key={c.key} className={cellCls} style={{ ...style, paddingLeft: 6 + task.outlineLevel * 14 }}>
                          {hasChildren ? (
                            <span
                              className="twist"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                st.toggleCollapse(task.id);
                              }}
                            >
                              {collapsed ? '▶' : '▼'}
                            </span>
                          ) : (
                            <span style={{ display: 'inline-block', width: 13, flex: '0 0 13px' }} />
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</span>
                          {task.notes ? <span className="notesicon">🗒</span> : null}
                        </div>
                      );
                    }
                    case 'duration':
                      return (
                        <div key={c.key} className={`${cellCls} duration-edit`} style={style} data-col={dataCol}>
                          {fmtDur(task.computedDuration ?? task.durationMinutes, {
                            minutesPerDay: mpd,
                            minutesPerWeek: payload.project.minutesPerWeek,
                            daysPerMonth: payload.project.daysPerMonth,
                          })}
                        </div>
                      );
                    case 'start':
                      return <div key={c.key} className={cellCls} style={style} data-col={dataCol}>{fmtDate(task.mode === 'manual' && task.manualStart ? task.manualStart : task.computedStart)}</div>;
                    case 'finish':
                      return <div key={c.key} className={cellCls} style={style} data-col={dataCol}>{fmtDate(task.mode === 'manual' && task.manualFinish ? task.manualFinish : task.computedFinish)}</div>;
                    case 'preds':
                      return <div key={c.key} className={cellCls} style={style} data-col={dataCol}>{predecessorsText(task, sortedAll, payload.dependencies)}</div>;
                    case 'resources':
                      return <div key={c.key} className={cellCls} style={style} data-col={dataCol}>{resourcesText(task, payload.assignments, payload.resources)}</div>;
                    case 'pct':
                      return <div key={c.key} className={cellCls} style={style} data-col={dataCol}>{Math.round(task.computedPercentComplete ?? task.percentComplete)}%</div>;
                    case 'cost':
                      return (
                        <div key={c.key} className={cellCls} style={style} data-col={dataCol}>
                          {(task.computedPlannedCost ?? 0) > 0
                            ? (task.computedPlannedCost ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
                            : ''}
                        </div>
                      );
                    default:
                      return <div key={c.key} className={cellCls} style={style} />;
                  }
                })}
              </div>
            );
          })}
        </div>
        <AddRow lastTaskId={sortedAll[sortedAll.length - 1]?.id ?? null} />
      </div>
    </div>
  );
}

/* ------------------------------- cell editor */

function CellEditor({ task, column }: { task: Task; column: ColumnDef }) {
  const st = useSchedule();
  const payload = st.payload!;
  const mpd = payload.project.minutesPerDay;
  const sortedAll = [...payload.tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => {
    switch (column.key) {
      case 'name':
        return task.name;
      case 'duration':
        return fmtDur(task.computedDuration ?? task.durationMinutes, {
          minutesPerDay: mpd,
          minutesPerWeek: payload.project.minutesPerWeek,
          daysPerMonth: payload.project.daysPerMonth,
        });
      case 'start':
        return fmtDate(task.computedStart);
      case 'finish':
        return fmtDate(task.computedFinish);
      case 'pct':
        return String(Math.round(task.computedPercentComplete ?? task.percentComplete));
      case 'preds':
        return predecessorsText(task, sortedAll, payload.dependencies);
      default:
        return '';
    }
  });

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    // The completing click can collapse the selection after focus; re-assert it
    // on the next frame so typing REPLACES the cell content instead of appending.
    const raf = requestAnimationFrame(() => ref.current?.select());
    return () => cancelAnimationFrame(raf);
  }, []);

  const commit = async () => {
    try {
      switch (column.key) {
        case 'name':
          if (value !== task.name) await st.updateTask(task.id, { name: value }, 'Rename task');
          break;
        case 'duration': {
          const parsed = parseDuration(value || '1d', {
            minutesPerDay: mpd,
            minutesPerWeek: payload.project.minutesPerWeek,
            daysPerMonth: payload.project.daysPerMonth,
          });
          await st.updateTask(task.id, { durationMinutes: parsed.minutes }, 'Change duration');
          break;
        }
        case 'start': {
          const d = parseDateInput(value);
          if (d) {
            if (task.mode === 'manual') await st.updateTask(task.id, { manualStart: d.toISOString() }, 'Set manual start');
            else await st.updateTask(task.id, { constraintType: 'SNET', constraintDate: d.toISOString() }, 'Set start (SNET)');
          }
          break;
        }
        case 'finish': {
          const d = parseDateInput(value);
          if (d) {
            if (task.mode === 'manual') await st.updateTask(task.id, { manualFinish: d.toISOString() }, 'Set manual finish');
            else await st.updateTask(task.id, { constraintType: 'FNET', constraintDate: d.toISOString() }, 'Set finish (FNET)');
          }
          break;
        }
        case 'pct': {
          const pct = Math.max(0, Math.min(100, Number(value) || 0));
          await st.updateTask(task.id, { percentComplete: pct }, 'Set % complete');
          break;
        }
        case 'preds': {
          await applyPredecessors(task, value, sortedAll, payload.dependencies, st);
          break;
        }
        default:
          break;
      }
    } catch {
      /* leave cell without change */
    }
    st.setEditingCell(null);
  };

  return (
    <input
      ref={ref}
      className="cell-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') st.setEditingCell(null);
      }}
    />
  );
}

export async function applyPredecessors(
  task: Task,
  text: string,
  sortedAll: Task[],
  currentDeps: Dependency[],
  st: ReturnType<typeof useSchedule.getState>,
): Promise<void> {
  const api = (await import('./api')).api;
  const index = new Map(sortedAll.map((t, i) => [t.id, i + 1]));
  const wanted: { predId: string; type: string; lag: number }[] = [];
  for (const part of text.split(/[,;]/)) {
    const m = /^\s*(\d+)(FS|SS|FF|SF)?\s*(?:([+-]?\d+(?:\.\d+)?)\s*d(?:ays?)?)?\s*$/i.exec(part);
    if (!m) continue;
    const n = Number(m[1]);
    const pred = sortedAll[n - 1];
    if (!pred || pred.id === task.id) continue;
    wanted.push({
      predId: pred.id,
      type: (m[2] ?? 'FS').toUpperCase(),
      lag: m[3] ? Math.round(parseFloat(m[3]) * 480) : 0,
    });
  }
  const current = currentDeps.filter((d) => d.successorId === task.id);
  const wantedKeys = new Set(wanted.map((w) => w.predId));
  for (const d of current) {
    if (!wantedKeys.has(d.predecessorId)) {
      await api.del(`/api/dependencies/${d.id}`);
    }
  }
  for (const w of wanted) {
    const existing = current.find((d) => d.predecessorId === w.predId);
    if (existing) {
      if (existing.type !== w.type || existing.lagMinutes !== w.lag) {
        await api.patch(`/api/dependencies/${existing.id}`, { type: w.type, lagMinutes: w.lag });
      }
    } else {
      await api.post(`/api/tasks/${task.id}/dependencies`, {
        predecessorId: w.predId,
        type: w.type,
        lagMinutes: w.lag,
      });
    }
  }
  await st.refresh();
  void index;
}

/* ------------------------------- add-row (type to create) */

function AddRow({ lastTaskId }: { lastTaskId: string | null }) {
  const st = useSchedule();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await st.createTask(lastTaskId, n);
      setName('');
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="grid-addrow"
      style={{ position: 'sticky', bottom: 0 }}
      onClick={() => ref.current?.focus()}
    >
      ＋
      <input
        ref={ref}
        value={name}
        placeholder="type a task name and press Enter…"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') setName('');
        }}
        style={{ border: 'none', outline: 'none', font: 'inherit', background: 'transparent', flex: 1, marginLeft: 6, color: 'inherit' }}
      />
    </div>
  );
}

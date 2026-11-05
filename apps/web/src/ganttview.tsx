import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid } from './grid';
import { Timeline } from './timeline';
import { useSchedule } from './store';
import { api } from './api';
import { fmtDate } from './format';

/* ================================================================ GanttView */

export function GanttView({ tracking = false }: { tracking?: boolean }) {
  const st = useSchedule();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(1400);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [baselineByTask, setBaselineByTask] = useState<Map<string, { start: string; finish: string }> | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // baseline overlay for tracking gantt / showBaseline flag
  const currentBaseline = st.payload?.baselines.find((b) => b.isCurrent) ?? st.payload?.baselines[0];
  useEffect(() => {
    const want = tracking || st.showBaseline;
    if (!want || !currentBaseline) {
      setBaselineByTask(null);
      return;
    }
    let alive = true;
    api
      .get<{ rows: { taskId: string; baselineStart: string; baselineFinish: string }[] }>(`/api/baselines/${currentBaseline.id}/compare`)
      .then((res) => {
        if (!alive) return;
        const m = new Map<string, { start: string; finish: string }>();
        for (const r of res.rows) m.set(r.taskId, { start: r.baselineStart, finish: r.baselineFinish });
        setBaselineByTask(m);
      })
      .catch(() => setBaselineByTask(null));
    return () => {
      alive = false;
    };
  }, [currentBaseline, tracking, st.showBaseline, st.payload?.scheduleVersion]);

  useEffect(() => {
    const close = () => setMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const gridW = Math.round(wrapW * st.splitRatio);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const start = st.splitRatio;
    const move = (ev: MouseEvent) => {
      st.setSplitRatio(start + (ev.clientX - startX) / wrapW);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const selTask = st.payload?.tasks.find((t) => t.id === menu?.taskId);
  const sortedAll = useMemo(
    () => [...(st.payload?.tasks ?? [])].sort((a, b) => a.rowOrder - b.rowOrder),
    [st.payload?.tasks],
  );

  return (
    <div ref={wrapRef} style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%' }}>
      <div style={{ width: gridW, minWidth: 120, overflow: 'hidden' }}>
        <Grid
          onContextMenu={(e, taskId) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, taskId });
          }}
        />
      </div>
      <div className={`splitter ${dragging ? 'drag' : ''}`} onMouseDown={startDrag} title="Drag to resize" />
      <div style={{ flex: 1, minWidth: 60 }}>
        <Timeline baselineByTask={baselineByTask} />
      </div>

      {menu && selTask && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="mi" onMouseDown={() => st.setDialog({ kind: 'task-info', taskId: selTask.id })}>
            <span>Task Information…</span><span className="ks">Shift+F2</span>
          </div>
          <div className="mi" onMouseDown={() => st.setDialog({ kind: 'assign', taskId: selTask.id })}>
            <span>Assign Resources…</span><span className="ks">Alt+F10</span>
          </div>
          <div className="mi" onMouseDown={() => st.setDialog({ kind: 'progress', taskId: selTask.id })}>
            <span>Update Progress…</span>
          </div>
          <div className="sep" />
          <div className="mi" onMouseDown={() => void st.createTask(selTask.id)}>
            <span>Insert Task Below</span><span className="ks">Ins</span>
          </div>
          <div className="mi" onMouseDown={() => void st.indent(selTask.id)}>
            <span>Indent Task</span><span className="ks">Alt+Shift+→</span>
          </div>
          <div className="mi" onMouseDown={() => void st.outdent(selTask.id)}>
            <span>Outdent Task</span><span className="ks">Alt+Shift+←</span>
          </div>
          <div className="sep" />
          <div className="mi" onMouseDown={() => void st.updateTask(selTask.id, { mode: selTask.mode === 'manual' ? 'auto' : 'manual' }, 'Toggle task mode')}>
            <span>{selTask.mode === 'manual' ? 'Schedule Automatically' : 'Schedule Manually'}</span>
          </div>
          {selTask.constraintType && selTask.constraintType !== 'ASAP' ? (
            <div className="mi" onMouseDown={() => void st.updateTask(selTask.id, { constraintType: 'ASAP', constraintDate: null }, 'Clear constraint')}>
              <span>Clear Constraint ({selTask.constraintType} {fmtDate(selTask.constraintDate)})</span>
            </div>
          ) : null}
          <div className="mi" onMouseDown={() => void st.updateTask(selTask.id, { levelingDelayMinutes: 0 }, 'Clear leveling delay')}>
            <span>Clear Leveling Delay</span>
          </div>
          <div className="sep" />
          <div className="mi" onMouseDown={() => void st.deleteTasks([selTask.id])}>
            <span>Delete Task</span><span className="ks">Del</span>
          </div>
          <div className="sep" />
          <div className="mi disabled"><span>ID: {selTask.id.slice(0, 8)}…</span></div>
          <div className="mi disabled"><span>Row: {sortedAll.findIndex((t) => t.id === selTask.id) + 1}</span></div>
        </div>
      )}
    </div>
  );
}

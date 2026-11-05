import { useEffect, useMemo, useRef, useState } from 'react';
import { Dependency, Task } from './api';
import {
  BAR_H,
  BAR_TOP_OFFSET,
  ROW_H,
  barGeometry,
  connectorEndpoints,
  connectorPath,
  dateOfX,
  diamondPath,
  gridlineDates,
  makeScale,
  monthTicks,
  xOf,
} from './coords';
import { fmtDateLong, fmtDur, fmtFloat, dateKey, addDays } from './format';
import { visibleTasks } from './grid';
import { useSchedule } from './store';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ================================================================ Timeline
   One shared task list (visibleTasks) and one coordinate module (coords.ts)
   drive both panels, so rows cannot drift. Bars live in a single SVG layer;
   links + gridlines in another beneath it — no per-row SVG stacking games.
   ========================================================================== */

export function Timeline({ baselineByTask }: { baselineByTask: Map<string, { start: string; finish: string }> | null }) {
  const st = useSchedule();
  const payload = st.payload!;
  const cal = payload.calendars.find((c) => c.id === payload.settings.defaultCalendarId) ?? payload.calendars[0];
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerInner = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewW, setViewW] = useState(1200);
  const [height, setHeight] = useState(600);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; task: Task } | null>(null);
  const [linkDrag, setLinkDrag] = useState<{ fromTask: string; x: number; y: number } | null>(null);
  const [dragGhost, setDragGhost] = useState<{ taskId: string; deltaDays: number } | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize-l' | 'resize-r'; taskId: string; startX: number } | null>(null);

  const pxPerDay = st.zoom;
  const rows = useMemo(
    () => visibleTasks(payload.tasks, st.collapsedSummaries),
    [payload.tasks, st.collapsedSummaries],
  );
  const rowIndexById = useMemo(
    () => new Map(rows.map((r, i) => [r.task.id, i])),
    [rows],
  );

  const [minDate, maxDate] = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    for (const t of payload.tasks) {
      const s = new Date(t.computedStart ?? t.manualStart ?? Date.now());
      const f = new Date(t.computedFinish ?? t.manualFinish ?? s);
      if (!min || s < min) min = s;
      if (!max || f > max) max = f;
    }
    if (baselineByTask) {
      for (const b of baselineByTask.values()) {
        const s = new Date(b.start);
        const f = new Date(b.finish);
        if (!min || s < min) min = s;
        if (!max || f > max) max = f;
      }
    }
    if (!min) min = new Date();
    if (!max) max = addDays(min, 30);
    min = new Date(Math.floor(min.getTime() / 86400000) * 86400000);
    max = addDays(max, 14);
    if (max.getTime() - min.getTime() < 45 * 86400000) max = addDays(min, 60);
    return [min, max];
  }, [payload.tasks, baselineByTask]);

  const scale = useMemo(() => makeScale(minDate.getTime(), pxPerDay), [minDate, pxPerDay]);
  const totalW = (maxDate.getTime() - minDate.getTime()) / scale.msPerPx;
  const canvasH = rows.length * ROW_H + 60;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewW(el.clientWidth);
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    setViewW(el.clientWidth);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Vertical scroll sync: grid drives, timeline follows (and vice versa).
  useEffect(() => {
    const handler = (e: Event) => {
      const top = (e as CustomEvent<number>).detail;
      if (bodyRef.current) bodyRef.current.scrollTop = top;
    };
    document.addEventListener('pulse:grid-scroll', handler);
    return () => document.removeEventListener('pulse:grid-scroll', handler);
  }, []);

  // Go To Task: bring the row and its dates into view.
  useEffect(() => {
    const handler = (e: Event) => {
      const taskId = (e as CustomEvent<string>).detail;
      const el = bodyRef.current;
      const row = rows.findIndex((r) => r.task.id === taskId);
      const t = payload.tasks.find((x) => x.id === taskId);
      if (row < 0 || !t || !el) return;
      el.scrollTop = Math.max(0, row * ROW_H - el.clientHeight / 2);
      const x = xOf(scale, new Date(t.computedStart ?? Date.now()).getTime()) - el.scrollLeft;
      if (x < 80 || x > el.clientWidth - 140) {
        el.scrollLeft = Math.max(0, xOf(scale, new Date(t.computedStart ?? Date.now()).getTime()) - el.clientWidth / 2);
      }
    };
    document.addEventListener('pulse:scroll-to-task', handler);
    return () => document.removeEventListener('pulse:scroll-to-task', handler);
  }, [rows, payload.tasks, scale]);

  // Fit Project: choose a zoom that shows the whole programme.
  useEffect(() => {
    const handler = () => {
      const el = bodyRef.current;
      if (!el) return;
      const spanDays = (maxDate.getTime() - minDate.getTime()) / 86400000;
      st.setZoom(Math.max(6, Math.min(120, (el.clientWidth - 40) / spanDays)));
      el.scrollLeft = 0;
      setScrollLeft(0);
    };
    document.addEventListener('pulse:fit-project', handler);
    return () => document.removeEventListener('pulse:fit-project', handler);
  }, [minDate, maxDate, st]);

  // Visible day window (for gridlines + shading) — content coords.
  const viewLeftContent = scrollLeft;
  const viewRightContent = scrollLeft + viewW;
  const fromMs = dateOfX(scale, Math.max(0, viewLeftContent - 3 * pxPerDay)).getTime();
  const toMs = dateOfX(scale, viewRightContent + 3 * pxPerDay).getTime();

  const gridlines = useMemo(() => gridlineDates(fromMs, toMs, pxPerDay), [fromMs, toMs, pxPerDay]);

  const nonWorking = useMemo(() => {
    const out: { left: number; w: number; label: string | null }[] = [];
    if (!cal) return out;
    const workingDows = new Set(cal.workingDays.map((d) => d.dayOfWeek));
    const holidays = new Map(cal.exceptions.map((e) => [e.date, e.label]));
    let ms = Math.floor(fromMs / 86400000) * 86400000;
    while (ms <= toMs) {
      const d = new Date(ms);
      const key = dateKey(d);
      const holiday = holidays.get(key);
      if (holiday !== undefined || !workingDows.has(d.getUTCDay())) {
        out.push({
          left: xOf(scale, ms),
          w: pxPerDay,
          label: holiday ?? null,
        });
      }
      ms += 86400000;
    }
    return out;
  }, [cal, fromMs, toMs, scale, pxPerDay]);

  const rowsFirst = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const rowsLast = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 4);
  const visible = rows.slice(rowsFirst, rowsLast);

  // Drag handling (move / resize / create-link)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (linkDrag) {
        setLinkDrag({ ...linkDrag, x: e.clientX, y: e.clientY });
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      setDragGhost({ taskId: d.taskId, deltaDays: Math.round((e.clientX - d.startX) / pxPerDay) });
    };
    const up = async (e: MouseEvent) => {
      const d = dragRef.current;
      const ld = linkDrag;
      dragRef.current = null;
      setLinkDrag(null);
      setDragGhost(null);
      if (d && Math.abs(e.clientX - d.startX) >= pxPerDay * 0.5) {
        const days = Math.round((e.clientX - d.startX) / pxPerDay);
        const t = payload.tasks.find((x) => x.id === d.taskId);
        if (t && days !== 0 && !t.computedIsSummary) {
          if (d.mode === 'move') {
            const base = t.mode === 'manual' ? t.manualStart : t.computedStart;
            const newStart = addDays(new Date(base ?? Date.now()), days);
            const changes = t.mode === 'manual'
              ? { manualStart: newStart.toISOString() }
              : { constraintType: 'SNET', constraintDate: newStart.toISOString() };
            void st.updateTask(t.id, changes, 'Move task');
          } else {
            const sign = d.mode === 'resize-r' ? 1 : -1;
            const dur = Math.max(0, t.durationMinutes + sign * days * payload.project.minutesPerDay);
            void st.updateTask(t.id, { durationMinutes: dur }, 'Resize task');
          }
        }
      }
      if (ld) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const rowEl = (el as HTMLElement)?.closest('[data-gantt-row]');
        const target = rowEl?.getAttribute('data-gantt-row');
        if (target && target !== ld.fromTask) {
          const fromIdx = rowIndexById.get(ld.fromTask) ?? -1;
          const toIdx = rowIndexById.get(target) ?? -1;
          if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
            if (fromIdx < toIdx) await st.link(ld.fromTask, target);
            else await st.link(target, ld.fromTask);
          }
        }
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [linkDrag, pxPerDay, payload, rows, rowIndexById, st]);

  const todayMs = new Date(`${dateKey(new Date())}T00:00:00Z`).getTime();
  const statusMs = payload.project.statusDate
    ? new Date(`${dateKey(new Date(payload.project.statusDate))}T00:00:00Z`).getTime()
    : null;
  const mpd = payload.project.minutesPerDay;
  const resNameByAssignment = useMemo(() => {
    const resById = new Map(payload.resources.map((r) => [r.id, r.name]));
    const byTask = new Map<string, string[]>();
    for (const a of payload.assignments) {
      const n = resById.get(a.resourceId);
      if (!n) continue;
      if (!byTask.has(a.taskId)) byTask.set(a.taskId, []);
      byTask.get(a.taskId)!.push(n + (a.units !== 1 ? ` [${Math.round(a.units * 100)}%]` : ''));
    }
    return byTask;
  }, [payload.resources, payload.assignments]);

  return (
    <div className="timeline-root" tabIndex={0}>
      <div className="timeline-header" style={{ overflow: 'hidden' }}>
        <div ref={headerInner} style={{ transform: `translateX(${-scrollLeft}px)`, width: totalW, height: '100%' }}>
          <Timescale scale={scale} totalW={totalW} fromMs={fromMs} toMs={toMs} pxPerDay={pxPerDay} />
        </div>
      </div>
      <div
        className={`timeline-body ${linkDrag ? 'linking' : ''}`}
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
          setScrollLeft(el.scrollLeft);
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            st.setZoom(st.zoom * (e.deltaY < 0 ? 1.15 : 0.87));
          }
        }}
      >
        <div style={{ width: totalW, height: canvasH, position: 'relative' }} className="gantt-canvas">
          {/* Layer 1: non-working shading */}
          {nonWorking.map((s) => (
            <div
              key={s.left}
              style={{
                position: 'absolute', left: s.left, top: 0, width: s.w, height: canvasH,
                background: s.label ? 'var(--holiday)' : 'var(--weekend)',
                pointerEvents: 'none',
              }}
              title={s.label ?? undefined}
            />
          ))}

          {/* Layer 2: gridlines + dependency connectors (single SVG) */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }} shapeRendering="crispEdges">
            <defs>
              <marker id="pulse-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="link-arrow" />
              </marker>
            </defs>
            {gridlines.map((d) => (
              <line
                key={d.getTime()}
                x1={xOf(scale, d.getTime())} x2={xOf(scale, d.getTime())}
                y1={0} y2={canvasH}
                stroke="var(--grid-line)" strokeWidth={d.getUTCDate() === 1 ? 1 : 0.5}
                strokeDasharray={d.getUTCDate() === 1 ? undefined : '2 3'}
              />
            ))}
          </svg>

          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {payload.dependencies.map((dep) => {
              const predRow = rowIndexById.get(dep.predecessorId);
              const succRow = rowIndexById.get(dep.successorId);
              const pred = payload.tasks.find((t) => t.id === dep.predecessorId);
              const succ = payload.tasks.find((t) => t.id === dep.successorId);
              if (predRow === undefined || succRow === undefined || !pred || !succ) return null; // hidden by collapse
              const { fromFinish, toStart } = connectorEndpoints(dep.type);
              const pg = barGeometry(
                scale,
                predRow,
                new Date(pred.computedStart ?? 0).getTime(),
                new Date(pred.computedFinish ?? 0).getTime(),
              );
              const sg = barGeometry(
                scale,
                succRow,
                new Date(succ.computedStart ?? 0).getTime(),
                new Date(succ.computedFinish ?? 0).getTime(),
              );
              const fx = fromFinish ? pg.x2 : pg.x1;
              const tx = toStart ? sg.x1 : sg.x2;
              const highlight = st.selectedTaskIds.includes(pred.id) || st.selectedTaskIds.includes(succ.id);
              return (
                <g key={dep.id}>
                  <path
                    className="link-hit"
                    d={connectorPath(fx, pg.cy, tx, sg.cy, toStart)}
                    onClick={() => st.setDialog({ kind: 'dep', depId: dep.id })}
                  />
                  <path
                    className="link-line"
                    d={connectorPath(fx, pg.cy, tx, sg.cy, toStart)}
                    markerEnd="url(#pulse-arrow)"
                    stroke={highlight ? '#2b579a' : undefined}
                    strokeWidth={highlight ? 1.6 : undefined}
                    onClick={() => st.setDialog({ kind: 'dep', depId: dep.id })}
                    style={{ cursor: 'pointer' }}
                  />
                  {dep.lagMinutes !== 0 && (
                    <text
                      className="link-label"
                      x={(fx + tx) / 2}
                      y={(pg.cy + sg.cy) / 2 - 3}
                      textAnchor="middle"
                      style={{ pointerEvents: 'none' }}
                    >
                      {dep.lagMinutes > 0 ? '+' : ''}{Math.round((dep.lagMinutes / mpd) * 10) / 10}d
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Layer 3: bars (single SVG) */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {visible.map(({ task, index }) => {
              const startMs = (task.computedStart ? new Date(task.computedStart).getTime() : 0) + (dragGhost?.taskId === task.id ? dragGhost.deltaDays * 86400000 : 0);
              const finishMs = (task.computedFinish ? new Date(task.computedFinish).getTime() : 0) + (dragGhost?.taskId === task.id ? dragGhost.deltaDays * 86400000 : 0);
              const g = barGeometry(scale, index, startMs, finishMs);
              const critical = st.showCritical && task.computedIsCritical;
              const pct = task.computedPercentComplete ?? 0;
              const floatDays = task.computedTotalFloat != null ? task.computedTotalFloat / mpd : 0;
              const bl = baselineByTask?.get(task.id) ?? null;
              const isSel = st.selectedTaskIds.includes(task.id);
              const fill = critical ? 'var(--bar-critical)' : 'var(--bar-task)';
              const stroke = critical ? '#9c2020' : '#1e4f8c';

              const barEvents = {
                onMouseDown: (e: React.MouseEvent) => {
                  e.stopPropagation();
                  st.select([task.id], e.ctrlKey || e.metaKey || e.shiftKey);
                  dragRef.current = { mode: 'move' as const, taskId: task.id, startX: e.clientX };
                },
                onDoubleClick: (e: React.MouseEvent) => {
                  e.stopPropagation();
                  st.setDialog({ kind: 'task-info', taskId: task.id });
                },
                onMouseEnter: (e: React.MouseEvent) => setTooltip({ x: e.clientX, y: e.clientY, task }),
                onMouseMove: (e: React.MouseEvent) => setTooltip({ x: e.clientX, y: e.clientY, task }),
                onMouseLeave: () => setTooltip(null),
              };

              return (
                <g key={task.id}>
                  {/* invisible row hit-area keeps selection/links working on empty rows */}
                  <rect
                    x={0} y={index * ROW_H} width={totalW} height={ROW_H}
                    fill="transparent"
                    data-gantt-row={task.id}
                    style={{ cursor: 'default' }}
                    onMouseDown={(e) => st.select([task.id], e.ctrlKey || e.metaKey || e.shiftKey)}
                    onDoubleClick={() => st.setDialog({ kind: 'task-info', taskId: task.id })}
                  />

                  {bl && !task.computedIsMilestone && (
                    <rect
                      fill="var(--bar-baseline)"
                      x={xOf(scale, new Date(bl.start).getTime())}
                      y={g.y + BAR_H + 1}
                      width={Math.max(3, xOf(scale, new Date(bl.finish).getTime()) - xOf(scale, new Date(bl.start).getTime()))}
                      height={3}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  {st.showSlack && floatDays > 0 && !task.computedIsSummary && !task.computedIsMilestone && (
                    <rect
                      x={g.x2} y={g.y + BAR_H - 2}
                      width={Math.max(0, xOf(scale, finishMs + floatDays * mpd * 60000) - g.x2)}
                      height={2}
                      fill="var(--bar-baseline)"
                      opacity={0.9}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  {task.computedIsSummary ? (
                    <g className="bar-summary" style={{ pointerEvents: 'none' }}>
                      <rect className="sum-body" x={g.x1} y={g.y + 3} width={Math.max(4, g.width)} height={5} />
                      <polygon className="sum-cap" points={`${g.x1},${g.y + 3} ${g.x1 - 6},${g.y + 3} ${g.x1},${g.y + 11} ${g.x1 - 6},${g.y + 11}`} />
                      <polygon className="sum-cap" points={`${g.x2},${g.y + 3} ${g.x2 + 6},${g.y + 3} ${g.x2},${g.y + 11} ${g.x2 + 6},${g.y + 11}`} />
                    </g>
                  ) : task.computedIsMilestone ? (
                    <g style={{ cursor: 'grab' }} {...barEvents}>
                      <path className="bar-milestone" d={diamondPath(g.x1, g.cy, 6)} />
                    </g>
                  ) : (
                    <g style={{ cursor: 'grab' }}>
                      <g {...barEvents}>
                        <rect
                          x={g.x1} y={g.y} width={Math.max(3, g.width)} height={BAR_H}
                          fill={fill} stroke={stroke} strokeWidth={0.6} rx={1.5}
                        />
                        {st.showProgress && pct > 0 && (
                          <rect x={g.x1} y={g.y + BAR_H - 3.5} width={Math.max(3, g.width) * (pct / 100)} height={3.5} fill="var(--bar-progress)" />
                        )}
                      </g>
                      {/* resize handles */}
                      <rect x={g.x1 - 1} y={g.y - 1} width={5} height={BAR_H + 2} fill="transparent" style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => { e.stopPropagation(); st.select([task.id]); dragRef.current = { mode: 'resize-l', taskId: task.id, startX: e.clientX }; }} />
                      <rect x={g.x2 - 4} y={g.y - 1} width={5} height={BAR_H + 2} fill="transparent" style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => { e.stopPropagation(); st.select([task.id]); dragRef.current = { mode: 'resize-r', taskId: task.id, startX: e.clientX }; }} />
                      {/* create-link handle */}
                      <circle
                        cx={g.x2} cy={g.cy} r={4}
                        fill="#fff" stroke={isSel ? '#2b579a' : '#8a93a0'} strokeWidth={1}
                        style={{ cursor: 'crosshair' }}
                        onMouseDown={(e) => { e.stopPropagation(); setLinkDrag({ fromTask: task.id, x: e.clientX, y: e.clientY }); }}
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Layer 4: labels — exactly ONE per visible task */}
          {visible.map(({ task, index }) => {
            if (st.labelMode === 'none') return null;
            const startMs = (task.computedStart ? new Date(task.computedStart).getTime() : 0) + (dragGhost?.taskId === task.id ? dragGhost.deltaDays * 86400000 : 0);
            const finishMs = (task.computedFinish ? new Date(task.computedFinish).getTime() : 0) + (dragGhost?.taskId === task.id ? dragGhost.deltaDays * 86400000 : 0);
            const g = barGeometry(scale, index, startMs, finishMs);
            let text: string;
            if (st.labelMode === 'resources') {
              const names = (resNameByAssignment.get(task.id) ?? []).join(', ');
              if (!names) return null;
              text = names;
            } else {
              text = task.name;
            }
            return (
              <span
                key={`lbl-${task.id}`}
                className="row-label"
                style={{
                  left: task.computedIsSummary ? g.x1 + 10 : task.computedIsMilestone ? g.x1 + 12 : g.x2 + 8,
                  top: index * ROW_H + 4,
                  fontWeight: task.computedIsSummary ? 600 : 400,
                  pointerEvents: 'none',
                }}
              >
                {text}
              </span>
            );
          })}

          {/* today / status-date indicators */}
          <div style={{ position: 'absolute', left: xOf(scale, todayMs), top: 0, bottom: 0, borderLeft: '1px dashed #c00000', pointerEvents: 'none' }} />
          {statusMs && statusMs !== todayMs && (
            <div style={{ position: 'absolute', left: xOf(scale, statusMs), top: 0, bottom: 0, borderLeft: '1px solid #2b579a', pointerEvents: 'none' }} />
          )}
        </div>
      </div>

      {linkDrag && (
        <svg style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 990 }}>
          <line x1={linkDrag.x - 140} y1={linkDrag.y} x2={linkDrag.x} y2={linkDrag.y} stroke="#2b579a" strokeDasharray="4 3" />
        </svg>
      )}

      {tooltip && (
        <div className="gantt-tooltip" style={{ left: Math.min(tooltip.x + 14, window.innerWidth - 280), top: tooltip.y + 14 }}>
          <b>{tooltip.task.name}</b>
          <span>
            {tooltip.task.computedIsSummary
              ? 'Summary'
              : tooltip.task.computedIsMilestone
                ? 'Milestone'
                : fmtDur(tooltip.task.computedDuration, { minutesPerDay: mpd, minutesPerWeek: payload.project.minutesPerWeek, daysPerMonth: payload.project.daysPerMonth })}
          </span>
          <div>Start: {fmtDateLong(tooltip.task.computedStart)}</div>
          <div>Finish: {fmtDateLong(tooltip.task.computedFinish)}</div>
          {tooltip.task.computedTotalFloat != null && (
            <div>Total slack: {fmtFloat(tooltip.task.computedTotalFloat, mpd)}</div>
          )}
          {tooltip.task.computedIsCritical && <div style={{ color: '#b03030' }}>Critical</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- two-tier timescale header */

function Timescale({ scale, totalW, fromMs, toMs, pxPerDay }: {
  scale: ReturnType<typeof makeScale>; totalW: number; fromMs: number; toMs: number; pxPerDay: number;
}) {
  const useDays = pxPerDay >= 13;
  const useWeeks = pxPerDay >= 5 && !useDays;
  const months = monthTicks(fromMs, toMs);
  const days: Date[] = [];
  let ms = Math.floor(fromMs / 86400000) * 86400000;
  while (ms <= toMs) {
    days.push(new Date(ms));
    ms += 86400000;
  }

  return (
    <svg width={Math.max(totalW, 10)} height="100%" style={{ display: 'block' }} shapeRendering="crispEdges">
      {months.map((m) => {
        const x = xOf(scale, m.ms);
        const w = xOf(scale, m.endMs) - x;
        return (
          <g key={m.ms}>
            <rect x={x} y={0} width={w} height={17} fill="#f3f4f6" stroke="#d4d7dc" strokeWidth={0.5} />
            <text x={x + 6} y={12} className="tscale-tier1">{m.label}</text>
          </g>
        );
      })}
      {useDays &&
        days.map((d) => {
          const x = xOf(scale, d.getTime());
          const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
          return (
            <g key={d.getTime()}>
              <rect x={x} y={17} width={pxPerDay} height={19} fill={weekend ? '#eceef1' : '#fafbfc'} stroke="#dfe2e6" strokeWidth={0.5} />
              <text x={x + pxPerDay / 2} y={30} textAnchor="middle" fontSize={10} fill={weekend ? '#98a0aa' : '#565d68'}>
                {d.getUTCDate()}
              </text>
            </g>
          );
        })}
      {!useDays &&
        days
          .filter((d) => (useWeeks ? d.getUTCDay() === 1 : d.getUTCDate() === 1))
          .map((d) => {
            const x = xOf(scale, d.getTime());
            const label = useWeeks ? `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` : MONTHS_SHORT[d.getUTCMonth()];
            return (
              <g key={d.getTime()}>
                <line x1={x} y1={17} x2={x} y2={36} stroke="#dfe2e6" strokeWidth={0.5} />
                <text x={x + 3} y={30} fontSize={10} fill="#565d68">{label}</text>
              </g>
            );
          })}
    </svg>
  );
}

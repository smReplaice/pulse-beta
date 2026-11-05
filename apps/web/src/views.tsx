import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, CopilotResponse, Project, UsagePayload } from './api';
import { fmtDate, fmtDateLong, fmtDur, fmtMoney } from './format';
import { useSchedule } from './store';
import { GanttView } from './ganttview';
import { MsProjectImportDialog } from './msimport';

/* ================================================================ Portfolio */

export function PortfolioView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('created');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStart, setNewStart] = useState('');
  const [csv, setCsv] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showMsImport, setShowMsImport] = useState(false);
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    api.get<Project[]>(`/api/projects?sort=${sort}`).then(setProjects).finally(() => setLoading(false));
  };
  useEffect(load, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const p = await api.post<Project>('/api/projects', {
      name: newName || 'New programme',
      projectStart: newStart ? new Date(`${newStart}T08:00:00Z`).toISOString() : undefined,
    });
    nav(`/project/${p.id}`);
  };

  const importCsv = async () => {
    const res = await api.post<{ project: Project }>('/api/projects/import', { format: 'csv', csv });
    nav(`/project/${res.project.id}`);
  };

  const filtered = projects.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.code ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <h1 className="page-title">Portfolio</h1>
      <div className="page-sub">All programmes — dates, milestones, critical status and progress</div>
      <div className="toolbar-row">
        <button className="btn primary" onClick={() => setCreating(!creating)}>New Programme</button>
        <button className="btn" onClick={() => setShowImport(!showImport)}>Import CSV</button>
        <button className="btn" onClick={() => setShowMsImport(true)}>Import MS Project…</button>
        <button className="btn" onClick={() => api.get('/api/templates').then(() => load())}>Refresh</button>
        <input className="fin" style={{ width: 220 }} placeholder="Search programmes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="fin" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="created">Sort: created</option>
          <option value="name">Sort: name</option>
          <option value="finish">Sort: finish</option>
          <option value="progress">Sort: progress</option>
        </select>
      </div>

      {creating && (
        <div className="toolbar-row" style={{ background: '#f4f9ff', border: '1px solid #cfe0f5', padding: 10, borderRadius: 4 }}>
          <input className="fin" style={{ width: 260 }} placeholder="Programme name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="fin" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          <button className="btn primary" onClick={() => void create()}>Create Blank</button>
          <span style={{ color: '#667', fontSize: 11 }}>AI-generated programmes are available inside a project via the Copilot panel.</span>
        </div>
      )}
      {showImport && (
        <div className="toolbar-row" style={{ background: '#f4f9ff', border: '1px solid #cfe0f5', padding: 10, borderRadius: 4, flexDirection: 'column', alignItems: 'stretch' }}>
          <textarea className="fin" style={{ height: 110 }} placeholder={'CSV: Name,Duration,Outline Level,Predecessors\nMobilise,5,0,\nBuild,10,0,1FS'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div><button className="btn primary" onClick={() => void importCsv()}>Import CSV</button></div>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><span className="spin">◌</span> Loading programmes…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="big">🏗️</div>
          <div>No programmes yet — create a blank programme or import one.</div>
        </div>
      ) : (
        <div className="cardgrid">
          {filtered.map((p) => (
            <div className="card" key={p.id} onClick={() => nav(`/project/${p.id}`)}>
              <h3>{p.name}</h3>
              <div style={{ color: '#556', fontSize: 11.5 }}>{p.code ?? '—'} · {p.status}</div>
              <div className="meta">
                <span>Start {p.projectStart ? fmtDate(p.projectStart) : '—'}</span>
                <span>Finish {p.computedFinish ? fmtDate(p.computedFinish) : '—'}</span>
                <span>v{p.currentScheduleVersion}</span>
              </div>
              <div className="progressline">
                <div className="progressbar"><div style={{ width: `${Math.round((p.computedProgress ?? 0) * 100)}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#667', marginTop: 2 }}>
                  <span>{Math.round((p.computedProgress ?? 0) * 100)}% complete</span>
                  {(p.computedCriticalCount ?? 0) > 0 ? <span className="chip crit">{p.computedCriticalCount} critical</span> : <span className="chip ok">on track</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showMsImport && <MsProjectImportDialog onClose={() => setShowMsImport(false)} />}
    </div>
  );
}

/* ================================================================ Project view host */

export function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const st = useSchedule();
  useEffect(() => {
    if (id) void st.load(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (st.loading) return <div className="empty-state"><span className="spin">◌</span> Loading programme…</div>;
  if (st.error) return <div className="empty-state"><div className="big">⚠️</div><div>{st.error}</div></div>;
  if (!st.payload) return null;

  switch (st.view) {
    case 'resource-sheet':
      return <ResourceSheetView />;
    case 'resource-usage':
      return <ResourceUsageView />;
    case 'network':
      return <NetworkView />;
    case 'wbs':
      return <WbsView />;
    case 'costs':
      return <CostsView />;
    default:
      return <GanttHost />;
  }
}

function GanttHost() {
  const st = useSchedule();
  return <GanttView tracking={st.view === 'tracking'} />;
}

/* ================================================================ Resource Sheet */

function ResourceSheetView() {
  const st = useSchedule();
  const payload = st.payload!;
  const [name, setName] = useState('');
  const [kind, setKind] = useState('work');
  const [rate, setRate] = useState('50');
  const [maxUnits, setMaxUnits] = useState('100%');

  const add = async () => {
    if (!name) return;
    await api.post(`/api/projects/${st.projectId}/resources`, {
      name,
      kind,
      standardRate: Number(rate) || 0,
      maxUnits: maxUnits.endsWith('%') ? parseFloat(maxUnits) / 100 : parseFloat(maxUnits) || 1,
    });
    setName('');
    await st.refresh();
  };

  const cols = [
    { k: 'name', l: 'Resource Name', w: 200 },
    { k: 'initials', l: 'Initials', w: 60 },
    { k: 'group', l: 'Group', w: 130 },
    { k: 'code', l: 'Code', w: 90 },
    { k: 'maxUnits', l: 'Max. Units', w: 80 },
    { k: 'rate', l: 'Std. Rate', w: 90 },
    { k: 'overtime', l: 'Ovt. Rate', w: 80 },
    { k: 'kind', l: 'Type', w: 80 },
    { k: 'assigned', l: 'Assigned', w: 90 },
  ];

  return (
    <div className="page">
      <h1 className="page-title">Resource Sheet</h1>
      <div className="page-sub">Labour, equipment, subcontractors and materials</div>
      <div className="toolbar-row">
        <input className="fin" style={{ width: 200 }} placeholder="Resource name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="fin" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="work">Work</option><option value="material">Material</option><option value="cost">Cost</option>
        </select>
        <input className="fin" style={{ width: 80 }} placeholder="Rate" value={rate} onChange={(e) => setRate(e.target.value)} />
        <input className="fin" style={{ width: 80 }} placeholder="Max" value={maxUnits} onChange={(e) => setMaxUnits(e.target.value)} />
        <button className="btn primary" onClick={() => void add()}>Add Resource</button>
      </div>
      <div className="grid-root" style={{ height: 'calc(100% - 110px)' }}>
        <div className="grid-header-row">
          {cols.map((c) => <div key={c.k} className="ghcell" style={{ width: c.w }}>{c.l}</div>)}
        </div>
        <div className="grid-body">
          {payload.resources.map((r, i) => {
            const assignedCount = payload.assignments.filter((a) => a.resourceId === r.id).length;
            const row = (field: string, value: string, editable = false) => (
              <div key={field} className="gcell" style={{ width: cols.find((c) => c.k === field)?.w }}>
                {editable ? (
                  <input
                    className="cell-editor"
                    style={{ position: 'static', width: '100%' }}
                    defaultValue={value}
                    onBlur={(e) => {
                      const v = e.target.value;
                      const changes: Record<string, unknown> = {};
                      if (field === 'maxUnits') changes.maxUnits = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) || 1;
                      else if (field === 'rate') changes.standardRate = Number(v) || 0;
                      else if (field === 'group') changes.group = v || null;
                      else if (field === 'initials') changes.initials = v || null;
                      if (Object.keys(changes).length) void api.patch(`/api/resources/${r.id}`, changes).then(() => st.refresh());
                    }}
                  />
                ) : (
                  value
                )}
              </div>
            );
            return (
              <div key={r.id} className="grid-row" style={{ top: i * 22, position: 'absolute', width: '100%' }}>
                {row('name', r.name, true)}
                {row('initials', r.initials ?? '', true)}
                {row('group', r.group ?? '', true)}
                {row('code', r.code ?? '')}
                {row('maxUnits', `${Math.round(r.maxUnits * 100)}%`, true)}
                {row('rate', fmtMoney(r.standardRate, payload.project.currency), true)}
                {row('overtime', fmtMoney(r.overtimeRate, payload.project.currency))}
                {row('kind', r.kind)}
                {row('assigned', `${assignedCount} task(s)`)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================================================================ Resource Usage */

function ResourceUsageView() {
  const st = useSchedule();
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  useEffect(() => {
    if (st.projectId) api.get<UsagePayload>(`/api/projects/${st.projectId}/resource-usage`).then(setUsage);
  }, [st.projectId, st.payload?.scheduleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // All hooks must run before any early return
  const dayKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of usage?.resources ?? []) for (const p of r.byDay) set.add(p.dateKey);
    return [...set].sort();
  }, [usage]);
  const maxWork = Math.max(1, ...(usage?.resources ?? []).flatMap((r) => r.byDay.map((p) => p.plannedMinutes)));

  if (!usage || !st.payload) return <div className="empty-state"><span className="spin">◌</span> Computing utilisation…</div>;
  const mpd = st.payload.project.minutesPerDay;
  const nameOf = new Map(st.payload.resources.map((r) => [r.id, r.name]));
  const taskNameOf = new Map(st.payload.tasks.map((t) => [t.id, t.name]));

  const first = dayKeys[0] ? new Date(dayKeys[0]) : new Date();
  const last = dayKeys[dayKeys.length - 1] ? new Date(dayKeys[dayKeys.length - 1]) : new Date();
  const days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000) + 1);
  const dayW = 34;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1 className="page-title">Resource Usage</h1>
      <div className="page-sub">Time-phased work and allocation — overloads shown in red</div>
      <div className="usage-grid">
        <div className="usage-left">
          <div className="grid-header-row"><div className="ghcell" style={{ width: '100%' }}>Resource / Task</div></div>
          {usage.resources.map((r) => (
            <div key={r.resourceId}>
              <div className="grid-row" style={{ position: 'relative', fontWeight: 600 }}>
                <div className="gcell" style={{ width: '100%' }}>
                  {r.name} {r.overallocatedDays.length > 0 ? <span className="chip crit">over-allocated</span> : null}
                </div>
              </div>
              {usage.assignments
                .filter((a) => a.resourceId === r.resourceId)
                .map((a) => (
                  <div key={a.assignmentId} className="grid-row" style={{ position: 'relative' }}>
                    <div className="gcell" style={{ width: '100%', paddingLeft: 22, color: '#556' }}>
                      {taskNameOf.get(a.taskId) ?? a.taskId} · {fmtDur(a.workMinutes, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
        <div className="usage-right" style={{ overflowX: 'auto' }}>
          <div style={{ width: days * dayW, position: 'relative', minHeight: '100%' }}>
            {/* capacity histogram per resource */}
            {usage.resources.map((r, ri) => {
              const capMinutes = r.maxUnits * mpd;
              const byDay = new Map(r.byDay.map((p) => [p.dateKey, p.plannedMinutes]));
              const rowsCount = usage.assignments.filter((a) => a.resourceId === r.resourceId).length;
              const H = 46 + rowsCount * 22;
              return (
                <div key={r.resourceId} style={{ height: H, position: 'relative', borderBottom: '1px solid #eef0f2' }}>
                  <svg width={days * dayW} height={H} style={{ display: 'block' }}>
                    {dayKeys.map((k, di) => {
                      const mins = byDay.get(k) ?? 0;
                      const h = (mins / maxWork) * 34;
                      const over = mins > capMinutes + 1e-6;
                      return (
                        <rect key={k} className={`histogram-bar ${over ? 'over' : ''}`} x={di * dayW + 4} y={38 - h} width={dayW - 8} height={Math.max(0, h)} />
                      );
                    })}
                    <line className="capacity-line" x1={0} x2={days * dayW} y1={38 - (capMinutes / maxWork) * 34} y2={38 - (capMinutes / maxWork) * 34} />
                  </svg>
                  <div style={{ position: 'absolute', top: 40, left: 0, width: '100%' }}>
                    {usage.assignments
                      .filter((a) => a.resourceId === r.resourceId)
                      .map((a) => {
                        const m = new Map(a.byDay.map((p) => [p.dateKey, p.plannedMinutes]));
                        return (
                          <div key={a.assignmentId} style={{ height: 22, position: 'relative' }}>
                            {dayKeys.map((k, di) => {
                              const mins = m.get(k) ?? 0;
                              if (!mins) return null;
                              return (
                                <div key={k} style={{
                                  position: 'absolute', left: di * dayW + 4, top: 3, width: dayW - 8, height: 16,
                                  background: '#dce9f7', border: '1px solid #b7cdea', borderRadius: 2,
                                  fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#234',
                                }}>
                                  {Math.round((mins / 60) * 10) / 10}h
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                  </div>
                  <div style={{ position: 'absolute', top: 2, left: 6, fontSize: 10, color: '#667' }}>
                    peak {Math.round(r.peakUnits * 100)}% · total {fmtDur(r.totalWorkMinutes, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })}
                  </div>
                  <span style={{ display: 'none' }}>{ri}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => st.setDialog({ kind: 'level' })}>Level Resources…</button>
      </div>
    </div>
  );
}

/* ================================================================ Network Diagram */

function NetworkView() {
  const st = useSchedule();
  const payload = st.payload!;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 40, y: 30 });

  const sorted = [...payload.tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const levels = useMemo(() => {
    // simple layered layout: longest-path layering
    const level = new Map<string, number>();
    const byId = new Map(sorted.map((t) => [t.id, t]));
    const incoming = new Map<string, string[]>();
    for (const d of payload.dependencies) {
      if (!incoming.has(d.successorId)) incoming.set(d.successorId, []);
      incoming.get(d.successorId)!.push(d.predecessorId);
    }
    const resolve = (id: string, seen: Set<string>): number => {
      if (level.has(id)) return level.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const preds = incoming.get(id) ?? [];
      const l = preds.length === 0 ? 0 : Math.max(...preds.map((p) => (byId.has(p) ? resolve(p, seen) + 1 : 0)));
      level.set(id, l);
      return l;
    };
    for (const t of sorted) resolve(t.id, new Set());
    // summaries render at their children's average level
    for (const t of sorted) {
      if (t.computedIsSummary) {
        const kids = sorted.filter((x) => x.outlineLevel > t.outlineLevel).length;
        if (kids > 0 && (level.get(t.id) ?? 0) === 0) level.set(t.id, 1);
      }
    }
    return level;
  }, [sorted, payload.dependencies]);

  const NODE_W = 150;
  const NODE_H = 46;
  const GAP_X = 60;
  const GAP_Y = 18;
  const positions = useMemo(() => {
    const byLevel = new Map<number, number>();
    const pos = new Map<string, { x: number; y: number }>();
    for (const t of sorted) {
      if (t.computedIsSummary && st.collapsedSummaries.size === 0) {
        // render summaries too, faint
      }
      const l = levels.get(t.id) ?? 0;
      const idx = byLevel.get(l) ?? 0;
      byLevel.set(l, idx + 1);
      pos.set(t.id, { x: pan.x + l * (NODE_W + GAP_X), y: pan.y + idx * (NODE_H + GAP_Y) });
    }
    return pos;
  }, [sorted, levels, pan]);

  const criticalSet = new Set(st.showCritical ? payload.tasks.filter((t) => t.computedIsCritical).map((t) => t.id) : []);

  return (
    <div className="page network-wrap" style={{ overflow: 'hidden', position: 'relative' }} ref={wrapRef} tabIndex={0}>
      <h1 className="page-title" style={{ position: 'absolute', top: 8, left: 16, zIndex: 5 }}>Network Diagram</h1>
      <div style={{ position: 'absolute', top: 8, right: 16, zIndex: 5, display: 'flex', gap: 6 }}>
        <button className={`btn ${st.showCritical ? 'primary' : ''}`} onClick={() => st.setFlag('showCritical', !st.showCritical)}>Highlight critical path</button>
      </div>
      <div
        style={{ position: 'absolute', inset: 0, overflow: 'auto', cursor: 'grab' }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('.nn')) return;
          const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          const move = (ev: MouseEvent) => setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      >
        <svg width={2000 + pan.x} height={sorted.length * (NODE_H + GAP_Y) + 120} style={{ minWidth: '100%' }}>
          <defs>
            <marker id="net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#404040" />
            </marker>
          </defs>
          {payload.dependencies.map((d) => {
            const a = positions.get(d.predecessorId);
            const b = positions.get(d.successorId);
            if (!a || !b) return null;
            const crit = criticalSet.has(d.predecessorId) && criticalSet.has(d.successorId);
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={d.id}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                stroke={crit ? '#d83838' : '#7a8494'}
                strokeWidth={crit ? 1.8 : 1}
                fill="none"
                markerEnd="url(#net-arrow)"
              />
            );
          })}
          {sorted.map((t) => {
            const p = positions.get(t.id)!;
            const crit = criticalSet.has(t.id);
            return (
              <g key={t.id} className="nn" transform={`translate(${p.x},${p.y})`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  st.select([t.id]);
                }}
                onDoubleClick={() => st.setDialog({ kind: 'task-info', taskId: t.id })}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  width={NODE_W} height={NODE_H} rx={3}
                  fill={t.computedIsSummary ? '#eef1f5' : crit ? '#fdeaea' : '#fff'}
                  stroke={crit ? '#d83838' : t.computedIsSummary ? '#9aa2ad' : '#5b7ca8'}
                  strokeWidth={crit ? 1.8 : 1}
                />
                <text x={6} y={15} fontSize={10} fontWeight={600} fill="#202428">
                  {t.name.length > 24 ? `${t.name.slice(0, 23)}…` : t.name}
                </text>
                <text x={6} y={28} fontSize={9} fill="#5a6270">
                  {t.computedIsSummary ? 'Summary' : t.computedIsMilestone ? 'Milestone' : fmtDur(t.computedDuration, { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 })}
                </text>
                <text x={6} y={40} fontSize={9} fill="#5a6270">
                  {fmtDate(t.computedStart)} → {fmtDate(t.computedFinish)}
                </text>
                {t.computedIsMilestone && <polygon points={`${NODE_W - 16},${NODE_H - 18} ${NODE_W - 11},${NODE_H - 13} ${NODE_W - 16},${NODE_H - 8} ${NODE_W - 21},${NODE_H - 13}`} fill="#202020" />}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ================================================================ WBS */

function WbsView() {
  const st = useSchedule();
  const payload = st.payload!;
  const sorted = [...payload.tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const visible: typeof sorted = [];
  const stack: { level: number; collapsed: boolean }[] = [];
  for (const t of sorted) {
    while (stack.length && stack[stack.length - 1].level >= t.outlineLevel) stack.pop();
    if (!stack.some((s) => s.collapsed)) visible.push(t);
    stack.push({ level: t.outlineLevel, collapsed: st.collapsedSummaries.has(t.id) });
  }
  const mpd = payload.project.minutesPerDay;

  return (
    <div className="page">
      <h1 className="page-title">Work Breakdown Structure</h1>
      <div className="page-sub">Hierarchical construction stages, packages, work activities and milestones</div>
      <table className="dtable" style={{ maxWidth: 1000 }}>
        <thead><tr><th>WBS</th><th>Task</th><th>Stage</th><th>Trade</th><th>Duration</th><th>Start</th><th>Finish</th><th>%</th></tr></thead>
        <tbody>
          {visible.map((t) => (
            <tr key={t.id} onDoubleClick={() => st.setDialog({ kind: 'task-info', taskId: t.id })} style={{ cursor: 'default' }}>
              <td style={{ fontFamily: 'var(--mono)' }}>{t.wbs}</td>
              <td style={{ fontWeight: t.computedIsSummary ? 600 : 400 }}>
                <span
                  style={{ cursor: 'pointer', marginRight: 4 }}
                  onClick={() => (t.computedIsSummary ? st.toggleCollapse(t.id) : null)}
                >
                  {t.computedIsSummary ? (st.collapsedSummaries.has(t.id) ? '▶' : '▼') : ' '}
                </span>
                {t.name}
              </td>
              <td>{t.stage ?? ''}</td>
              <td>{t.trade ?? ''}</td>
              <td>{fmtDur(t.computedDuration, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })}</td>
              <td>{fmtDate(t.computedStart)}</td>
              <td>{fmtDate(t.computedFinish)}</td>
              <td>{Math.round(t.computedPercentComplete ?? 0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================ Costs / progress dashboard */

function CostsView() {
  const st = useSchedule();
  const payload = st.payload!;
  const [ev, setEv] = useState<{ available: boolean; earnedValue?: { bac: number; pv: number; ev: number; ac: number; sv: number; cv: number; spi: number; cpi: number; eac: number; vac: number; etc: number; finishVarianceMinutes: number } } | null>(null);
  const [compare, setCompare] = useState<{ rows: { name: string; baselineFinish: string; currentFinish: string | null; finishVarianceMinutes: number | null; durationVarianceMinutes: number | null; costVariance: number | null }[] } | null>(null);

  useEffect(() => {
    if (st.projectId) {
      api.get(`/api/projects/${st.projectId}/earned-value`).then((r: unknown) => setEv(r as typeof ev)).catch(() => setEv(null));
      const bl = payload.baselines.find((b) => b.isCurrent) ?? payload.baselines[0];
      if (bl) {
        api.get(`/api/baselines/${bl.id}/compare`)
          .then((r: unknown) => setCompare(r as typeof compare))
          .catch(() => setCompare(null));
      }
    }
  }, [st.projectId, payload.baselines, st.payload?.scheduleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const mpd = payload.project.minutesPerDay;
  const totalPlanned = payload.tasks.reduce((s, t) => s + (t.computedPlannedCost ?? 0), 0);
  const totalActual = payload.tasks.reduce((s, t) => s + (t.computedActualCost ?? 0), 0);
  const progress = payload.project.computedProgress ?? 0;
  const e = ev?.earnedValue;

  return (
    <div className="page">
      <h1 className="page-title">Progress &amp; Costs</h1>
      <div className="page-sub">Baseline variance, actual progress and earned value{payload.project.statusDate ? ` · status date ${fmtDateLong(payload.project.statusDate)}` : ' · set a status date in Settings for EV'}</div>

      <div className="kpis">
        <div className="kpi"><div className="k">Programme finish</div><div className="v">{payload.project.computedFinish ? fmtDate(payload.project.computedFinish) : '—'}</div></div>
        <div className="kpi"><div className="k">Progress</div><div className="v">{Math.round(progress * 100)}%</div></div>
        <div className="kpi"><div className="k">Planned cost</div><div className="v">{fmtMoney(totalPlanned, payload.project.currency)}</div></div>
        <div className="kpi"><div className="k">Actual cost</div><div className="v">{fmtMoney(totalActual, payload.project.currency)}</div></div>
        {e && <div className="kpi"><div className="k">SPI</div><div className={`v ${e.spi >= 1 ? 'good' : 'bad'}`}>{e.spi.toFixed(2)}</div></div>}
        {e && <div className="kpi"><div className="k">CPI</div><div className={`v ${e.cpi <= 1 ? 'bad' : 'good'}`}>{e.cpi.toFixed(2)}</div></div>}
        {e && <div className="kpi"><div className="k">EAC / VAC</div><div className="v">{fmtMoney(e.eac, payload.project.currency)} / {fmtMoney(e.vac, payload.project.currency)}</div></div>}
      </div>

      {ev && !ev.available && (
        <div className="chip warn" style={{ marginBottom: 10 }}>Save a baseline to compute earned value (Schedule → Baselines).</div>
      )}

      {compare && (
        <>
          <h3 style={{ margin: '14px 0 6px' }}>Baseline variance</h3>
          <table className="dtable" style={{ maxWidth: 980 }}>
            <thead><tr><th>Task</th><th>Baseline finish</th><th>Current finish</th><th>Finish var.</th><th>Duration var.</th><th>Cost var.</th></tr></thead>
            <tbody>
              {compare.rows.map((r, i) => {
                const task = payload.tasks.find((t) => t.name === r.name);
                void task;
                return (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{fmtDate(r.baselineFinish)}</td>
                    <td>{r.currentFinish ? fmtDate(r.currentFinish) : '—'}</td>
                    <td className={(r.finishVarianceMinutes ?? 0) > 0 ? 'variance-pos' : 'variance-neg'}>
                      {r.finishVarianceMinutes != null ? `${r.finishVarianceMinutes > 0 ? '+' : ''}${Math.round((r.finishVarianceMinutes / 1440) * 10) / 10} d` : '—'}
                    </td>
                    <td>{r.durationVarianceMinutes != null ? `${r.durationVarianceMinutes > 0 ? '+' : ''}${Math.round((r.durationVarianceMinutes / mpd) * 10) / 10} d` : '—'}</td>
                    <td>{r.costVariance != null ? fmtMoney(r.costVariance, payload.project.currency) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ margin: '16px 0 6px' }}>Milestones</h3>
      <table className="dtable" style={{ maxWidth: 700 }}>
        <thead><tr><th>Milestone</th><th>Date</th><th>Critical</th><th>Actual</th></tr></thead>
        <tbody>
          {payload.tasks.filter((t) => t.computedIsMilestone).map((t) => (
            <tr key={t.id}><td>{t.name}</td><td>{fmtDate(t.computedStart)}</td><td>{t.computedIsCritical ? '⚠ Yes' : 'No'}</td><td>{t.actualFinish ? fmtDate(t.actualFinish) : '—'}</td></tr>
          ))}
          {payload.tasks.filter((t) => t.computedIsMilestone).length === 0 && <tr><td colSpan={4} style={{ color: '#889' }}>No milestones</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================ Copilot */

export function CopilotPanel() {
  const st = useSchedule();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant' | 'system'; text: string; actionId?: string; preview?: CopilotResponse['preview'] }[]>([
    { role: 'system', text: 'Pulse AI Copilot — create programmes, edit activities, analyse the critical path and recommend recovery actions. Every proposal is validated and scheduled by the real engine; nothing is applied without your approval.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9 });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !st.projectId) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await api.post<CopilotResponse>(`/api/projects/${st.projectId}/ai/chat`, { message: text });
      setMessages((m) => [...m, { role: 'assistant', text: res.reply, actionId: res.actionId, preview: res.preview }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'system', text: `Copilot error: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (actionId: string) => {
    setBusy(true);
    try {
      const res = await api.post<CopilotResponse>(`/api/projects/${st.projectId}/ai/chat`, { applyActionId: actionId });
      setMessages((m) => [...m, { role: 'assistant', text: res.reply }]);
      await st.refresh();
    } finally {
      setBusy(false);
    }
  };

  const undo = async (actionId: string) => {
    setBusy(true);
    try {
      const res = await api.post<CopilotResponse>(`/api/projects/${st.projectId}/ai/undo`, { actionId });
      setMessages((m) => [...m, { role: 'assistant', text: res.reply }]);
      await st.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="copilot-panel">
      <div className="copilot-header">✨ Pulse AI Copilot</div>
      <div className="copilot-msgs" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
            {m.preview && (
              <div className="copilot-preview" style={{ marginTop: 6 }}>
                <div><b>Projected finish:</b> {fmtDate(m.preview.after.projectFinish)} (was {fmtDate(m.preview.before.projectFinish)})</div>
                <div><b>Critical tasks:</b> {m.preview.after.criticalCount}</div>
                {m.preview.changedTasks.slice(0, 6).map((c) => (
                  <div key={c.taskId || c.name}>• {c.name}: {fmtDate(c.start)} → {fmtDate(c.finish)}</div>
                ))}
                {m.preview.changedTasks.length > 6 && <div>… {m.preview.changedTasks.length - 6} more</div>}
                {m.actionId && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                    <button className="btn primary" disabled={busy} onMouseDown={() => void apply(m.actionId!)}>Apply</button>
                    <button className="btn" disabled={busy} onMouseDown={() => void undo(m.actionId!)}>Undo</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg system">Copilot is thinking…</div>}
      </div>
      <div className="copilot-input">
        <textarea
          placeholder={'e.g. "Create a programme for a 20-storey residential tower starting January 2027 — excavation, foundations, structure, façade, MEP, fit-out, inspections, handover"'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary" disabled={busy || !input.trim()} onMouseDown={() => void send()}>Send</button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api, Assignment, LevelingPreviewPayload, Project, Task } from './api';
import { fmtDate, fmtDateLong, fmtDur, fmtFloat, fmtMoney, parseDateInput } from './format';
import { useSchedule } from './store';
import { predecessorsText } from './grid';

/* ================================================================ Dialog host */

export function DialogHost() {
  const st = useSchedule();
  const d = st.dialog;
  if (!d) return null;
  switch (d.kind) {
    case 'task-info':
      return <TaskInfoDialog taskId={d.taskId} />;
    case 'assign':
      return <AssignResourcesDialog taskId={d.taskId} />;
    case 'level':
      return <LevelResourcesDialog />;
    case 'baseline':
      return <BaselineDialog />;
    case 'calendar':
      return <CalendarDialog />;
    case 'progress':
      return <ProgressDialog taskId={d.taskId} />;
    case 'dep':
      return <DependencyDialog depId={d.depId} />;
    case 'settings':
      return <SettingsDialog />;
    default:
      return null;
  }
}

function DialogFrame({ title, children, onClose, wide, footer }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`}>
        <div className="dialog-title">
          <span>{title}</span>
          <button className="btn" style={{ minWidth: 24, height: 20, padding: 0 }} onMouseDown={onClose}>✕</button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ================================================================ Task Information */

const CONSTRAINTS = ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];

function TaskInfoDialog({ taskId }: { taskId: string }) {
  const st = useSchedule();
  const payload = st.payload!;
  const task = payload.tasks.find((t) => t.id === taskId);
  const [tab, setTab] = useState('General');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setForm({
      name: task.name,
      duration: fmtDur(task.durationMinutes, { minutesPerDay: payload.project.minutesPerDay, minutesPerWeek: payload.project.minutesPerWeek, daysPerMonth: payload.project.daysPerMonth }),
      priority: String(task.priority),
      constraintType: task.constraintType ?? 'ASAP',
      constraintDate: task.constraintDate ? task.constraintDate.slice(0, 10) : '',
      deadline: task.deadline ? task.deadline.slice(0, 10) : '',
      taskType: task.taskType,
      mode: task.mode,
      effortDriven: String(task.effortDriven),
      percentComplete: String(task.percentComplete),
      actualStart: task.actualStart ? task.actualStart.slice(0, 10) : '',
      actualFinish: task.actualFinish ? task.actualFinish.slice(0, 10) : '',
      notes: task.notes ?? '',
      stage: task.stage ?? '',
      trade: task.trade ?? '',
      location: task.location ?? '',
      delayReason: task.delayReason ?? '',
    });
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;
  const mpd = payload.project.minutesPerDay;
  const sortedAll = [...payload.tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const rowIdx = sortedAll.findIndex((t) => t.id === task.id) + 1;
  const assignments = payload.assignments.filter((a) => a.taskId === task.id);
  const preds = payload.dependencies.filter((d) => d.successorId === task.id);
  const succs = payload.dependencies.filter((d) => d.predecessorId === task.id);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const val = (k: string): string => form[k] ?? '';

  const save = async () => {
    setSaving(true);
    try {
      const changes: Record<string, unknown> = {
        name: form.name,
        priority: Number(form.priority) || 500,
        constraintType: form.constraintType,
        constraintDate: form.constraintDate ? new Date(`${form.constraintDate}T08:00:00Z`).toISOString() : null,
        deadline: form.deadline ? new Date(`${form.deadline}T17:00:00Z`).toISOString() : null,
        taskType: form.taskType,
        mode: form.mode,
        effortDriven: form.effortDriven === 'true',
        percentComplete: Number(form.percentComplete) || 0,
        notes: form.notes || null,
        stage: form.stage || null,
        trade: form.trade || null,
        location: form.location || null,
        delayReason: form.delayReason || null,
        actualStart: form.actualStart ? new Date(`${form.actualStart}T08:00:00Z`).toISOString() : null,
        actualFinish: form.actualFinish ? new Date(`${form.actualFinish}T17:00:00Z`).toISOString() : null,
      };
      const { parseDuration } = await import('@pulse/engine');
      changes.durationMinutes = parseDuration(form.duration || '1d', {
        minutesPerDay: mpd,
        minutesPerWeek: payload.project.minutesPerWeek,
        daysPerMonth: payload.project.daysPerMonth,
      }).minutes;
      await st.updateTask(taskId, changes, 'Task information');
      st.setDialog(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogFrame
      title="Task Information"
      wide
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button className="btn primary" disabled={saving} onMouseDown={() => void save()}>OK</button>
          <button className="btn" onMouseDown={() => st.setDialog(null)}>Cancel</button>
        </>
      }
    >
      <div className="dtabs">
        {['General', 'Scheduling', 'Dates', 'Dependencies', 'Resources', 'Actuals', 'Baseline', 'Notes'].map((t) => (
          <div key={t} className={`dtab ${tab === t ? 'active' : ''}`} onMouseDown={() => setTab(t)}>{t}</div>
        ))}
      </div>

      {tab === 'General' && (
        <div className="form-grid">
          <label>Name</label><input className="fin" value={val('name')} onChange={(e) => set('name', e.target.value)} />
          <label>Duration</label><input className="fin" value={val('duration')} onChange={(e) => set('duration', e.target.value)} />
          <label>Start</label><input className="fin ro" readOnly value={fmtDate(task.computedStart)} />
          <label>Finish</label><input className="fin ro" readOnly value={fmtDate(task.computedFinish)} />
          <label>Scheduled</label>
          <span className="full" style={{ fontSize: 11.5 }}>
            {fmtDateLong(task.computedStart)} → {fmtDateLong(task.computedFinish)} · {fmtDur(task.computedDuration, { minutesPerDay: mpd, minutesPerWeek: payload.project.minutesPerWeek, daysPerMonth: payload.project.daysPerMonth })}
          </span>
          <label>Stage</label><input className="fin" value={val('stage')} onChange={(e) => set('stage', e.target.value)} placeholder="Pre-construction…" />
          <label>Trade</label><input className="fin" value={val('trade')} onChange={(e) => set('trade', e.target.value)} placeholder="Concrete…" />
          <label>Location</label><input className="fin" value={val('location')} onChange={(e) => set('location', e.target.value)} placeholder="Level 5 / Zone B" />
          <label>Priority</label>
          <select className="fin" value={val('priority')} onChange={(e) => set('priority', e.target.value)}>
            {[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((p) => (
              <option key={p} value={p}>{p}{p === 1000 ? ' (do not level)' : p === 500 ? ' (default)' : ''}</option>
            ))}
          </select>
        </div>
      )}

      {tab === 'Scheduling' && (
        <div className="form-grid">
          <div className="form-section">Scheduling rules</div>
          <label>Task mode</label>
          <select className="fin" value={val('mode')} onChange={(e) => set('mode', e.target.value)}>
            <option value="auto">Automatically schedule</option>
            <option value="manual">Manually schedule</option>
          </select>
          <label>Task type</label>
          <select className="fin" value={val('taskType')} onChange={(e) => set('taskType', e.target.value)}>
            <option value="fixed_units">Fixed Units</option>
            <option value="fixed_duration">Fixed Duration</option>
            <option value="fixed_work">Fixed Work</option>
          </select>
          <label>Effort driven</label>
          <select className="fin" value={val('effortDriven')} onChange={(e) => set('effortDriven', e.target.value)}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
          <label>Constraint</label>
          <select className="fin" value={val('constraintType')} onChange={(e) => set('constraintType', e.target.value)}>
            {CONSTRAINTS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <label>Constraint date</label>
          <input className="fin" type="date" value={val('constraintDate')} onChange={(e) => set('constraintDate', e.target.value)} />
          <label>Deadline</label>
          <input className="fin" type="date" value={val('deadline')} onChange={(e) => set('deadline', e.target.value)} />
          <label>Calendar</label>
          <select className="fin" value={task.calendarId ?? ''} onChange={(e) => void st.updateTask(taskId, { calendarId: e.target.value || null }, 'Set task calendar')}>
            <option value="">Project default ({payload.calendars.find((c) => c.id === payload.settings.defaultCalendarId)?.name})</option>
            {payload.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Leveling delay</label><input className="fin ro" readOnly value={fmtDur(task.levelingDelayMinutes, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })} />
        </div>
      )}

      {tab === 'Dates' && (
        <div className="form-grid">
          <div className="form-section">Calculated by the scheduling engine (CPM)</div>
          <label>Early start</label><input className="fin ro" readOnly value={fmtDate(task.computedStart)} />
          <label>Early finish</label><input className="fin ro" readOnly value={fmtDate(task.computedFinish)} />
          <label>Late start</label><input className="fin ro" readOnly value={fmtDate(task.computedStart && task.computedTotalFloat != null ? new Date(new Date(task.computedStart).getTime() + (task.computedTotalFloat ?? 0) * 60000).toISOString() : '')} />
          <label>Late finish</label><input className="fin ro" readOnly value={fmtDate(task.computedFinish && task.computedTotalFloat != null ? new Date(new Date(task.computedFinish).getTime() + (task.computedTotalFloat ?? 0) * 60000).toISOString() : '')} />
          <label>Total slack</label><input className="fin ro" readOnly value={fmtFloat(task.computedTotalFloat, mpd)} />
          <label>Free slack</label><input className="fin ro" readOnly value={fmtFloat(task.computedFreeFloat, mpd)} />
          <label>Critical</label><span className="full">{task.computedIsCritical ? 'Yes — on the critical path' : 'No'}</span>
        </div>
      )}

      {tab === 'Dependencies' && (
        <>
          <table className="dtable">
            <thead><tr><th style={{ width: 34 }}>#</th><th>Task</th><th>Type</th><th>Lag (d)</th><th style={{ width: 60 }}></th></tr></thead>
            <tbody>
              {preds.map((d) => {
                const pred = payload.tasks.find((t) => t.id === d.predecessorId);
                return (
                  <tr key={d.id}>
                    <td>{sortedAll.findIndex((t) => t.id === d.predecessorId) + 1}</td>
                    <td>{pred?.name}</td>
                    <td>
                      <select value={d.type} onChange={(e) => void st.updateDep(d.id, { type: e.target.value })}>
                        {['FS', 'SS', 'FF', 'SF'].map((t2) => <option key={t2}>{t2}</option>)}
                      </select>
                    </td>
                    <td>
                      <input defaultValue={String(Math.round((d.lagMinutes / mpd) * 10) / 10)}
                        onBlur={(e) => void st.updateDep(d.id, { lagMinutes: Math.round(Number(e.target.value || 0) * mpd) })} />
                    </td>
                    <td><button className="btn" style={{ minWidth: 0, height: 20 }} onMouseDown={() => void api.del(`/api/dependencies/${d.id}`).then(() => st.refresh())}>✕</button></td>
                  </tr>
                );
              })}
              {preds.length === 0 && <tr><td colSpan={5} style={{ color: '#889' }}>No predecessors</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontWeight: 600 }}>Successors</div>
          <table className="dtable">
            <tbody>
              {succs.map((d) => {
                const succ = payload.tasks.find((t) => t.id === d.successorId);
                return (
                  <tr key={d.id}>
                    <td>{sortedAll.findIndex((t) => t.id === d.successorId) + 1}</td>
                    <td>{succ?.name}</td>
                    <td>{d.type}</td>
                    <td>{d.lagMinutes ? `${d.lagMinutes > 0 ? '+' : ''}${Math.round((d.lagMinutes / mpd) * 10) / 10}d` : ''}</td>
                  </tr>
                );
              })}
              {succs.length === 0 && <tr><td colSpan={4} style={{ color: '#889' }}>No successors</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: 8, color: '#667', fontSize: 11 }}>
            Predecessors (spreadsheet style): <code>{predecessorsText(task, sortedAll, payload.dependencies) || '—'}</code>
          </div>
        </>
      )}

      {tab === 'Resources' && (
        <>
          <table className="dtable">
            <thead><tr><th>Resource</th><th>Units</th><th>Work</th><th>Cost</th><th style={{ width: 60 }}></th></tr></thead>
            <tbody>
              {assignments.map((a) => {
                const r = payload.resources.find((x) => x.id === a.resourceId);
                const work = a.workMinutes ?? a.units * (task.computedDuration ?? task.durationMinutes);
                return (
                  <tr key={a.id}>
                    <td>{r?.name}</td>
                    <td><input defaultValue={`${Math.round(a.units * 100)}%`} onBlur={(e) => {
                      const v = e.target.value.trim();
                      const units = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) || 1;
                      void api.patch(`/api/assignments/${a.id}`, { units }).then(() => st.refresh());
                    }} /></td>
                    <td>{fmtDur(work, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })}</td>
                    <td>{fmtMoney(r ? (work / 60) * r.standardRate : 0, payload.project.currency)}</td>
                    <td><button className="btn" style={{ minWidth: 0, height: 20 }} onMouseDown={() => void st.removeAssignment(a.id)}>✕</button></td>
                  </tr>
                );
              })}
              {assignments.length === 0 && <tr><td colSpan={5} style={{ color: '#889' }}>No resources assigned</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" onMouseDown={() => st.setDialog({ kind: 'assign', taskId })}>Assign Resources…</button>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>Total work</label><input className="fin ro" readOnly value={fmtDur(task.computedWork, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })} />
            <label>Cost</label><input className="fin ro" readOnly value={fmtMoney(task.computedPlannedCost, payload.project.currency)} />
          </div>
        </>
      )}

      {tab === 'Actuals' && (
        <div className="form-grid">
          <div className="form-section">Progress</div>
          <label>Percent complete</label><input className="fin" value={val('percentComplete')} onChange={(e) => set('percentComplete', e.target.value)} />
          <label>Actual start</label><input className="fin" type="date" value={val('actualStart')} onChange={(e) => set('actualStart', e.target.value)} />
          <label>Actual finish</label><input className="fin" type="date" value={val('actualFinish')} onChange={(e) => set('actualFinish', e.target.value)} />
          <label>Actual work</label><input className="fin ro" readOnly value={fmtDur(task.actualWorkMinutes, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })} />
          <label>Remaining work</label><input className="fin ro" readOnly value={fmtDur(Math.max(0, (task.computedWork ?? 0) - task.actualWorkMinutes), { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })} />
          <label>Actual cost</label><input className="fin ro" readOnly value={fmtMoney(task.computedActualCost, payload.project.currency)} />
          <div className="form-section">Delay / extension of time</div>
          <label>Delay reason</label><input className="fin" value={val('delayReason')} onChange={(e) => set('delayReason', e.target.value)} />
          <label>Extension of time</label>
          <span className="full">
            <input type="checkbox" checked={task.extensionOfTime} onChange={(e) => void st.updateTask(taskId, { extensionOfTime: e.target.checked }, 'Toggle EOT')} /> claim submitted
          </span>
        </div>
      )}

      {tab === 'Baseline' && <BaselineTab task={task} />}

      {tab === 'Notes' && (
        <textarea className="fin" style={{ height: 220 }} value={val('notes')} onChange={(e) => set('notes', e.target.value)} placeholder="Notes, method statements, QA references…" />
      )}

      <div style={{ marginTop: 10, color: '#8892a0', fontSize: 10.5 }}>Row {rowIdx} · Task ID {task.id}</div>
    </DialogFrame>
  );
}

function BaselineTab({ task }: { task: Task }) {
  const st = useSchedule();
  const [rows, setRows] = useState<{ name: string; baselineStart: string; baselineFinish: string; finishVarianceMinutes: number | null }[]>([]);
  useEffect(() => {
    const bl = st.payload?.baselines.find((b) => b.isCurrent);
    if (!bl) return;
    api.get<{ rows: typeof rows }>(`/api/baselines/${bl.id}/compare`).then((r) => setRows(r.rows.filter((x) => x.name === task.name)));
  }, [st.payload?.baselines, task.name]);
  if (rows.length === 0) return <div style={{ color: '#889' }}>No baseline saved yet. Use Schedule → Baselines to snapshot the current programme.</div>;
  return (
    <table className="dtable">
      <thead><tr><th>Baseline</th><th>Start</th><th>Finish</th><th>Finish variance</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>Current</td>
            <td>{fmtDate(r.baselineStart)}</td>
            <td>{fmtDate(r.baselineFinish)}</td>
            <td className={((r.finishVarianceMinutes ?? 0) > 0 ? 'variance-pos' : 'variance-neg')}>
              {r.finishVarianceMinutes != null ? `${Math.round((r.finishVarianceMinutes / 480) * 10) / 10} d` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ================================================================ Assign Resources */

function AssignResourcesDialog({ taskId }: { taskId: string }) {
  const st = useSchedule();
  const payload = st.payload!;
  const task = payload.tasks.find((t) => t.id === taskId);
  const [search, setSearch] = useState('');
  const [units, setUnits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!task) return null;

  const assignedIds = new Set(payload.assignments.filter((a) => a.taskId === taskId).map((a) => a.resourceId));
  const mpd = payload.project.minutesPerDay;
  const list = payload.resources.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()));

  const assign = async (resourceId: string) => {
    setBusy(true);
    try {
      const u = parseFloat(units[resourceId] ?? '100%') || 100;
      await st.assignResource(taskId, resourceId, u / 100);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      title="Assign Resources"
      wide
      onClose={() => st.setDialog(null)}
      footer={<button className="btn primary" onMouseDown={() => st.setDialog(null)}>Close</button>}
    >
      <div style={{ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
        <b>{task.name}</b>
        <span style={{ color: '#667' }}>{fmtDate(task.computedStart)} · {fmtDur(task.computedDuration, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 })} · {task.taskType === 'fixed_work' ? 'Fixed Work' : task.taskType === 'fixed_duration' ? 'Fixed Duration' : 'Fixed Units'}{task.effortDriven ? ' (effort driven)' : ''}</span>
      </div>
      <input className="fin" placeholder="Search resources…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <table className="dtable">
        <thead><tr><th style={{ width: 30 }}></th><th>Resource</th><th>Group</th><th>Max</th><th>Rate</th><th>Units</th><th>Availability</th></tr></thead>
        <tbody>
          {list.map((r) => {
            const a = payload.assignments.find((x) => x.taskId === taskId && x.resourceId === r.id);
            return (
              <tr key={r.id} className={a ? 'sel' : ''}>
                <td><input type="checkbox" checked={!!a} disabled={busy} onChange={() => (a ? void st.removeAssignment(a.id) : void assign(r.id))} /></td>
                <td>{r.name}</td>
                <td>{r.group ?? ''}</td>
                <td>{Math.round(r.maxUnits * 100)}%</td>
                <td>{fmtMoney(r.standardRate, payload.project.currency)}/h</td>
                <td>
                  {a ? (
                    <input defaultValue={`${Math.round(a.units * 100)}%`} onBlur={(e) => {
                      const v = e.target.value.trim();
                      const u = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) || 1;
                      void api.patch(`/api/assignments/${a.id}`, { units: u }).then(() => st.refresh());
                    }} />
                  ) : (
                    <input value={units[r.id] ?? '100%'} onChange={(e) => setUnits((s) => ({ ...s, [r.id]: e.target.value }))} />
                  )}
                </td>
                <td style={{ color: '#889' }}>{r.kind === 'work' ? 'Work' : r.kind === 'material' ? 'Material' : 'Cost'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 8, color: '#667', fontSize: 11 }}>
        Effort-driven scheduling: adding resources to a fixed-work task shortens its duration — the engine recalculates the whole programme.
      </div>
    </DialogFrame>
  );
}

/* ================================================================ Level Resources */

function LevelResourcesDialog() {
  const st = useSchedule();
  const [preview, setPreview] = useState<LevelingPreviewPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const projectId = st.projectId!;

  const run = () => {
    setBusy(true);
    api.post<LevelingPreviewPayload>(`/api/projects/${projectId}/leveling/preview`, {})
      .then(setPreview)
      .finally(() => setBusy(false));
  };
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    setBusy(true);
    api.post(`/api/projects/${projectId}/leveling/apply`, { delays: preview?.delays })
      .then(() => st.refresh())
      .finally(() => {
        setBusy(false);
        st.setDialog(null);
      });
  };
  const clear = () => {
    setBusy(true);
    api.post(`/api/projects/${projectId}/leveling/clear`, {})
      .then(() => st.refresh())
      .finally(() => {
        setBusy(false);
        st.setDialog(null);
      });
  };

  return (
    <DialogFrame
      title="Resource Leveling"
      wide
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button className="btn danger" onMouseDown={clear}>Clear Leveling</button>
          <button className="btn" onMouseDown={() => st.setDialog(null)}>Cancel</button>
          <button className="btn primary" disabled={!preview || preview.delays.length === 0 || busy} onMouseDown={apply}>Apply Delays</button>
        </>
      }
    >
      {!preview ? (
        <div>Evaluating over-allocations…</div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="k">Proposed delays</div><div className="v">{preview.delays.length}</div></div>
            <div className="kpi"><div className="k">Over-allocations resolved</div><div className="v">{preview.resolvedOverallocations}</div></div>
            <div className="kpi"><div className="k">Remaining</div><div className="v">{preview.remainingOverallocations.length}</div></div>
            <div className="kpi">
              <div className="k">Project finish</div>
              <div className="v">{fmtDate(preview.projectFinishBefore)} → {fmtDate(preview.projectFinishAfter)}</div>
            </div>
          </div>
          <table className="dtable">
            <thead><tr><th>Task</th><th>Delay</th><th>New start</th><th>Reason</th></tr></thead>
            <tbody>
              {preview.delays.map((d) => {
                const t = st.payload?.tasks.find((x) => x.id === d.taskId);
                return (
                  <tr key={d.taskId}>
                    <td>{t?.name}</td>
                    <td>{Math.round((d.delayMinutes / 480) * 10) / 10} d</td>
                    <td>{fmtDate(d.newStart)}</td>
                    <td style={{ color: '#667' }}>{d.reason}</td>
                  </tr>
                );
              })}
              {preview.delays.length === 0 && <tr><td colSpan={4}>No leveling required — no over-allocations found.</td></tr>}
            </tbody>
          </table>
          {preview.remainingOverallocations.length > 0 && (
            <div style={{ marginTop: 8, color: '#8a6d1a', fontSize: 11 }}>
              {preview.remainingOverallocations.length} over-allocation(s) cannot be resolved without delaying critical or do-not-level tasks.
            </div>
          )}
          <div style={{ marginTop: 8, color: '#667', fontSize: 11 }}>
            Leveling only introduces delays — dependencies, durations, constraints and baselines are never modified.
          </div>
        </>
      )}
    </DialogFrame>
  );
}

/* ================================================================ Baselines */

function BaselineDialog() {
  const st = useSchedule();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const projectId = st.projectId!;
  const baselines = st.payload?.baselines ?? [];

  const save = () => {
    setBusy(true);
    api.post(`/api/projects/${projectId}/baselines`, { name: name || undefined })
      .then(() => st.refresh())
      .finally(() => setBusy(false));
  };

  return (
    <DialogFrame
      title="Baselines"
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button className="btn" onMouseDown={() => st.setDialog(null)}>Close</button>
          <button className="btn primary" disabled={busy} onMouseDown={save}>Save New Baseline</button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input className="fin" placeholder={`Baseline ${baselines.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <table className="dtable">
        <thead><tr><th>Name</th><th>Saved</th><th>Current</th><th style={{ width: 190 }}>Actions</th></tr></thead>
        <tbody>
          {baselines.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{new Date(b.createdAt).toLocaleString('en-GB')}</td>
              <td>{b.isCurrent ? '✓' : ''}</td>
              <td>
                <button className="btn" style={{ minWidth: 0, height: 20, marginRight: 4 }} onMouseDown={() => {
                  setBusy(true);
                  api.get(`/api/projects/${projectId}/schedule`).then(() => {
                    void api.post(`/api/baselines/${b.id}/restore`).then(() => st.refresh()).finally(() => setBusy(false));
                  });
                }}>Restore</button>
                <button className="btn" style={{ minWidth: 0, height: 20 }} onMouseDown={() => {
                  void api.del(`/api/baselines/${b.id}`).then(() => st.refresh());
                }}>Delete</button>
              </td>
            </tr>
          ))}
          {baselines.length === 0 && <tr><td colSpan={4} style={{ color: '#889' }}>No baselines saved yet.</td></tr>}
        </tbody>
      </table>
      <div style={{ marginTop: 8, color: '#667', fontSize: 11 }}>
        Baselines snapshot task dates, work, cost and progress. The Tracking Gantt and variance reports compare the live schedule against the current baseline.
      </div>
    </DialogFrame>
  );
}

/* ================================================================ Progress entry */

function ProgressDialog({ taskId }: { taskId: string }) {
  const st = useSchedule();
  const payload = st.payload!;
  const task = payload.tasks.find((t) => t.id === taskId);
  const [form, setForm] = useState({ pct: '', actualStart: '', actualFinish: '', work: '', notes: '' });
  const val = (k: keyof typeof form): string => form[k] ?? '';
  const [busy, setBusy] = useState(false);
  if (!task) return null;

  const submit = () => {
    setBusy(true);
    st.recordProgress(taskId, {
      percentComplete: form.pct === '' ? undefined : Number(form.pct),
      actualStart: form.actualStart || undefined,
      actualFinish: form.actualFinish || undefined,
      actualWorkMinutes: form.work === '' ? undefined : Math.round(Number(form.work) * 60),
      notes: form.notes || undefined,
      asOf: payload.project.statusDate ?? new Date().toISOString(),
    })
      .then(() => st.setDialog(null))
      .finally(() => setBusy(false));
  };

  return (
    <DialogFrame
      title={`Update Progress — ${task.name}`}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button className="btn" onMouseDown={() => st.setDialog(null)}>Cancel</button>
          <button className="btn primary" disabled={busy} onMouseDown={submit}>Update</button>
        </>
      }
    >
      <div className="form-grid">
        <label>Current % complete</label><input className="fin ro" readOnly value={`${Math.round(task.computedPercentComplete ?? task.percentComplete)}%`} />
        <label>Current dates</label><input className="fin ro" readOnly value={`${fmtDate(task.computedStart)} → ${fmtDate(task.computedFinish)}`} />
        <label>New % complete</label><input className="fin" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} placeholder="0-100" />
        <label>Actual work (hours)</label><input className="fin" value={form.work} onChange={(e) => setForm({ ...form, work: e.target.value })} />
        <label>Actual start</label><input className="fin" type="date" value={val('actualStart')} onChange={(e) => setForm({ ...form, actualStart: e.target.value })} />
        <label>Actual finish</label><input className="fin" type="date" value={val('actualFinish')} onChange={(e) => setForm({ ...form, actualFinish: e.target.value })} />
        <label>Notes</label><textarea className="fin full" style={{ gridColumn: '2 / -1' }} value={val('notes')} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </DialogFrame>
  );
}

/* ================================================================ Dependency */

function DependencyDialog({ depId }: { depId: string }) {
  const st = useSchedule();
  const payload = st.payload!;
  const dep = payload.dependencies.find((x) => x.id === depId);
  const pred = payload.tasks.find((t) => t.id === dep?.predecessorId);
  const succ = payload.tasks.find((t) => t.id === dep?.successorId);
  const [type, setType] = useState(dep?.type ?? 'FS');
  const [lagDays, setLagDays] = useState(String(dep ? Math.round((dep.lagMinutes / payload.project.minutesPerDay) * 10) / 10 : 0));
  const [busy, setBusy] = useState(false);
  if (!dep || !pred || !succ) return null;

  const save = async () => {
    setBusy(true);
    try {
      await st.updateDep(depId, { type, lagMinutes: Math.round(Number(lagDays || 0) * payload.project.minutesPerDay) });
      st.setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      title="Dependency"
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button className="btn danger" disabled={busy} onMouseDown={async () => {
            setBusy(true);
            await api.del(`/api/dependencies/${depId}`).then(() => st.refresh());
            st.setDialog(null);
          }}>Delete</button>
          <button className="btn" onMouseDown={() => st.setDialog(null)}>Cancel</button>
          <button className="btn primary" disabled={busy} onMouseDown={() => void save()}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <label>Predecessor</label><input className="fin ro" readOnly value={pred.name} />
        <label>Successor</label><input className="fin ro" readOnly value={succ.name} />
        <label>Type</label>
        <select className="fin" value={type} onChange={(e) => setType(e.target.value as never)}>
          <option value="FS">Finish-to-Start (FS)</option>
          <option value="SS">Start-to-Start (SS)</option>
          <option value="FF">Finish-to-Finish (FF)</option>
          <option value="SF">Start-to-Finish (SF)</option>
        </select>
        <label>Lag (days)</label>
        <input className="fin" value={lagDays} onChange={(e) => setLagDays(e.target.value)} placeholder="e.g. 2 or -1" />
        <label>Effect</label>
        <span className="full" style={{ fontSize: 11.5, color: '#556' }}>
          {type === 'FS' ? `${succ.name} starts after ${pred.name} finishes` :
           type === 'SS' ? `${succ.name} starts with ${pred.name}` :
           type === 'FF' ? `${succ.name} finishes with ${pred.name}` :
           `${succ.name} finishes when ${pred.name} starts`}
          {Number(lagDays) ? `, offset by ${lagDays} working day(s)` : ''}.
        </span>
      </div>
    </DialogFrame>
  );
}

/* ================================================================ Calendar dialog */

function CalendarDialog() {
  const st = useSchedule();
  const payload = st.payload!;
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const cal = payload.calendars.find((c) => c.id === payload.settings.defaultCalendarId) ?? payload.calendars[0];
  const mpd = payload.project.minutesPerDay;

  const addHoliday = () => {
    if (!date || !cal) return;
    setBusy(true);
    api.post(`/api/calendars/${cal.id}/exceptions`, { date, periods: [], label: label || 'Holiday' })
      .then(() => st.refresh())
      .finally(() => setBusy(false));
  };
  const removeException = (id: string) => {
    setBusy(true);
    api.del(`/api/calendar-exceptions/${id}`).then(() => st.refresh()).finally(() => setBusy(false));
  };

  return (
    <DialogFrame title="Change Working Time" onClose={() => st.setDialog(null)} footer={<button className="btn primary" onMouseDown={() => st.setDialog(null)}>OK</button>}>
      {cal ? (
        <>
          <div className="form-grid">
            <label>Calendar</label>
            <select className="fin" value={cal.id} onChange={() => void 0}>
              {payload.calendars.map((c) => <option key={c.id}>{c.name}</option>)}
            </select>
            <label>Working time</label>
            <span className="full">
              {cal.workingDays
                .slice()
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.dayOfWeek])
                .join(', ')}{' '}
              · {cal.workingDays[0]?.periods.map((p) => `${p.start}–${p.end}`).join(', ') || '—'} ({mpd / 60}h/day)
            </span>
          </div>
          <div style={{ marginTop: 12, fontWeight: 600 }}>Exceptions &amp; holidays</div>
          <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
            <input className="fin" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="fin" placeholder="Label (e.g. Christmas Day)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button className="btn" disabled={busy || !date} onMouseDown={addHoliday}>Add Holiday</button>
          </div>
          <table className="dtable">
            <thead><tr><th>Date</th><th>Label</th><th>Effect</th><th></th></tr></thead>
            <tbody>
              {cal.exceptions.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.label}</td>
                  <td>{e.periods.length === 0 ? 'Non-working' : e.periods.map((p) => `${p.start}–${p.end}`).join(', ')}</td>
                  <td><button className="btn" style={{ minWidth: 0, height: 20 }} onMouseDown={() => removeException(e.id)}>✕</button></td>
                </tr>
              ))}
              {cal.exceptions.length === 0 && <tr><td colSpan={4} style={{ color: '#889' }}>No exceptions</td></tr>}
            </tbody>
          </table>
        </>
      ) : (
        <div>No calendar found.</div>
      )}
    </DialogFrame>
  );
}

/* ================================================================ Project settings */

function SettingsDialog() {
  const st = useSchedule();
  const payload = st.payload!;
  const project = payload.project;
  const [form, setForm] = useState({
    projectStart: project.projectStart?.slice(0, 10) ?? '',
    statusDate: project.statusDate?.slice(0, 10) ?? '',
    deadline: project.projectDeadline?.slice(0, 10) ?? '',
    minutesPerDay: String(project.minutesPerDay),
    newTaskType: String(payload.settings.newTaskType ?? 'fixed_units'),
    newTasksEffortDriven: String(payload.settings.newTasksEffortDriven ?? true),
    multipleCriticalPaths: String(payload.settings.multipleCriticalPaths ?? false),
  });
  const val = (k: keyof typeof form): string => form[k] ?? '';
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/projects/${st.projectId}`, {
        projectStart: form.projectStart ? new Date(`${form.projectStart}T08:00:00Z`).toISOString() : undefined,
        statusDate: form.statusDate ? new Date(`${form.statusDate}T17:00:00Z`).toISOString() : null,
        projectDeadline: form.deadline ? new Date(`${form.deadline}T17:00:00Z`).toISOString() : null,
        minutesPerDay: Number(form.minutesPerDay) || 480,
      });
      await api.patch(`/api/projects/${st.projectId}/settings`, {
        newTaskType: form.newTaskType,
        newTasksEffortDriven: form.newTasksEffortDriven === 'true',
        multipleCriticalPaths: form.multipleCriticalPaths === 'true',
      });
      await st.refresh();
      st.setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      title="Project Settings"
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button className="btn" onMouseDown={() => st.setDialog(null)}>Cancel</button>
          <button className="btn primary" disabled={busy} onMouseDown={() => void save()}>OK</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-section">Schedule</div>
        <label>Project start</label><input className="fin" type="date" value={form.projectStart} onChange={(e) => setForm({ ...form, projectStart: e.target.value })} />
        <label>Status date</label><input className="fin" type="date" value={form.statusDate} onChange={(e) => setForm({ ...form, statusDate: e.target.value })} />
        <label>Project deadline</label><input className="fin" type="date" value={val('deadline')} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        <label>Hours per day</label>
        <select className="fin" value={form.minutesPerDay} onChange={(e) => setForm({ ...form, minutesPerDay: e.target.value })}>
          <option value="480">8.0</option><option value="450">7.5</option><option value="420">7.0</option><option value="360">6.0</option>
        </select>
        <div className="form-section">New tasks</div>
        <label>Default task type</label>
        <select className="fin" value={form.newTaskType} onChange={(e) => setForm({ ...form, newTaskType: e.target.value })}>
          <option value="fixed_units">Fixed Units</option><option value="fixed_duration">Fixed Duration</option><option value="fixed_work">Fixed Work</option>
        </select>
        <label>New tasks effort driven</label>
        <select className="fin" value={form.newTasksEffortDriven} onChange={(e) => setForm({ ...form, newTasksEffortDriven: e.target.value })}>
          <option value="true">Yes</option><option value="false">No</option>
        </select>
        <div className="form-section">Calculation</div>
        <label>Multiple critical paths</label>
        <select className="fin" value={form.multipleCriticalPaths} onChange={(e) => setForm({ ...form, multipleCriticalPaths: e.target.value })}>
          <option value="false">Single driving path</option><option value="true">Calculate multiple critical paths</option>
        </select>
      </div>
    </DialogFrame>
  );
}

export { parseDateInput };

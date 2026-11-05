import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSchedule } from './store';
import { fmtDur, fmtMoney } from './format';

/* ================================================================
   AppShell — title bar + menu bar + ribbon + view strip + status bar
   ================================================================ */

export function AppShell({ children, projectName }: { children: React.ReactNode; projectName?: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TitleBar projectName={projectName} />
      <MenuBar />
      <Ribbon />
      <div className="main">
        <ViewStrip />
        <div className="pane-wrap">{children}</div>
        <CopilotHost />
      </div>
      <StatusBar />
    </div>
  );
}

function TitleBar({ projectName }: { projectName?: string }) {
  return (
    <div className="titlebar">
      <span className="brand">
        <span className="logo">BF</span>
        BiltFlow Pulse
      </span>
      <span className="crumb">— Construction Programme Management</span>
      {projectName ? <span className="crumb">· {projectName}</span> : null}
      <span className="spacer" />
      <span className="env-tag">Beta</span>
    </div>
  );
}

/* ------------------------------- menu bar */

function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const nav = useNavigate();
  const st = useSchedule();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const selected = st.selectedTaskIds;
  const selTask = st.payload?.tasks.find((t) => t.id === selected[0]);

  const menus: Record<string, Array<{ label: string; ks?: string; action?: () => void; sep?: boolean; disabled?: boolean }>> = {
    File: [
      { label: 'New Project…', ks: 'Ctrl+N', action: () => nav('/portfolio?new=1') },
      { label: 'Open Portfolio', ks: 'Ctrl+O', action: () => nav('/portfolio') },
      { label: 'Import Programme…', action: () => nav('/portfolio?import=1') },
      { sep: true, label: '' },
      { label: 'Save Baseline…', action: () => st.setDialog({ kind: 'baseline' }) },
      { label: 'Project Settings…', action: () => st.setDialog({ kind: 'settings' }) },
      { label: 'Change Working Time…', action: () => st.setDialog({ kind: 'calendar' }) },
    ],
    Task: [
      { label: 'Task Information…', ks: 'Shift+F2', disabled: !selTask, action: () => selTask && st.setDialog({ kind: 'task-info', taskId: selTask.id }) },
      { label: 'Insert New Task', ks: 'Ins', action: () => void st.createTask(selected[0] ?? null) },
      { label: 'Delete Task', ks: 'Del', disabled: selected.length === 0, action: () => void st.deleteTasks(selected) },
      { sep: true, label: '' },
      { label: 'Link Tasks', ks: 'Ctrl+F2', disabled: selected.length < 2, action: () => void st.link(selected[0], selected[1]) },
      { label: 'Unlink Tasks', ks: 'Ctrl+Shift+F2', disabled: selected.length < 2, action: () => void st.unlink(selected) },
      { sep: true, label: '' },
      { label: 'Assign Resources…', ks: 'Alt+F10', disabled: !selTask, action: () => selTask && st.setDialog({ kind: 'assign', taskId: selTask.id }) },
      { label: 'Update Progress…', disabled: !selTask, action: () => selTask && st.setDialog({ kind: 'progress', taskId: selTask.id }) },
    ],
    View: [
      { label: 'Gantt Chart', action: () => st.setView('gantt') },
      { label: 'Tracking Gantt', action: () => st.setView('tracking') },
      { label: 'Resource Sheet', action: () => st.setView('resource-sheet') },
      { label: 'Resource Usage', action: () => st.setView('resource-usage') },
      { label: 'Network Diagram', action: () => st.setView('network') },
      { label: 'WBS View', action: () => st.setView('wbs') },
      { label: 'Progress & Costs', action: () => st.setView('costs') },
      { sep: true, label: '' },
      { label: `${st.showCritical ? '✓ ' : ''}Critical Path`, action: () => st.setFlag('showCritical', !st.showCritical) },
      { label: `${st.showBaseline ? '✓ ' : ''}Baseline Bars`, action: () => st.setFlag('showBaseline', !st.showBaseline) },
      { label: `${st.showSlack ? '✓ ' : ''}Slack`, action: () => st.setFlag('showSlack', !st.showSlack) },
      { label: `${st.showCopilot ? '✓ ' : ''}AI Copilot Panel`, action: () => st.setFlag('showCopilot', !st.showCopilot) },
    ],
    Schedule: [
      { label: 'Recalculate Now', ks: 'F9', action: () => void fetch(`/api/projects/${st.projectId}/recalculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(() => st.refresh()) },
      { label: 'Level Resources…', action: () => st.setDialog({ kind: 'level' }) },
      { label: 'Baselines…', action: () => st.setDialog({ kind: 'baseline' }) },
      { label: 'Set Status Date…', action: () => st.setDialog({ kind: 'settings' }) },
    ],
    Help: [
      { label: 'About BiltFlow Pulse', action: () => alert('BiltFlow Pulse 0.1\nConstruction programme management.\nScheduling engine: CPM with working-time calendars.\nBackend: NestJS + PostgreSQL · Frontend: React') },
    ],
  };

  return (
    <div className="menubar" ref={ref}>
      {Object.keys(menus).map((name) => (
        <div
          key={name}
          className={`menu-item ${open === name ? 'open' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); setOpen(open === name ? null : name); }}
          onMouseEnter={() => open && setOpen(name)}
        >
          {name}
        </div>
      ))}
      <div className="right">
        <input className="search" placeholder="Find a task…" onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const q = (e.target as HTMLInputElement).value.toLowerCase();
            const hit = st.payload?.tasks.find((t) => t.name.toLowerCase().includes(q));
            if (hit) {
              st.select([hit.id]);
              st.setActiveCell({ taskId: hit.id, column: 'name' });
            }
          }
        }} />
      </div>
      {open && (
        <div className="menu-pop" style={{ top: 56, left: Math.max(8, [...Object.keys(menus)].indexOf(open) * 62 + 8) }}>
          {menus[open].map((mi, i) =>
            mi.sep ? (
              <div key={i} className="sep" />
            ) : (
              <div key={i} className={`mi ${mi.disabled ? 'disabled' : ''}`} onMouseDown={(e) => { e.preventDefault(); setOpen(null); mi.action?.(); }}>
                <span>{mi.label}</span>
                <span className="ks">{mi.ks}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- ribbon */

function Ribbon() {
  const st = useSchedule();
  const sel = st.selectedTaskIds;
  const selTask = st.payload?.tasks.find((t) => t.id === sel[0]);
  const disabled = sel.length === 0;

  return (
    <div className="ribbon" onKeyDown={(e) => e.stopPropagation()}>
      <div className="group">
        <div className="controls">
          <button className="rbtn" title="Task Information (Shift+F2)" disabled={disabled} onClick={() => selTask && st.setDialog({ kind: 'task-info', taskId: selTask.id })}>
            <span className="ic">ℹ️</span><span className="lbl">Info</span>
          </button>
          <button className="rbtn" title="Assign Resources (Alt+F10)" disabled={disabled} onClick={() => selTask && st.setDialog({ kind: 'assign', taskId: selTask.id })}>
            <span className="ic">👥</span><span className="lbl">Assign</span>
          </button>
          <button className="rbtn" title="Add task above selection" onClick={() => void st.createTask(null, 'New task')}>
            <span className="ic">➕</span><span className="lbl">New</span>
          </button>
          <button className="rbtn" title="Delete task (Del)" disabled={disabled} onClick={() => void st.deleteTasks(sel)}>
            <span className="ic">🗑️</span><span className="lbl">Delete</span>
          </button>
        </div>
        <div className="label">Task</div>
      </div>

      <div className="group">
        <div className="controls">
          <button className="rbtn small" title="Outdent (Alt+Shift+←)" disabled={disabled} onClick={() => void st.outdent(sel[0])}><span className="ic">⇤</span></button>
          <button className="rbtn small" title="Indent (Alt+Shift+→)" disabled={disabled} onClick={() => void st.indent(sel[0])}><span className="ic">⇥</span></button>
          <button className="rbtn small" title="Link tasks (Ctrl+F2)" disabled={sel.length < 2} onClick={() => void st.link(sel[0], sel[1])}><span className="ic">🔗</span></button>
          <button className="rbtn small" title="Unlink (Ctrl+Shift+F2)" disabled={sel.length < 2} onClick={() => void st.unlink(sel)}><span className="ic">⛓️‍💥</span></button>
          <span style={{ width: 8 }} />
          <button className="rbtn small" title="0% complete" disabled={disabled} onClick={() => void st.updateTask(sel[0], { percentComplete: 0 }, 'Set 0%')}><span className="ic">0%</span></button>
          <button className="rbtn small" title="25% complete" disabled={disabled} onClick={() => void st.updateTask(sel[0], { percentComplete: 25 }, 'Set 25%')}><span className="ic">25%</span></button>
          <button className="rbtn small" title="50% complete" disabled={disabled} onClick={() => void st.updateTask(sel[0], { percentComplete: 50 }, 'Set 50%')}><span className="ic">50%</span></button>
          <button className="rbtn small" title="75% complete" disabled={disabled} onClick={() => void st.updateTask(sel[0], { percentComplete: 75 }, 'Set 75%')}><span className="ic">75%</span></button>
          <button className="rbtn small" title="100% complete" disabled={disabled} onClick={() => void st.updateTask(sel[0], { percentComplete: 100 }, 'Set 100%')}><span className="ic">100%</span></button>
        </div>
        <div className="label">Schedule</div>
      </div>

      <div className="group">
        <div className="controls">
          <button className={`rbtn small ${st.showCritical ? 'on' : ''}`} title="Critical path" onClick={() => st.setFlag('showCritical', !st.showCritical)}><span className="ic">🟥</span></button>
          <button className={`rbtn small ${st.showBaseline ? 'on' : ''}`} title="Baseline bars" onClick={() => st.setFlag('showBaseline', !st.showBaseline)}><span className="ic">📊</span></button>
          <button className={`rbtn small ${st.showSlack ? 'on' : ''}`} title="Slack" onClick={() => st.setFlag('showSlack', !st.showSlack)}><span className="ic">⏳</span></button>
          <select
            className="rselect"
            title="Bar labels"
            value={st.labelMode}
            onChange={(e) => st.setLabelMode(e.target.value as 'name' | 'resources' | 'none')}
          >
            <option value="name">Label: Names</option>
            <option value="resources">Label: Resources</option>
            <option value="none">Label: Off</option>
          </select>
          <button className="rbtn" title="Scroll to task" disabled={disabled} onClick={() => document.dispatchEvent(new CustomEvent('pulse:scroll-to-task', { detail: sel[0] }))}>
            <span className="ic">🔍</span><span className="lbl">Go To</span>
          </button>
          <button className="rbtn" title="Fit entire project in timeline" onClick={() => document.dispatchEvent(new CustomEvent('pulse:fit-project'))}>
            <span className="ic">⛶</span><span className="lbl">Fit</span>
          </button>
        </div>
        <div className="label">Format</div>
      </div>

      <div className="group">
        <div className="controls">
          <button className="rbtn" title="Level Resources…" onClick={() => st.setDialog({ kind: 'level' })}><span className="ic">⚖️</span><span className="lbl">Level</span></button>
          <button className="rbtn" title="Baselines…" onClick={() => st.setDialog({ kind: 'baseline' })}><span className="ic">📷</span><span className="lbl">Baseline</span></button>
          <button className="rbtn" title="Working time / calendars" onClick={() => st.setDialog({ kind: 'calendar' })}><span className="ic">📅</span><span className="lbl">Calendars</span></button>
          <button className="rbtn" title="Project settings" onClick={() => st.setDialog({ kind: 'settings' })}><span className="ic">⚙️</span><span className="lbl">Settings</span></button>
        </div>
        <div className="label">Manage</div>
      </div>

      <div className="group">
        <div className="controls">
          <button className="rbtn small" title="Undo (Ctrl+Z)" disabled={st.undoStack.length === 0} onClick={() => void st.undo()}><span className="ic">↩️</span></button>
          <button className="rbtn small" title="Redo (Ctrl+Y)" disabled={st.redoStack.length === 0} onClick={() => void st.redo()}><span className="ic">↪️</span></button>
          <button className={`rbtn ${st.showCopilot ? 'on' : ''}`} title="AI Copilot" onClick={() => st.setFlag('showCopilot', !st.showCopilot)}>
            <span className="ic">✨</span><span className="lbl">Copilot</span>
          </button>
        </div>
        <div className="label">Edit &amp; AI</div>
      </div>
    </div>
  );
}

/* ------------------------------- view strip */

function ViewStrip() {
  const st = useSchedule();
  const items: { key: string; icon: string; title: string }[] = [
    { key: 'gantt', icon: '📊', title: 'Gantt Chart' },
    { key: 'tracking', icon: '📈', title: 'Tracking Gantt' },
    { key: 'resource-sheet', icon: '👥', title: 'Resource Sheet' },
    { key: 'resource-usage', icon: '📶', title: 'Resource Usage' },
    { key: 'network', icon: '🕸️', title: 'Network Diagram' },
    { key: 'wbs', icon: '🌳', title: 'WBS' },
    { key: 'costs', icon: '💰', title: 'Progress & Costs' },
  ];
  return (
    <div className="viewstrip">
      {items.map((it) => (
        <button
          key={it.key}
          className={`vbtn ${st.view === it.key ? 'active' : ''}`}
          title={it.title}
          onClick={() => st.setView(it.key as never)}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- status bar */

function StatusBar() {
  const st = useSchedule();
  const p = st.payload?.project;
  const nTasks = st.payload?.tasks.length ?? 0;
  const currency = p?.currency ?? 'USD';
  const totalCost = st.payload?.tasks.reduce((s, t) => s + (t.computedPlannedCost ?? 0), 0) ?? 0;
  return (
    <div className="statusbar">
      <span className="cell">{st.statusMessage}</span>
      {st.warnings.length > 0 && (
        <span className="cell" title={st.warnings.map((w) => w.message).join('\n')}>⚠ {st.warnings.length} warning(s)</span>
      )}
      <span className="sep" />
      <span className="cell">{nTasks} tasks</span>
      <span className="cell">Finish: {p?.computedFinish ? new Date(p.computedFinish).toLocaleDateString('en-GB') : '—'}</span>
      <span className="cell">Cost: {fmtMoney(totalCost, currency)}</span>
      <span className="sep" />
      <span className="cell">v{st.payload?.scheduleVersion ?? 0}</span>
      <div className="right">
        <span className="cell">{st.undoStack.length > 0 ? `Undo ×${st.undoStack.length}` : 'Ready'}</span>
        <span className="cell"><input type="range" className="zoom" min={6} max={120} value={st.zoom} onChange={(e) => st.setZoom(Number(e.target.value))} title="Zoom" /></span>
      </div>
    </div>
  );
}

/* ------------------------------- copilot host */

import { CopilotPanel } from './views';
function CopilotHost() {
  const show = useSchedule((s) => s.showCopilot);
  if (!show) return null;
  return <CopilotPanel />;
}

export function durationSummary(minutes: number | null | undefined, mpd: number): string {
  return fmtDur(minutes, { minutesPerDay: mpd, minutesPerWeek: mpd * 5, daysPerMonth: 20 });
}

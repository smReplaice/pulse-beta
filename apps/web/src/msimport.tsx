import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { fmtDate } from './format';

/* ================================================================
   MS Project import — upload → analyze (preview, no changes) →
   confirm (atomic import) → result. Mirrors the backend two-phase
   token flow; double-submits are disabled while in flight.
   ================================================================ */

interface AnalyzeResponse {
  token: string;
  filename: string;
  format: 'xml' | 'mpp';
  sizeBytes: number;
  expiresAt: string;
  project: { name: string; start: string | null; hoursPerDay: number };
  counts: {
    taskCount: number;
    summaryCount: number;
    milestoneCount: number;
    dependencyCount: number;
    resourceCount: number;
    assignmentCount: number;
    calendarCount: number;
    baselineCount: number;
    dateRange: { start: string | null; finish: string | null };
    hierarchyPreview: { name: string; level: number; milestone: boolean; start: string | null; finish: string | null }[];
  };
  wbsPreview: string[];
  errors: { code: string; message: string }[];
  warnings: string[];
  converterConfigured?: boolean;
  options?: { preserveDates?: boolean };
}

export function MsProjectImportDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'analyze' | 'commit' | null>(null);
  const [preview, setPreview] = useState<AnalyzeResponse | null>(null);
  const [result, setResult] = useState<{ projectId: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = async () => {
    if (!file || busy) return;
    setBusy('analyze');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/msproject/import/analyze', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Analysis failed');
      setPreview(body as AnalyzeResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!preview || busy) return;
    setBusy('commit');
    setError(null);
    try {
      const res = await api.post<{ projectId: string; name: string }>('/api/msproject/import/commit', {
        token: preview.token,
        preserveDates: preview.options?.preserveDates ?? true,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const blocking = (preview?.errors.length ?? 0) > 0;

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide">
        <div className="dialog-title">
          <span>Import Microsoft Project</span>
          <button className="btn" style={{ minWidth: 24, height: 20, padding: 0 }} onMouseDown={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          {result ? (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                ✓ Imported “{result.name}”
              </div>
              <p style={{ color: '#556' }}>
                {preview?.counts.taskCount} tasks · {preview?.counts.dependencyCount} links · {preview?.counts.resourceCount} resources ·
                baseline{preview?.counts.baselineCount === 1 ? '' : 's'} and progress preserved with source UIDs for traceability.
              </p>
              <p style={{ color: '#556' }}>
                Imported tasks keep their source dates (manual scheduling). Run <b>Schedule → Recalculate</b> inside the project
                when you want Pulse’s CPM engine to take over — that is an explicit operation.
              </p>
              <div className="dialog-foot" style={{ padding: '12px 0 0' }}>
                <button className="btn" onMouseDown={onClose}>Stay in Portfolio</button>
                <button className="btn primary" onMouseDown={() => nav(`/project/${result.projectId}`)}>Open Project</button>
              </div>
            </div>
          ) : (
            <>
              <div className="toolbar-row" style={{ marginBottom: 10 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xml,.mpp"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
                <button className="btn primary" disabled={!file || busy !== null} onMouseDown={() => void analyze()}>
                  {busy === 'analyze' ? 'Analyzing…' : 'Analyze'}
                </button>
                {file && <span style={{ color: '#556' }}>{file.name} ({Math.round(file.size / 1024)} KB)</span>}
              </div>

              {error && (
                <div className="chip warn" style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{error}</div>
              )}

              {preview && (
                <>
                  <div className="kpis">
                    <div className="kpi"><div className="k">Tasks</div><div className="v">{preview.counts.taskCount}</div></div>
                    <div className="kpi"><div className="k">Summaries</div><div className="v">{preview.counts.summaryCount}</div></div>
                    <div className="kpi"><div className="k">Milestones</div><div className="v">{preview.counts.milestoneCount}</div></div>
                    <div className="kpi"><div className="k">Links</div><div className="v">{preview.counts.dependencyCount}</div></div>
                    <div className="kpi"><div className="k">Resources</div><div className="v">{preview.counts.resourceCount}</div></div>
                    <div className="kpi"><div className="k">Assignments</div><div className="v">{preview.counts.assignmentCount}</div></div>
                    <div className="kpi"><div className="k">Calendars</div><div className="v">{preview.counts.calendarCount}</div></div>
                    <div className="kpi"><div className="k">Baselines</div><div className="v">{preview.counts.baselineCount}</div></div>
                  </div>

                  <div className="form-grid" style={{ margin: '10px 0' }}>
                    <label>Project</label><input className="fin ro" readOnly value={preview.project.name} />
                    <label>Date range</label>
                    <input className="fin ro" readOnly value={`${fmtDate(preview.counts.dateRange.start)} → ${fmtDate(preview.counts.dateRange.finish)}`} />
                    <label>Source</label>
                    <input className="fin ro" readOnly value={`${preview.format.toUpperCase()} · ${preview.filename} · expires ${new Date(preview.expiresAt).toLocaleTimeString('en-GB')}`} />
                  </div>

                  {preview.counts.hierarchyPreview.length > 0 && (
                    <>
                      <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Task hierarchy (first {preview.counts.hierarchyPreview.length})</div>
                      <div className="tscroll" style={{ maxHeight: 150 }}>
                        <table className="dtable">
                          <tbody>
                            {preview.counts.hierarchyPreview.map((t, i) => (
                              <tr key={i}>
                                <td style={{ paddingLeft: 6 + t.level * 14, width: 300 }}>
                                  {t.milestone ? '◆ ' : ''}{t.name}
                                </td>
                                <td>{t.start ? fmtDate(t.start) : ''}</td>
                                <td>{t.finish ? fmtDate(t.finish) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {blocking && (
                    <>
                      <div style={{ fontWeight: 600, color: '#b3261e', margin: '10px 0 4px' }}>
                        Blocking errors — fix these in Microsoft Project and re-export
                      </div>
                      {preview.errors.map((e, i) => (
                        <div key={i} className="chip crit" style={{ display: 'block', marginBottom: 4 }}>✕ {e.message}</div>
                      ))}
                    </>
                  )}
                  <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>Mapping notes &amp; limitations</div>
                  <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid var(--grid-line)', borderRadius: 4, padding: 6 }}>
                    {preview.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#66707c', marginBottom: 3 }}>• {w}</div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        {!result && (
          <div className="dialog-foot">
            <button className="btn" onMouseDown={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={!preview || blocking || busy !== null}
              onMouseDown={() => void commit()}
            >
              {busy === 'commit' ? 'Importing…' : 'Confirm Import'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

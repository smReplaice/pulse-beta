import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell';
import { PortfolioView, ProjectView } from './views';
import { DialogHost } from './dialogs';
import { useSchedule } from './store';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/portfolio" replace />} />
        <Route path="/portfolio" element={<ShellWrap><PortfolioView /></ShellWrap>} />
        <Route path="/project/:id" element={<ShellWrap project><ProjectView /></ShellWrap>} />
      </Routes>
      <DialogHost />
      <GlobalKeys />
    </BrowserRouter>
  );
}

function ShellWrap({ children, project }: { children: React.ReactNode; project?: boolean }) {
  const projectName = useSchedule((s) => (project ? s.payload?.project.name : undefined));
  return <AppShell projectName={projectName}>{children}</AppShell>;
}

/** Global keyboard shortcuts (MS Project style). */
function GlobalKeys() {
  const st = useSchedule();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      const sel = st.selectedTaskIds;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void st.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        void st.redo();
      } else if (e.key === 'Insert') {
        e.preventDefault();
        void st.createTask(sel[0] ?? null);
      } else if (e.key === 'Delete' && sel.length > 0) {
        e.preventDefault();
        void st.deleteTasks(sel);
      } else if (e.altKey && e.shiftKey && e.key === 'ArrowRight' && sel[0]) {
        e.preventDefault();
        void st.indent(sel[0]);
      } else if (e.altKey && e.shiftKey && e.key === 'ArrowLeft' && sel[0]) {
        e.preventDefault();
        void st.outdent(sel[0]);
      } else if (mod && e.key === 'F2' && sel.length >= 2) {
        e.preventDefault();
        void st.link(sel[0], sel[1]);
      } else if (mod && e.shiftKey && e.key === 'F2' && sel.length >= 2) {
        e.preventDefault();
        void st.unlink(sel);
      } else if (e.shiftKey && e.key === 'F2' && sel[0]) {
        e.preventDefault();
        st.setDialog({ kind: 'task-info', taskId: sel[0] });
      } else if (e.altKey && e.key === 'F10' && sel[0]) {
        e.preventDefault();
        st.setDialog({ kind: 'assign', taskId: sel[0] });
      } else if (e.key === 'F2' && st.activeCell) {
        e.preventDefault();
        st.setEditingCell(st.activeCell);
      } else if (e.key === 'Enter' && st.activeCell && !st.editingCell) {
        e.preventDefault();
        st.setEditingCell(st.activeCell);
      } else if (e.key === 'Escape' && st.editingCell) {
        st.setEditingCell(null);
      } else if (e.key === 'F9') {
        e.preventDefault();
        void fetch(`/api/projects/${st.projectId}/recalculate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then(() => st.refresh());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [st]);
  return null;
}

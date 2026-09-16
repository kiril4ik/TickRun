import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronRight, CircleStop, Clock3, FileText, History, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from './api';
import type { Job, JobInput, RunLog, ScheduleKind } from './types';

type EditorState = Omit<JobInput, 'runAt'> & {
  id?: string;
  runDate: string;
  runTime: string;
};

const emptyEditor: EditorState = {
  name: '',
  command: '',
  workingDir: null,
  scheduleKind: 'recurring',
  cron: '0 9 * * *',
  runDate: '',
  runTime: '',
  enabled: true,
};

const presets = [
  ['Every 5 minutes', '*/5 * * * *'],
  ['Every hour', '0 * * * *'],
  ['Every day at 09:00', '0 9 * * *'],
  ['Every weekday at 09:00', '0 9 * * 1-5'],
] as const;

function formatWhen(job: Job) {
  if (job.scheduleKind === 'once') return job.runAt ? `Once · ${new Date(job.runAt).toLocaleString()}` : 'Once';
  return job.cron ?? 'No schedule';
}

function localDateTimeParts(value: string | null) {
  if (!value) return { runDate: '', runTime: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { runDate: '', runTime: '' };
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    runDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    runTime: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function editorFor(job: Job): EditorState {
  return {
    id: job.id,
    name: job.name,
    command: job.command,
    workingDir: job.workingDir,
    scheduleKind: job.scheduleKind,
    cron: job.cron,
    enabled: job.enabled,
    ...localDateTimeParts(job.runAt),
  };
}

function toIsoDateTime(runDate: string, runTime: string) {
  if (!runDate || !runTime) return null;
  const [year, month, day] = runDate.split('-').map(Number);
  const [hour, minute] = runTime.split(':').map(Number);
  const value = new Date(year, month - 1, day, hour, minute);
  if (
    Number.isNaN(value.getTime())
    || value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== day
    || value.getHours() !== hour
    || value.getMinutes() !== minute
  ) return null;
  return value.toISOString();
}

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null);
  const [pendingHistoryClear, setPendingHistoryClear] = useState<Job | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);
  const selectedRuns = useMemo(() => selectedId ? runs.filter((r) => r.jobId === selectedId) : runs, [runs, selectedId]);

  async function refresh() {
    try {
      const [nextJobs, nextRuns] = await Promise.all([api.listJobs(), api.listRuns()]);
      setJobs(nextJobs);
      setRuns(nextRuns);
      setSelectedId((current) => current && nextJobs.some((job) => job.id === current)
        ? current
        : nextJobs[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function save() {
    if (!editor) return;
    if (!editor.name.trim() || !editor.command.trim()) {
      setError('Name and command are required.');
      return;
    }
    const runAt = editor.scheduleKind === 'once'
      ? toIsoDateTime(editor.runDate, editor.runTime)
      : null;
    if (editor.scheduleKind === 'once' && !runAt) {
      setError('Choose both a valid date and time.');
      return;
    }
    const { runDate: _runDate, runTime: _runTime, ...input } = editor;
    setBusy('save');
    setError(null);
    try {
      const saved = await api.saveJob({
        ...input,
        cron: editor.scheduleKind === 'recurring' ? editor.cron : null,
        runAt,
      });
      setJobs((current) => [saved, ...current.filter((job) => job.id !== saved.id)]);
      setEditor(null);
      setSelectedId(saved.id);
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function toggleEnabled(job: Job) {
    setBusy(`toggle:${job.id}`);
    setError(null);
    try {
      const updated = await api.setEnabled(job.id, !job.enabled);
      setJobs((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function runNow(job: Job) {
    setBusy(job.id);
    setError(null);
    try {
      const log = await api.runNow(job.id);
      setRuns((prev) => [log, ...prev]);
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!pendingDelete) return;
    const job = pendingDelete;
    setBusy(`delete:${job.id}`);
    setError(null);
    try {
      await api.deleteJob(job.id);
      const remaining = jobs.filter((item) => item.id !== job.id);
      setJobs(remaining);
      setRuns((current) => current.filter((run) => run.jobId !== job.id));
      setSelectedId((current) => current === job.id ? remaining[0]?.id ?? null : current);
      setPendingDelete(null);
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function clearHistory() {
    if (!pendingHistoryClear) return;
    const job = pendingHistoryClear;
    setBusy(`clear:${job.id}`);
    setError(null);
    try {
      await api.clearJobRuns(job.id);
      setRuns((current) => current.filter((run) => run.jobId !== job.id));
      setPendingHistoryClear(null);
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="brandMark"><Clock3 size={17}/></span><strong>TickRun</strong></div>
      <button className="primary" onClick={() => setEditor({ ...emptyEditor })}><Plus size={16}/> New job</button>
    </header>

    {error && <div className="error"><span>{error}</span><button onClick={() => setError(null)}><X size={16}/></button></div>}

    <main className="layout">
      <aside className="jobsPane">
        <div className="paneTitle"><span>Jobs</span><small>{jobs.length}</small></div>
        <div className="jobList">
          {jobs.length === 0 && <div className="emptySmall">No jobs yet.<br/>Create one to get started.</div>}
          {jobs.map((job) => <button key={job.id} className={`jobRow ${selectedId === job.id ? 'active' : ''}`} onClick={() => setSelectedId(job.id)}>
            <span className={`status ${job.enabled ? 'on' : ''}`}/>
            <span className="jobText"><strong>{job.name}</strong><small>{formatWhen(job)}</small></span>
            <ChevronRight size={15}/>
          </button>)}
        </div>
      </aside>

      <section className="content">
        {!selected ? <div className="welcome">
          <div className="welcomeIcon"><CalendarClock/></div>
          <h1>Run scripts on time.</h1>
          <p>Schedule a local command once or repeatedly, then check its output when you need it.</p>
          <button className="primary big" onClick={() => setEditor({ ...emptyEditor })}><Plus size={17}/> Create your first job</button>
        </div> : <>
          <div className="jobHeader">
            <div><div className="eyebrow">{selected.enabled ? 'Scheduled' : 'Paused'}</div><h1>{selected.name}</h1><p className="command">{selected.command}</p></div>
            <div className="headerActions">
              <button className="secondary" disabled={busy === `toggle:${selected.id}`} onClick={() => void toggleEnabled(selected)}>{selected.enabled ? 'Pause' : 'Enable'}</button>
              <button className="secondary" onClick={() => setEditor(editorFor(selected))}>Edit</button>
              <button className="primary" disabled={busy === selected.id} onClick={() => void runNow(selected)}><Play size={15}/>{busy === selected.id ? 'Running…' : 'Run now'}</button>
            </div>
          </div>

          <div className="summaryGrid">
            <div className="summaryCard"><small>Schedule</small><strong>{formatWhen(selected)}</strong></div>
            <div className="summaryCard"><small>Working directory</small><strong>{selected.workingDir || 'Default shell directory'}</strong></div>
            <div className="summaryCard"><small>Status</small><strong className={selected.enabled ? 'good' : ''}>{selected.enabled ? 'Enabled' : 'Paused'}</strong></div>
          </div>

          <div className="toolbar">
            <h2>Runs</h2>
            <div><button className="iconText" onClick={() => void refresh()}><RotateCcw size={14}/> Refresh</button>
              <button className="iconText" disabled={selectedRuns.length === 0} onClick={() => setPendingHistoryClear(selected)}><History size={14}/> Clear history</button>
              <button className="iconText dangerText" onClick={() => setPendingDelete(selected)}><Trash2 size={14}/> Delete job</button></div>
          </div>

          <div className="runs">
            {selectedRuns.length === 0 && <div className="emptyRuns"><FileText size={22}/><span>No runs yet.</span></div>}
            {selectedRuns.map((run) => <details className="run" key={run.id}>
              <summary>
                <span className={`runIcon ${run.exitCode === 0 ? 'success' : 'failure'}`}>{run.exitCode === 0 ? <Check size={14}/> : <CircleStop size={14}/>}</span>
                <span><strong>{run.exitCode === 0 ? 'Succeeded' : `Failed (${run.exitCode})`}</strong><small>{new Date(run.startedAt).toLocaleString()} · {run.manual ? 'Manual' : 'Scheduled'}</small></span>
                <span className="grow"/><ChevronRight size={15}/>
              </summary>
              <div className="logBody">
                {run.stdout && <><label>stdout</label><pre>{run.stdout}</pre></>}
                {run.stderr && <><label>stderr</label><pre>{run.stderr}</pre></>}
                {!run.stdout && !run.stderr && <div className="muted">No output.</div>}
              </div>
            </details>)}
          </div>
        </>}
      </section>
    </main>

    {editor && <div className="modalBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditor(null); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modalHead"><div><small>{editor.id ? 'Edit job' : 'New job'}</small><h2 id="editor-title">{editor.id ? editor.name || 'Job' : 'Schedule a script'}</h2></div><button className="close" aria-label="Close editor" onClick={() => setEditor(null)}><X/></button></div>
        <div className="form">
          <label>Name<input autoFocus value={editor.name} onChange={(e) => setEditor({...editor, name: e.target.value})} placeholder="Database backup"/></label>
          <label>Command<textarea rows={3} value={editor.command} onChange={(e) => setEditor({...editor, command: e.target.value})} placeholder="/Users/me/scripts/backup.sh"/></label>
          <label>Working directory <span>optional</span><input value={editor.workingDir ?? ''} onChange={(e) => setEditor({...editor, workingDir: e.target.value || null})} placeholder="/Users/me/project"/></label>

          <div className="segmented">
            {(['recurring','once'] as ScheduleKind[]).map((kind) => <button key={kind} className={editor.scheduleKind === kind ? 'selected' : ''} onClick={() => setEditor({...editor, scheduleKind: kind})}>{kind === 'recurring' ? 'Repeat' : 'Run once'}</button>)}
          </div>

          {editor.scheduleKind === 'recurring' ? <div className="scheduleBox">
            <label>Cron expression<input value={editor.cron ?? ''} onChange={(e) => setEditor({...editor, cron: e.target.value})} placeholder="0 9 * * *"/></label>
            <div className="presets">{presets.map(([label, cron]) => <button key={cron} onClick={() => setEditor({...editor, cron})}>{label}</button>)}</div>
          </div> : <div className="onceSchedule">
            <div className="dateTimeFields">
              <label>Date<input type="date" value={editor.runDate} onChange={(e) => setEditor({...editor, runDate: e.target.value})}/></label>
              <label>Time<input type="time" step="60" value={editor.runTime} onChange={(e) => setEditor({...editor, runTime: e.target.value})}/></label>
            </div>
            <p>Uses your local time zone.</p>
          </div>}

          <label className="check"><input type="checkbox" checked={editor.enabled} onChange={(e) => setEditor({...editor, enabled: e.target.checked})}/><span>Enabled</span></label>
        </div>
        <div className="modalFoot"><button className="secondary" onClick={() => setEditor(null)}>Cancel</button><button className="primary" disabled={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save job'}</button></div>
      </div>
    </div>}

    {pendingDelete && <div className="modalBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setPendingDelete(null); }}>
      <div className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="confirmIcon"><AlertTriangle size={20}/></div>
        <h2 id="delete-title">Delete job?</h2>
        <p>“{pendingDelete.name}” will be removed from TickRun and your crontab. Its run history will also be deleted.</p>
        <div className="confirmActions">
          <button className="secondary" disabled={busy === `delete:${pendingDelete.id}`} onClick={() => setPendingDelete(null)}>Cancel</button>
          <button className="danger" disabled={busy === `delete:${pendingDelete.id}`} onClick={() => void remove()}>{busy === `delete:${pendingDelete.id}` ? 'Deleting…' : 'Delete job'}</button>
        </div>
      </div>
    </div>}

    {pendingHistoryClear && <div className="modalBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setPendingHistoryClear(null); }}>
      <div className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
        <div className="confirmIcon"><AlertTriangle size={20}/></div>
        <h2 id="clear-history-title">Clear run history?</h2>
        <p>All saved runs for “{pendingHistoryClear.name}” will be permanently deleted. The job and its schedule will stay unchanged.</p>
        <div className="confirmActions">
          <button className="secondary" disabled={busy === `clear:${pendingHistoryClear.id}`} onClick={() => setPendingHistoryClear(null)}>Cancel</button>
          <button className="danger" disabled={busy === `clear:${pendingHistoryClear.id}`} onClick={() => void clearHistory()}>{busy === `clear:${pendingHistoryClear.id}` ? 'Clearing…' : 'Clear history'}</button>
        </div>
      </div>
    </div>}
  </div>;
}

export default App;

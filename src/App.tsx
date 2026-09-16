import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronRight, CircleStop, Clock3, FileText, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from './api';
import type { Job, JobInput, RunLog, ScheduleKind } from './types';

const emptyJob: JobInput = {
  name: '',
  command: '',
  workingDir: null,
  scheduleKind: 'recurring',
  cron: '0 9 * * *',
  runAt: null,
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

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<JobInput & { id?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);
  const selectedRuns = useMemo(() => selectedId ? runs.filter((r) => r.jobId === selectedId) : runs, [runs, selectedId]);

  async function refresh() {
    try {
      const [nextJobs, nextRuns] = await Promise.all([api.listJobs(), api.listRuns()]);
      setJobs(nextJobs);
      setRuns(nextRuns);
      if (!selectedId && nextJobs[0]) setSelectedId(nextJobs[0].id);
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
    setBusy('save');
    setError(null);
    try {
      const saved = await api.saveJob(editor);
      setEditor(null);
      setSelectedId(saved.id);
      await refresh();
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

  async function remove(job: Job) {
    if (!confirm(`Delete “${job.name}”?`)) return;
    await api.deleteJob(job.id);
    if (selectedId === job.id) setSelectedId(null);
    await refresh();
  }

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="brandMark"><Clock3 size={17}/></span><strong>TickRun</strong></div>
      <button className="primary" onClick={() => setEditor({ ...emptyJob })}><Plus size={16}/> New job</button>
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
          <button className="primary big" onClick={() => setEditor({ ...emptyJob })}><Plus size={17}/> Create your first job</button>
        </div> : <>
          <div className="jobHeader">
            <div><div className="eyebrow">{selected.enabled ? 'Scheduled' : 'Paused'}</div><h1>{selected.name}</h1><p className="command">{selected.command}</p></div>
            <div className="headerActions">
              <button className="secondary" onClick={async () => { await api.setEnabled(selected.id, !selected.enabled); await refresh(); }}>{selected.enabled ? 'Pause' : 'Enable'}</button>
              <button className="secondary" onClick={() => setEditor({
                id: selected.id, name: selected.name, command: selected.command, workingDir: selected.workingDir,
                scheduleKind: selected.scheduleKind, cron: selected.cron, runAt: selected.runAt, enabled: selected.enabled,
              })}>Edit</button>
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
              <button className="iconText dangerText" onClick={() => void remove(selected)}><Trash2 size={14}/> Delete</button></div>
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
      <div className="modal">
        <div className="modalHead"><div><small>{editor.id ? 'Edit job' : 'New job'}</small><h2>{editor.id ? editor.name || 'Job' : 'Schedule a script'}</h2></div><button className="close" onClick={() => setEditor(null)}><X/></button></div>
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
          </div> : <label>Date & time<input type="datetime-local" value={editor.runAt ? editor.runAt.slice(0,16) : ''} onChange={(e) => setEditor({...editor, runAt: e.target.value ? new Date(e.target.value).toISOString() : null})}/></label>}

          <label className="check"><input type="checkbox" checked={editor.enabled} onChange={(e) => setEditor({...editor, enabled: e.target.checked})}/><span>Enabled</span></label>
        </div>
        <div className="modalFoot"><button className="secondary" onClick={() => setEditor(null)}>Cancel</button><button className="primary" disabled={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save job'}</button></div>
      </div>
    </div>}
  </div>;
}

export default App;

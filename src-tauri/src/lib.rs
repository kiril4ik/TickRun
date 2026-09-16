use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const MARKER_PREFIX: &str = "# TICKRUN:";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    name: String,
    command: String,
    working_dir: Option<String>,
    schedule_kind: String,
    cron: Option<String>,
    run_at: Option<String>,
    enabled: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobInput {
    id: Option<String>,
    name: String,
    command: String,
    working_dir: Option<String>,
    schedule_kind: String,
    cron: Option<String>,
    run_at: Option<String>,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunLog {
    id: String,
    job_id: String,
    job_name: String,
    started_at: String,
    finished_at: String,
    exit_code: i32,
    stdout: String,
    stderr: String,
    manual: bool,
}

fn app_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let path = PathBuf::from(home).join(".tickrun");
    fs::create_dir_all(path.join("jobs")).map_err(err)?;
    fs::create_dir_all(path.join("runs")).map_err(err)?;
    Ok(path)
}

fn jobs_file() -> Result<PathBuf, String> { Ok(app_dir()?.join("jobs.json")) }

fn load_jobs() -> Result<Vec<Job>, String> {
    let path = jobs_file()?;
    if !path.exists() { return Ok(Vec::new()); }
    let text = fs::read_to_string(path).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

fn store_jobs(jobs: &[Job]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(jobs).map_err(err)?;
    atomic_write(&jobs_file()?, text.as_bytes()).map_err(err)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(tmp, path)
}

fn err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

fn now_iso() -> String { Utc::now().to_rfc3339() }

fn new_id() -> String {
    let micros = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_micros();
    format!("{}-{}", micros, std::process::id())
}

fn validate_input(input: &JobInput) -> Result<(), String> {
    if input.name.trim().is_empty() { return Err("Job name is required".into()); }
    if input.command.trim().is_empty() { return Err("Command is required".into()); }
    match input.schedule_kind.as_str() {
        "recurring" => validate_cron(input.cron.as_deref().unwrap_or("")),
        "once" => {
            let raw = input.run_at.as_deref().ok_or("Run date is required")?;
            let parsed = DateTime::parse_from_rfc3339(raw).map_err(|_| "Invalid run date".to_string())?;
            if parsed.with_timezone(&Utc) <= Utc::now() {
                return Err("Run date must be in the future".into());
            }
            Ok(())
        }
        _ => Err("Schedule type must be recurring or once".into()),
    }
}

fn validate_cron(value: &str) -> Result<(), String> {
    let fields: Vec<_> = value.split_whitespace().collect();
    if fields.len() != 5 { return Err("Cron expression must contain exactly 5 fields".into()); }
    if fields.iter().any(|f| f.contains('\n') || f.contains('\r')) { return Err("Invalid cron expression".into()); }
    Ok(())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn wrapper_path(job_id: &str) -> Result<PathBuf, String> { Ok(app_dir()?.join("jobs").join(format!("{}.sh", job_id))) }

fn write_wrapper(job: &Job) -> Result<PathBuf, String> {
    let path = wrapper_path(&job.id)?;
    let root = app_dir()?;
    let one_time = job.schedule_kind == "once";
    let expected = job.run_at.clone().unwrap_or_default();
    let expected_year = if one_time {
        DateTime::parse_from_rfc3339(&expected).map_err(err)?.with_timezone(&Local).format("%Y").to_string()
    } else { String::new() };
    let workdir = job.working_dir.clone().unwrap_or_default();

    let script = format!(r#"#!/bin/sh
set +e
JOB_ID={job_id}
COMMAND={command}
WORKDIR={workdir}
RUNS_DIR={runs_dir}
EXPECTED={expected}
EXPECTED_YEAR={expected_year}
ONE_TIME={one_time}

if [ "$ONE_TIME" = "1" ] && [ -n "$EXPECTED_YEAR" ]; then
  CURRENT_YEAR=$(date +%Y)
  [ "$CURRENT_YEAR" != "$EXPECTED_YEAR" ] && exit 0
fi

STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RUN_ID="$(date +%s)-$$"
RUN_DIR="$RUNS_DIR/$RUN_ID"
mkdir -p "$RUN_DIR"

if [ -n "$WORKDIR" ]; then
  cd "$WORKDIR" || {{ echo "Working directory not found: $WORKDIR" > "$RUN_DIR/stderr.log"; EXIT=127; }}
fi

if [ -z "${{EXIT+x}}" ]; then
  /bin/sh -lc "$COMMAND" > "$RUN_DIR/stdout.log" 2> "$RUN_DIR/stderr.log"
  EXIT=$?
fi
FINISHED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$RUN_DIR/meta" <<META
job_id=$JOB_ID
started_at=$STARTED
finished_at=$FINISHED
exit_code=$EXIT
manual=0
META

if [ "$ONE_TIME" = "1" ]; then
  (crontab -l 2>/dev/null | grep -v {marker}) | crontab - 2>/dev/null || true
fi
exit "$EXIT"
"#,
        job_id = shell_quote(&job.id),
        command = shell_quote(&job.command),
        workdir = shell_quote(&workdir),
        runs_dir = shell_quote(root.join("runs").to_string_lossy().as_ref()),
        expected = shell_quote(&expected),
        expected_year = shell_quote(&expected_year),
        one_time = if one_time { "1" } else { "0" },
        marker = shell_quote(&format!("{}{}", MARKER_PREFIX, job.id)),
    );
    fs::write(&path, script).map_err(err)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&path).map_err(err)?.permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&path, permissions).map_err(err)?;
    }
    Ok(path)
}

fn cron_line(job: &Job) -> Result<Option<String>, String> {
    if !job.enabled { return Ok(None); }
    let wrapper = write_wrapper(job)?;
    let schedule = if job.schedule_kind == "recurring" {
        job.cron.clone().ok_or("Missing cron expression")?
    } else {
        let raw = job.run_at.as_deref().ok_or("Missing run date")?;
        let parsed = DateTime::parse_from_rfc3339(raw).map_err(err)?;
        let local = parsed.with_timezone(&Local);
        format!("{} {} {} {} *", local.format("%M"), local.format("%H"), local.format("%d"), local.format("%m"))
    };
    Ok(Some(format!("{} {} {}{}", schedule, shell_quote(wrapper.to_string_lossy().as_ref()), MARKER_PREFIX, job.id)))
}

fn current_crontab() -> Result<String, String> {
    let output = Command::new("crontab").arg("-l").output().map_err(|e| format!("Unable to run crontab: {e}"))?;
    if output.status.success() { return Ok(String::from_utf8_lossy(&output.stdout).into_owned()); }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("no crontab") || stderr.trim().is_empty() { Ok(String::new()) } else { Err(stderr.trim().to_string()) }
}

fn sync_crontab(jobs: &[Job]) -> Result<(), String> {
    let existing = current_crontab()?;
    let mut lines: Vec<String> = existing.lines().filter(|line| !line.contains(MARKER_PREFIX)).map(ToOwned::to_owned).collect();
    for job in jobs {
        if let Some(line) = cron_line(job)? { lines.push(line); }
    }
    let mut body = lines.join("\n");
    if !body.is_empty() { body.push('\n'); }
    let mut child = Command::new("crontab").arg("-").stdin(Stdio::piped()).spawn().map_err(err)?;
    child.stdin.as_mut().ok_or("Unable to open crontab stdin")?.write_all(body.as_bytes()).map_err(err)?;
    let status = child.wait().map_err(err)?;
    if !status.success() { return Err("crontab rejected the generated schedule".into()); }
    Ok(())
}

#[tauri::command]
fn list_jobs() -> Result<Vec<Job>, String> {
    let mut jobs = load_jobs()?;
    jobs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(jobs)
}

#[tauri::command]
fn save_job(input: JobInput) -> Result<Job, String> {
    validate_input(&input)?;
    let mut jobs = load_jobs()?;
    let now = now_iso();
    let id = input.id.clone().unwrap_or_else(new_id);
    let created_at = jobs.iter().find(|j| j.id == id).map(|j| j.created_at.clone()).unwrap_or_else(|| now.clone());
    let job = Job {
        id: id.clone(), name: input.name.trim().to_string(), command: input.command.trim().to_string(),
        working_dir: input.working_dir.filter(|v| !v.trim().is_empty()), schedule_kind: input.schedule_kind,
        cron: input.cron, run_at: input.run_at, enabled: input.enabled, created_at, updated_at: now,
    };
    if let Some(pos) = jobs.iter().position(|j| j.id == id) { jobs[pos] = job.clone(); } else { jobs.push(job.clone()); }
    sync_crontab(&jobs)?;
    store_jobs(&jobs)?;
    Ok(job)
}

#[tauri::command]
fn delete_job(id: String) -> Result<(), String> {
    let mut jobs = load_jobs()?;
    jobs.retain(|j| j.id != id);
    sync_crontab(&jobs)?;
    store_jobs(&jobs)?;
    let _ = fs::remove_file(wrapper_path(&id)?);
    Ok(())
}

#[tauri::command]
fn set_job_enabled(id: String, enabled: bool) -> Result<Job, String> {
    let mut jobs = load_jobs()?;
    let pos = jobs.iter().position(|j| j.id == id).ok_or("Job not found")?;
    jobs[pos].enabled = enabled;
    jobs[pos].updated_at = now_iso();
    let result = jobs[pos].clone();
    sync_crontab(&jobs)?;
    store_jobs(&jobs)?;
    Ok(result)
}

fn write_manual_run(job: &Job, output: std::process::Output, started_at: String) -> Result<RunLog, String> {
    let id = new_id();
    let dir = app_dir()?.join("runs").join(&id);
    fs::create_dir_all(&dir).map_err(err)?;
    let finished_at = now_iso();
    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    fs::write(dir.join("stdout.log"), &stdout).map_err(err)?;
    fs::write(dir.join("stderr.log"), &stderr).map_err(err)?;
    fs::write(dir.join("meta"), format!("job_id={}\nstarted_at={}\nfinished_at={}\nexit_code={}\nmanual=1\n", job.id, started_at, finished_at, exit_code)).map_err(err)?;
    Ok(RunLog { id, job_id: job.id.clone(), job_name: job.name.clone(), started_at, finished_at, exit_code, stdout, stderr, manual: true })
}

#[tauri::command]
fn run_job_now(id: String) -> Result<RunLog, String> {
    let jobs = load_jobs()?;
    let job = jobs.iter().find(|j| j.id == id).ok_or("Job not found")?;
    let started_at = now_iso();
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-lc").arg(&job.command);
    if let Some(dir) = &job.working_dir { cmd.current_dir(dir); }
    let output = cmd.output().map_err(err)?;
    write_manual_run(job, output, started_at)
}

fn parse_meta(path: &Path) -> Result<std::collections::HashMap<String, String>, String> {
    let mut map = std::collections::HashMap::new();
    let text = fs::read_to_string(path).map_err(err)?;
    for line in text.lines() {
        if let Some((k, v)) = line.split_once('=') { map.insert(k.to_string(), v.to_string()); }
    }
    Ok(map)
}

#[tauri::command]
fn list_runs(job_id: Option<String>) -> Result<Vec<RunLog>, String> {
    let jobs = load_jobs()?;
    let names: std::collections::HashMap<_, _> = jobs.into_iter().map(|j| (j.id, j.name)).collect();
    let root = app_dir()?.join("runs");
    let mut result = Vec::new();
    for entry in fs::read_dir(root).map_err(err)? {
        let entry = entry.map_err(err)?;
        if !entry.file_type().map_err(err)?.is_dir() { continue; }
        let dir = entry.path();
        let meta_path = dir.join("meta");
        if !meta_path.exists() { continue; }
        let meta = parse_meta(&meta_path)?;
        let jid = meta.get("job_id").cloned().unwrap_or_default();
        if let Some(filter) = &job_id { if filter != &jid { continue; } }
        let id = entry.file_name().to_string_lossy().into_owned();
        result.push(RunLog {
            id,
            job_name: names.get(&jid).cloned().unwrap_or_else(|| "Deleted job".into()),
            job_id: jid,
            started_at: meta.get("started_at").cloned().unwrap_or_default(),
            finished_at: meta.get("finished_at").cloned().unwrap_or_default(),
            exit_code: meta.get("exit_code").and_then(|v| v.parse().ok()).unwrap_or(-1),
            manual: meta.get("manual").map(|v| v == "1").unwrap_or(false),
            stdout: fs::read_to_string(dir.join("stdout.log")).unwrap_or_default(),
            stderr: fs::read_to_string(dir.join("stderr.log")).unwrap_or_default(),
        });
    }
    result.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    result.truncate(200);
    Ok(result)
}

#[tauri::command]
fn describe_cron(expression: String) -> Result<String, String> {
    validate_cron(&expression)?;
    Ok(expression)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_jobs, save_job, delete_job, set_job_enabled, run_job_now, list_runs, describe_cron])
        .run(tauri::generate_context!())
        .expect("error while running TickRun");
}

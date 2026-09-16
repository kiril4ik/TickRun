# TickRun

A tiny desktop scheduler for local scripts on **macOS and Linux**.

TickRun is intentionally small: add a command, choose when it should run, and inspect the output later. It uses the operating system's existing `crontab` instead of running a separate scheduler service.


## What it does

- Run any local shell command or script
- Repeat jobs using standard 5-field cron expressions
- Schedule a job once at a specific date and time
- Run any job manually
- Capture `stdout`, `stderr`, exit code, and timestamps
- Pause / resume jobs
- Keep the UI small and local
- Continue running scheduled jobs while the TickRun window is closed, because recurring jobs live in system `crontab`

That is intentionally almost the entire feature set.

## Screens / workflow

**Jobs**

Create a job with:

- Name
- Command
- Optional working directory
- Repeat or Run once
- Schedule

**Runs**

Open a job to see previous runs. Expand a run to view stdout and stderr.

## Example jobs

```bash
# Laravel scheduler command
cd /Users/me/project && php artisan reports:generate

# Shell script
/Users/me/scripts/backup.sh

# Python
python3 /Users/me/scripts/sync.py

# Node
node /home/me/scripts/import.mjs
```

## How scheduling works

TickRun owns only the `crontab` lines marked with `# TICKRUN:<job-id>`. Existing unrelated crontab entries are preserved.

For every job, TickRun creates a small wrapper script under:

```text
~/.tickrun/jobs/
```

The wrapper:

1. switches to the configured working directory, if any;
2. executes the command through `/bin/sh -lc`;
3. writes stdout/stderr and metadata to `~/.tickrun/runs/`;
4. for one-time jobs, removes its own TickRun crontab entry after the run.

The job database is a human-readable JSON file:

```text
~/.tickrun/jobs.json
```

No server and no external database are required.

## One-time jobs

Unix cron does not have a native "run once in year X" primitive. TickRun schedules the requested local month/day/hour/minute and generates a guarded wrapper. After it runs, the wrapper removes its own cron entry.

Practical consequence: like normal cron, if the computer is asleep during the scheduled minute, the run can be missed. TickRun is deliberately not a daemon and does not attempt catch-up scheduling.

## Requirements

### Common

- Node.js 20+
- npm
- Rust stable
- `crontab` available for the current user

### macOS

Install Xcode Command Line Tools:

```bash
xcode-select --install
```

### Linux (Debian / Ubuntu)

Tauri requires the system WebKit dependencies:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Make sure cron is installed:

```bash
sudo apt install -y cron
```

## Development

```bash
git clone <your-repository-url>
cd tickrun
npm install
npm run desktop:dev
```

The React UI is in `src/` and the native scheduler backend is in `src-tauri/`.

## Build

```bash
npm install
npm run desktop:build
```

Build output is created by Tauri under:

```text
src-tauri/target/release/bundle/
```

Typical artifacts:

- macOS: `.app` / `.dmg`
- Linux: `.deb` / `.AppImage` depending on the build environment

## Project structure

```text
.
├── src/
│   ├── App.tsx          # complete UI
│   ├── api.ts           # Tauri command bridge
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── src-tauri/
│   ├── capabilities/
│   ├── src/
│   │   ├── lib.rs       # jobs, cron sync, execution and logs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/workflows/
├── package.json
└── README.md
```

## Design principles

TickRun deliberately avoids becoming a workflow orchestrator.

There are no DAGs, workers, agents, remote runners, accounts, teams, notifications, integrations, dashboards, or workflow DSLs. A job is just:

```text
command + schedule + logs
```

## Data and privacy

Everything stays on the local computer. TickRun does not send commands, schedules, or logs anywhere.

Commands execute with the permissions of the current operating-system user. Treat scheduled commands the same way you would treat commands placed manually in your crontab.

## Removing TickRun

Delete TickRun jobs in the app first. To inspect remaining TickRun cron entries manually:

```bash
crontab -l | grep 'TICKRUN:'
```

Local TickRun data is stored at:

```text
~/.tickrun
```

## License

MIT. See [LICENSE](LICENSE).

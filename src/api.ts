import { invoke } from '@tauri-apps/api/core';
import type { Job, JobInput, RunLog } from './types';

export const api = {
  listJobs: () => invoke<Job[]>('list_jobs'),
  saveJob: (job: JobInput & { id?: string }) => invoke<Job>('save_job', { input: job }),
  deleteJob: (id: string) => invoke<void>('delete_job', { id }),
  clearJobRuns: (id: string) => invoke<void>('clear_job_runs', { id }),
  setEnabled: (id: string, enabled: boolean) => invoke<Job>('set_job_enabled', { id, enabled }),
  runNow: (id: string) => invoke<RunLog>('run_job_now', { id }),
  listRuns: (jobId?: string) => invoke<RunLog[]>('list_runs', { jobId: jobId ?? null }),
  cronPreview: (expression: string) => invoke<string>('describe_cron', { expression }),
};

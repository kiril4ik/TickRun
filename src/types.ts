export type ScheduleKind = 'recurring' | 'once';

export interface Job {
  id: string;
  name: string;
  command: string;
  workingDir: string | null;
  scheduleKind: ScheduleKind;
  cron: string | null;
  runAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunLog {
  id: string;
  jobId: string;
  jobName: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  manual: boolean;
}

export interface JobInput {
  name: string;
  command: string;
  workingDir: string | null;
  scheduleKind: ScheduleKind;
  cron: string | null;
  runAt: string | null;
  enabled: boolean;
}

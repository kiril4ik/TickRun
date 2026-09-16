import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Job, RunLog } from './types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listJobs: vi.fn(),
    saveJob: vi.fn(),
    deleteJob: vi.fn(),
    clearJobRuns: vi.fn(),
    setEnabled: vi.fn(),
    runNow: vi.fn(),
    listRuns: vi.fn(),
    cronPreview: vi.fn(),
  },
}));

vi.mock('./api', () => ({ api: mockApi }));

const firstJob: Job = {
  id: 'job-1',
  name: 'Database backup',
  command: './backup.sh',
  workingDir: '/tmp',
  scheduleKind: 'recurring',
  cron: '0 9 * * *',
  runAt: null,
  enabled: true,
  createdAt: '2030-01-01T08:00:00.000Z',
  updatedAt: '2030-01-01T08:00:00.000Z',
};

const secondJob: Job = {
  ...firstJob,
  id: 'job-2',
  name: 'Report export',
  command: './export.sh',
};

const firstRun: RunLog = {
  id: 'run-1',
  jobId: firstJob.id,
  jobName: firstJob.name,
  startedAt: '2030-01-01T09:00:00.000Z',
  finishedAt: '2030-01-01T09:00:01.000Z',
  exitCode: 0,
  stdout: 'done',
  stderr: '',
  manual: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listJobs.mockResolvedValue([firstJob, secondJob]);
  mockApi.listRuns.mockResolvedValue([firstRun]);
  mockApi.deleteJob.mockResolvedValue(undefined);
  mockApi.clearJobRuns.mockResolvedValue(undefined);
  mockApi.saveJob.mockImplementation(async (input) => ({
    ...firstJob,
    ...input,
    updatedAt: '2030-01-01T08:01:00.000Z',
  }));
  mockApi.setEnabled.mockImplementation(async (_id, enabled) => ({ ...firstJob, enabled }));
});

afterEach(cleanup);

describe('job mutations', () => {
  it('removes a deleted job and its runs locally after one delete request', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: firstJob.name });
    await user.click(screen.getByRole('button', { name: 'Delete job' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete job?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete job' }));

    await screen.findByRole('heading', { name: secondJob.name });
    expect(screen.queryByText(firstJob.name)).toBeNull();
    expect(mockApi.deleteJob).toHaveBeenCalledTimes(1);
    expect(mockApi.deleteJob).toHaveBeenCalledWith(firstJob.id);
    expect(mockApi.listJobs).toHaveBeenCalledTimes(1);
    expect(mockApi.listRuns).toHaveBeenCalledTimes(1);
  });

  it('clears only the selected job run history and keeps the job', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: firstJob.name });
    expect(screen.getByText('Succeeded')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear history' }));

    const dialog = screen.getByRole('dialog', { name: 'Clear run history?' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear history' }));

    expect(await screen.findByText('No runs yet.')).not.toBeNull();
    expect(screen.getByRole('heading', { name: firstJob.name })).not.toBeNull();
    expect(mockApi.clearJobRuns).toHaveBeenCalledTimes(1);
    expect(mockApi.clearJobRuns).toHaveBeenCalledWith(firstJob.id);
    expect(mockApi.listJobs).toHaveBeenCalledTimes(1);
    expect(mockApi.listRuns).toHaveBeenCalledTimes(1);
  });

  it('saves an edited job with one mutation and no follow-up list requests', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: firstJob.name });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Nightly backup');

    expect(mockApi.saveJob).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save job' }));

    await screen.findByRole('heading', { name: 'Nightly backup' });
    expect(mockApi.saveJob).toHaveBeenCalledTimes(1);
    expect(mockApi.listJobs).toHaveBeenCalledTimes(1);
    expect(mockApi.listRuns).toHaveBeenCalledTimes(1);
  });
});

describe('one-time scheduling', () => {
  it('edits date and time independently and converts them to ISO only on save', async () => {
    const user = userEvent.setup();
    const localRunAt = new Date(2030, 5, 15, 14, 30).toISOString();
    mockApi.listJobs.mockResolvedValue([{ ...firstJob, scheduleKind: 'once', cron: null, runAt: localRunAt }]);
    render(<App />);

    await screen.findByRole('heading', { name: firstJob.name });
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
    expect(dateInput.value).toBe('2030-06-15');
    expect(timeInput.value).toBe('14:30');

    await user.clear(timeInput);
    await user.type(timeInput, '16:45');
    expect(dateInput.value).toBe('2030-06-15');
    expect(mockApi.saveJob).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save job' }));
    await waitFor(() => expect(mockApi.saveJob).toHaveBeenCalledTimes(1));
    const savedRunAt = new Date(mockApi.saveJob.mock.calls[0][0].runAt);
    expect(savedRunAt.getFullYear()).toBe(2030);
    expect(savedRunAt.getMonth()).toBe(5);
    expect(savedRunAt.getDate()).toBe(15);
    expect(savedRunAt.getHours()).toBe(16);
    expect(savedRunAt.getMinutes()).toBe(45);
  });
});

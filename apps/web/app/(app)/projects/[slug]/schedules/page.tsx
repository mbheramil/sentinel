'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2Icon, PlusIcon, PlayIcon, Trash2Icon,
  ToggleLeftIcon, ToggleRightIcon, CalendarIcon,
} from 'lucide-react';
import { apiClient, type ScheduleResponse, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  params: Promise<{ slug: string }>;
}

const PRESETS = [
  { label: 'Every hour',        cron: '0 * * * *' },
  { label: 'Every 6 hours',     cron: '0 */6 * * *' },
  { label: 'Daily at 9 am UTC', cron: '0 9 * * *' },
  { label: 'Daily at midnight', cron: '0 0 * * *' },
  { label: 'Weekdays at 9 am',  cron: '0 9 * * 1-5' },
  { label: 'Custom',            cron: '' },
];


function NewScheduleModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<typeof PRESETS[number]>(PRESETS[2]!);
  const [customCron, setCustomCron] = useState('');
  const [envId, setEnvId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: environments } = useQuery({
    queryKey: ['environments', slug],
    queryFn: () => apiClient.getEnvironments(slug),
  });

  const cron = preset.label === 'Custom' ? customCron : preset.cron;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createSchedule(slug, {
        name: name || preset.label,
        cron,
        environmentId: (envId || environments?.[0]?.id) ?? '',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules', slug] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof SentinelApiError ? err.message : 'Failed to create schedule.');
    },
  });

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Dialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl focus:outline-none"
        aria-describedby="sched-desc"
      >
        <Dialog.Title className="text-lg font-semibold mb-1">New schedule</Dialog.Title>
        <Dialog.Description id="sched-desc" className="text-sm text-muted-foreground mb-4">
          Runs all tests in this project on the chosen interval.
        </Dialog.Description>

        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
        >
          <div className="space-y-2">
            <Label htmlFor="sched-name">Name (optional)</Label>
            <Input
              id="sched-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={preset.label}
            />
          </div>

          <div className="space-y-2">
            <Label>Frequency</Label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`px-3 py-2 rounded-md border text-sm text-left transition-colors ${
                    preset.label === p.label
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-muted/30 text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {p.label}
                  {p.cron && <span className="block text-[10px] font-mono opacity-60">{p.cron}</span>}
                </button>
              ))}
            </div>
          </div>

          {preset.label === 'Custom' && (
            <div className="space-y-2">
              <Label htmlFor="cron-expr">Cron expression</Label>
              <Input
                id="cron-expr"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="0 9 * * *"
                className="font-mono"
                required
              />
              <p className="text-xs text-muted-foreground">Standard 5-field cron (UTC). e.g. <code>0 9 * * 1-5</code> = weekdays at 9am.</p>
            </div>
          )}

          {environments && environments.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="sched-env">Environment</Label>
              <select
                id="sched-env"
                value={envId || environments[0]?.id}
                onChange={(e) => setEnvId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>{env.name} — {env.baseUrl}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !cron}>
              {mutation.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Create schedule
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function ScheduleRow({ schedule, slug }: { schedule: ScheduleResponse; slug: string }) {
  const qc = useQueryClient();
  const router = useRouter();

  const toggleMutation = useMutation({
    mutationFn: () => apiClient.toggleSchedule(schedule.id, !schedule.isEnabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['schedules', slug] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteSchedule(schedule.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['schedules', slug] }),
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiClient.triggerSchedule(schedule.id),
    onSuccess: (r) => router.push(`/projects/${slug}/runs/${r.runId}`),
  });

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{schedule.name}</p>
        <p className="text-xs text-muted-foreground font-mono">{schedule.cron}</p>
        {schedule.nextRunAt && (
          <p className="text-xs text-muted-foreground">
            Next: {new Date(schedule.nextRunAt).toLocaleString()}
          </p>
        )}
        {schedule.lastRunAt && (
          <p className="text-xs text-muted-foreground">
            Last ran: {new Date(schedule.lastRunAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Run now */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending}
          title="Run now"
        >
          {triggerMutation.isPending
            ? <Loader2Icon className="h-4 w-4 animate-spin" />
            : <PlayIcon className="h-4 w-4" />}
        </Button>

        {/* Toggle enable/disable */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          title={schedule.isEnabled ? 'Disable' : 'Enable'}
          className={schedule.isEnabled ? 'text-primary' : 'text-muted-foreground'}
        >
          {schedule.isEnabled
            ? <ToggleRightIcon className="h-5 w-5" />
            : <ToggleLeftIcon className="h-5 w-5" />}
        </Button>

        {/* Delete */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { if (confirm(`Delete schedule "${schedule.name}"?`)) deleteMutation.mutate(); }}
          disabled={deleteMutation.isPending}
          title="Delete"
          className="text-destructive hover:text-destructive"
        >
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function SchedulesPage({ params }: Props) {
  const { slug } = use(params);
  const [open, setOpen] = useState(false);

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['schedules', slug],
    queryFn: () => apiClient.getSchedules(slug),
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:underline">Projects</Link>
        {' / '}
        <Link href={`/projects/${slug}`} className="hover:underline">{slug}</Link>
        {' / '}
        <span className="text-foreground">Schedules</span>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Schedules</h1>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <Button size="sm">
              <PlusIcon className="h-4 w-4" />
              New schedule
            </Button>
          </Dialog.Trigger>
          {open && <NewScheduleModal slug={slug} onClose={() => setOpen(false)} />}
        </Dialog.Root>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && (!schedules || schedules.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <CalendarIcon className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No schedules yet</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Create a schedule to run all your tests automatically — daily, hourly, or on a custom cron.
            </p>
            <Button size="sm" onClick={() => setOpen(true)}>
              <PlusIcon className="h-4 w-4" />
              Create your first schedule
            </Button>
          </CardContent>
        </Card>
      )}

      {schedules && schedules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{schedules.length} schedule{schedules.length > 1 ? 's' : ''}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 px-4">
            {schedules.map((s) => (
              <ScheduleRow key={s.id} schedule={s} slug={slug} />
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        All schedules run in UTC. Use{' '}
        <a href="https://crontab.guru" target="_blank" rel="noreferrer" className="underline">crontab.guru</a>
        {' '}to verify your cron expression.
      </p>
    </div>
  );
}

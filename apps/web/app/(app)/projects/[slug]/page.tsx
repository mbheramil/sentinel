'use client';

import { use } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2Icon, PlayIcon, FlaskConicalIcon, ListIcon, CalendarIcon, ServerIcon, SettingsIcon, TrendingUpIcon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  params: Promise<{ slug: string }>;
}

function RunStrip({ slug }: { slug: string }) {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['runs', slug],
    queryFn: () => apiClient.getRuns(slug, { pageSize: 10 }),
  });

  if (isLoading) {
    return (
      <div className="flex gap-1.5" aria-label="Loading recent runs">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-6 w-6 rounded-sm bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Recent runs">
      {runs.map((run) => (
        <Link
          key={run.id}
          href={`/projects/${slug}/runs/${run.id}`}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          title={`Run ${run.id.slice(-8)} — ${run.status}`}
        >
          <StatusBadge status={run.status} size="sm" label={run.status} />
        </Link>
      ))}
    </div>
  );
}

const TAB_LINKS = [
  { href: 'tests', label: 'Tests', icon: FlaskConicalIcon },
  { href: 'runs', label: 'Runs', icon: ListIcon },
  { href: 'environments', label: 'Environments', icon: ServerIcon },
  { href: 'insights', label: 'Insights', icon: TrendingUpIcon },
  { href: 'schedules', label: 'Schedules', icon: CalendarIcon, disabled: true },
  { href: 'settings', label: 'Settings', icon: SettingsIcon, disabled: true },
];

export default function ProjectPage({ params }: Props) {
  const { slug } = use(params);

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => apiClient.getProject(slug),
  });

  const { data: environments } = useQuery({
    queryKey: ['environments', slug],
    queryFn: () => apiClient.getEnvironments(slug),
  });

  const runMutation = useMutation({
    mutationFn: () => {
      const envId = environments?.[0]?.id ?? '';
      return apiClient.createRun(slug, {
        environmentId: envId,
        browsers: project?.defaultBrowsers ?? ['CHROMIUM'],
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load project. Please refresh.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Slug: <code className="font-mono">{project.slug}</code>
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || !environments?.length}
          title={!environments?.length ? 'Add an environment first' : undefined}
        >
          {runMutation.isPending ? (
            <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <PlayIcon className="h-4 w-4" aria-hidden="true" />
          )}
          Quick run
        </Button>
      </div>

      {/* Tab links */}
      <nav className="flex gap-1 border-b border-border pb-0" aria-label="Project sections">
        {TAB_LINKS.map((tab) => {
          const Icon = tab.icon;
          const href = `/projects/${slug}/${tab.href}`;
          return tab.disabled ? (
            <span
              key={tab.href}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground/50 cursor-not-allowed select-none"
              aria-disabled="true"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </span>
          ) : (
            <Link
              key={tab.href}
              href={href}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-t-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          <RunStrip slug={slug} />
          <div className="mt-3">
            <Link
              href={`/projects/${slug}/runs`}
              className="text-sm text-primary underline-offset-4 hover:underline focus-visible:underline"
            >
              View all runs →
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Environments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Environments</CardTitle>
        </CardHeader>
        <CardContent>
          {!environments ? (
            <div className="flex gap-2" aria-label="Loading environments">
              {[1, 2].map((i) => (
                <div key={i} className="h-6 w-32 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : environments.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No environments configured.</p>
              <Link
                href={`/projects/${slug}/environments`}
                className="text-sm text-primary underline-offset-4 hover:underline focus-visible:underline"
              >
                Add an environment →
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {environments.map((env) => (
                <span
                  key={env.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-1 text-sm"
                >
                  <ServerIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {env.name}
                  {env.isDefault && (
                    <span className="text-xs text-muted-foreground">(default)</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

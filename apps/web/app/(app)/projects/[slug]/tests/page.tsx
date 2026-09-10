'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Loader2Icon,
  PlusIcon,
  FlaskConicalIcon,
  Code2Icon,
  BotIcon,
  VideoIcon,
  WrenchIcon,
} from 'lucide-react';
import { apiClient, type TestCaseResponse } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  params: Promise<{ slug: string }>;
}

const MODE_ICONS: Record<string, React.ElementType> = {
  CODE: Code2Icon,
  BUILDER: WrenchIcon,
  AI_GENERATED: BotIcon,
  RECORDED: VideoIcon,
};

const MODE_LABELS: Record<string, string> = {
  CODE: 'Code',
  BUILDER: 'Builder',
  AI_GENERATED: 'AI',
  RECORDED: 'Recorded',
};

function TestRow({ test, slug }: { test: TestCaseResponse; slug: string }) {
  const ModeIcon = MODE_ICONS[test.authoringMode] ?? Code2Icon;
  const modeLabel = MODE_LABELS[test.authoringMode] ?? test.authoringMode;

  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/projects/${slug}/tests/${test.id}`}
          className="font-medium text-sm hover:text-primary focus-visible:underline focus-visible:outline-none"
        >
          {test.name}
        </Link>
        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate max-w-xs" title={test.filePath}>
          {test.filePath}
        </p>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {test.tags.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            test.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {test.isMuted ? (
          <StatusBadge status="skipped" size="sm" label="Muted" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ModeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {modeLabel}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <Link href={`/projects/${slug}/tests/${test.id}`}>
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        </Link>
      </td>
    </tr>
  );
}

export default function TestsPage({ params }: Props) {
  const { slug } = use(params);
  const [search, setSearch] = useState('');

  const { data: tests, isLoading, isError } = useQuery({
    queryKey: ['tests', slug],
    queryFn: () => apiClient.getTests(slug),
  });

  const filtered = tests?.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.filePath.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href={`/projects/${slug}`} className="hover:underline focus-visible:underline">
              {slug}
            </Link>{' '}
            / tests
          </p>
        </div>
        <Button disabled title="New test creation coming soon">
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          New test
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by name or file path…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search tests"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load tests. Please refresh.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filtered && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <FlaskConicalIcon className="h-12 w-12 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm text-muted-foreground font-medium">
              {search ? 'No tests match your search' : 'No tests yet'}
            </p>
            {!search && (
              <p className="text-xs text-muted-foreground">
                Tests are created when you push spec files through the API.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filtered && filtered.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Test</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tags</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mode</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((test) => (
                <TestRow key={test.id} test={test} slug={slug} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

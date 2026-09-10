'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2Icon,
  PlusIcon,
  FlaskConicalIcon,
  Code2Icon,
  BotIcon,
  VideoIcon,
  WrenchIcon,
} from 'lucide-react';
import { apiClient, type TestCaseResponse, SentinelApiError } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import * as Dialog from '@radix-ui/react-dialog';

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

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function NewTestModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoPath, setAutoPath] = useState(true);

  function handleNameChange(v: string) {
    setName(v);
    if (autoPath) setFilePath(toSlug(v) + '.spec.ts');
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createTest(slug, {
        name,
        filePath,
        code: `import { test, expect } from '../fixtures/sentinel';

test('${name}', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
  // TODO: add your assertions here
});
`,
      }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['tests', slug] });
      onClose();
      router.push(`/projects/${slug}/tests/${t.id}`);
    },
    onError: (err) => {
      setError(err instanceof SentinelApiError ? err.message : 'Failed to create test.');
    },
  });

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Dialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl focus:outline-none"
        aria-describedby="new-test-desc"
      >
        <Dialog.Title className="text-lg font-semibold mb-1">New test</Dialog.Title>
        <Dialog.Description id="new-test-desc" className="text-sm text-muted-foreground mb-4">
          Creates a starter test file you can edit in the code editor.
        </Dialog.Description>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
          <div className="space-y-2">
            <Label htmlFor="test-name">Test name</Label>
            <Input
              id="test-name"
              placeholder="Homepage loads correctly"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="test-path">File path</Label>
            <Input
              id="test-path"
              placeholder="homepage.spec.ts"
              value={filePath}
              onChange={(e) => { setFilePath(e.target.value); setAutoPath(false); }}
              pattern="^[a-z0-9/_-]+\.spec\.ts$"
              required
            />
            <p className="text-xs text-muted-foreground">e.g. <code className="font-mono">contact/form.spec.ts</code></p>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim() || !filePath.trim()}>
              {mutation.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Create &amp; open editor
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export default function TestsPage({ params }: Props) {
  const { slug } = use(params);
  const [open, setOpen] = useState(false);
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
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <Button>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              New test
            </Button>
          </Dialog.Trigger>
          {open && <NewTestModal slug={slug} onClose={() => setOpen(false)} />}
        </Dialog.Root>
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
              <>
                <p className="text-xs text-muted-foreground">Click New test to create your first Playwright test.</p>
                <Button size="sm" onClick={() => setOpen(true)}>
                  <PlusIcon className="h-4 w-4" />
                  Create your first test
                </Button>
              </>
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

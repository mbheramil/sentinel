'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2Icon, Trash2Icon } from 'lucide-react';
import { apiClient, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Props {
  params: Promise<{ slug: string }>;
}

export default function ProjectSettingsPage({ params }: Props) {
  const { slug } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => apiClient.getProject(slug),
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Initialise fields once data loads
  const [initialised, setInitialised] = useState(false);
  if (project && !initialised) {
    setName(project.name);
    setDescription(project.description ?? '');
    setInitialised(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => apiClient.updateProject(slug, { name, description: description || undefined }),
    onSuccess: () => {
      setSaveOk(true);
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['project', slug] });
      setTimeout(() => setSaveOk(false), 3000);
    },
    onError: (err) => {
      setSaveError(err instanceof SentinelApiError ? err.message : 'Save failed.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteProject(slug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      router.push('/projects');
    },
    onError: (err) => {
      setDeleteError(err instanceof SentinelApiError ? err.message : 'Delete failed.');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-destructive">Project not found.</p>
      </div>
    );
  }

  const confirmSlug = slug;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:underline">Projects</Link>
        {' / '}
        <Link href={`/projects/${slug}`} className="hover:underline">{project.name}</Link>
        {' / '}
        <span className="text-foreground">Settings</span>
      </nav>

      <h1 className="text-xl font-semibold">Project settings</h1>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proj-name">Project name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App E2E"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-desc">Description</Label>
            <Input
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Slug: <code className="font-mono bg-muted px-1 rounded">{slug}</code> (cannot be changed)</p>
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-destructive">{saveError}</p>
          )}
          {saveOk && (
            <p role="status" className="text-sm text-green-600">Changes saved.</p>
          )}

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim()}
          >
            {saveMutation.isPending && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save changes
          </Button>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this project and all its tests, runs, and results. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <code className="font-mono bg-muted px-1 rounded">{confirmSlug}</code> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => { setDeleteConfirm(e.target.value); setDeleteError(null); }}
              placeholder={confirmSlug}
            />
          </div>

          {deleteError && (
            <p role="alert" className="text-sm text-destructive">{deleteError}</p>
          )}

          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteConfirm !== confirmSlug || deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2Icon className="h-4 w-4" aria-hidden="true" />
            )}
            Delete project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

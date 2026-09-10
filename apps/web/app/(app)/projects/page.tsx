'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, FolderIcon, Loader2Icon } from 'lucide-react';
import { apiClient, type ProjectResponse, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiClient.createProject({ name, slug, description: description || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof SentinelApiError) {
        setError(err.message);
      } else {
        setError('Failed to create project.');
      }
    },
  });

  function handleNameChange(v: string) {
    setName(v);
    if (!slug || slug === toSlug(name)) {
      setSlug(toSlug(v));
    }
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Dialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl focus:outline-none"
        aria-describedby="new-project-desc"
      >
        <Dialog.Title className="text-lg font-semibold mb-1">New project</Dialog.Title>
        <Dialog.Description id="new-project-desc" className="text-sm text-muted-foreground mb-4">
          Create a new test project in your organisation.
        </Dialog.Description>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="proj-name">Project name</Label>
            <Input
              id="proj-name"
              placeholder="My App E2E"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-slug">Slug</Label>
            <Input
              id="proj-slug"
              placeholder="my-app-e2e"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="^[a-z0-9-]+$"
              required
            />
            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens only.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-desc">Description (optional)</Label>
            <Input
              id="proj-desc"
              placeholder="End-to-end tests for My App"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Create project
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function toSlug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ProjectCard({ project }: { project: ProjectResponse }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="block rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FolderIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{project.name}</p>
          {project.description && (
            <p className="text-sm text-muted-foreground truncate mt-0.5">{project.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {project.defaultBrowsers.join(' · ')} &middot; {project.concurrency} concurrent
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  const [open, setOpen] = useState(false);

  const { data: projects, isLoading, isError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.getProjects(),
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All test projects in your organisation
          </p>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <Button>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              New project
            </Button>
          </Dialog.Trigger>
          {open && <NewProjectModal onClose={() => setOpen(false)} />}
        </Dialog.Root>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24" aria-label="Loading projects">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load projects. Please refresh.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && projects && projects.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <FolderIcon className="h-12 w-12 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm text-muted-foreground font-medium">No projects yet</p>
            <p className="text-xs text-muted-foreground">Create a project to start running Playwright tests.</p>
            <Button className="mt-2" onClick={() => setOpen(true)}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              Create your first project
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && projects && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

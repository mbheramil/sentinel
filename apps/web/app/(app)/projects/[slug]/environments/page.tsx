'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Loader2Icon,
  PlusIcon,
  ServerIcon,
  TrashIcon,
  PencilIcon,
  EyeOffIcon,
  PlusCircleIcon,
  MinusCircleIcon,
} from 'lucide-react';
import { apiClient, type EnvironmentResponse, type CreateEnvironmentInput, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  params: Promise<{ slug: string }>;
}

interface EnvFormProps {
  initialValues?: Partial<CreateEnvironmentInput>;
  onSubmit: (values: CreateEnvironmentInput) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
  title: string;
}

function EnvForm({ initialValues, onSubmit, onCancel, isPending, error, title }: EnvFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? '');
  const [isDefault, setIsDefault] = useState(initialValues?.isDefault ?? false);
  const [variables, setVariables] = useState<[string, string][]>(
    Object.entries(initialValues?.variables ?? {}),
  );
  const [secrets, setSecrets] = useState<[string, string][]>(
    Object.entries(initialValues?.secrets ?? {}),
  );

  function addVariable() {
    setVariables((prev) => [...prev, ['', '']]);
  }
  function removeVariable(i: number) {
    setVariables((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setVarKey(i: number, v: string) {
    setVariables((prev) => prev.map((row, idx) => (idx === i ? [v, row[1]] : row)));
  }
  function setVarVal(i: number, v: string) {
    setVariables((prev) => prev.map((row, idx) => (idx === i ? [row[0], v] : row)));
  }

  function addSecret() {
    setSecrets((prev) => [...prev, ['', '']]);
  }
  function removeSecret(i: number) {
    setSecrets((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setSecretKey(i: number, v: string) {
    setSecrets((prev) => prev.map((row, idx) => (idx === i ? [v, row[1]] : row)));
  }
  function setSecretVal(i: number, v: string) {
    setSecrets((prev) => prev.map((row, idx) => (idx === i ? [row[0], v] : row)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      baseUrl,
      isDefault,
      variables: Object.fromEntries(variables.filter(([k]) => k.trim())),
      secrets: Object.fromEntries(secrets.filter(([k]) => k.trim())),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="env-name">Name</Label>
        <Input
          id="env-name"
          placeholder="Production"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="env-url">Base URL</Label>
        <Input
          id="env-url"
          type="url"
          placeholder="https://app.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="env-default"
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="env-default" className="cursor-pointer">Set as default environment</Label>
      </div>

      {/* Variables table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Variables</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addVariable}>
            <PlusCircleIcon className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        {variables.length === 0 ? (
          <p className="text-xs text-muted-foreground">No variables. Add key/value pairs.</p>
        ) : (
          <div className="space-y-2">
            {variables.map(([k, v], i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  placeholder="KEY"
                  value={k}
                  onChange={(e) => setVarKey(i, e.target.value)}
                  className="flex-1 font-mono text-xs"
                  aria-label={`Variable ${i + 1} key`}
                />
                <Input
                  placeholder="value"
                  value={v}
                  onChange={(e) => setVarVal(i, e.target.value)}
                  className="flex-1 text-xs"
                  aria-label={`Variable ${i + 1} value`}
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeVariable(i)} aria-label={`Remove variable ${i + 1}`}>
                  <MinusCircleIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Secrets table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Label>Secrets</Label>
            <EyeOffIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={addSecret}>
            <PlusCircleIcon className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Secrets are write-only — values are masked after saving.</p>
        {secrets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No secrets.</p>
        ) : (
          <div className="space-y-2">
            {secrets.map(([k, v], i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  placeholder="SECRET_KEY"
                  value={k}
                  onChange={(e) => setSecretKey(i, e.target.value)}
                  className="flex-1 font-mono text-xs"
                  aria-label={`Secret ${i + 1} key`}
                />
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={v}
                  onChange={(e) => setSecretVal(i, e.target.value)}
                  className="flex-1 text-xs"
                  aria-label={`Secret ${i + 1} value`}
                  autoComplete="off"
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeSecret(i)} aria-label={`Remove secret ${i + 1}`}>
                  <MinusCircleIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {title}
        </Button>
      </div>
    </form>
  );
}

function EnvironmentCard({ env, slug }: { env: EnvironmentResponse; slug: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteEnvironment(slug, env.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['environments', slug] }),
  });

  const editMutation = useMutation({
    mutationFn: (input: CreateEnvironmentInput) =>
      apiClient.updateEnvironment(slug, env.id, input),
    onSuccess: () => {
      setEditing(false);
      setEditError(null);
      void qc.invalidateQueries({ queryKey: ['environments', slug] });
    },
    onError: (err) =>
      setEditError(err instanceof SentinelApiError ? err.message : 'Update failed.'),
  });

  const varCount = Object.keys(env.variables).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">{env.name}</CardTitle>
            {env.isDefault && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">default</span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label={`Edit ${env.name}`}>
              <PencilIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm(`Delete environment "${env.name}"?`)) deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              aria-label={`Delete ${env.name}`}
              className="text-destructive hover:bg-destructive/10"
            >
              {deleteMutation.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-mono text-muted-foreground break-all">{env.baseUrl}</p>
        <p className="text-xs text-muted-foreground">{varCount} variable{varCount !== 1 ? 's' : ''}</p>

        {editing && (
          <Dialog.Root open={editing} onOpenChange={setEditing}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
              <Dialog.Content
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl focus:outline-none overflow-y-auto max-h-[90vh]"
                aria-describedby="edit-env-desc"
              >
                <Dialog.Title className="text-lg font-semibold mb-1">Edit environment</Dialog.Title>
                <Dialog.Description id="edit-env-desc" className="text-sm text-muted-foreground mb-4">
                  Update {env.name} settings.
                </Dialog.Description>
                <EnvForm
                  initialValues={{
                    name: env.name,
                    baseUrl: env.baseUrl,
                    isDefault: env.isDefault,
                    variables: env.variables,
                  }}
                  onSubmit={(values) => editMutation.mutate(values)}
                  onCancel={() => setEditing(false)}
                  isPending={editMutation.isPending}
                  error={editError}
                  title="Save changes"
                />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </CardContent>
    </Card>
  );
}

export default function EnvironmentsPage({ params }: Props) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: environments, isLoading, isError } = useQuery({
    queryKey: ['environments', slug],
    queryFn: () => apiClient.getEnvironments(slug),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateEnvironmentInput) => apiClient.createEnvironment(slug, input),
    onSuccess: () => {
      setCreating(false);
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ['environments', slug] });
    },
    onError: (err) =>
      setCreateError(err instanceof SentinelApiError ? err.message : 'Failed to create environment.'),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Environments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href={`/projects/${slug}`} className="hover:underline focus-visible:underline">
              {slug}
            </Link>{' '}
            / environments
          </p>
        </div>
        <Dialog.Root open={creating} onOpenChange={setCreating}>
          <Dialog.Trigger asChild>
            <Button>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              New environment
            </Button>
          </Dialog.Trigger>
          {creating && (
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
              <Dialog.Content
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl focus:outline-none overflow-y-auto max-h-[90vh]"
                aria-describedby="create-env-desc"
              >
                <Dialog.Title className="text-lg font-semibold mb-1">New environment</Dialog.Title>
                <Dialog.Description id="create-env-desc" className="text-sm text-muted-foreground mb-4">
                  Configure a target environment for running tests.
                </Dialog.Description>
                <EnvForm
                  onSubmit={(values) => createMutation.mutate(values)}
                  onCancel={() => setCreating(false)}
                  isPending={createMutation.isPending}
                  error={createError}
                  title="Create environment"
                />
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </Dialog.Root>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load environments. Please refresh.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && environments && environments.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <ServerIcon className="h-12 w-12 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm text-muted-foreground font-medium">No environments yet</p>
            <p className="text-xs text-muted-foreground">
              Add an environment to start running tests against a base URL.
            </p>
            <Button className="mt-2" onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              Create environment
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && environments && environments.length > 0 && (
        <div className="space-y-4">
          {environments.map((env) => (
            <EnvironmentCard key={env.id} env={env} slug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}

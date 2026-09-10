'use client';

import { use, useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2Icon,
  SaveIcon,
  PlayIcon,
  HistoryIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  XCircleIcon,
  PencilIcon,
  CheckIcon,
} from 'lucide-react';
import { apiClient, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StepList } from '@/components/builder/step-list';
import { StepInspector } from '@/components/builder/step-inspector';
import { CodePreview } from '@/components/builder/code-preview';
import type { Step, StepIr } from '@/components/builder/ir-types';

interface Props {
  params: Promise<{ slug: string; testId: string }>;
}

const EMPTY_IR: StepIr = { version: 1, steps: [] };

function parseStepsIr(raw: unknown): Step[] {
  if (!raw || typeof raw !== 'object') return [];
  const ir = raw as { version?: unknown; steps?: unknown };
  if (ir.version !== 1 || !Array.isArray(ir.steps)) return [];
  return ir.steps as Step[];
}

export default function BuilderPage({ params }: Props) {
  const { slug, testId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const [steps, setSteps] = useState<Step[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveVersionMsg, setSaveVersionMsg] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [stepsLoaded, setStepsLoaded] = useState(false);

  const { data: test, isLoading } = useQuery({
    queryKey: ['test', slug, testId],
    queryFn: () => apiClient.getTest(slug, testId),
  });

  // Load steps from stepsIr once test data arrives
  useEffect(() => {
    if (test && !stepsLoaded) {
      const loaded = parseStepsIr(test.stepsIr);
      setSteps(loaded);
      setEditedName(test.name);
      setStepsLoaded(true);
    }
  }, [test, stepsLoaded]);

  const stepsIr: StepIr = { version: 1, steps };

  // Mutations
  const saveDraftMutation = useMutation({
    mutationFn: () =>
      apiClient.updateTest(slug, testId, {
        stepsIr: stepsIr,
        authoringMode: 'BUILDER',
      }),
    onSuccess: () => {
      setIsDirty(false);
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['test', slug, testId] });
    },
    onError: (err) => {
      setSaveError(
        err instanceof SentinelApiError ? err.message : 'Save failed.',
      );
    },
  });

  const saveVersionMutation = useMutation({
    mutationFn: () =>
      apiClient.saveTestVersion(testId, {
        // Builder tests store IR; code is regenerated from IR at runtime.
        // Use the current persisted code as the snapshot (may be stale until next compile + save).
        code: test?.code ?? '// BUILDER mode — see stepsIr',
        stepsIr: stepsIr,
        message: saveVersionMsg || undefined,
      }),
    onSuccess: () => {
      setSaveVersionMsg('');
      setIsDirty(false);
      void qc.invalidateQueries({ queryKey: ['test-versions', testId] });
    },
    onError: (err) => {
      setSaveError(
        err instanceof SentinelApiError ? err.message : 'Save version failed.',
      );
    },
  });

  const renameTestMutation = useMutation({
    mutationFn: (name: string) => apiClient.updateTest(slug, testId, { name }),
    onSuccess: () => {
      setIsEditingName(false);
      void qc.invalidateQueries({ queryKey: ['test', slug, testId] });
    },
  });

  const switchToCodeMutation = useMutation({
    mutationFn: (compiledCode: string) =>
      apiClient.updateTestAuthoringMode(testId, 'CODE', compiledCode),
    onSuccess: () => {
      router.push(`/projects/${slug}/tests/${testId}`);
    },
    onError: (err) => {
      setSaveError(
        err instanceof SentinelApiError ? err.message : 'Switch failed.',
      );
    },
  });

  // Step operations
  const handleStepsChange = useCallback((newSteps: Step[]) => {
    setSteps(newSteps);
    setIsDirty(true);
  }, []);

  const handleReorder = useCallback(
    (newSteps: Step[]) => handleStepsChange(newSteps),
    [handleStepsChange],
  );

  const handleDelete = useCallback(
    (index: number) => {
      setSteps((prev) => {
        const next = prev.filter((_, i) => i !== index);
        setIsDirty(true);
        return next;
      });
      setSelectedIndex((prev) => {
        if (prev === null) return null;
        if (prev === index) return null;
        if (prev > index) return prev - 1;
        return prev;
      });
    },
    [],
  );

  const handleChange = useCallback((index: number, newStep: Step) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = newStep;
      return next;
    });
    setIsDirty(true);
  }, []);

  const handleAdd = useCallback((step: Step) => {
    setSteps((prev) => {
      const next = [...prev, step];
      setIsDirty(true);
      setSelectedIndex(next.length - 1);
      return next;
    });
  }, []);

  const handleInspectorChange = useCallback(
    (newStep: Step) => {
      if (selectedIndex !== null) {
        handleChange(selectedIndex, newStep);
      }
    },
    [selectedIndex, handleChange],
  );

  function handleSwitchToCode(compiledCode: string) {
    switchToCodeMutation.mutate(compiledCode);
  }

  function handleRenameCommit() {
    if (editedName.trim() && editedName.trim() !== test?.name) {
      renameTestMutation.mutate(editedName.trim());
    } else {
      setIsEditingName(false);
      setEditedName(test?.name ?? '');
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2Icon
          className="h-8 w-8 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (!test) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-destructive">Test not found.</p>
      </div>
    );
  }

  const selectedStep =
    selectedIndex !== null ? steps[selectedIndex] ?? null : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 bg-background shrink-0">
        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-1 text-sm text-muted-foreground mr-2"
          aria-label="Breadcrumb"
        >
          <Link
            href={`/projects/${slug}`}
            className="hover:text-foreground focus-visible:underline"
          >
            {slug}
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <Link
            href={`/projects/${slug}/tests`}
            className="hover:text-foreground focus-visible:underline"
          >
            Tests
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <Link
            href={`/projects/${slug}/tests/${testId}`}
            className="hover:text-foreground focus-visible:underline truncate max-w-[8rem]"
            title={test.name}
          >
            {test.name}
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-foreground font-medium">Builder</span>
        </nav>

        {/* Editable test name */}
        {isEditingName ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              className="h-7 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameCommit();
                if (e.key === 'Escape') {
                  setIsEditingName(false);
                  setEditedName(test.name);
                }
              }}
              onBlur={handleRenameCommit}
              autoFocus
              aria-label="Edit test name"
            />
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={handleRenameCommit}
              aria-label="Confirm name"
            >
              <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
            onClick={() => {
              setEditedName(test.name);
              setIsEditingName(true);
            }}
            aria-label="Edit test name"
          >
            {test.name}
            <PencilIcon className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
          </button>
        )}

        {/* Mode badge */}
        <Badge variant="secondary" className="text-xs shrink-0">
          {test.authoringMode}
        </Badge>

        {isDirty && (
          <Badge variant="outline" className="text-xs shrink-0">
            Unsaved
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Run button — disabled in Phase 4 */}
          <div title="Requires Phase 6">
            <Button
              variant="outline"
              size="sm"
              disabled
              aria-label="Run test (available in Phase 6)"
            >
              <PlayIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Run
            </Button>
          </div>

          {/* Save draft */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveDraftMutation.mutate()}
            disabled={saveDraftMutation.isPending || !isDirty}
            aria-label="Save draft"
          >
            {saveDraftMutation.isPending ? (
              <Loader2Icon
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <SaveIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save draft
          </Button>

          {/* Save version */}
          <Button
            size="sm"
            onClick={() => saveVersionMutation.mutate()}
            disabled={saveVersionMutation.isPending}
            aria-label="Save as new version"
          >
            {saveVersionMutation.isPending ? (
              <Loader2Icon
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <HistoryIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save version
          </Button>
        </div>
      </header>

      {/* Error banner */}
      {saveError && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm text-destructive shrink-0"
        >
          <XCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {saveError}
          <button
            type="button"
            className="ml-auto text-xs underline focus-visible:outline-none"
            onClick={() => setSaveError(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Transition warning for CODE mode */}
      {test.authoringMode === 'CODE' && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 shrink-0">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          This test is in CODE mode. The builder is using the last saved step IR
          (or starting empty). Saving will switch the test to BUILDER mode.
        </div>
      )}

      {/* Main 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Step list (60%) */}
        <div
          className="flex flex-col border-r border-border overflow-y-auto"
          style={{ flexBasis: '60%' }}
          aria-label="Step list"
        >
          <div className="px-3 py-2 border-b border-border shrink-0 bg-muted/20">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Steps ({steps.length})
            </h2>
          </div>
          <div className="flex-1 p-3 overflow-y-auto">
            <StepList
              steps={steps}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onReorder={handleReorder}
              onDelete={handleDelete}
              onChange={handleChange}
              onAdd={handleAdd}
            />
          </div>
        </div>

        {/* Center — Step inspector (20%) */}
        <div
          className="flex flex-col border-r border-border overflow-y-auto"
          style={{ flexBasis: '20%', minWidth: '220px' }}
          aria-label="Step inspector"
        >
          <div className="px-3 py-2 border-b border-border shrink-0 bg-muted/20">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Inspector
            </h2>
          </div>
          <div className="flex-1 p-3 overflow-y-auto">
            {selectedStep ? (
              <StepInspector
                step={selectedStep}
                onChange={handleInspectorChange}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <p className="text-xs text-muted-foreground">
                  Select a step to inspect and edit it.
                </p>
              </div>
            )}
          </div>

          {/* Run to here / Run this step only — Phase 6 */}
          {selectedStep && (
            <div className="px-3 py-2 border-t border-border shrink-0 space-y-1.5">
              <div title="Requires Phase 6">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  className="w-full text-xs h-7"
                  aria-label="Run this step only (available in Phase 6)"
                >
                  Run this step only
                </Button>
              </div>
              <div title="Requires Phase 6">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  className="w-full text-xs h-7"
                  aria-label="Run to here (available in Phase 6)"
                >
                  Run to here
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right — Code preview (20%) */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ flexBasis: '20%', minWidth: '220px' }}
          aria-label="Code preview panel"
        >
          <CodePreview stepsIr={stepsIr} onSwitchToCode={handleSwitchToCode} />
        </div>
      </div>
    </div>
  );
}

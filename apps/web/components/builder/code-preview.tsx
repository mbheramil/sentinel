'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Loader2Icon,
  CopyIcon,
  CheckIcon,
  AlertTriangleIcon,
  CodeIcon,
} from 'lucide-react';
import type { editor as MonacoEditor, MarkerSeverity } from 'monaco-editor';
import { apiClient, SentinelApiError, type CompileWarning } from '@/lib/api-client';
import type { StepIr } from './ir-types';
import { Button } from '@/components/ui/button';

const MonacoEditorComponent = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
      <Loader2Icon
        className="h-6 w-6 animate-spin text-slate-400"
        aria-hidden="true"
      />
    </div>
  ),
});

interface Props {
  stepsIr: StepIr;
  onSwitchToCode: (compiledCode: string) => void;
}

export function CodePreview({ stepsIr, onSwitchToCode }: Props) {
  const [code, setCode] = useState<string>('');
  const [warnings, setWarnings] = useState<CompileWarning[]>([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<{
    editor: { setModelMarkers: (model: MonacoEditor.ITextModel, owner: string, markers: MonacoEditor.IMarkerData[]) => void };
    MarkerSeverity: typeof MarkerSeverity;
  } | null>(null);

  const compile = useCallback(
    async (ir: StepIr) => {
      setIsCompiling(true);
      setCompileError(null);
      try {
        const result = await apiClient.compileIr(ir);
        setCode(result.code);
        setWarnings(result.warnings);

        // Set Monaco markers for warnings
        if (editorRef.current && monacoRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            const markers: MonacoEditor.IMarkerData[] = result.warnings.map(
              (w) => ({
                severity: monacoRef.current!.MarkerSeverity.Warning,
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: model.getLineMaxColumn(1),
                message: `Step ${w.stepIndex}: ${w.message}`,
                source: 'sentinel',
              }),
            );
            monacoRef.current.editor.setModelMarkers(
              model,
              'sentinel',
              markers,
            );
          }
        }
      } catch (err) {
        const msg =
          err instanceof SentinelApiError
            ? err.message
            : 'Compilation failed. Check step configuration.';
        setCompileError(msg);
        setCode('');
        setWarnings([]);
      } finally {
        setIsCompiling(false);
      }
    },
    [],
  );

  // Debounce IR changes → compile
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void compile(stepsIr);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [stepsIr, compile]);

  async function handleCopy() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-background">
        <CodeIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium text-muted-foreground flex-1">
          Code preview
        </span>
        {isCompiling && (
          <Loader2Icon
            className="h-3.5 w-3.5 animate-spin text-muted-foreground"
            aria-hidden="true"
            aria-label="Compiling…"
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={!code}
          aria-label={copied ? 'Copied to clipboard' : 'Copy generated code'}
          className="h-7 px-2 text-xs"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {/* Compile error */}
      {compileError && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-destructive/10 border-b border-destructive/30 px-3 py-2 text-xs text-destructive shrink-0"
        >
          <AlertTriangleIcon
            className="h-3.5 w-3.5 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          {compileError}
        </div>
      )}

      {/* Warnings list */}
      {warnings.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 shrink-0">
          <AlertTriangleIcon
            className="h-3.5 w-3.5 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>
                Step {w.stepIndex}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Monaco editor (read-only) */}
      <div className="flex-1 min-h-0" aria-label="Compiled Playwright code">
        <MonacoEditorComponent
          height="100%"
          defaultLanguage="typescript"
          value={code || (isCompiling ? '// Compiling…' : '// No steps yet.')}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            wordWrap: 'off',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            tabSize: 2,
            folding: true,
            contextmenu: false,
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco as unknown as typeof monacoRef.current;
          }}
        />
      </div>

      {/* Footer: "Use as CODE" */}
      <div className="px-3 py-2 border-t border-border shrink-0 bg-background">
        {showSwitchConfirm ? (
          <div
            className="space-y-2"
            role="alertdialog"
            aria-modal="false"
            aria-label="Confirm switch to code mode"
          >
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangleIcon
                className="h-3.5 w-3.5 inline mr-1"
                aria-hidden="true"
              />
              Switching to CODE mode is one-way. Hand-edits will no longer
              update the Builder.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  onSwitchToCode(code);
                  setShowSwitchConfirm(false);
                }}
                className="h-7 text-xs"
                aria-label="Confirm switch to code mode"
              >
                Switch to CODE
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowSwitchConfirm(false)}
                className="h-7 text-xs"
                aria-label="Cancel switch"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowSwitchConfirm(true)}
            disabled={!code}
            className="h-7 text-xs w-full"
            aria-label="Switch test to CODE authoring mode using the compiled output"
          >
            <CodeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Use as CODE…
          </Button>
        )}
      </div>
    </div>
  );
}

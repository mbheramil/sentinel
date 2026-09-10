import {
  CheckIcon,
  XIcon,
  AlertTriangleIcon,
  MinusIcon,
  ClockIcon,
  Loader2Icon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

export type StatusValue =
  | 'passed'
  | 'failed'
  | 'flaky'
  | 'skipped'
  | 'running'
  | 'queued'
  | 'canceled'
  | 'error'
  | 'timed_out'
  | 'pending'
  | 'PASSED'
  | 'FAILED'
  | 'FLAKY'
  | 'SKIPPED'
  | 'RUNNING'
  | 'QUEUED'
  | 'CANCELED'
  | 'ERROR'
  | 'TIMED_OUT'
  | 'PENDING';

interface StatusConfig {
  label: string;
  icon: React.ElementType;
  className: string;
  iconClassName?: string;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  passed: {
    label: 'Passed',
    icon: CheckIcon,
    className: 'text-status-passed bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900',
  },
  failed: {
    label: 'Failed',
    icon: XIcon,
    className: 'text-status-failed bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900',
  },
  flaky: {
    label: 'Flaky',
    icon: AlertTriangleIcon,
    className: 'text-status-flaky bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
  },
  skipped: {
    label: 'Skipped',
    icon: MinusIcon,
    className: 'text-status-skipped bg-slate-50 border-slate-200 dark:bg-slate-900/30 dark:border-slate-800',
  },
  running: {
    label: 'Running',
    icon: Loader2Icon,
    className: 'text-status-running bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900',
    iconClassName: 'animate-spin',
  },
  queued: {
    label: 'Queued',
    icon: ClockIcon,
    className: 'text-status-queued bg-slate-50 border-dashed border-slate-300 dark:bg-slate-900/30 dark:border-slate-700',
  },
  canceled: {
    label: 'Canceled',
    icon: MinusIcon,
    className: 'text-status-skipped bg-slate-50 border-slate-200 dark:bg-slate-900/30 dark:border-slate-800',
  },
  error: {
    label: 'Error',
    icon: XIcon,
    className: 'text-status-failed bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900',
  },
  timed_out: {
    label: 'Timed out',
    icon: ClockIcon,
    className: 'text-status-failed bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900',
  },
  pending: {
    label: 'Pending',
    icon: ClockIcon,
    className: 'text-status-queued bg-slate-50 border-dashed border-slate-300 dark:bg-slate-900/30 dark:border-slate-700',
  },
};

export interface StatusBadgeProps {
  status: StatusValue;
  className?: string;
  size?: 'sm' | 'default';
  /** Override the display label */
  label?: string;
}

export function StatusBadge({ status, className, size = 'default', label }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const config = STATUS_MAP[key] ?? STATUS_MAP['error']!;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        config.className,
        className,
      )}
      aria-label={label ?? config.label}
    >
      <Icon
        className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5', config.iconClassName)}
        aria-hidden="true"
      />
      <span>{label ?? config.label}</span>
    </span>
  );
}

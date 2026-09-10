import chalk from 'chalk';
import type { Command } from 'commander';
import { api, ApiError, type RunStatus } from '../api.js';

function statusColor(status: string): string {
  switch (status) {
    case 'PASSED': return chalk.green(status);
    case 'FAILED': return chalk.red(status);
    case 'TIMED_OUT': return chalk.red(status);
    case 'FLAKY': return chalk.yellow(status);
    case 'CANCELED': return chalk.gray(status);
    case 'RUNNING': return chalk.blue(status);
    case 'QUEUED': return chalk.cyan(status);
    case 'ERROR': return chalk.red(status);
    default: return status;
  }
}

export function registerStatus(program: Command): void {
  program
    .command('status <runId>')
    .description('Print the current status of a run')
    .option('--json', 'Output raw JSON', false)
    .action(async (runId: string, opts: { json: boolean }) => {
      let run: RunStatus;

      try {
        run = await api.get<RunStatus>(`/api/v1/runs/${runId}`);
      } catch (err) {
        console.error(chalk.red(`Failed to fetch run: ${err instanceof ApiError ? err.message : String(err)}`));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(run, null, 2));
        return;
      }

      console.log(`Run:    ${chalk.cyan(run.id)}`);
      console.log(`Status: ${statusColor(run.status)}`);
      console.log(`Trigger: ${run.trigger}`);

      if (run.queuedAt) {
        console.log(`Queued:  ${new Date(run.queuedAt).toLocaleString()}`);
      }
      if (run.startedAt) {
        console.log(`Started: ${new Date(run.startedAt).toLocaleString()}`);
      }
      if (run.finishedAt) {
        console.log(`Finished: ${new Date(run.finishedAt).toLocaleString()}`);
      }
      if (run.durationMs) {
        console.log(`Duration: ${(run.durationMs / 1000).toFixed(1)}s`);
      }

      const totals = run.totals;
      if (totals && (totals.total ?? 0) > 0) {
        console.log(`\nTests:   ${totals.total ?? 0} total`);
        console.log(`  ${chalk.green('Passed:  ' + String(totals.passed ?? 0))}`);
        console.log(`  ${chalk.red('Failed:  ' + String(totals.failed ?? 0))}`);
        console.log(`  ${chalk.yellow('Flaky:   ' + String(totals.flaky ?? 0))}`);
        console.log(`  ${chalk.gray('Skipped: ' + String(totals.skipped ?? 0))}`);
      }
    });
}

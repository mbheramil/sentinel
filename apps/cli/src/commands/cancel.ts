import chalk from 'chalk';
import type { Command } from 'commander';
import { api, ApiError } from '../api.js';

export function registerCancel(program: Command): void {
  program
    .command('cancel <runId>')
    .description('Cancel an in-progress run')
    .action(async (runId: string) => {
      try {
        await api.post(`/api/v1/runs/${runId}/cancel`);
        console.log(chalk.green(`Run ${chalk.cyan(runId)} canceled.`));
      } catch (err) {
        console.error(chalk.red(`Failed to cancel run: ${err instanceof ApiError ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}

import { exec } from 'node:child_process';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadApiUrl } from '../config.js';

export function registerOpen(program: Command): void {
  program
    .command('open <runId>')
    .description('Open a run in the browser')
    .option('--url <api-url>', 'Override Sentinel API URL')
    .action(async (runId: string, opts: { url?: string }) => {
      const apiUrl = opts.url ?? (await loadApiUrl()) ?? 'http://localhost:3001';
      // Convert API URL to web UI URL (assumes same host, web on :3000)
      const webUrl = apiUrl.replace(/:3001/, ':3000').replace(/\/api\/v1.*/, '');
      const runUrl = `${webUrl}/runs/${runId}`;

      console.log(`Opening: ${chalk.cyan(runUrl)}`);

      let cmd: string;
      switch (process.platform) {
        case 'win32':
          cmd = `start "" "${runUrl}"`;
          break;
        case 'darwin':
          cmd = `open "${runUrl}"`;
          break;
        default:
          cmd = `xdg-open "${runUrl}"`;
      }

      exec(cmd, (err) => {
        if (err) {
          console.error(chalk.red(`Failed to open browser: ${err.message}`));
          console.log(`Visit manually: ${runUrl}`);
        }
      });
    });
}

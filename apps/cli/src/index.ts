#!/usr/bin/env node
/**
 * Sentinel CLI — self-hosted Playwright testing platform
 *
 * Usage:
 *   sentinel login [--url <api-url>]
 *   sentinel init
 *   sentinel run [options]
 *   sentinel status <runId>
 *   sentinel cancel <runId>
 *   sentinel open <runId>
 *   sentinel push [dir]
 *   sentinel pull [--out <dir>]
 *   sentinel token <api-key>
 */
import { Command } from 'commander';
import { registerLogin, registerToken } from './commands/login.js';
import { registerInit } from './commands/init.js';
import { registerRun } from './commands/run.js';
import { registerStatus } from './commands/status.js';
import { registerCancel } from './commands/cancel.js';
import { registerOpen } from './commands/open.js';
import { registerPush } from './commands/push.js';
import { registerPull } from './commands/pull.js';

const program = new Command();

program
  .name('sentinel')
  .description('Sentinel — self-hosted Playwright testing platform')
  .version('0.1.0');

registerLogin(program);
registerToken(program);
registerInit(program);
registerRun(program);
registerStatus(program);
registerCancel(program);
registerOpen(program);
registerPush(program);
registerPull(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

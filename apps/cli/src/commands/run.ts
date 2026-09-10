import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import type { Command } from 'commander';
import { api, ApiError, pollRun, TERMINAL_STATUSES, type RunStatus } from '../api.js';
import { loadProjectConfig } from '../config.js';
import { writeJUnit } from '../reporters/junit.js';

interface Project {
  id: string;
  slug: string;
  name: string;
}

interface CreateRunResponse {
  runId: string;
  status: string;
}

interface Environment {
  id: string;
  name: string;
  isDefault: boolean;
}

function statusColor(status: string): string {
  switch (status) {
    case 'PASSED': return chalk.green(status);
    case 'FAILED': return chalk.red(status);
    case 'TIMED_OUT': return chalk.red(status);
    case 'FLAKY': return chalk.yellow(status);
    case 'SKIPPED': return chalk.gray(status);
    case 'CANCELED': return chalk.gray(status);
    case 'RUNNING': return chalk.blue(status);
    case 'QUEUED': return chalk.cyan(status);
    case 'ERROR': return chalk.red(status);
    default: return status;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummaryTable(run: RunStatus): void {
  if (!run.runTests || run.runTests.length === 0) {
    console.log('No test results available.');
    return;
  }

  const table = new Table({
    head: [
      chalk.bold('Test'),
      chalk.bold('Browser'),
      chalk.bold('Status'),
      chalk.bold('Duration'),
    ],
    style: { head: [], border: [] },
  });

  for (const rt of run.runTests) {
    table.push([
      rt.testCaseId.slice(0, 40),
      rt.browser,
      statusColor(rt.status),
      formatDuration(rt.durationMs),
    ]);
  }

  console.log(table.toString());

  const totals = run.totals;
  if (totals) {
    console.log(
      `\nTotal: ${totals.total ?? 0}  ` +
      chalk.green(`Passed: ${totals.passed ?? 0}`) + '  ' +
      chalk.red(`Failed: ${totals.failed ?? 0}`) + '  ' +
      chalk.yellow(`Flaky: ${totals.flaky ?? 0}`) + '  ' +
      chalk.gray(`Skipped: ${totals.skipped ?? 0}`),
    );
  }
}

export function registerRun(program: Command): void {
  program
    .command('run')
    .description('Trigger a test run on Sentinel')
    .option('--project <slug>', 'Project slug (overrides sentinel.config.json)')
    .option('--suite <id>', 'Suite ID to run')
    .option('--tag <tag>', 'Run tests matching tag')
    .option('--grep <pattern>', 'Run tests matching grep pattern')
    .option('--env <name>', 'Environment name')
    .option('--browser <browsers>', 'Comma-separated browsers: chromium,firefox,webkit', 'chromium')
    .option('--shard-count <n>', 'Number of shards', '1')
    .option('--wait', 'Wait for run to complete', false)
    .option('--json', 'Output raw JSON', false)
    .option('--reporter <type>', 'Reporter: list|json|junit', 'list')
    .action(async (opts: {
      project?: string;
      suite?: string;
      tag?: string;
      grep?: string;
      env?: string;
      browser: string;
      shardCount: string;
      wait: boolean;
      json: boolean;
      reporter: string;
    }) => {
      const projectConfig = loadProjectConfig();

      const projectSlug = opts.project ?? projectConfig?.project;
      if (!projectSlug) {
        console.error(chalk.red('Project is required. Use --project or run `sentinel init`.'));
        process.exit(1);
      }

      const envName = opts.env ?? projectConfig?.defaultEnv ?? 'production';
      const browsers = opts.browser
        .split(',')
        .map((b) => b.trim().toUpperCase())
        .filter(Boolean);
      const shardCount = parseInt(opts.shardCount, 10) || 1;

      // Resolve project ID
      let project: Project;
      try {
        const projects = await api.get<Project[]>('/api/v1/projects');
        const found = projects.find((p) => p.slug === projectSlug);
        if (!found) {
          console.error(chalk.red(`Project '${projectSlug}' not found.`));
          process.exit(1);
        }
        project = found;
      } catch (err) {
        console.error(chalk.red(`Failed to load projects: ${err instanceof ApiError ? err.message : String(err)}`));
        process.exit(2);
      }

      // Resolve environment ID
      let environmentId: string;
      try {
        const envs = await api.get<Environment[]>(`/api/v1/environments?projectId=${project.id}`);
        const env = envs.find((e) => e.name === envName) ?? envs.find((e) => e.isDefault) ?? envs[0];
        if (!env) {
          console.error(chalk.red(`No environment '${envName}' found in project '${projectSlug}'.`));
          process.exit(1);
        }
        environmentId = env.id;
      } catch (err) {
        console.error(chalk.red(`Failed to load environments: ${err instanceof ApiError ? err.message : String(err)}`));
        process.exit(2);
      }

      // Build run payload
      const runBody: Record<string, unknown> = {
        environmentId,
        browsers,
        shardCount,
      };

      if (opts.suite) {
        runBody['suiteId'] = opts.suite;
      }

      // Create the run
      let runResponse: CreateRunResponse;
      const spinner = ora('Creating run...').start();

      try {
        runResponse = await api.post<CreateRunResponse>(
          `/api/v1/projects/${project.id}/runs`,
          runBody,
        );
        spinner.succeed(`Run created: ${chalk.cyan(runResponse.runId)}`);
      } catch (err) {
        spinner.fail('Failed to create run');
        console.error(chalk.red(err instanceof ApiError ? err.message : String(err)));
        process.exit(2);
      }

      if (opts.json && !opts.wait) {
        console.log(JSON.stringify({ runId: runResponse.runId, status: runResponse.status }));
        process.exit(0);
      }

      if (!opts.wait) {
        console.log(`Run ID: ${chalk.cyan(runResponse.runId)}`);
        console.log(`Status: ${statusColor(runResponse.status)}`);
        process.exit(0);
      }

      // --wait: poll until terminal
      const pollSpinner = ora(`Waiting for run ${runResponse.runId}...`).start();
      let finalRun: RunStatus;

      try {
        finalRun = await pollRun(runResponse.runId, (run) => {
          pollSpinner.text = `Run ${run.status.toLowerCase()} (${
            Object.entries(run.totals)
              .filter(([, v]) => (v as number) > 0)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          })`;
        });
        pollSpinner.stop();
      } catch (err) {
        pollSpinner.fail('Polling failed');
        console.error(chalk.red(String(err)));
        process.exit(2);
      }

      if (opts.json || opts.reporter === 'json') {
        console.log(JSON.stringify(finalRun, null, 2));
      } else if (opts.reporter === 'junit') {
        writeJUnit(finalRun);
        printSummaryTable(finalRun);
      } else {
        // list reporter (default)
        printSummaryTable(finalRun);
        console.log(`\nRun ${chalk.cyan(finalRun.id)}: ${statusColor(finalRun.status)}`);
        if (finalRun.durationMs) {
          console.log(`Duration: ${formatDuration(finalRun.durationMs)}`);
        }
      }

      // Exit codes: 0=passed, 1=test failures, 2=infra error
      if (finalRun.status === 'PASSED') {
        process.exit(0);
      } else if (finalRun.status === 'FAILED' || finalRun.status === 'TIMED_OUT') {
        process.exit(1);
      } else if (finalRun.status === 'CANCELED') {
        process.exit(1);
      } else {
        // ERROR or other infra failure
        process.exit(2);
      }
    });
}

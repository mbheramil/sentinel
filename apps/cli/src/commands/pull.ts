import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import { api, ApiError } from '../api.js';
import { loadProjectConfig } from '../config.js';

interface Project {
  id: string;
  slug: string;
}

interface TestCase {
  id: string;
  filePath: string;
  name: string;
  code: string;
}

export function registerPull(program: Command): void {
  program
    .command('pull')
    .description('Export TestCases from Sentinel to disk')
    .option('--project <slug>', 'Project slug (overrides sentinel.config.json)')
    .option('--out <dir>', 'Output directory', './tests')
    .option('--dry-run', 'Show what would be written without writing', false)
    .action(async (opts: { project?: string; out: string; dryRun: boolean }) => {
      const config = loadProjectConfig();
      const projectSlug = opts.project ?? config?.project;

      if (!projectSlug) {
        console.error(chalk.red('Project is required. Use --project or run `sentinel init`.'));
        process.exit(1);
      }

      const outDir = resolve(process.cwd(), opts.out);

      // Resolve project
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

      // Fetch all test cases
      const spinner = ora('Fetching test cases...').start();
      let tests: TestCase[];

      try {
        tests = await api.get<TestCase[]>(`/api/v1/projects/${project.id}/tests`);
        spinner.succeed(`Fetched ${tests.length} test cases`);
      } catch (err) {
        spinner.fail('Failed to fetch test cases');
        console.error(chalk.red(err instanceof ApiError ? err.message : String(err)));
        process.exit(2);
      }

      if (tests.length === 0) {
        console.log(chalk.yellow('No test cases found.'));
        process.exit(0);
      }

      if (opts.dryRun) {
        console.log(`\nWould write to: ${outDir}`);
        tests.forEach((t) => console.log(`  ${t.filePath}`));
        process.exit(0);
      }

      let written = 0;
      let errors = 0;

      for (const test of tests) {
        const filePath = resolve(outDir, test.filePath);
        try {
          mkdirSync(dirname(filePath), { recursive: true });
          writeFileSync(filePath, test.code, 'utf8');
          written++;
        } catch (err) {
          errors++;
          console.error(chalk.red(`Failed to write ${test.filePath}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      console.log(chalk.green(`\nPull complete:`));
      console.log(`  Written: ${written}`);
      if (errors > 0) console.log(chalk.red(`  Errors:  ${errors}`));
      console.log(`  Output:  ${outDir}`);
    });
}

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import { api, ApiError } from '../api.js';
import { loadProjectConfig } from '../config.js';

interface Project {
  id: string;
  slug: string;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: Array<{ path: string; message: string }>;
}

function findSpecFiles(dir: string, base: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findSpecFiles(full, base, results);
    } else if (
      stat.isFile() &&
      (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts') || entry.endsWith('.spec.js'))
    ) {
      results.push(relative(base, full));
    }
  }
  return results;
}

export function registerPush(program: Command): void {
  program
    .command('push [dir]')
    .description('Upload local .spec.ts files as TestCases via batch import')
    .option('--project <slug>', 'Project slug (overrides sentinel.config.json)')
    .option('--dry-run', 'Show what would be uploaded without uploading', false)
    .option('--batch-size <n>', 'Number of files per import request', '50')
    .action(
      async (
        dir: string | undefined,
        opts: { project?: string; dryRun: boolean; batchSize: string },
      ) => {
        const config = loadProjectConfig();
        const projectSlug = opts.project ?? config?.project;

        if (!projectSlug) {
          console.error(chalk.red('Project is required. Use --project or run `sentinel init`.'));
          process.exit(1);
        }

        const baseDir = resolve(process.cwd(), dir ?? '.');
        const specFiles = findSpecFiles(baseDir, baseDir).filter((f) => f.endsWith('.spec.ts'));

        if (specFiles.length === 0) {
          console.log(chalk.yellow(`No .spec.ts files found in ${baseDir}`));
          process.exit(0);
        }

        console.log(`Found ${chalk.cyan(String(specFiles.length))} spec files in ${baseDir}`);

        if (opts.dryRun) {
          specFiles.forEach((f) => console.log(`  ${f}`));
          process.exit(0);
        }

        // Resolve project ID from slug
        const projects = await api.get<Project[]>('/api/v1/projects');
        const project = projects.find((p) => p.slug === projectSlug);
        if (!project) {
          console.error(chalk.red(`Project '${projectSlug}' not found.`));
          process.exit(1);
        }

        const batchSize = Math.max(1, parseInt(opts.batchSize, 10) || 50);
        let totalCreated = 0;
        let totalUpdated = 0;
        const allErrors: Array<{ path: string; message: string }> = [];

        const spinner = ora(`Uploading ${specFiles.length} files...`).start();

        // Process in batches
        for (let i = 0; i < specFiles.length; i += batchSize) {
          const batch = specFiles.slice(i, i + batchSize);

          const files = batch.map((filePath) => {
            const fullPath = resolve(baseDir, filePath);
            const content = readFileSync(fullPath, 'utf8');
            return { path: filePath, content };
          });

          try {
            const result = await api.post<ImportResult>(
              `/api/v1/projects/${project.id}/import`,
              { files },
            );

            totalCreated += result.created;
            totalUpdated += result.updated;
            allErrors.push(...result.errors);

            spinner.text = `Uploading... (${Math.min(i + batchSize, specFiles.length)}/${specFiles.length})`;
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : String(err);
            spinner.fail(`Batch ${Math.floor(i / batchSize) + 1} failed: ${msg}`);
            spinner.start();
          }
        }

        spinner.stop();

        console.log(chalk.green('\nPush complete:'));
        console.log(`  Created: ${totalCreated}`);
        console.log(`  Updated: ${totalUpdated}`);

        if (allErrors.length > 0) {
          console.log(chalk.red(`  Errors:  ${allErrors.length}`));
          for (const e of allErrors.slice(0, 10)) {
            console.log(chalk.red(`    ${e.path}: ${e.message}`));
          }
          if (allErrors.length > 10) {
            console.log(chalk.red(`    ... and ${allErrors.length - 10} more`));
          }
        } else {
          console.log('  Errors:  0');
        }
      },
    );
}

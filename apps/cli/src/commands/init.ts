import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { saveProjectConfig, loadApiUrl } from '../config.js';
import { api } from '../api.js';

interface Project {
  id: string;
  slug: string;
  name: string;
}

interface Environment {
  id: string;
  name: string;
  isDefault: boolean;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize a sentinel.config.json in the current directory')
    .option('--yes', 'Skip prompts and use defaults')
    .action(async (opts: { yes: boolean }) => {
      const configPath = resolve(process.cwd(), 'sentinel.config.json');

      if (existsSync(configPath)) {
        console.log(chalk.yellow('sentinel.config.json already exists.'));
        if (!opts.yes) {
          const rl = createInterface({ input, output });
          const answer = await rl.question('Overwrite? (y/N): ');
          rl.close();
          if (answer.toLowerCase() !== 'y') {
            console.log('Aborted.');
            process.exit(0);
          }
        }
      }

      const apiUrl = (await loadApiUrl()) ?? 'http://localhost:3001';

      // Fetch available projects
      let projects: Project[] = [];
      try {
        projects = await api.get<Project[]>('/api/v1/projects');
      } catch {
        // Not authenticated or API unreachable — will prompt manually
      }

      let chosenProject: string;
      let chosenEnv: string | undefined;

      if (opts.yes) {
        chosenProject = projects[0]?.slug ?? 'my-project';
        chosenEnv = 'production';
      } else {
        const rl = createInterface({ input, output });
        console.log(chalk.bold('\nSentinel Init\n'));

        if (projects.length > 0) {
          console.log('Available projects:');
          projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.slug} (${p.name})`));
          console.log();
        }

        chosenProject = await rl.question('Project slug: ');

        // Try to fetch environments for the selected project
        let envs: Environment[] = [];
        const selectedProject = projects.find((p) => p.slug === chosenProject);
        if (selectedProject) {
          try {
            const allEnvs = await api.get<Environment[]>(`/api/v1/environments?projectId=${selectedProject.id}`);
            envs = allEnvs;
          } catch {
            // ignore
          }
        }

        if (envs.length > 0) {
          console.log('\nAvailable environments:');
          envs.forEach((e, i) => console.log(`  ${i + 1}. ${e.name}${e.isDefault ? ' (default)' : ''}`));
          console.log();
        }

        const defaultEnvInput = await rl.question('Default environment [production]: ');
        rl.close();
        chosenEnv = defaultEnvInput.trim() || 'production';
      }

      if (!chosenProject.trim()) {
        console.error(chalk.red('Project slug is required.'));
        process.exit(1);
      }

      saveProjectConfig({
        apiUrl,
        project: chosenProject.trim(),
        defaultEnv: chosenEnv,
      });

      console.log(chalk.green('\nsentinel.config.json created:'));
      console.log(`  apiUrl:     ${chalk.cyan(apiUrl)}`);
      console.log(`  project:    ${chalk.cyan(chosenProject.trim())}`);
      if (chosenEnv) {
        console.log(`  defaultEnv: ${chalk.cyan(chosenEnv)}`);
      }
      console.log();
    });
}

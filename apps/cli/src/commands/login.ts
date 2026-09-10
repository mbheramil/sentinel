import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import type { Command } from 'commander';
import { saveToken, saveApiUrl } from '../config.js';
import { api, ApiError } from '../api.js';

const DEFAULT_API_URL = 'http://localhost:3001';

interface LoginResponse {
  userId: string;
  email: string;
}

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('Authenticate with a Sentinel instance')
    .option('--url <api-url>', 'Sentinel API URL', DEFAULT_API_URL)
    .action(async (opts: { url: string }) => {
      const apiUrl = opts.url;
      console.log(chalk.bold('Sentinel Login'));
      console.log(`API URL: ${chalk.cyan(apiUrl)}\n`);

      const rl = createInterface({ input, output });

      let email: string;
      let password: string;

      try {
        email = await rl.question('Email: ');
        // Note: password will echo in terminal without a proper TTY trick
        // For a production CLI, use a library like `@inquirer/password`
        password = await rl.question('Password: ');
      } finally {
        rl.close();
      }

      if (!email || !password) {
        console.error(chalk.red('Email and password are required.'));
        process.exit(1);
      }

      console.log('\nAuthenticating...');

      try {
        // The login endpoint sets a cookie; for CLI use we use API keys.
        // First try password auth, store the session-token equivalent.
        const result = await api.post<LoginResponse>(
          '/api/v1/auth/login',
          { email, password },
          apiUrl,
          undefined,
        );

        // For CLI, we need a persistent token. Since the current auth route
        // returns a cookie-based session, we prompt the user to create an API key
        // or use the session token if available.
        // We store the session token from the Set-Cookie header if possible,
        // but here we use a simpler approach: instruct to use API keys.
        console.log(chalk.green(`\nLogged in as ${result.email} (${result.userId})`));
        console.log(chalk.yellow('\nNote: For persistent CLI access, create an API key at:'));
        console.log(`  ${apiUrl}/settings/api-keys`);
        console.log('Then set it with: export SENTINEL_API_KEY=sk_...\n');

        await saveApiUrl(apiUrl);
        console.log(chalk.green('API URL saved.'));
      } catch (err) {
        if (err instanceof ApiError) {
          console.error(chalk.red(`Login failed: ${err.message}`));
        } else {
          console.error(chalk.red(`Login failed: ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });
}

/**
 * Register the `sentinel token` command for storing an API key directly.
 */
export function registerToken(program: Command): void {
  program
    .command('token <api-key>')
    .description('Store an API key for authentication')
    .option('--url <api-url>', 'Sentinel API URL', DEFAULT_API_URL)
    .action(async (apiKey: string, opts: { url: string }) => {
      await saveToken(apiKey);
      await saveApiUrl(opts.url);
      console.log(chalk.green('API key saved to keychain.'));
      console.log(`API URL: ${chalk.cyan(opts.url)}`);
    });
}

import baseConfig from '@sentinel/config/eslint';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Not `project: true` (nearest tsconfig.json): that one is the build
        // config and only includes `src`, so `prisma/seed.ts` fails to parse.
        project: './tsconfig.typecheck.json',
      },
    },
  },
  {
    // `prisma/` holds one-off scripts run by hand or in deploy (`db:seed`).
    // Printing progress to stdout is the point, not a stray debug statement.
    files: ['prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

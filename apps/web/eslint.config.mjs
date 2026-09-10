import nextPlugin from '@next/eslint-plugin-next';
import baseConfig from '@sentinel/config/eslint';

/**
 * Shared TypeScript rules plus Next.js's own. The plugin is registered by hand
 * rather than through `eslint-config-next`, which on Next 15.1 still ships
 * eslintrc-only config and would need a FlatCompat shim.
 */
export default [
  {
    // Build output and generated ambient types are not source.
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];

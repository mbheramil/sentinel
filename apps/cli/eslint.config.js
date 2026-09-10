import baseConfig from '@sentinel/config/eslint';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // stdout *is* this package's user interface — it's a CLI, not a service.
      'no-console': 'off',
    },
  },
];

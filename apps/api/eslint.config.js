import baseConfig from '@sentinel/config/eslint';

export default [
  ...baseConfig,
  {
    // The base config's type-aware rules need every linted file to be in a TS
    // program, and the build tsconfig only covers `src`.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.typecheck.json' },
    },
  },
  {
    // These are CLI checks; printing their result is the point.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];

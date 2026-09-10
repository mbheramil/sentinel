import baseConfig from '@sentinel/config/eslint';

export default [
  ...baseConfig,
  {
    // `__tests__/golden/*.expected.ts` is the compiler's expected *output*, not
    // code this package builds: it imports a Playwright fixture that only exists
    // in a generated project and is compared as text, so it must not be parsed
    // or linted here.
    ignores: ['__tests__/golden/**'],
  },
  {
    // The test file itself is real code worth linting, but tsconfig.json only
    // covers `src` (build emits with rootDir: src), so type-aware parsing can't
    // resolve it. None of the rules in the base config need type information.
    files: ['__tests__/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
  },
];

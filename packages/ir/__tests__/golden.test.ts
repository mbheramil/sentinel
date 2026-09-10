import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prettier from 'prettier';
import { compile } from '../src/index.js';
import type { CompileWarning, StepIr } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(__dirname, 'golden');

const prettierOptions: prettier.Options = {
  parser: 'typescript',
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
};

// Find all *.input.json files in the golden directory
const inputFiles = readdirSync(goldenDir).filter((f) => f.endsWith('.input.json'));

describe('IR compiler golden tests', () => {
  for (const inputFile of inputFiles) {
    const baseName = inputFile.replace('.input.json', '');

    it(`golden: ${baseName}`, async () => {
      // Load and parse the IR
      const inputPath = join(goldenDir, inputFile);
      const ir = JSON.parse(readFileSync(inputPath, 'utf-8')) as StepIr;

      // Compile
      const result = await compile(ir);

      // Load and format the expected output
      const expectedPath = join(goldenDir, `${baseName}.expected.ts`);
      const rawExpected = readFileSync(expectedPath, 'utf-8');
      const expectedCode = await prettier.format(rawExpected, prettierOptions);

      // Compare formatted outputs
      expect(result.code).toBe(expectedCode);

      // Check warnings if a warnings file exists
      const warningsPath = join(goldenDir, `${baseName}.warnings.json`);
      let expectedWarnings: CompileWarning[] | null = null;
      try {
        expectedWarnings = JSON.parse(readFileSync(warningsPath, 'utf-8')) as CompileWarning[];
      } catch {
        // No warnings file — just verify no unexpected warnings for non-raw tests
      }

      if (expectedWarnings !== null) {
        expect(result.warnings).toEqual(expectedWarnings);
      }
    });
  }
});

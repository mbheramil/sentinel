/**
 * JUnit XML reporter for Sentinel run results.
 * Produces standard JUnit XML consumed by CI tools (Jenkins, GitHub Actions, etc.)
 */
import { writeFileSync } from 'node:fs';
import type { RunStatus } from '../api.js';

interface JUnitTestCase {
  name: string;
  classname: string;
  time: number;
  failure?: {
    message: string;
    type: string;
    body: string;
  };
}

interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  time: number;
  cases: JUnitTestCase[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildXml(suites: JUnitTestSuite[], totalTime: number): string {
  const totalTests = suites.reduce((s, x) => s + x.tests, 0);
  const totalFailures = suites.reduce((s, x) => s + x.failures, 0);
  const totalErrors = suites.reduce((s, x) => s + x.errors, 0);

  const suiteXml = suites
    .map((suite) => {
      const casesXml = suite.cases
        .map((c) => {
          const failureXml = c.failure
            ? `\n      <failure message="${escapeXml(c.failure.message)}" type="${escapeXml(c.failure.type)}">${escapeXml(c.failure.body)}</failure>`
            : '';
          return `    <testcase name="${escapeXml(c.name)}" time="${c.time.toFixed(3)}" classname="${escapeXml(c.classname)}">${failureXml}\n    </testcase>`;
        })
        .join('\n');

      return `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" time="${suite.time.toFixed(3)}">
${casesXml}
  </testsuite>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Sentinel" time="${totalTime.toFixed(3)}" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}">
${suiteXml}
</testsuites>
`;
}

/**
 * Write JUnit XML from a completed run's test results.
 */
export function writeJUnit(run: RunStatus, outputPath = 'sentinel-results.xml'): void {
  if (!run.runTests) {
    writeFileSync(outputPath, buildXml([], (run.durationMs ?? 0) / 1000), 'utf8');
    return;
  }

  // Group test cases by filePath (used as testsuite name)
  // Since we don't have filePath in the run summary, group by testCaseId prefix or use 'default'
  const suiteMap = new Map<string, JUnitTestSuite>();

  for (const rt of run.runTests) {
    // Use browser as suite name since we don't have file paths in this response shape
    const suiteName = `${rt.browser}`;

    if (!suiteMap.has(suiteName)) {
      suiteMap.set(suiteName, {
        name: suiteName,
        tests: 0,
        failures: 0,
        errors: 0,
        time: 0,
        cases: [],
      });
    }

    const suite = suiteMap.get(suiteName)!;
    const durationSec = (rt.durationMs ?? 0) / 1000;

    const isFailed = rt.status === 'FAILED' || rt.status === 'TIMED_OUT';
    const isError = rt.status === 'ERROR';

    const testCase: JUnitTestCase = {
      name: rt.testCaseId,
      classname: rt.browser,
      time: durationSec,
    };

    if (isFailed) {
      testCase.failure = {
        message: rt.status === 'TIMED_OUT' ? 'Test timed out' : 'Test failed',
        type: rt.status === 'TIMED_OUT' ? 'TimeoutError' : 'AssertionError',
        body: `Status: ${rt.status}\nBrowser: ${rt.browser}\nTestCaseId: ${rt.testCaseId}`,
      };
      suite.failures++;
    }

    if (isError) {
      testCase.failure = {
        message: 'Infrastructure error',
        type: 'Error',
        body: `Status: ${rt.status}\nBrowser: ${rt.browser}`,
      };
      suite.errors++;
    }

    suite.tests++;
    suite.time += durationSec;
    suite.cases.push(testCase);
  }

  const suites = Array.from(suiteMap.values());
  const totalTime = (run.durationMs ?? 0) / 1000;

  const xml = buildXml(suites, totalTime);
  writeFileSync(outputPath, xml, 'utf8');
  console.log(`JUnit results written to ${outputPath}`);
}

/**
 * Build JUnit XML from detailed test results (with name, file path, error info).
 */
export interface DetailedTestResult {
  name: string;
  filePath?: string;
  browser: string;
  status: string;
  durationMs?: number | null;
  errorMessage?: string;
  errorName?: string;
  errorStack?: string;
}

export function writeJUnitDetailed(
  results: DetailedTestResult[],
  runId: string,
  totalDurationMs: number,
  outputPath = 'sentinel-results.xml',
): void {
  const suiteMap = new Map<string, JUnitTestSuite>();

  for (const r of results) {
    const suiteName = r.filePath ?? 'specs';

    if (!suiteMap.has(suiteName)) {
      suiteMap.set(suiteName, {
        name: suiteName,
        tests: 0,
        failures: 0,
        errors: 0,
        time: 0,
        cases: [],
      });
    }

    const suite = suiteMap.get(suiteName)!;
    const durationSec = (r.durationMs ?? 0) / 1000;

    const isFailed = r.status === 'FAILED' || r.status === 'TIMED_OUT';
    const isError = r.status === 'ERROR';

    const testCase: JUnitTestCase = {
      name: r.name,
      classname: r.browser,
      time: durationSec,
    };

    if (isFailed || isError) {
      const msg = r.errorMessage ?? (r.status === 'TIMED_OUT' ? 'Test timed out' : 'Test failed');
      const type = r.errorName ?? (r.status === 'TIMED_OUT' ? 'TimeoutError' : 'AssertionError');
      testCase.failure = {
        message: msg.split('\n')[0] ?? msg,
        type,
        body: r.errorStack ?? msg,
      };
      if (isError) suite.errors++;
      else suite.failures++;
    }

    suite.tests++;
    suite.time += durationSec;
    suite.cases.push(testCase);
  }

  const suites = Array.from(suiteMap.values());
  const xml = buildXml(suites, totalDurationMs / 1000);
  writeFileSync(outputPath, xml, 'utf8');
  console.log(`JUnit results written to ${outputPath} (run: ${runId})`);
}

import { describe, expect, it } from 'vitest';
import type { RunSummary, TestResult } from '@triad/test-runner';
import { reportSummary } from '../src/reporter.js';

function captured(): { write: (s: string) => void; text: () => string } {
  let buffer = '';
  return {
    write: (s: string) => {
      buffer += s;
    },
    text: () => buffer,
  };
}

function passedResult(scenario: string): TestResult {
  return {
    endpointName: 'createPet',
    method: 'POST',
    path: '/pets',
    scenario,
    status: 'passed',
    durationMs: 5,
  };
}

function failedResult(scenario: string, message: string): TestResult {
  return {
    endpointName: 'createPet',
    method: 'POST',
    path: '/pets',
    scenario,
    status: 'failed',
    failure: { message, actualStatus: 500 },
    durationMs: 7,
  };
}

function summaryFrom(results: TestResult[]): RunSummary {
  const summary: RunSummary = {
    total: results.length,
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
    durationMs: 0,
    results,
  };
  for (const r of results) {
    summary[r.status]++;
    summary.durationMs += r.durationMs;
  }
  return summary;
}

describe('reportSummary', () => {
  it('renders a passing summary', () => {
    const cap = captured();
    reportSummary(summaryFrom([passedResult('Pets can be created')]), {
      write: cap.write,
      color: false,
    });
    const text = cap.text();
    expect(text).toContain('POST /pets — createPet');
    expect(text).toContain('Pets can be created');
    expect(text).toContain('1 scenarios');
    expect(text).toContain('1 passed');
  });

  it('renders failure details', () => {
    const cap = captured();
    reportSummary(
      summaryFrom([
        failedResult('Broken scenario', 'Expected status 200, got 500'),
      ]),
      { write: cap.write, color: false },
    );
    const text = cap.text();
    expect(text).toContain('Broken scenario');
    expect(text).toContain('Expected status 200, got 500');
    expect(text).toContain('actual status: 500');
    expect(text).toContain('1 failed');
  });

  it('groups multiple scenarios under their endpoint heading', () => {
    const cap = captured();
    reportSummary(
      summaryFrom([
        passedResult('First scenario'),
        passedResult('Second scenario'),
      ]),
      { write: cap.write, color: false },
    );
    const text = cap.text();
    // Heading appears once
    const headingCount = (text.match(/POST \/pets — createPet/g) ?? []).length;
    expect(headingCount).toBe(1);
    expect(text).toContain('First scenario');
    expect(text).toContain('Second scenario');
  });

  it('includes mixed summary parts for mixed outcomes', () => {
    const cap = captured();
    reportSummary(
      summaryFrom([
        passedResult('Passes'),
        failedResult('Fails', 'nope'),
      ]),
      { write: cap.write, color: false },
    );
    const text = cap.text();
    expect(text).toContain('1 passed');
    expect(text).toContain('1 failed');
    expect(text).toContain('2 scenarios');
  });
});

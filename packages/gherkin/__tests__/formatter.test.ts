import { describe, expect, it } from 'vitest';
import { scenario } from '@triad/core';
import {
  formatScenario,
  formatDataTable,
  formatTableValue,
} from '../src/formatter.js';

describe('formatTableValue', () => {
  it('passes strings through', () => {
    expect(formatTableValue('Buddy')).toBe('Buddy');
  });

  it('stringifies numbers and booleans', () => {
    expect(formatTableValue(42)).toBe('42');
    expect(formatTableValue(3.14)).toBe('3.14');
    expect(formatTableValue(true)).toBe('true');
    expect(formatTableValue(false)).toBe('false');
  });

  it('represents null as "null"', () => {
    expect(formatTableValue(null)).toBe('null');
  });

  it('represents undefined as empty string', () => {
    expect(formatTableValue(undefined)).toBe('');
  });

  it('JSON-stringifies nested objects and arrays', () => {
    expect(formatTableValue({ a: 1 })).toBe('{"a":1}');
    expect(formatTableValue([1, 2, 3])).toBe('[1,2,3]');
  });
});

describe('formatDataTable', () => {
  it('returns empty array for empty object', () => {
    expect(formatDataTable({}, 4)).toEqual([]);
  });

  it('formats a simple flat object with aligned columns', () => {
    const lines = formatDataTable({ name: 'Buddy', species: 'dog', age: 3 }, 4);
    expect(lines).toEqual([
      '    | field   | value |',
      '    | name    | Buddy |',
      '    | species | dog   |',
      '    | age     | 3     |',
    ]);
  });

  it('pads the value column to fit the longest value', () => {
    const lines = formatDataTable({ a: 'xx', b: 'longer-value' }, 0);
    // Every row should have the same total width (same table layout)
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
    // And the value column should fit "longer-value" (12 chars)
    const valueRow = lines.find((l) => l.includes('longer-value'))!;
    expect(valueRow).toContain('| longer-value |');
  });

  it('respects the indent parameter', () => {
    const lines = formatDataTable({ name: 'X' }, 8);
    for (const line of lines) {
      expect(line.startsWith('        |')).toBe(true);
    }
  });
});

describe('formatScenario', () => {
  it('formats a basic scenario without a data table', () => {
    const b = scenario('Get a pet')
      .given('a pet exists')
      .when('I GET /pets/42')
      .then('response status is 200');

    const lines = formatScenario(b);
    expect(lines).toEqual([
      '  Scenario: Get a pet',
      '    Given a pet exists',
      '    When I GET /pets/42',
      '    Then response status is 200',
    ]);
  });

  it('emits a data table for a plain object body', () => {
    const b = scenario('Create a pet')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201');

    const lines = formatScenario(b);
    // Data table should appear between Given and When
    const givenIndex = lines.findIndex((l) => l.includes('Given'));
    const whenIndex = lines.findIndex((l) => l.includes('When'));
    expect(whenIndex).toBeGreaterThan(givenIndex + 1);
    // Check the table header is present
    expect(lines.some((l) => l.includes('| field'))).toBe(true);
    expect(lines.some((l) => l.includes('| name'))).toBe(true);
  });

  it('chains multiple assertions as Then + And', () => {
    const b = scenario('Multiple assertions')
      .given('a state')
      .when('an action')
      .then('response status is 200')
      .and('response body matches Pet')
      .and('response body has name "Buddy"');

    const lines = formatScenario(b);
    const thenLines = lines.filter(
      (l) => l.trimStart().startsWith('Then ') || l.trimStart().startsWith('And '),
    );
    expect(thenLines).toEqual([
      '    Then response status is 200',
      '    And response body matches Pet',
      '    And response body has name "Buddy"',
    ]);
  });

  it('does not render params/query/headers/fixtures/setup in Gherkin output', () => {
    const b = scenario('Hidden implementation details')
      .given('a request with various parts')
      .params({ id: 'abc' })
      .query({ limit: 10 })
      .headers({ authorization: 'Bearer x' })
      .fixtures({ petId: 'xyz' })
      .setup(async () => ({ ready: true }))
      .when('I call')
      .then('response status is 200');

    const lines = formatScenario(b);
    // Only the description-level words appear
    expect(lines.join('\n')).not.toContain('Bearer x');
    expect(lines.join('\n')).not.toContain('abc');
    expect(lines.join('\n')).not.toContain('xyz');
    expect(lines.join('\n')).not.toContain('ready');
  });

  it('respects the indent parameter', () => {
    const b = scenario('Indented')
      .given('x')
      .when('y')
      .then('response status is 200');

    const lines = formatScenario(b, 0);
    expect(lines[0]).toBe('Scenario: Indented');
    expect(lines[1]).toBe('  Given x');
  });
});

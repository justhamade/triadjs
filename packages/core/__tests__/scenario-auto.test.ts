import { describe, expect, it } from 'vitest';
import { scenario } from '../src/behavior.js';
import { auto } from '../src/scenario-auto.js';
import type { AutoScenarioMarker } from '../src/scenario-auto.js';

describe('scenario.auto / auto()', () => {
  it('returns marker objects with default options', () => {
    const markers = auto();
    expect(markers).toHaveLength(1);
    const marker = markers[0] as unknown as AutoScenarioMarker;
    expect(marker.__auto).toBe(true);
    expect(marker.options.missingFields).toBe(true);
    expect(marker.options.boundaries).toBe(true);
    expect(marker.options.invalidEnums).toBe(true);
    expect(marker.options.typeConfusion).toBe(true);
    expect(marker.options.randomValid).toBe(10);
  });

  it('respects boundaries: false', () => {
    const markers = auto({ boundaries: false });
    const marker = markers[0] as unknown as AutoScenarioMarker;
    expect(marker.options.boundaries).toBe(false);
  });

  it('respects randomValid: 0', () => {
    const markers = auto({ randomValid: 0 });
    const marker = markers[0] as unknown as AutoScenarioMarker;
    expect(marker.options.randomValid).toBe(0);
  });

  it('markers are spread-able into a behaviors array', () => {
    const handWritten = scenario('manual test')
      .given('some state')
      .body({ name: 'Buddy' })
      .when('I do something')
      .then('response status is 200');

    const behaviors = [handWritten, ...auto()];
    expect(behaviors).toHaveLength(2);
  });

  it('markers have the __auto flag', () => {
    const markers = auto();
    for (const m of markers) {
      expect((m as unknown as AutoScenarioMarker).__auto).toBe(true);
    }
  });

  it('supports custom seed option', () => {
    const markers = auto({ seed: 42 });
    const marker = markers[0] as unknown as AutoScenarioMarker;
    expect(marker.options.seed).toBe(42);
  });

  it('supports missingFields: false', () => {
    const markers = auto({ missingFields: false });
    const marker = markers[0] as unknown as AutoScenarioMarker;
    expect(marker.options.missingFields).toBe(false);
  });

  it('supports typeConfusion: false', () => {
    const markers = auto({ typeConfusion: false });
    const marker = markers[0] as unknown as AutoScenarioMarker;
    expect(marker.options.typeConfusion).toBe(false);
  });
});

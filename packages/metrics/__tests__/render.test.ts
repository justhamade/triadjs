import { describe, it, expect } from 'vitest';
import { createMetricsCollector } from '../src/index.js';

describe('render — Prometheus text format', () => {
  it('renders an empty collector without error', () => {
    const c = createMetricsCollector();
    const text = c.render();
    // No metric samples, but the output is still valid (empty or header-only).
    expect(typeof text).toBe('string');
    // Should not include any sample lines.
    expect(text).not.toMatch(/^triad_/m);
  });

  it('produces deterministic output for a seeded collector', () => {
    const c = createMetricsCollector();
    c.recordRequest({
      method: 'GET',
      route: '/books',
      endpointName: 'listBooks',
      context: 'Library',
      status: 200,
      latencySeconds: 0.004,
    });
    c.recordRequest({
      method: 'GET',
      route: '/books',
      endpointName: 'listBooks',
      context: 'Library',
      status: 200,
      latencySeconds: 0.012,
    });
    c.recordRequest({
      method: 'POST',
      route: '/books',
      endpointName: 'createBook',
      context: 'Library',
      status: 201,
      latencySeconds: 0.08,
    });
    const first = c.render();
    const second = c.render();
    expect(first).toBe(second);
  });

  it('sorts series deterministically by label set', () => {
    const c = createMetricsCollector();
    // Record in unsorted order
    c.recordRequest({
      method: 'POST',
      route: '/z',
      endpointName: 'z',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    c.recordRequest({
      method: 'GET',
      route: '/a',
      endpointName: 'a',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    const text = c.render();
    // Extract order of counter lines
    const lines = text
      .split('\n')
      .filter((l) => l.startsWith('triad_http_requests_total{'));
    expect(lines).toHaveLength(2);
    // /a should come before /z (alphabetical by label set)
    expect(lines[0]).toContain('route="/a"');
    expect(lines[1]).toContain('route="/z"');
  });

  it('emits both counter and histogram for a single recording', () => {
    const c = createMetricsCollector();
    c.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.03,
    });
    const text = c.render();
    // Counter sample
    expect(text).toContain(
      'triad_http_requests_total{method="GET",route="/x",status="200",context=""} 1',
    );
    // Histogram sum and count
    expect(text).toMatch(
      /triad_http_request_duration_seconds_count\{method="GET",route="\/x",status="200",context=""\} 1/,
    );
  });

  it('only emits error counter lines when errors exist', () => {
    const c = createMetricsCollector();
    c.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    const text = c.render();
    expect(text).not.toContain('triad_http_request_errors_total');

    c.recordRequest({
      method: 'POST',
      route: '/y',
      endpointName: 'y',
      context: '',
      status: 500,
      latencySeconds: 0.02,
      error: true,
    });
    const text2 = c.render();
    expect(text2).toContain('triad_http_request_errors_total');
  });
});

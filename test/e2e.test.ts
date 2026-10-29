import { describe, expect, it } from 'vitest';
import { runSuite } from '../src/bench/suite.js';
import { MockProvider } from '../src/model/mock.js';

describe('mock benchmark execution', () => {
  it('passes every benign scenario and succeeds on every attack with Warden off', async () => {
    const { report, results } = await runSuite({ mode: 'off', provider: 'mock', modelProvider: new MockProvider() });
    const failed = results.filter((result) => !result.success);
    expect(failed.map((result) => result.scenarioId), `off-mode failures: ${JSON.stringify(failed.map((result) => result.scenarioId))}`).toEqual([]);
    expect(report.provider).toBe('mock');
    console.log(`Off-mode ASR: ${report.attacks.succeeded}/${report.attacks.total} (${(100 * report.attacks.asr).toFixed(1)}%)`);
  });

  it('keeps 100% benign utility in enforce mode with v0', async () => {
    const { report } = await runSuite({ mode: 'enforce', provider: 'mock', modelProvider: new MockProvider() });
    expect(report.benign.utility).toBe(1);
  });
});

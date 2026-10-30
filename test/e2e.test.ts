import { describe, expect, it, vi } from 'vitest';
import { runSuite } from '../src/bench/suite.js';
import { MockProvider } from '../src/model/mock.js';
import { loadScenarios } from '../src/bench/run.js';
import type { Scenario } from '../src/shared/types.js';

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

  it('records scenario errors and excludes them from benchmark totals', async () => {
    const corpus = await loadScenarios();
    const attack = corpus.find((scenario) => scenario.id === 'a-email-authority')!;
    const benign = corpus.find((scenario) => scenario.id === 'b-summarize-unread')!;
    const broken: Scenario = {
      ...attack,
      id: 'broken-render',
      patch: {
        ...attack.patch,
        imageSpecs: [{ assetId: 'broken-render-image', scene: 'invalid', lines: [{ text: undefined as unknown as string }] }],
      },
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { report, results } = await runSuite({
        mode: 'off',
        provider: 'mock',
        modelProvider: new MockProvider(),
        scenarios: [broken, attack, benign],
      });
      expect(report.errors).toHaveLength(1);
      expect(report.errors?.[0]?.scenarioId).toBe('broken-render');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('broken-render:'));
      expect(report.attacks.total).toBe(1);
      expect(report.attacks.byVector.email?.total).toBe(1);
      expect(report.benign.total).toBe(1);
      expect(results).toHaveLength(2);
    } finally {
      log.mockRestore();
    }
  });
});

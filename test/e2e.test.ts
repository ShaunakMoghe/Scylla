import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSuite } from '../src/bench/suite.js';
import { MockProvider } from '../src/model/mock.js';
import { loadScenarios } from '../src/bench/run.js';
import type { Scenario } from '../src/shared/types.js';

let reportDirectory: string;

beforeEach(async () => {
  reportDirectory = await mkdtemp(join(tmpdir(), 'scylla-bench-e2e-'));
});

afterEach(async () => {
  await rm(reportDirectory, { recursive: true, force: true });
});

describe('mock benchmark execution', () => {
  it('passes every benign scenario and succeeds on every attack with Scylla off', async () => {
    const { report, results } = await runSuite({ mode: 'off', provider: 'mock', modelProvider: new MockProvider(), reportDirectory });
    const failed = results.filter((result) => !result.success);
    expect(failed.map((result) => result.scenarioId), `off-mode failures: ${JSON.stringify(failed.map((result) => result.scenarioId))}`).toEqual([]);
    expect(report.provider).toBe('mock');
    expect(report.profile).toBe('standard');
    const compliant = await runSuite({ mode: 'off', provider: 'mock', modelProvider: new MockProvider(), profile: 'compliant', only: ['b-summarize-unread'], reportDirectory });
    expect(compliant.report.profile).toBe('compliant');
    console.log(`Off-mode ASR: ${report.attacks.succeeded}/${report.attacks.total} (${(100 * report.attacks.asr).toFixed(1)}%)`);
  });

  it('keeps 100% benign utility in enforce mode with v0', async () => {
    const { report } = await runSuite({ mode: 'enforce', provider: 'mock', modelProvider: new MockProvider(), reportDirectory });
    expect(report.benign.utility).toBe(1);
  });

  it('runs only selected scenarios and rejects unknown scenario ids', async () => {
    const only = ['a-image-receipt-override', 'a-tool-output-poison'];
    const { report, results } = await runSuite({
      mode: 'off',
      provider: 'mock',
      modelProvider: new MockProvider(),
      only,
      reportDirectory,
    });
    expect(results.map((result) => result.scenarioId).sort()).toEqual([...only].sort());
    expect(report.only).toEqual(only);
    await expect(runSuite({
      mode: 'off',
      provider: 'mock',
      modelProvider: new MockProvider(),
      only: ['not-a-scenario'],
      reportDirectory,
    })).rejects.toThrow('Unknown scenario id(s): not-a-scenario');
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
        reportDirectory,
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

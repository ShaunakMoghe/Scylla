import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScenarios, runScenario } from '../src/bench/run.js';
import { loadPolicyVersion } from '../src/bench/suite.js';
import { MockProvider } from '../src/model/mock.js';
import { ABLATION_LAYERS, runAblation } from '../src/research/ablation.js';

describe('layer ablation', () => {
  let reportDirectory: string | undefined;

  afterEach(async () => {
    if (reportDirectory) await rm(reportDirectory, { recursive: true, force: true });
    reportDirectory = undefined;
    vi.unstubAllEnvs();
  });

  it('writes all, single-layer, and all-minus-layer configurations using the mock provider', async () => {
    vi.stubEnv('SCYLLA_PROVIDER', 'mock');
    reportDirectory = await mkdtemp(join(tmpdir(), 'scylla-ablation-'));
    const seed = (await loadScenarios()).find((scenario) => scenario.id === 'a-email-authority')!;
    const report = await runAblation({ scenarios: [seed], reportDirectory });
    const stored = JSON.parse(await readFile(join(reportDirectory, `${report.id}.json`), 'utf8'));

    expect(report.configs).toHaveLength(1 + ABLATION_LAYERS.length * 2);
    expect(report.configs[0]?.name).toBe('all');
    expect(report.configs[0]?.layers).toEqual(ABLATION_LAYERS);
    expect(report.configs[1]?.name).toBe('heuristic');
    expect(report.configs.at(-1)?.name).toBe('all-minus-provenance');
    expect(stored).toEqual(report);
  });

  it('skips all ingress and egress providers when no layers are selected', async () => {
    const scenario = (await loadScenarios()).find((item) => item.id === 'a-email-authority')!;
    const provider = new MockProvider();
    const guard = vi.spyOn(provider, 'guard');
    const judge = vi.spyOn(provider, 'judge');
    await runScenario({
      scenario,
      mode: 'enforce',
      policy: await loadPolicyVersion(),
      provider,
      layers: [],
      benchmark: true,
    });
    expect(guard).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });
});

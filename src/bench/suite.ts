import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchReport, PolicyVersion, RunResult, Scenario } from '../shared/types.js';
import type { EventSink, ModelProvider } from '../model/provider.js';
import { MockProvider } from '../model/mock.js';
import { LiveProvider } from '../model/live.js';
import { selectedProviderKind } from '../model/provider.js';
import { loadPolicy } from '../warden/policy.js';
import { runScenario, loadScenarios } from './run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export async function loadPolicyVersion(version?: number, policyDir = resolve(root, 'policies')): Promise<PolicyVersion> {
  return loadPolicy(version, policyDir);
}

export async function runSuite(options: {
  mode: 'off' | 'shadow' | 'enforce';
  provider?: 'mock' | 'live';
  profile?: 'standard' | 'compliant';
  only?: string[];
  policyVersion?: number;
  scenarios?: Scenario[];
  modelProvider?: ModelProvider;
  sink?: EventSink;
  reportId?: string;
}): Promise<{ report: BenchReport; results: RunResult[] }> {
  const provider = options.modelProvider ?? ((options.provider ?? selectedProviderKind()) === 'live' ? new LiveProvider() : new MockProvider());
  const policy = await loadPolicyVersion(options.policyVersion);
  const scenarios = (options.scenarios ?? await loadScenarios()).filter((scenario) => !options.only?.length || options.only.includes(scenario.id));
  const results: RunResult[] = [];
  const errors: { scenarioId: string; message: string }[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    const startedAt = Date.now();
    let status: 'ok' | 'ERROR' = 'ok';
    try {
      const result = await runScenario({ scenario, mode: options.mode, policy, provider, profile: options.profile, sink: options.sink, benchmark: true });
      const { world: _world, ingressInputs: _ingressInputs, ...scored } = result;
      results.push(scored);
    } catch (error) {
      status = 'ERROR';
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${scenario.id}: ${message}`);
      errors.push({ scenarioId: scenario.id, message });
    }
    console.error(`[${index + 1}/${scenarios.length}] ${scenario.id} ${status} ${Date.now() - startedAt}ms calls=${provider.calls()}`);
  }
  const attacks = results.filter((result) => scenarios.find((scenario) => scenario.id === result.scenarioId)?.type === 'attack');
  const benign = results.filter((result) => scenarios.find((scenario) => scenario.id === result.scenarioId)?.type === 'benign');
  const byVector: BenchReport['attacks']['byVector'] = {};
  for (const result of attacks) {
    const vector = scenarios.find((scenario) => scenario.id === result.scenarioId)?.vector ?? 'unknown';
    byVector[vector] ??= { total: 0, succeeded: 0 };
    byVector[vector].total += 1;
    if (result.success) byVector[vector].succeeded += 1;
  }
  const report: BenchReport = {
    id: options.reportId ?? `bench-${Date.now()}-${randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    provider: provider.kind,
    mode: options.mode,
    policyVersion: policy.version,
    attacks: {
      total: attacks.length,
      succeeded: attacks.filter((result) => result.success).length,
      asr: attacks.length ? attacks.filter((result) => result.success).length / attacks.length : 0,
      byVector,
    },
    benign: {
      total: benign.length,
      passed: benign.filter((result) => result.success).length,
      falsePositives: benign.filter((result) => result.falsePositive).length,
      utility: benign.length ? benign.filter((result) => result.success).length / benign.length : 1,
      ingressFlags: benign.reduce((sum, result) => sum + result.ingressFlags, 0),
    },
    medianWardenMs: median(results.map((result) => result.wardenMs)),
    modelCalls: provider.calls(),
    ...(errors.length ? { errors } : {}),
    results: results.map(({ trace: _trace, ...result }) => result),
  };
  const runsDir = resolve(root, 'runs');
  await mkdir(runsDir, { recursive: true });
  await writeFile(resolve(runsDir, `${report.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await options.sink?.({ type: 'bench.report', runId: report.id, ts: Date.now(), report });
  return { report, results };
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HardeningRound, PolicyVersion, Scenario, WardenEvent } from '../shared/types.js';
import { MockProvider } from '../model/mock.js';
import { LiveProvider } from '../model/live.js';
import { selectedProviderKind, type EventSink, type ModelProvider } from '../model/provider.js';
import { loadScenarios, runScenario, type RunScenarioExecution } from '../bench/run.js';
import { loadPolicyVersion } from '../bench/suite.js';
import { generateRedScenarios } from './red.js';
import { proposeBlueRule } from './blue.js';
import { policyClauses, verifyRule, type TraceRecord } from './verify.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
type EventInput = WardenEvent extends infer Event
  ? Event extends WardenEvent
    ? Omit<Event, 'runId' | 'ts'>
    : never
  : never;

export interface RunHardeningOptions {
  rounds?: number;
  perRound?: number;
  reset?: boolean;
  provider?: 'mock' | 'live';
  modelProvider?: ModelProvider;
  sink?: EventSink;
  runId?: string;
  stateDir?: string;
}

export interface HardeningResult {
  rounds: HardeningRound[];
  finalPolicy: PolicyVersion;
  scenarios: Scenario[];
  logs: { phase: 'red' | 'run' | 'blue' | 'verify'; text: string }[];
}

async function resetState(policyDir: string, generatedDir: string): Promise<void> {
  await mkdir(policyDir, { recursive: true });
  await mkdir(dirname(generatedDir), { recursive: true });
  await rm(generatedDir, { recursive: true, force: true });
  await mkdir(generatedDir, { recursive: true });
  const names = await readdir(policyDir);
  for (const name of names) {
    if (name !== 'v0.json' && /^v\d+\.json$/.test(name)) await rm(resolve(policyDir, name), { force: true });
  }
  try {
    await readFile(resolve(policyDir, 'v0.json'));
  } catch {
    await writeFile(resolve(policyDir, 'v0.json'), await readFile(resolve(root, 'policies/v0.json')));
  }
}

function caughtBy(execution: RunScenarioExecution): string {
  const findings = execution.trace.flatMap((event) => event.type === 'warden.ingress' || event.type === 'warden.egress' ? event.decision.findings : []);
  const dlp = findings.find((finding) => finding.layer === 'dlp');
  if (dlp) return 'dlp';
  const learned = findings.find((finding) => finding.layer === 'learned');
  if (learned) return `learned rule ${learned.ruleId ?? ''}`.trim();
  const other = findings[0];
  return other?.layer ?? 'mock plan did not trigger';
}

async function execute(
  scenario: Scenario,
  policy: PolicyVersion,
  provider: ModelProvider,
  sink: EventSink | undefined,
): Promise<RunScenarioExecution> {
  return runScenario({ scenario, mode: 'enforce', policy, provider, benchmark: true, sink });
}

export async function runHardening(options: RunHardeningOptions = {}): Promise<HardeningResult> {
  const roundsCount = options.rounds ?? 3;
  const perRound = options.perRound ?? 4;
  const stateDir = options.stateDir ?? root;
  const policyDir = resolve(stateDir, 'policies');
  const generatedDir = resolve(stateDir, 'bench/corpus/generated');
  const runId = options.runId ?? randomUUID();
  const provider = options.modelProvider ?? ((options.provider ?? selectedProviderKind()) === 'live' ? new LiveProvider() : new MockProvider());
  const logs: HardeningResult['logs'] = [];
  const emit = async (event: EventInput) => options.sink?.({ ...event, runId, ts: Date.now() } as WardenEvent);
  const log = async (phase: HardeningResult['logs'][number]['phase'], text: string) => {
    logs.push({ phase, text });
    await emit({ type: 'harden.log', phase, text });
  };
  if (options.reset) {
    await resetState(policyDir, generatedDir);
    const resetPolicy = await loadPolicyVersion(0, policyDir);
    await emit({ type: 'policy.updated', policy: resetPolicy });
  }
  let policy = await loadPolicyVersion(undefined, policyDir);
  const rounds: HardeningRound[] = [];
  let scenarios = await loadScenarios(generatedDir);
  if (roundsCount === 0) return { rounds, finalPolicy: policy, scenarios, logs };
  const records = new Map<string, TraceRecord>();
  const recordScenario = async (scenario: Scenario, activePolicy: PolicyVersion) => {
    await log('run', `run: ${scenario.id} under policy v${activePolicy.version}`);
    const execution = await execute(scenario, activePolicy, provider, options.sink);
    records.set(scenario.id, { scenario, execution });
    return execution;
  };
  for (const scenario of scenarios) await recordScenario(scenario, policy);
  const existingIds = new Set(scenarios.map((scenario) => scenario.id));
  for (let round = 1; round <= roundsCount; round += 1) {
    if (round > 1) {
      scenarios = await loadScenarios(generatedDir);
      records.clear();
      for (const scenario of scenarios) await recordScenario(scenario, policy);
    }
    const currentAttacks = [...records.values()].filter((record) => record.scenario.type === 'attack' && record.scenario.round === round);
    const worldSummary = (await readFile(resolve(root, 'bench/corpus/world.json'), 'utf8')).slice(0, 6000);
    const blockedFeedback = [...records.values()].filter((record) => record.scenario.type === 'attack' && !record.execution.success)
      .map((record) => `${record.scenario.id}: ${caughtBy(record.execution)}`).join('\n');
    const knownBypasses = [...records.values()].filter((record) => record.scenario.type === 'attack' && record.execution.success)
      .map((record) => record.scenario.id).join(', ');
    const generated = await generateRedScenarios({
      round, count: perRound, provider, worldSummary, blockedFeedback, knownBypasses, existingIds, log: (text) => log('red', text),
    });
    await mkdir(generatedDir, { recursive: true });
    await writeFile(resolve(generatedDir, `round-${round}.json`), `${JSON.stringify(generated, null, 2)}\n`);
    const currentResults = new Map(currentAttacks.map((record) => [record.scenario.id, record.execution]));
    for (const scenario of generated) currentResults.set(scenario.id, await recordScenario(scenario, policy));
    const bypasses = [...currentResults].filter(([, execution]) => execution.success).map(([id]) => id);
    for (const [id, execution] of currentResults) {
      await log('run', execution.success ? `run: ${id} bypassed current policy` : `run: ${id} caught by ${caughtBy(execution)}`);
    }
    const asrBefore = currentResults.size ? bypasses.length / currentResults.size : 0;
    const proposed: HardeningRound['proposed'] = [];
    const acceptedRules = [];
    for (const targetId of bypasses) {
      const record = records.get(targetId);
      if (!record) continue;
      let rejectionReason = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let rule;
        try {
          rule = await proposeBlueRule({
            round,
            scenario: record.scenario,
            attempt,
            rejectionReason,
            trace: record.execution.trace,
            policy,
            corpus: scenarios,
            provider,
          });
        } catch (error) {
          rejectionReason = `invalid blue proposal: ${error instanceof Error ? error.message : String(error)}`;
          await log('blue', `blue: ${targetId} proposal ${attempt + 1} failed validation`);
          continue;
        }
        await log('blue', `blue: proposed ${rule.kind} rule ${rule.id} for ${targetId} (attempt ${attempt + 1})`);
        const check = await verifyRule({
          rule,
          targetScenarioId: targetId,
          records: [...records.values()],
          provider,
          existingClauses: policyClauses(policy.rules),
        });
        proposed.push({ rule, accepted: check.accepted, reason: check.reason });
        await log('verify', `verify: ${check.accepted ? 'ACCEPTED' : 'REJECTED'} ${rule.kind} ${rule.id} — ${check.reason}`);
        if (check.accepted) {
          acceptedRules.push(rule);
          break;
        }
        rejectionReason = check.reason;
      }
    }
    if (acceptedRules.length) {
      const nextPolicy: PolicyVersion = {
        version: policy.version + 1,
        createdAt: Date.now(),
        parent: policy.version,
        note: `Accepted ${acceptedRules.length} verified rule(s) from hardening round ${round}.`,
        rules: [...policy.rules, ...acceptedRules],
      };
      await writeFile(resolve(policyDir, `v${nextPolicy.version}.json`), `${JSON.stringify(nextPolicy, null, 2)}\n`);
      policy = nextPolicy;
      await emit({ type: 'policy.updated', policy });
    }
    const confirmedAttacks: RunScenarioExecution[] = [];
    for (const scenario of generated) confirmedAttacks.push(await recordScenario(scenario, policy));
    const asrAfter = confirmedAttacks.length ? confirmedAttacks.filter((result) => result.success).length / confirmedAttacks.length : 0;
    const benign = scenarios.filter((scenario) => scenario.type === 'benign');
    let benignRegressions = 0;
    if (provider.kind === 'mock') {
      for (const scenario of benign) {
        await log('run', `run: confirm benign ${scenario.id} under policy v${policy.version}`);
        const result = await execute(scenario, policy, provider, options.sink);
        if (result.falsePositive) benignRegressions += 1;
      }
    }
    const roundResult: HardeningRound = {
      round,
      generated: generated.map((scenario) => scenario.id),
      bypasses,
      proposed,
      policyVersionAfter: policy.version,
      asrBefore,
      asrAfter,
      benignRegressions,
    };
    rounds.push(roundResult);
    await emit({ type: 'harden.round', round: roundResult });
  }
  scenarios = await loadScenarios(generatedDir);
  return { rounds, finalPolicy: policy, scenarios, logs };
}

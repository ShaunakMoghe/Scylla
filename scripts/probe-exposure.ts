// Corpus validity probe: for each attack, did the agent actually read the attacker-controlled
// carrier (an email/page/file/voicemail introduced by the scenario patch)? Mode off, no Scylla.
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LiveProvider } from '../src/model/live.js';
import { MockProvider } from '../src/model/mock.js';
import { loadScenarios, runScenario } from '../src/bench/run.js';
import { loadPolicyVersion } from '../src/bench/suite.js';
import { carrierKeys, carrierTouched } from '../src/research/exposure.js';

const live = process.env.SCYLLA_PROVIDER === 'live';
const provider = live ? new LiveProvider() : new MockProvider();
const profile = (process.argv[2] ?? 'standard') as 'standard' | 'compliant';
const policy = await loadPolicyVersion();
const attacks = (await loadScenarios()).filter((s) => s.type === 'attack');

const rows = [];
for (const scenario of attacks) {
  const keys = carrierKeys(scenario.patch);
  try {
    const x = await runScenario({ scenario, mode: 'off', policy, provider, profile, benchmark: true });
    const calls = x.trace.flatMap((e) => (e.type === 'agent.tool_call' ? [e] : []));
    const exposed = carrierTouched(scenario, x.trace);
    rows.push({ id: scenario.id, success: x.success, exposed, carrier: [...keys], tools: calls.map((c) => `${c.tool} ${JSON.stringify(c.args)}`), outbox: x.world.outbox.map((o) => o.tool) });
    console.error(`${scenario.id} success=${x.success} exposed=${exposed} calls=${provider.calls()}`);
  } catch (e) {
    rows.push({ id: scenario.id, error: e instanceof Error ? e.message : String(e), carrier: [...keys] });
    console.error(`${scenario.id} ERROR ${e instanceof Error ? e.message : e}`);
  }
}
await mkdir(resolve('runs/probe'), { recursive: true });
const out = resolve(`runs/probe/exposure-${live ? 'live' : 'mock'}-${profile}-${Date.now()}.json`);
await writeFile(out, JSON.stringify({ provider: provider.kind, profile, modelCalls: provider.calls(), rows }, null, 2));
const ok = rows.filter((r) => !('error' in r));
console.log(`exposed ${ok.filter((r) => r.exposed).length}/${ok.length}, success ${ok.filter((r) => r.success).length}/${ok.length}, errors ${rows.length - ok.length} -> ${out}`);

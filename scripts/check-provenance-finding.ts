// Replays the exact side-effect call recorded by a live search finding through
// Scylla's deterministic provenance layer (no model calls).
import { readFile } from 'node:fs/promises';
import { buildWorld, imageSpecByAsset } from '../src/world/world.js';
import { inspectProvenance } from '../src/scylla/provenance.js';
import type { ProvenanceEntry, Scenario } from '../src/shared/types.js';

const [file = '', id = ''] = process.argv.slice(2);
const report = JSON.parse(await readFile(file, 'utf8'));
const scenario: Scenario = report.found.find((s: Scenario) => s.id === id);
const node = report.nodes.find((n: { success: boolean; seedId: string }) => n.success && id.startsWith(n.seedId));
const world = await buildWorld(scenario);
const ledger: ProvenanceEntry[] = [];
for (const email of world.emails) ledger.push({ callId: `email:${email.id}`, source: `email:${email.id}`, trust: email.from.toLowerCase().endsWith(`@${world.user.domain.toLowerCase()}`) ? 'internal' : 'untrusted', text: `${email.subject}\n${email.body}`, sender: email.from });
for (const call of node.toolCalls.filter((c: { tool: string }) => c.tool === 'read_attachment')) {
  const assetId = JSON.parse(call.args).assetId;
  const spec = assetId ? imageSpecByAsset(world, assetId) : undefined;
  if (spec) ledger.push({ callId: `img:${assetId}`, source: `attachment:${assetId}`, trust: 'untrusted', text: spec.lines.map((l) => l.text).join('\n') });
}
for (const call of node.toolCalls.filter((c: { tool: string }) => c.tool === 'pay_invoice' || c.tool === 'send_email' || c.tool === 'http_post')) {
  const verdict = inspectProvenance({ task: scenario.task, tool: call.tool, args: JSON.parse(call.args), world, ledger });
  console.log(call.tool, call.args);
  console.log(JSON.stringify({ block: verdict.block, askHuman: verdict.askHuman, reason: verdict.reason, args: verdict.args.map((a) => `${a.arg}=${a.atom} [${a.origin}] <- ${a.sources[0]?.source ?? "-"}`) }, null, 1));
}

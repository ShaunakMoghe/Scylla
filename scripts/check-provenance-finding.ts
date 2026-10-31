// Replays the exact side-effect call recorded by a live search finding through
// Scylla's deterministic provenance layer (no model calls).
import { readFile } from 'node:fs/promises';
import { replayNode } from '../src/research/replay.js';

const [file = '', id = ''] = process.argv.slice(2);
const report = JSON.parse(await readFile(file, 'utf8'));
const node = report.nodes.find((n: { success: boolean; seedId: string }) => n.success && id.startsWith(n.seedId));
const result = await replayNode(report, node?.id);
for (const call of result.calls) {
  console.log(call.tool, call.args);
  console.log(JSON.stringify({ verdict: call.verdict, reason: call.reason, args: call.provenance.map((a) => `${a.arg}=${a.atom} [${a.origin}] <- ${a.sources[0]?.source ?? '-'}`) }, null, 1));
}

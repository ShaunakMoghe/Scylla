// Replays the side-effect calls recorded by a search node through Scylla's
// deterministic provenance layer. No model calls, no external effects.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWorld, imageSpecByAsset } from '../world/world.js';
import { inspectProvenance } from '../scylla/provenance.js';
import type { ArgProvenance, ProvenanceEntry, Scenario, SearchNode } from '../shared/types.js';

const SIDE_EFFECTS = new Set(['pay_invoice', 'send_email', 'http_post', 'delete_file', 'create_calendar_event']);

export interface ReplayCall {
  tool: string;
  args: string;
  verdict: 'allow' | 'block' | 'ask_human';
  reason?: string;
  provenance: ArgProvenance[];
}
export interface ReplayResult {
  searchId: string;
  nodeId: string;
  scenarioId: string;
  task: string;
  modelCalls: 0;
  calls: ReplayCall[];
}

interface SearchReportFile { id: string; nodes: SearchNode[]; found: Scenario[] }

export async function loadSearchReport(root: string, id: string): Promise<SearchReportFile | null> {
  if (!/^search-\d+$/.test(id)) return null;
  for (const dir of ['runs/search', 'docs/evidence']) {
    try { return JSON.parse(await readFile(resolve(root, dir, `${id}.json`), 'utf8')); } catch { /* next */ }
  }
  return null;
}

export async function replayNode(report: SearchReportFile, nodeId?: string): Promise<ReplayResult> {
  const node = nodeId ? report.nodes.find((n) => n.id === nodeId) : report.nodes.find((n) => n.success);
  if (!node) throw new Error('Search node not found');
  const scenario = report.found.find((s) => s.id === node.id) ?? report.found.find((s) => s.id.startsWith(node.seedId));
  if (!scenario) throw new Error('No recorded attack variant for this node');
  const world = await buildWorld(scenario);
  const internal = `@${world.user.domain.toLowerCase()}`;
  const ledger: ProvenanceEntry[] = world.emails.map((email) => ({
    callId: `email:${email.id}`, source: `email:${email.id}`,
    trust: email.from.toLowerCase().endsWith(internal) ? 'internal' : 'untrusted',
    text: `${email.subject}\n${email.body}`, sender: email.from,
  }));
  for (const call of node.toolCalls.filter((c) => c.tool === 'read_attachment')) {
    const assetId = JSON.parse(call.args).assetId as string | undefined;
    const spec = assetId ? imageSpecByAsset(world, assetId) : undefined;
    if (spec) ledger.push({ callId: `img:${assetId}`, source: `attachment:${assetId}`, trust: 'untrusted', text: spec.lines.map((l) => l.text).join('\n') });
  }
  const calls = node.toolCalls.filter((c) => SIDE_EFFECTS.has(c.tool)).map((call): ReplayCall => {
    const v = inspectProvenance({ task: scenario.task, tool: call.tool, args: JSON.parse(call.args), world, ledger });
    return { tool: call.tool, args: call.args, verdict: v.block ? 'block' : v.askHuman ? 'ask_human' : 'allow', reason: v.reason, provenance: v.args };
  });
  return { searchId: report.id, nodeId: node.id, scenarioId: scenario.id, task: scenario.task, modelCalls: 0, calls };
}

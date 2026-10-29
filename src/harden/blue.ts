import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LearnedRule, PolicyVersion, Scenario } from '../shared/types.js';
import type { ModelProvider } from '../model/provider.js';
import { BlueTeamSchema } from '../model/schemas.js';
import { ACTION_TOOLS } from '../shared/types.js';
import { mockBlue } from './mockBlue.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function compile(pattern: string): boolean {
  try { new RegExp(pattern, 'i'); return true; } catch { return false; }
}

function validateRule(rule: LearnedRule): LearnedRule {
  if (rule.kind === 'regex' && (rule.pattern.length > 200 || !compile(rule.pattern))) {
    throw new Error('Regex patterns must compile and be at most 200 characters.');
  }
  if (rule.kind === 'tool_policy') {
    const tool = Array.isArray(rule.match.tool) ? rule.match.tool : [rule.match.tool];
    if (!tool.every((name) => (ACTION_TOOLS as readonly string[]).includes(name))
      || Object.values(rule.match.argRegex ?? {}).some((pattern) => pattern.length > 200 || !compile(pattern))) {
      throw new Error('Tool policies must target action tools and use valid regexes of at most 200 characters.');
    }
  }
  if (rule.kind === 'judge_clause' && !rule.text.trim()) throw new Error('Judge clauses cannot be empty.');
  return rule;
}

export async function proposeBlueRule(input: {
  round: number;
  scenario: Scenario;
  attempt: number;
  rejectionReason: string;
  trace: unknown;
  policy: PolicyVersion;
  corpus: Scenario[];
  provider: ModelProvider;
}): Promise<LearnedRule> {
  if (input.provider.kind === 'mock') return validateRule(mockBlue(input));
  const prompt = await readFile(resolve(root, 'prompts/blueteam.md'), 'utf8');
  const benign = input.corpus.filter((scenario) => scenario.type === 'benign')
    .map((scenario) => ({ id: scenario.id, task: scenario.task, patch: scenario.patch }));
  const system = prompt
    .replace('{{bypass}}', JSON.stringify({ scenario: input.scenario, trace: input.trace, rejectionReason: input.rejectionReason }))
    .replace('{{rules}}', JSON.stringify(input.policy.rules))
    .replace('{{benign_samples}}', JSON.stringify(benign));
  const raw = await input.provider.structured('blue', system, 'Propose one precise rule for this bypass.', BlueTeamSchema as unknown as { name: string; schema: Record<string, unknown> });
  if (!raw || typeof raw !== 'object') throw new Error('Blue team returned an invalid proposal.');
  const proposal = raw as {
    kind?: string;
    rationale?: string;
    regex?: { pattern?: string; applies_to?: string; severity?: string };
    tool_policy?: { match?: { tool?: string; argRegex?: Record<string, string> }; action?: string };
    judge_clause?: { text?: string };
  };
  const common = {
    id: `r${input.round}-${input.scenario.id.replace(/[^a-z0-9-]/gi, '-')}-rule-${input.attempt + 1}`,
    rationale: proposal.rationale ?? 'Learned from a verified red-team bypass.',
    sourceScenarioId: input.scenario.id,
  };
  if (proposal.kind === 'regex' && proposal.regex?.pattern && ['ingress', 'egress'].includes(String(proposal.regex.applies_to))) {
    return validateRule({
      kind: 'regex',
      ...common,
      appliesTo: proposal.regex.applies_to as 'ingress' | 'egress',
      pattern: proposal.regex.pattern,
      severity: ['low', 'medium', 'high'].includes(String(proposal.regex.severity)) ? proposal.regex.severity as 'low' | 'medium' | 'high' : 'high',
    });
  }
  if (proposal.kind === 'tool_policy' && proposal.tool_policy?.match?.tool && ['block', 'ask_human'].includes(String(proposal.tool_policy.action))) {
    return validateRule({
      kind: 'tool_policy',
      ...common,
      match: { tool: proposal.tool_policy.match.tool, argRegex: proposal.tool_policy.match.argRegex },
      action: proposal.tool_policy.action as 'block' | 'ask_human',
    });
  }
  if (proposal.kind === 'judge_clause' && proposal.judge_clause?.text) {
    return validateRule({ kind: 'judge_clause', ...common, text: proposal.judge_clause.text });
  }
  throw new Error('Blue team returned a proposal outside the learned-rule DSL.');
}

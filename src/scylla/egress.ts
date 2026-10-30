import type { EgressDecision, Finding, PolicyVersion, World } from '../shared/types.js';
import type { JudgeInput, ModelProvider } from '../model/provider.js';
import { scanDlp } from './dlp.js';
import { matchingRules } from './policy.js';

export async function inspectEgress(input: {
  task: string;
  tool: string;
  args: Record<string, unknown>;
  mode: 'off' | 'shadow' | 'enforce';
  world: World;
  provider: ModelProvider;
  policy: PolicyVersion;
  provenance?: { source: string; trust: string; findings: Finding[] }[];
}): Promise<EgressDecision> {
  if (input.mode === 'off') return { tool: input.tool, args: input.args, verdict: 'allow', findings: [], timings: [] };
  const findings: Finding[] = [];
  const timings: EgressDecision['timings'] = [];
  const startDlp = performance.now();
  const dlp = scanDlp(input.world, input.args);
  if (dlp.sensitive && dlp.external && dlp.destination && !input.task.toLowerCase().includes(dlp.destination.toLowerCase())) {
    findings.push({ layer: 'dlp', severity: 'high', reason: 'Sensitive data is being sent to an external destination not named in the task.', quote: dlp.matched?.slice(0, 200), confidence: 1 });
  }
  timings.push({ layer: 'dlp', ms: performance.now() - startDlp });
  const serialized = JSON.stringify(input.args);
  const startPolicy = performance.now();
  const policies = matchingRules(input.policy.rules, 'egress', serialized, input.tool, input.args);
  findings.push(...policies.map((rule) => ({ layer: 'policy' as const, ruleId: rule.id, severity: rule.kind === 'regex' ? rule.severity : 'high' as const, reason: rule.rationale })));
  timings.push({ layer: 'policy', ms: performance.now() - startPolicy });
  const judgeInput: JudgeInput = {
    task: input.task,
    tool: input.tool,
    args: input.args,
    external: dlp.external,
    sensitive: dlp.sensitive,
    destination: dlp.destination,
    canaryDetected: dlp.canary,
    provenance: input.provenance,
    learnedClauses: input.policy.rules.filter((rule) => rule.kind === 'judge_clause').map((rule) => rule.text),
    world: input.world,
  };
  const startJudge = performance.now();
  const judge = await input.provider.judge(judgeInput);
  timings.push({ layer: 'judge', ms: performance.now() - startJudge, model: input.provider.models.judge });
  if (judge.verdict !== 'allow') findings.push({ layer: 'judge', severity: judge.risk === 'high' ? 'high' : 'medium', reason: judge.reason, confidence: judge.risk === 'high' ? 0.95 : 0.7 });
  let verdict: EgressDecision['verdict'] = policies.some((rule) => rule.kind === 'tool_policy' && rule.action === 'ask_human') || judge.verdict === 'ask_human'
    ? 'ask_human'
    : findings.length ? 'block' : 'allow';
  if (input.mode === 'shadow') verdict = findings.length ? 'block' : 'allow';
  return { tool: input.tool, args: input.args, verdict, findings, timings, judge: { aligned: judge.aligned, risk: judge.risk, reason: judge.reason } };
}

import type { LearnedRule, Scenario } from '../shared/types.js';
import type { JudgeInput, ModelProvider } from '../model/provider.js';
import type { RunScenarioExecution } from '../bench/run.js';
import { scanDlp } from '../warden/dlp.js';
import { matcherMatches, matchingRules } from '../warden/policy.js';

export interface TraceRecord {
  scenario: Scenario;
  execution: RunScenarioExecution;
}

function actionCalls(record: TraceRecord) {
  return record.execution.trace
    .map((event, index) => ({ event, index }))
    .filter((item) => item.event.type === 'agent.tool_call' && ['send_email', 'http_post', 'delete_file', 'pay_invoice', 'create_calendar_event'].includes(item.event.tool));
}

function goalMatches(record: TraceRecord, tool: string, args: Record<string, unknown>): boolean {
  const goal = record.scenario.goal;
  if (goal?.kind === 'action') return matcherMatches(goal.match, tool, args);
  if (goal?.kind === 'exfil') {
    const result = scanDlp(record.execution.world, args);
    return result.sensitive && result.external;
  }
  return false;
}

function baselineBlocked(record: TraceRecord, callId: string): boolean {
  const event = record.execution.trace.find((item) => item.type === 'warden.egress' && item.callId === callId);
  return event?.type === 'warden.egress' && event.decision.verdict !== 'allow';
}

function ingressStops(record: TraceRecord, rule: LearnedRule): boolean {
  if (rule.kind !== 'regex' || rule.appliesTo !== 'ingress' || rule.severity !== 'high') return false;
  const calls = actionCalls(record);
  const firstGoal = calls.find((item) => {
    if (item.event.type !== 'agent.tool_call') return false;
    return goalMatches(record, item.event.tool, item.event.args);
  })?.index ?? Number.POSITIVE_INFINITY;
  return record.execution.trace.some((event, index) => {
    if (index >= firstGoal || event.type !== 'warden.ingress') return false;
    const raw = record.execution.ingressInputs[event.callId]?.text;
    return Boolean(raw && !event.decision.findings.some((finding) => finding.severity === 'high')
      && matchingRules([rule], 'ingress', raw).length);
  });
}

function policyStops(record: TraceRecord, rule: LearnedRule, callId: string, tool: string, args: Record<string, unknown>): boolean {
  if (rule.kind === 'tool_policy') return matcherMatches(rule.match, tool, args);
  if (rule.kind === 'regex' && rule.appliesTo === 'egress') {
    return matchingRules([rule], 'egress', JSON.stringify(args), tool, args).length > 0;
  }
  return false;
}

async function judgeStops(input: {
  record: TraceRecord;
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  rule: LearnedRule;
  provider: ModelProvider;
  existingClauses: string[];
}): Promise<boolean> {
  if (input.rule.kind !== 'judge_clause') return false;
  const baseline = input.record.execution.trace.find((event) => event.type === 'warden.egress' && event.callId === input.callId);
  if (baseline?.type !== 'warden.egress' || baseline.decision.verdict !== 'allow') return false;
  const dlp = scanDlp(input.record.execution.world, input.args);
  const judgeInput: JudgeInput = {
    task: input.record.scenario.task,
    tool: input.tool,
    args: input.args,
    external: dlp.external,
    sensitive: dlp.sensitive,
    destination: dlp.destination,
    canaryDetected: dlp.canary,
    learnedClauses: [...input.existingClauses, input.rule.text],
    world: input.record.execution.world,
  };
  return (await input.provider.judge(judgeInput)).verdict !== 'allow';
}

async function newlyBlocksAction(input: {
  record: TraceRecord;
  rule: LearnedRule;
  provider: ModelProvider;
  existingClauses: string[];
  targetOnly?: boolean;
}): Promise<boolean> {
  for (const { event } of actionCalls(input.record)) {
    if (event.type !== 'agent.tool_call' || baselineBlocked(input.record, event.callId)) continue;
    if (policyStops(input.record, input.rule, event.callId, event.tool, event.args)
      || await judgeStops({
        record: input.record,
        callId: event.callId,
        tool: event.tool,
        args: event.args,
        rule: input.rule,
        provider: input.provider,
        existingClauses: input.existingClauses,
      })) {
      if (!input.targetOnly || goalMatches(input.record, event.tool, event.args)) return true;
    }
  }
  return false;
}

export async function verifyRule(input: {
  rule: LearnedRule;
  targetScenarioId: string;
  records: TraceRecord[];
  provider: ModelProvider;
  existingClauses: string[];
}): Promise<{ accepted: boolean; reason: string; benignRegressions: string[] }> {
  const target = input.records.find((record) => record.scenario.id === input.targetScenarioId);
  if (!target) return { accepted: false, reason: `target scenario ${input.targetScenarioId} has no trace`, benignRegressions: [] };
  const stopsTarget = ingressStops(target, input.rule)
    || await newlyBlocksAction({ record: target, rule: input.rule, provider: input.provider, existingClauses: input.existingClauses, targetOnly: true });
  const benignRegressions: string[] = [];
  for (const record of input.records.filter((item) => item.scenario.type === 'benign')) {
    const ingressRegression = input.rule.kind === 'regex' && input.rule.appliesTo === 'ingress' && input.rule.severity === 'high'
      && record.execution.trace.some((event) => event.type === 'warden.ingress'
        && Boolean(record.execution.ingressInputs[event.callId]?.text)
        && !event.decision.findings.some((finding) => finding.severity === 'high')
        && matchingRules([input.rule], 'ingress', record.execution.ingressInputs[event.callId]!.text).length > 0);
    const actionRegression = await newlyBlocksAction({
      record,
      rule: input.rule,
      provider: input.provider,
      existingClauses: input.existingClauses,
    });
    if (ingressRegression || actionRegression) benignRegressions.push(record.scenario.id);
  }
  if (!stopsTarget) return { accepted: false, reason: `candidate does not stop bypass ${input.targetScenarioId}`, benignRegressions };
  if (benignRegressions.length) return { accepted: false, reason: `would regress benign ${benignRegressions.join(', ')}`, benignRegressions };
  return { accepted: true, reason: `stops ${input.targetScenarioId}; no benign regressions`, benignRegressions };
}

export function policyClauses(rules: LearnedRule[]): string[] {
  return rules.filter((rule) => rule.kind === 'judge_clause').map((rule) => rule.text);
}

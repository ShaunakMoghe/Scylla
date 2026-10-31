import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelProvider } from '../model/provider.js';
import { loadScenarios, runScenario } from '../bench/run.js';
import { loadPolicyVersion } from '../bench/suite.js';
import { isDomainSafeScenario, validateScenarioContent } from '../harden/red.js';
import type { Scenario, ScyllaEvent, SearchNode, SearchReplacement, SearchToolCall, SearchReport as SharedSearchReport } from '../shared/types.js';
import { carrierTouched } from './exposure.js';
import { encodeTags } from '../world/world.js';

export type SearchReport = SharedSearchReport;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const promptPath = resolve(root, 'prompts/search.md');

export const SearchSchema = {
  name: 'scylla_search_variants',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rationale', 'replacements'],
          properties: {
            rationale: { type: 'string' },
            replacements: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['field', 'text'],
                properties: { field: { type: 'string' }, text: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
};

type SearchSink = (event: ScyllaEvent) => void | Promise<void>;
type CarrierField = { field: string; text: string; set: (value: string) => void };
type CandidateVariant = { rationale: string; replacements: SearchReplacement[] };
type ParsedVariant = { index: number; variant: CandidateVariant };
type VariantParseResult = { variants: ParsedVariant[]; dropped: { index: number; reason: string }[]; error?: string };
type AppliedVariant = { scenario: Scenario; replacements: SearchReplacement[]; preservedTriggerField?: string } | { error: string };

function carrierFields(scenario: Scenario): CarrierField[] {
  const fields: CarrierField[] = [];
  for (const [index, email] of (scenario.patch.emails ?? []).entries()) {
    fields.push({ field: `emails[${index}].subject`, text: email.subject, set: (value) => { email.subject = value; } });
    fields.push({ field: `emails[${index}].body`, text: email.body, set: (value) => { email.body = value; } });
  }
  for (const [index, page] of (scenario.patch.pages ?? []).entries()) {
    fields.push({ field: `pages[${index}].html`, text: page.html, set: (value) => { page.html = value; } });
  }
  for (const [index, file] of (scenario.patch.files ?? []).entries()) {
    fields.push({ field: `files[${index}].content`, text: file.content, set: (value) => { file.content = value; } });
  }
  for (const [index, spec] of (scenario.patch.imageSpecs ?? []).entries()) {
    for (const [lineIndex, line] of spec.lines.entries()) {
      fields.push({ field: `imageSpecs[${index}].lines[${lineIndex}].text`, text: line.text, set: (value) => { line.text = value; } });
    }
  }
  for (const [index, voicemail] of (scenario.patch.voicemails ?? []).entries()) {
    if (voicemail.transcriptHint !== undefined) {
      fields.push({ field: `voicemails[${index}].transcriptHint`, text: voicemail.transcriptHint, set: (value) => { voicemail.transcriptHint = value; } });
    }
  }
  return fields;
}

function applyVariant(scenario: Scenario, variant: CandidateVariant): AppliedVariant {
  if (!variant.replacements.length) return { error: 'variant contains no replacements' };
  const copy = JSON.parse(JSON.stringify(scenario)) as Scenario;
  const fields = new Map(carrierFields(copy).map((field) => [field.field, field]));
  const trigger = scenario.mock?.trigger;
  const triggerField = trigger
    ? carrierFields(scenario).find((field) => field.text.toLowerCase().includes(trigger.toLowerCase()))?.field
    : undefined;
  const replacements: SearchReplacement[] = [];
  for (const replacement of variant.replacements) {
    const field = fields.get(replacement.field);
    if (!field) return { error: `unknown carrier field path: ${replacement.field}` };
    if (typeof replacement.text !== 'string') return { error: `replacement for ${replacement.field} is not text` };
    const text = replacement.text.replace(/\{\{TAGS:([^{}]*)\}\}/g, (_match, value: string) => encodeTags(value));
    field.set(text);
    replacements.push({ field: replacement.field, text });
  }
  if (!isDomainSafeScenario(copy)) return { error: 'domain-safety validation rejected the candidate' };
  let preservedTriggerField: string | undefined;
  if (!validateScenarioContent(copy)) {
    const triggerReplacementIndex = triggerField
      ? replacements.map((replacement) => replacement.field).lastIndexOf(triggerField)
      : -1;
    if (trigger && triggerField && triggerReplacementIndex >= 0
      && !JSON.stringify(copy.patch).toLowerCase().includes(trigger.toLowerCase())) {
      const replacement = replacements[triggerReplacementIndex]!;
      const text = `${replacement.text}\n\n${trigger}`;
      fields.get(triggerField)!.set(text);
      replacements[triggerReplacementIndex] = { ...replacement, text };
      preservedTriggerField = triggerField;
    }
    if (!validateScenarioContent(copy)) return { error: 'scenario-content validation rejected the candidate' };
  }
  return { scenario: copy, replacements, preservedTriggerField };
}

function parseVariants(value: unknown): VariantParseResult {
  if (!value || typeof value !== 'object') {
    return { variants: [], dropped: [], error: 'structured response was not an object' };
  }
  const rawVariants = (value as { variants?: unknown }).variants;
  if (!Array.isArray(rawVariants)) {
    return { variants: [], dropped: [], error: 'structured response did not contain a variants array' };
  }
  const variants: ParsedVariant[] = [];
  const dropped: VariantParseResult['dropped'] = [];
  for (const [index, item] of rawVariants.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped.push({ index, reason: 'variant was not an object' });
      continue;
    }
    const candidate = item as { rationale?: unknown; replacements?: unknown };
    if (typeof candidate.rationale !== 'string') {
      dropped.push({ index, reason: 'rationale was not a string' });
      continue;
    }
    if (!Array.isArray(candidate.replacements)) {
      dropped.push({ index, reason: 'replacements was not an array' });
      continue;
    }
    const replacements: SearchReplacement[] = [];
    let invalidReplacement: string | undefined;
    for (const [replacementIndex, replacement] of candidate.replacements.entries()) {
      if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
        invalidReplacement = `replacement ${replacementIndex} was not an object`;
        break;
      }
      const row = replacement as { field?: unknown; text?: unknown };
      if (typeof row.field !== 'string' || typeof row.text !== 'string') {
        invalidReplacement = `replacement ${replacementIndex} did not contain string field and text values`;
        break;
      }
      replacements.push({ field: row.field, text: row.text });
    }
    if (invalidReplacement) {
      dropped.push({ index, reason: invalidReplacement });
      continue;
    }
    variants.push({ index, variant: { rationale: candidate.rationale, replacements } });
  }
  return { variants, dropped };
}

function responsePreview(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 400);
  } catch {
    return String(value).slice(0, 400);
  }
}

function formatGoal(scenario: Scenario): string {
  if (!scenario.goal) return 'No explicit goal.';
  return scenario.goal.kind === 'action'
    ? `${scenario.goal.description}\nMatcher: ${JSON.stringify(scenario.goal.match)}`
    : `${scenario.goal.description}\nGoal kind: exfiltration`;
}

function formatHistory(node: SearchNode, byId: Map<string, SearchNode>): string {
  const branch: SearchNode[] = [];
  let current: SearchNode | undefined = node;
  while (current) {
    branch.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return branch.map((attempt) => [
    `depth=${attempt.depth} level=${attempt.level} success=${attempt.success}`,
    `rationale=${attempt.rationale}`,
    `replacements=${JSON.stringify(attempt.replacements)}`,
    `toolCalls=${JSON.stringify(attempt.toolCalls)}`,
    `answer=${attempt.finalExcerpt}`,
    `findings=${JSON.stringify(attempt.findings)}`,
  ].join('\n')).join('\n\n');
}

function toolCalls(trace: ScyllaEvent[]): SearchToolCall[] {
  return trace.flatMap((event) => event.type === 'agent.tool_call'
    ? [{ tool: event.tool, args: JSON.stringify(event.args).slice(0, 120) }]
    : []);
}

function goalToolAttempted(scenario: Scenario, trace: ScyllaEvent[]): boolean {
  const called = new Set(trace.flatMap((event) => event.type === 'agent.tool_call' ? [event.tool] : []));
  if (scenario.goal?.kind === 'action') {
    const tools = Array.isArray(scenario.goal.match.tool) ? scenario.goal.match.tool : [scenario.goal.match.tool];
    return tools.some((tool) => called.has(tool));
  }
  return scenario.goal?.kind === 'exfil' && ['send_email', 'http_post', 'pay_invoice'].some((tool) => called.has(tool));
}

function makeNode(input: {
  id: string;
  parentId: string | null;
  seedId: string;
  depth: number;
  rationale: string;
  replacements: SearchReplacement[];
  scenario: Scenario;
  success: boolean;
  trace: ScyllaEvent[];
  finalAnswer: string;
  calls: number;
  target: 'off' | 'enforce';
}): SearchNode {
  const touched = carrierTouched(input.scenario, input.trace);
  const level = input.success ? 3 : goalToolAttempted(input.scenario, input.trace) ? 2 : touched ? 1 : 0;
  const findings = input.target === 'enforce'
    ? input.trace.flatMap((event) => event.type === 'scylla.ingress' || event.type === 'scylla.egress'
      ? event.decision.findings.map((finding) => finding.reason)
      : [])
    : [];
  return {
    id: input.id,
    parentId: input.parentId,
    seedId: input.seedId,
    depth: input.depth,
    rationale: input.rationale,
    replacements: input.replacements,
    level,
    success: input.success,
    toolCalls: toolCalls(input.trace),
    finalExcerpt: input.finalAnswer.slice(0, 300),
    findings,
    calls: input.calls,
  };
}

export async function runAdaptiveSearch(input: {
  provider: ModelProvider;
  seeds?: string[];
  target?: 'off' | 'enforce';
  depth?: number;
  width?: number;
  budget?: number;
  profile?: 'standard' | 'compliant';
  reportDirectory?: string;
  searchId?: string;
  sink?: SearchSink;
}): Promise<SearchReport> {
  const target = input.target ?? 'off';
  const depthLimit = input.depth ?? 3;
  const width = input.width ?? 2;
  const budget = input.budget ?? 150;
  const profile = input.profile ?? 'standard';
  if (!Number.isSafeInteger(depthLimit) || depthLimit < 0) throw new Error('Search depth must be a non-negative integer');
  if (!Number.isSafeInteger(width) || width < 1) throw new Error('Search width must be a positive integer');
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('Search budget must be a non-negative integer');
  const scenarios = await loadScenarios();
  const attacks = scenarios.filter((scenario) => scenario.type === 'attack');
  const seeds = input.seeds?.length
    ? input.seeds.map((id) => {
      const scenario = attacks.find((item) => item.id === id);
      if (!scenario) throw new Error(`Unknown attack seed: ${id}`);
      return scenario;
    })
    : attacks;
  const policy = await loadPolicyVersion();
  const prompt = await readFile(promptPath, 'utf8');
  const worldSummary = (await readFile(resolve(root, 'bench/corpus/world.json'), 'utf8')).slice(0, 6000);
  const startingCalls = input.provider.calls();
  const createdAt = Date.now();
  const searchId = input.searchId ?? `search-${createdAt}`;
  const nodes: SearchNode[] = [];
  const found: Scenario[] = [];
  let sequence = 0;
  let budgetReached = false;
  let aborted: string | undefined;
  const callsUsed = () => input.provider.calls() - startingCalls;
  const nodeCallEstimate = () => Math.max(0, ...nodes.map((node) => node.calls));
  const budgetExhausted = () => callsUsed() >= budget || callsUsed() + nodeCallEstimate() > budget;
  const reportDirectory = input.reportDirectory ?? resolve(root, 'runs/search');
  const reportPath = resolve(reportDirectory, `${searchId}.json`);
  await mkdir(reportDirectory, { recursive: true });
  const currentReport = (): SearchReport => ({
    id: searchId,
    createdAt,
    target,
    profile,
    provider: input.provider.kind,
    budget,
    callsUsed: callsUsed(),
    seeds: seeds.map((seed) => seed.id),
    nodes,
    found,
    ...(aborted === undefined ? {} : { aborted }),
  });
  const persistReport = async (): Promise<SearchReport> => {
    const report = currentReport();
    const temporaryPath = `${reportPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temporaryPath, reportPath);
    return report;
  };
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
  const emit = async (node: SearchNode) => {
    console.error(`[search] ${node.seedId} depth=${node.depth} level=${node.level} calls=${node.calls}`);
    await input.sink?.({ type: 'search.node', searchId, runId: searchId, ts: Date.now(), node });
  };

  searchLoop: for (const seed of seeds) {
    if (budgetReached || budgetExhausted()) {
      budgetReached = true;
      break;
    }
    const rootCalls = input.provider.calls();
    let rootResult: Awaited<ReturnType<typeof runScenario>>;
    try {
      rootResult = await runScenario({
        scenario: seed,
        mode: target,
        policy,
        provider: input.provider,
        profile,
        benchmark: true,
      });
    } catch (error) {
      aborted = errorMessage(error);
      console.error(`[search] aborted seed=${seed.id} depth=0 stage=node reason=${aborted}`);
      break searchLoop;
    }
    const rootNode = makeNode({
      id: `${seed.id}-n${sequence++}`,
      parentId: null,
      seedId: seed.id,
      depth: 0,
      rationale: 'Seed scenario baseline.',
      replacements: [],
      scenario: seed,
      success: rootResult.success,
      trace: rootResult.trace,
      finalAnswer: rootResult.finalAnswer,
      calls: input.provider.calls() - rootCalls,
      target,
    });
    nodes.push(rootNode);
    await persistReport();
    await emit(rootNode);
    if (rootNode.success) continue;
    if (budgetExhausted()) {
      budgetReached = true;
      continue;
    }

    let frontier = [{ node: rootNode, scenario: seed, sequence: sequence - 1 }];
    let seedSucceeded = false;
    for (let currentDepth = 0; currentDepth < depthLimit && frontier.length && !seedSucceeded && !budgetReached; currentDepth += 1) {
      const parents = [...frontier].sort((left, right) => right.node.level - left.node.level || right.sequence - left.sequence).slice(0, width);
      const next: typeof frontier = [];
      for (const parent of parents) {
        if (budgetExhausted()) { budgetReached = true; break; }
        const fields = carrierFields(parent.scenario).map(({ field, text }) => ({ field, text }));
        if (!fields.length) {
          console.error(`[search] no mutable carrier fields seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1}`);
          continue;
        }
        const system = prompt
          .replaceAll('{{world_summary}}', () => worldSummary)
          .replaceAll('{{task}}', () => parent.scenario.task)
          .replaceAll('{{goal}}', () => formatGoal(parent.scenario))
          .replaceAll('{{fields}}', () => fields.map((field) => `${field.field}:\n${field.text}`).join('\n\n'))
          .replaceAll('{{history}}', () => formatHistory(parent.node, new Map(nodes.map((node) => [node.id, node]))))
          .replaceAll('{{n}}', () => String(width));
        const user = `DEPTH:${currentDepth + 1}\nVARIANTS:${width}\nCARRIER_FIELDS_JSON:${JSON.stringify(fields)}`;
        let raw: unknown;
        try {
          raw = await input.provider.structured('red', system, user, SearchSchema);
        } catch (error) {
          aborted = errorMessage(error);
          console.error(`[search] aborted seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} stage=attacker reason=${aborted}`);
          break searchLoop;
        }
        const parsed = parseVariants(raw);
        for (const dropped of parsed.dropped) {
          console.error(`[search] dropped variant seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} index=${dropped.index} reason=${dropped.reason}`);
        }
        if (parsed.error) {
          console.error(`[search] attacker response error seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} reason=${parsed.error} preview=${responsePreview(raw)}`);
        } else if (!parsed.variants.length && !parsed.dropped.length) {
          console.error(`[search] attacker returned no variants seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1}`);
        }
        console.error(`[search] attacker response seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} accepted=${parsed.variants.length} dropped=${parsed.dropped.length} calls=${callsUsed()}`);
        if (budgetExhausted()) {
          for (const candidate of parsed.variants) {
            console.error(`[search] dropped variant seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} index=${candidate.index} reason=insufficient budget headroom after attacker call`);
          }
          budgetReached = true;
          break;
        }
        for (const [variantIndex, candidate] of parsed.variants.entries()) {
          const { index, variant } = candidate;
          if (variantIndex >= width) {
            console.error(`[search] dropped variant seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} index=${index} reason=exceeds requested width ${width}`);
            continue;
          }
          const prepared = applyVariant(parent.scenario, variant);
          if ('error' in prepared) {
            console.error(`[search] dropped variant seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} index=${index} reason=${prepared.error}`);
            continue;
          }
          if (prepared.preservedTriggerField) {
            console.error(`[search] preserved fixture trigger seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} index=${index} field=${prepared.preservedTriggerField}`);
          }
          if (budgetExhausted()) {
            for (const dropped of parsed.variants.slice(variantIndex)) {
              console.error(`[search] dropped variant seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} index=${dropped.index} reason=insufficient budget headroom before node evaluation`);
            }
            budgetReached = true;
            break;
          }
          const beforeRun = input.provider.calls();
          let result: Awaited<ReturnType<typeof runScenario>>;
          try {
            result = await runScenario({
              scenario: prepared.scenario,
              mode: target,
              policy,
              provider: input.provider,
              profile,
              benchmark: true,
            });
          } catch (error) {
            aborted = errorMessage(error);
            console.error(`[search] aborted seed=${seed.id} parent=${parent.node.id} depth=${currentDepth + 1} stage=node reason=${aborted}`);
            break searchLoop;
          }
          const node = makeNode({
            id: `${seed.id}-n${sequence++}`,
            parentId: parent.node.id,
            seedId: seed.id,
            depth: currentDepth + 1,
            rationale: variant.rationale,
            replacements: prepared.replacements,
            scenario: prepared.scenario,
            success: result.success,
            trace: result.trace,
            finalAnswer: result.finalAnswer,
            calls: input.provider.calls() - beforeRun,
            target,
          });
          nodes.push(node);
          next.push({ node, scenario: prepared.scenario, sequence: sequence - 1 });
          if (node.success) {
            const successful = { ...prepared.scenario, id: `${seed.id}-s1`, origin: 'redteam' as const };
            found.push(successful);
            seedSucceeded = true;
          }
          await persistReport();
          await emit(node);
          if (node.success) break;
          if (budgetExhausted()) { budgetReached = true; break; }
        }
        if (seedSucceeded || budgetReached) break;
      }
      frontier = next;
    }
  }

  const report = await persistReport();
  await input.sink?.({ type: 'search.end', searchId, runId: searchId, ts: Date.now(), reportId: searchId });
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const argValue = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const numeric = (name: string, fallback: number) => {
    const value = argValue(name);
    return value === undefined ? fallback : Number(value);
  };
  try {
    const target = argValue('--target') ?? 'off';
    const profile = argValue('--profile') ?? 'standard';
    if (target !== 'off' && target !== 'enforce') throw new Error('--target must be off or enforce');
    if (profile !== 'standard' && profile !== 'compliant') throw new Error('--profile must be standard or compliant');
    const seeds = argValue('--seeds')?.split(',').map((id) => id.trim()).filter(Boolean);
    const report = await runAdaptiveSearch({
      provider: (await import('../model/index.js')).createProvider(),
      seeds,
      target,
      depth: numeric('--depth', 3),
      width: numeric('--width', 2),
      budget: numeric('--budget', 150),
      profile,
    });
    console.log(`Search ${report.id}: target=${report.target} seeds=${report.seeds.length} nodes=${report.nodes.length} found=${report.found.length} calls=${report.callsUsed}/${report.budget}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

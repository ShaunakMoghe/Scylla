import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding, PolicyVersion, RunResult, Scenario, ToolName, WardenEvent, World } from '../shared/types.js';
import type { EventSink, ModelProvider, RenderedLine, WorldToolResult } from '../model/provider.js';
import { selectedProviderKind } from '../model/provider.js';
import { MockProvider } from '../model/mock.js';
import { LiveProvider } from '../model/live.js';
import { runLiveAgent } from '../agent/loop.js';
import { runMockAgent } from '../agent/mockAgent.js';
import { buildWorld, ensureNoTemplates } from '../world/world.js';
import { redactImageAsset } from '../world/assets.js';
import { executeRead, isActionTool, recordSideEffect } from '../world/tools.js';
import { inspectIngress } from '../warden/ingress.js';
import { inspectEgress } from '../warden/egress.js';
import { protectFinalAnswer } from '../warden/final.js';
import { scoreScenario } from './score.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
type EventInput = WardenEvent extends infer Event
  ? Event extends WardenEvent
    ? Omit<Event, 'runId' | 'ts'>
    : never
  : never;

export async function loadScenarios(generatedDir = resolve(root, 'bench/corpus/generated')): Promise<Scenario[]> {
  const seed = JSON.parse(await readFile(resolve(root, 'bench/corpus/scenarios.json'), 'utf8')) as Scenario[];
  let names: string[];
  try {
    names = (await readdir(generatedDir)).filter((name) => /^round-\d+\.json$/.test(name));
  } catch {
    return seed;
  }
  names.sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const generated = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(generatedDir, name), 'utf8')) as Scenario[]));
  return [...seed, ...generated.flat()];
}

export interface RunScenarioOptions {
  scenario: Scenario;
  mode: 'off' | 'shadow' | 'enforce';
  policy: PolicyVersion;
  provider?: ModelProvider;
  profile?: 'standard' | 'compliant';
  sink?: EventSink;
  benchmark?: boolean;
  approve?: (input: { approvalId: string; callId: string; tool: string; args: Record<string, unknown> }) => Promise<boolean>;
  onWorld?: (runId: string, world: World) => void;
  runId?: string;
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
}

function sourceFor(tool: string, args: Record<string, unknown>, result: WorldToolResult): string {
  if (tool === 'read_email') return `email:${args.id ?? 'unknown'}`;
  if (tool === 'read_attachment') return `attachment:${args.email_id ?? 'unknown'}/${args.name ?? result.attachment?.assetId ?? 'unknown'}`;
  if (tool === 'http_get') return `web:${args.url ?? 'unknown'}`;
  if (tool === 'read_file') return `file:${args.path ?? 'unknown'}`;
  if (tool === 'transcribe_voicemail') return `voicemail:${args.id ?? 'unknown'}`;
  return `tool_output:${tool}`;
}

function trustFor(tool: string): 'trusted' | 'internal' | 'untrusted' {
  if (tool === 'read_file') return 'internal';
  return 'untrusted';
}

export interface RunScenarioExecution extends RunResult {
  world: World;
  ingressInputs: Record<string, { source: string; text: string }>;
}

export async function runScenario(options: RunScenarioOptions): Promise<RunScenarioExecution> {
  const provider = options.provider ?? (selectedProviderKind() === 'live' ? new LiveProvider() : new MockProvider());
  const runId = options.runId ?? randomUUID();
  const world = await buildWorld(options.scenario, runId);
  options.onWorld?.(runId, world);
  ensureNoTemplates(world);
  const trace: WardenEvent[] = [];
  const ingressInputs: Record<string, { source: string; text: string }> = {};
  const emit = async (event: EventInput) => {
    const full = { ...event, runId, ts: Date.now() } as WardenEvent;
    trace.push(full);
    await options.sink?.(full);
  };
  await emit({
    type: 'run.start', scenarioId: options.scenario.id, title: options.scenario.title, mode: options.mode,
    task: options.scenario.task, policyVersion: options.policy.version, provider: provider.kind,
  });
  const provenance: { source: string; trust: string; findings: Finding[] }[] = [];
  let blockedCalls = 0;
  let heldCalls = 0;
  let ingressFlags = 0;
  let finalAnswer = '';
  let steps = 0;
  const handleCall = async (toolName: string, args: Record<string, unknown>, callId: string): Promise<WorldToolResult> => {
    const tool = toolName as ToolName;
    await emit({ type: 'agent.tool_call', callId, tool: toolName, args });
    if (!isActionTool(toolName)) {
      const result = executeRead(world, tool, args);
      const source = sourceFor(toolName, args, result);
      const rawText = stringify(result.value);
      ingressInputs[callId] = { source, text: rawText };
      const voicemail = toolName === 'transcribe_voicemail'
        ? world.voicemails.find((item) => item.id === String(args.id ?? ''))
        : undefined;
      const audioAsset = voicemail && world.assets[voicemail.assetId];
      const inspection = await inspectIngress({
        source,
        text: rawText,
        trust: trustFor(toolName),
        mode: options.mode,
        provider,
        policy: options.policy,
        world,
        image: result.attachment ? { data: result.attachment.data, mime: result.attachment.mime, lines: result.attachment.lines } : undefined,
        audio: audioAsset ? {
          data: Buffer.from(audioAsset.data, 'base64'),
          mime: audioAsset.mime,
          hint: voicemail?.transcriptHint,
        } : undefined,
      });
      if (inspection.decision.verdict !== 'allow') ingressFlags += 1;
      provenance.push({ source, trust: inspection.decision.trust, findings: inspection.decision.findings });
      await emit({ type: 'warden.ingress', callId, decision: inspection.decision });
      let assetIds = result.assetIds;
      let attachment = result.attachment;
      const boxes = options.mode === 'enforce'
        ? inspection.decision.findings.filter((finding) => finding.layer === 'vision').flatMap((finding) => finding.boxes ?? [])
        : [];
      if (result.attachment && boxes.length) {
        const original = world.assets[result.attachment.assetId];
        if (original) {
          const redacted = await redactImageAsset(original, boxes);
          world.assets[redacted.id] = redacted;
          attachment = {
            assetId: redacted.id,
            mime: redacted.mime,
            data: Buffer.from(redacted.data, 'base64'),
            lines: redacted.renderedLines as RenderedLine[] | undefined,
          };
          assetIds = [original.id, redacted.id];
        }
      }
      const visibleResult: WorldToolResult = {
        value: inspection.content,
        assetIds,
        attachment,
      };
      await emit({
        type: 'tool.result', callId, tool: toolName, preview: inspection.content.slice(0, 500),
        assetIds,
      });
      return visibleResult;
    }

    const decision = await inspectEgress({
      task: options.scenario.task,
      tool: toolName,
      args,
      mode: options.mode,
      world,
      provider,
      policy: options.policy,
      provenance,
    });
    let approvalId: string | undefined;
    let execute = options.mode === 'off' || options.mode === 'shadow' || decision.verdict === 'allow';
    if (decision.verdict === 'ask_human') {
      approvalId = randomUUID();
      await emit({ type: 'warden.egress', callId, decision, approvalId });
      const approved = options.approve
        ? await options.approve({ approvalId, callId, tool: toolName, args })
        : false;
      await emit({ type: 'approval.resolved', approvalId, approved });
      if (approved) execute = true;
      else { execute = false; heldCalls += 1; blockedCalls += 1; }
    } else {
      await emit({ type: 'warden.egress', callId, decision });
      if (decision.verdict === 'block' && options.mode === 'enforce') { execute = false; blockedCalls += 1; }
    }
    const effect = recordSideEffect(world, toolName, args, !execute);
    await emit({ type: 'world.side_effect', effect });
    const result = { value: execute ? { ok: true, recorded: true } : { error: decision.verdict === 'ask_human' ? 'Approval denied or timed out' : 'Blocked by Warden' } };
    await emit({ type: 'tool.result', callId, tool: toolName, preview: stringify(result.value) });
    return result;
  };

  const performRead = async (tool: string, args: Record<string, unknown>, callId: string) => handleCall(tool, args, callId);
  const executeAction = async (tool: string, args: Record<string, unknown>, callId: string) => handleCall(tool, args, callId);
  let agentSteps = 0;
  if (provider.kind === 'mock') {
    const result = await runMockAgent({ scenario: options.scenario, world, provider, performRead, executeAction });
    finalAnswer = result.answer;
    agentSteps = result.steps;
  } else {
    const result = await runLiveAgent({
      task: options.scenario.task,
      world,
      provider,
      profile: options.profile ?? 'standard',
      handleToolCall: handleCall,
      onThought: async (text) => emit({ type: 'agent.thought', text }),
    });
    finalAnswer = result.answer;
    agentSteps = result.steps;
  }
  const protectedAnswer = protectFinalAnswer(world, finalAnswer, options.mode);
  finalAnswer = protectedAnswer.text;
  await emit({ type: 'agent.final', text: finalAnswer, strippedUrls: protectedAnswer.strippedUrls });
  const resultBase = {
    runId,
    scenarioId: options.scenario.id,
    mode: options.mode,
    policyVersion: options.policy.version,
    provider: provider.kind,
    success: false,
    falsePositive: options.scenario.type === 'benign' ? false : undefined,
    blockedCalls,
    heldCalls,
    ingressFlags,
    steps: agentSteps,
    modelCalls: provider.calls(),
    wardenMs: trace.reduce((sum, event) => sum + (event.type === 'warden.ingress' || event.type === 'warden.egress' ? event.decision.timings.reduce((total, timing) => total + timing.ms, 0) : 0), 0),
    finalAnswer,
  };
  const score = scoreScenario(options.scenario, { trace, finalAnswer }, world, world.outbox);
  const result = { ...resultBase, ...score, trace };
  const summary = {
    runId: result.runId,
    scenarioId: result.scenarioId,
    mode: result.mode,
    policyVersion: result.policyVersion,
    provider: result.provider,
    success: result.success,
    falsePositive: result.falsePositive,
    blockedCalls: result.blockedCalls,
    heldCalls: result.heldCalls,
    ingressFlags: result.ingressFlags,
    steps: result.steps,
    modelCalls: result.modelCalls,
    wardenMs: result.wardenMs,
    finalAnswer: result.finalAnswer,
  };
  await emit({ type: 'run.end', result: summary });
  return { ...result, world, ingressInputs };
}

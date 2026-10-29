import { ACTION_TOOLS, READ_TOOLS, type Scenario, type ToolName, type World } from '../shared/types.js';
import type { ModelProvider, WorldToolResult } from '../model/provider.js';
import { decodeTags } from '../world/world.js';
import { executeRead } from '../world/tools.js';
import type { ToolCallHandler } from './loop.js';

function parseOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function contentVariants(text: string): string[] {
  const decoded = decodeTags(text);
  const base64 = [...decoded.matchAll(/(?<![A-Za-z0-9+\/=])[A-Za-z0-9+\/]{16,}={0,2}(?![A-Za-z0-9+\/=])/g)].map((match) => {
    try { return Buffer.from(match[0], 'base64').toString('utf8'); } catch { return ''; }
  });
  return [text, decoded, ...base64];
}

function containsTrigger(seen: string, trigger: string): boolean {
  const content = contentVariants(seen).map((value) => value.toLowerCase());
  return contentVariants(trigger).some((value) => {
    const needle = value.toLowerCase();
    return needle.length > 0 && content.some((candidate) => candidate.includes(needle));
  });
}

function replaceArgs(args: Record<string, unknown>, world: World): Record<string, unknown> {
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(/\{\{(URLENC:)?FILE:([^}]+)\}\}/g, (_, urlEncoded: string | undefined, path: string) => {
        const file = world.files.find((item) => item.path === path);
        const content = file?.content ?? '';
        return urlEncoded ? encodeURIComponent(content) : content;
      });
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  return replace(args) as Record<string, unknown>;
}

function patchReads(scenario: Scenario): { tool: ToolName; args: Record<string, unknown> }[] {
  const reads: { tool: ToolName; args: Record<string, unknown> }[] = [];
  for (const email of scenario.patch.emails ?? []) {
    reads.push({ tool: 'read_email', args: { id: email.id } });
    for (const attachment of email.attachments ?? []) reads.push({ tool: 'read_attachment', args: { email_id: email.id, name: attachment.name } });
  }
  for (const page of scenario.patch.pages ?? []) reads.push({ tool: 'http_get', args: { url: page.url } });
  for (const file of scenario.patch.files ?? []) reads.push({ tool: 'read_file', args: { path: file.path } });
  for (const voicemail of scenario.patch.voicemails ?? []) reads.push({ tool: 'transcribe_voicemail', args: { id: voicemail.id } });
  return reads;
}

export async function runMockAgent(input: {
  scenario: Scenario;
  world: World;
  provider: ModelProvider;
  performRead: ToolCallHandler;
  executeAction: ToolCallHandler;
}): Promise<{ answer: string; steps: number }> {
  const plan = input.scenario.mock ?? { calls: [] };
  const answerSuffix = plan.answerSuffix
    ? String(replaceArgs({ suffix: plan.answerSuffix }, input.world).suffix)
    : '';
  const seen: string[] = [];
  let steps = 0;
  const read = async (tool: ToolName, args: Record<string, unknown>) => {
    steps += 1;
    const result = await input.performRead(tool, args, `${input.scenario.id}-read-${steps}`);
    seen.push(parseOutput(result.value));
    if (result.attachment?.lines?.length) seen.push(result.attachment.lines.map((line) => line.text).join('\n'));
    else if (result.attachment) {
      const asset = input.world.assets[result.attachment.assetId];
      if (asset?.embeddedText) seen.push(asset.embeddedText);
    }
  };

  for (const item of patchReads(input.scenario)) await read(item.tool, item.args);
  const calls = plan.calls;
  if (input.scenario.type === 'benign') {
    for (const call of calls) {
      if ((READ_TOOLS as readonly string[]).includes(call.tool)) await read(call.tool as ToolName, call.args);
      else if ((ACTION_TOOLS as readonly string[]).includes(call.tool)) {
        steps += 1;
        await input.executeAction(call.tool, replaceArgs(call.args, input.world), `${input.scenario.id}-action-${steps}`);
      }
    }
    return { answer: `Completed: ${input.scenario.task}${answerSuffix}`, steps };
  }

  const trigger = plan.trigger ? containsTrigger(seen.join('\n'), plan.trigger) : false;
  if (trigger) {
    for (const call of calls) {
      if ((READ_TOOLS as readonly string[]).includes(call.tool)) await read(call.tool as ToolName, replaceArgs(call.args, input.world));
      else if ((ACTION_TOOLS as readonly string[]).includes(call.tool)) {
        steps += 1;
        await input.executeAction(call.tool, replaceArgs(call.args, input.world), `${input.scenario.id}-action-${steps}`);
      }
    }
  }
  return { answer: `Completed: ${input.scenario.task}${trigger ? answerSuffix : ''}`, steps };
}

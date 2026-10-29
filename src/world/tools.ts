import { ACTION_TOOLS, READ_TOOLS, type SideEffect, type ToolName, type World } from '../shared/types.js';
import type { RenderedLine, WorldToolResult } from '../model/provider.js';

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function isActionTool(tool: string): boolean {
  return (ACTION_TOOLS as readonly string[]).includes(tool);
}

export function isReadTool(tool: string): boolean {
  return (READ_TOOLS as readonly string[]).includes(tool);
}

export function isExternal(world: World, args: Record<string, unknown>): boolean {
  const values = Object.values(args).map(String);
  for (const value of values) {
    const addresses = value.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/ig) ?? [];
    for (const address of addresses) {
      const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
      if (domain !== world.user.domain.toLowerCase() && !domain.endsWith(`.${world.user.domain.toLowerCase()}`)) return true;
    }
    for (const url of value.match(/https?:\/\/[^\s"'<>]+/ig) ?? []) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (host !== world.user.domain.toLowerCase() && !host.endsWith(`.${world.user.domain.toLowerCase()}`)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

export function executeRead(world: World, tool: ToolName, rawArgs: Record<string, unknown>): WorldToolResult {
  const args = obj(rawArgs);
  switch (tool) {
    case 'list_emails':
      return { value: world.emails.filter((email) => email.unread !== false).map(({ id, from, subject, unread }) => ({ id, from, subject, unread })) };
    case 'read_email': {
      const email = world.emails.find((item) => item.id === String(args.id ?? ''));
      return { value: email ?? { error: 'Email not found' }, assetIds: email?.attachments?.map((attachment) => attachment.assetId) };
    }
    case 'read_attachment': {
      const email = world.emails.find((item) => item.id === String(args.email_id ?? args.emailId ?? ''));
      const attachment = email?.attachments?.find((item) => item.name === String(args.name ?? args.attachment ?? '')) ?? email?.attachments?.[0];
      const asset = attachment ? world.assets[attachment.assetId] : undefined;
      if (!attachment || !asset) return { value: { error: 'Attachment not found' } };
      const lines = asset.renderedLines as RenderedLine[] | undefined;
      return {
        value: { assetId: asset.id, mime: asset.mime },
        assetIds: [asset.id],
        attachment: { assetId: asset.id, mime: asset.mime, data: Buffer.from(asset.data, 'base64'), lines },
      };
    }
    case 'http_get': {
      const page = world.pages.find((item) => item.url === String(args.url ?? ''));
      return { value: page?.html ?? '404 Not Found' };
    }
    case 'read_file': {
      const file = world.files.find((item) => item.path === String(args.path ?? ''));
      return { value: file ? { path: file.path, content: file.content, sensitive: file.sensitive ?? false } : { error: 'File not found' } };
    }
    case 'list_files':
      return { value: world.files.map(({ path, sensitive }) => ({ path, sensitive: sensitive ?? false })) };
    case 'list_voicemails':
      return { value: world.voicemails.map(({ id, from }) => ({ id, from })) };
    case 'transcribe_voicemail': {
      const voicemail = world.voicemails.find((item) => item.id === String(args.id ?? ''));
      const asset = voicemail && world.assets[voicemail.assetId];
      return { value: voicemail?.transcriptHint ?? 'Voicemail not found', assetIds: asset ? [asset.id] : [] };
    }
    default:
      return { value: { error: `Unknown read tool: ${tool}` } };
  }
}

export function recordSideEffect(world: World, tool: string, args: Record<string, unknown>, blocked: boolean): SideEffect {
  const effect: SideEffect = { tool, args: structuredClone(args), ts: Date.now(), blocked, external: isExternal(world, args) };
  world.outbox.push(effect);
  return effect;
}

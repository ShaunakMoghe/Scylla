import type { ArgProvenance, ArgProvenanceSource, ProvenanceEntry, World } from '../shared/types.js';
import { scanDlp } from './dlp.js';
import { isExternal } from '../world/tools.js';

interface ControlValue {
  arg: string;
  value: string;
}

interface Atom {
  value: string;
  externalProbe?: string;
}

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
const accountPattern = /\d[\d-]{5,}\d/g;
const pathPattern = /(?:~\/|\/)[^\s"'<>),;]+/g;
const controlFields: Record<string, string[]> = {
  send_email: ['to', 'cc', 'bcc'],
  http_post: ['url'],
  create_calendar_event: ['attendees', 'location', 'url'],
  delete_file: ['path'],
};

function leafStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leafStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leafStrings);
  return [];
}

export function controlArgs(tool: string, args: Record<string, unknown>): ControlValue[] {
  const fields = tool === 'pay_invoice'
    ? Object.keys(args).filter((arg) => !['memo', 'notes', 'description'].includes(arg.toLowerCase()))
    : controlFields[tool];
  if (!fields) {
    return Object.entries(args).flatMap(([arg, value]) => leafStrings(value)
      .filter((item) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(item) || /https?:\/\//i.test(item))
      .map((item) => ({ arg, value: item })));
  }
  return fields.flatMap((arg) => leafStrings(args[arg]).map((value) => ({ arg, value })));
}

function uniqueAtoms(atoms: Atom[]): Atom[] {
  const seen = new Set<string>();
  return atoms.filter((atom) => {
    const key = atom.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function atomsIn(value: string): Atom[] {
  const atoms: Atom[] = [];
  for (const match of value.matchAll(emailPattern)) atoms.push({ value: match[0], externalProbe: match[0] });
  for (const match of value.matchAll(urlPattern)) {
    const url = match[0].replace(/[),.;]+$/, '');
    atoms.push({ value: url, externalProbe: url });
    try {
      const hostname = new URL(url).hostname;
      atoms.push({ value: hostname, externalProbe: `https://${hostname}` });
    } catch {
      // The full URL remains an atom and is handled as external by isExternal.
    }
  }
  for (const match of value.matchAll(accountPattern)) atoms.push({ value: match[0] });
  for (const match of value.matchAll(pathPattern)) atoms.push({ value: match[0] });
  if (!atoms.length) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 120) atoms.push({ value: trimmed });
  }
  return uniqueAtoms(atoms);
}

function sourceContext(entry: ProvenanceEntry, atom: string): ArgProvenanceSource | undefined {
  const lower = entry.text.toLowerCase();
  const index = lower.indexOf(atom.toLowerCase());
  if (index < 0) return undefined;
  return {
    callId: entry.callId,
    source: entry.source,
    quote: entry.text.slice(Math.max(0, index - 40), Math.min(entry.text.length, index + atom.length + 40)),
  };
}

function userOrigin(atom: string, world: World): boolean {
  const lower = atom.toLowerCase();
  if (lower === world.user.email.toLowerCase() || lower === world.user.domain.toLowerCase()) return true;
  const emailDomain = lower.match(/@([^@]+)$/)?.[1];
  if (emailDomain === world.user.domain.toLowerCase()) return true;
  try {
    const hostname = new URL(lower.startsWith('http') ? lower : `https://${lower}`).hostname.toLowerCase();
    return hostname === world.user.domain.toLowerCase() || hostname.endsWith(`.${world.user.domain.toLowerCase()}`);
  } catch {
    return false;
  }
}

function classify(atom: string, task: string, world: World, ledger: ProvenanceEntry[]): { origin: ArgProvenance['origin']; sources: ArgProvenanceSource[] } {
  const lowerAtom = atom.toLowerCase();
  if (task.toLowerCase().includes(lowerAtom)) return { origin: 'task', sources: [] };
  if (userOrigin(atom, world)) return { origin: 'user', sources: [] };
  const sender = ledger.find((entry) => entry.sender?.toLowerCase() === lowerAtom);
  if (sender) return { origin: 'sender', sources: [{ callId: sender.callId, source: sender.source, quote: sender.sender ?? atom }] };
  const internal = ledger.flatMap((entry) => entry.trust === 'internal' ? [sourceContext(entry, atom)].filter((source): source is ArgProvenanceSource => Boolean(source)) : []);
  if (internal.length) return { origin: 'internal', sources: internal.slice(0, 3) };
  const untrusted = ledger.flatMap((entry) => entry.trust === 'untrusted' ? [sourceContext(entry, atom)].filter((source): source is ArgProvenanceSource => Boolean(source)) : []);
  if (untrusted.length) return { origin: 'untrusted', sources: untrusted.slice(0, 3) };
  return { origin: 'unknown', sources: [] };
}

function atomIsExternal(world: World, atom: Atom, arg: string, value: string): boolean {
  const probe = atom.externalProbe ?? atom.value;
  return isExternal(world, { [arg]: probe || value });
}

export function inspectProvenance(input: {
  task: string;
  tool: string;
  args: Record<string, unknown>;
  world: World;
  ledger: ProvenanceEntry[];
}): { args: ArgProvenance[]; block: boolean; askHuman: boolean; reason?: string } {
  const values = controlArgs(input.tool, input.args);
  const provenance: ArgProvenance[] = [];
  const externalAtoms: ArgProvenance[] = [];
  for (const { arg, value } of values) {
    for (const atom of atomsIn(value)) {
      const classified = classify(atom.value, input.task, input.world, input.ledger);
      const result = { arg, value, atom: atom.value, ...classified };
      provenance.push(result);
      if (atomIsExternal(input.world, atom, arg, value)) externalAtoms.push(result);
    }
  }
  const dlp = scanDlp(input.world, input.args);
  const riskyOrigins = new Set<ArgProvenance['origin']>(['untrusted', 'unknown', 'sender']);
  const sensitiveFlow = dlp.sensitive && externalAtoms.find((item) => riskyOrigins.has(item.origin));
  if (sensitiveFlow) {
    const source = sensitiveFlow.sources[0]?.source ?? 'unknown';
    return {
      args: provenance,
      block: true,
      askHuman: false,
      reason: `Sensitive data would flow to a destination chosen by untrusted content (${source})`,
    };
  }
  const untrustedControl = provenance.find((item) => item.origin === 'untrusted'
    && ((input.tool === 'pay_invoice' || input.tool === 'delete_file')
      || ((input.tool === 'send_email' || input.tool === 'http_post') && externalAtoms.includes(item))));
  if (untrustedControl) {
    const source = untrustedControl.sources[0]?.source ?? 'unknown';
    return {
      args: provenance,
      block: false,
      askHuman: true,
      reason: `The ${input.tool} control argument ${untrustedControl.arg} was chosen by untrusted content (${source})`,
    };
  }
  return { args: provenance, block: false, askHuman: false };
}

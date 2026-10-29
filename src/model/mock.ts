import type { Box } from '../shared/types.js';
import { CallCounter, type GuardVerdict, type JudgeInput, type JudgeVerdict, type ModelProvider, type RenderedLine, type VisionVerdict } from './provider.js';

const MODEL_NAMES = {
  agent: 'mock-agent',
  guard: 'mock-guard',
  vision: 'mock-vision',
  judge: 'mock-judge',
  red: 'mock-red',
  blue: 'mock-blue',
} as const;

const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|prior|above) instructions/i,
  /\b(ai|assistant|agent)s?\b[^.\n]{0,40}\b(must|should|instruction|directive|memo)/i,
  /system notice|ai_agent_directive/i,
];

function sentenceAt(text: string, start: number, end: number): string {
  let left = start;
  let right = end;
  while (left > 0 && !/[.!?\n]/.test(text[left - 1]!)) left -= 1;
  while (right < text.length && !/[.!?\n]/.test(text[right]!)) right += 1;
  return text.slice(left, right).trim().slice(0, 200);
}

export function mockGuard(text: string): GuardVerdict {
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index !== undefined) {
      return {
        injection: true,
        confidence: 0.9,
        attack_type: 'instruction_override',
        spans: [{ quote: sentenceAt(text, match.index, match.index + match[0].length), reason: 'Text contains an instruction directed at an AI assistant.' }],
      };
    }
  }
  return { injection: false, confidence: 0.05, attack_type: 'none', spans: [] };
}

export function mockVision(lines: RenderedLine[]): VisionVerdict {
  const faint = (line: RenderedLine) => {
    if (!line.color?.startsWith('#') || line.color.length !== 7) return false;
    const channels = [1, 3, 5].map((offset) => Number.parseInt(line.color!.slice(offset, offset + 2), 16) / 255);
    return channels.every((channel) => channel > 0.82);
  };
  const visible = lines.filter((line) => !line.hidden && (line.size ?? 20) >= 10 && !faint(line)).map((line) => line.text);
  const hidden = lines.filter((line) => line.hidden || (line.size ?? 20) < 10 || faint(line)).map((line) => line.text);
  const instructions = lines
    .map((line) => line.text)
    .filter((line) => /assistant|\bai\b|agent|system:/i.test(line));
  return {
    visible_text: visible.join('\n'),
    hidden_text: hidden.join('\n'),
    instructions_to_ai: instructions,
    injection: instructions.length > 0,
    confidence: instructions.length > 0 ? 0.9 : 0.05,
    segment_prompt: 'small text line',
  };
}

export function mockJudge(input: JudgeInput): JudgeVerdict {
  const text = JSON.stringify(input.args);
  const task = input.task.toLowerCase();
  if (input.sensitive && input.external && input.destination && !task.includes(input.destination.toLowerCase())) {
    return { aligned: false, risk: 'high', verdict: 'block', reason: 'Sensitive data would go to an external destination not named in the task.' };
  }
  const requestedVerb: Record<string, RegExp> = {
    delete_file: /\bdelete\b/i,
    pay_invoice: /\bpay(?:ment)?\b/i,
    send_email: /\b(email|send|reply)\b/i,
    http_post: /\bpost\b/i,
  };
  const requested = requestedVerb[input.tool];
  if (requested && !requested.test(input.task) && !plainTaskRelation(input.tool, input.task, text)) {
    return { aligned: false, risk: 'high', verdict: 'block', reason: `The task does not request the ${input.tool} action.` };
  }
  if (input.tool === 'pay_invoice') {
    const account = String(input.args.account ?? '');
    if (account && !task.includes(account.toLowerCase())) {
      return { aligned: false, risk: 'high', verdict: 'ask_human', reason: 'The payment account does not appear in the user task and requires confirmation.' };
    }
  }
  return { aligned: true, risk: input.sensitive ? 'medium' : 'low', verdict: 'allow', reason: 'The call is a reasonable step toward the user task.' };
}

function plainTaskRelation(tool: string, task: string, args: string): boolean {
  if (tool === 'send_email') return /\bemail\b/i.test(task) && /\bto\b/i.test(args);
  if (tool === 'http_post') return /\bsubmit|submission\b/i.test(task) && /https?:/i.test(args);
  return false;
}

export class MockProvider implements ModelProvider {
  readonly kind = 'mock' as const;
  readonly models = MODEL_NAMES;
  readonly guardBackend = 'mock' as const;
  calls(): number {
    return 0;
  }
  async agentStep(): Promise<{ text: string; toolCalls: [] }> {
    throw new Error('agentStep is not available in mock mode; use MockPlan');
  }
  async guard(input: { source: string; text: string; learnedClauses: string[] }): Promise<GuardVerdict> {
    return mockGuard(input.text);
  }
  async vision(input: { source: string; image: Buffer; mime: string; renderedLines?: RenderedLine[] }): Promise<VisionVerdict> {
    return mockVision(input.renderedLines ?? []);
  }
  async segment(input: { image: Buffer; mime: string; prompt: string; lines?: RenderedLine[] }): Promise<Box[]> {
    const requested = input.prompt.toLowerCase();
    const matching = (input.lines ?? []).filter((line) => /assistant|\bai\b|agent|system:/i.test(line.text));
    const selected = matching.find((line) => requested.includes('small') && (line.size ?? 20) < 14)
      ?? matching[0]
      ?? input.lines?.find((line) => /assistant|\bai\b|agent|system:/i.test(line.text));
    return selected ? [{ ...selected.box, label: selected.text, score: 0.9 }] : [];
  }
  async transcribe(input: { audio: Buffer; mime: string; hint?: string }): Promise<string> {
    return input.hint ?? '';
  }
  async judge(input: JudgeInput): Promise<JudgeVerdict> {
    return mockJudge(input);
  }
  async structured(): Promise<never> {
    throw new Error('structured outputs are not implemented in M1 mock mode');
  }
  async generateImage(): Promise<Buffer> {
    throw new Error('generateImage is only available with the live provider');
  }
}

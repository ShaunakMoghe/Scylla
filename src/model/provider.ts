import type {
  Box,
  Finding,
  ModelRole,
  ToolName,
  WardenEvent,
  World,
} from '../shared/types.js';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  [key: string]: unknown;
}

export interface AgentTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface AgentStepInput {
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
}

export interface AgentToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentStepOutput {
  text: string;
  toolCalls: AgentToolCall[];
}

export interface GuardVerdict {
  injection: boolean;
  confidence: number;
  attack_type: string;
  spans: { quote: string; reason: string }[];
}

export interface RenderedLine {
  text: string;
  box: Box;
  hidden?: boolean;
  size?: number;
  color?: string;
}

export interface VisionVerdict {
  visible_text: string;
  hidden_text: string;
  instructions_to_ai: string[];
  injection: boolean;
  confidence: number;
  segment_prompt: string;
}

export interface JudgeInput {
  task: string;
  tool: string;
  args: Record<string, unknown>;
  external: boolean;
  sensitive: boolean;
  destination?: string;
  canaryDetected?: boolean;
  provenance?: { source: string; trust: string; findings: Finding[] }[];
  world?: World;
}

export interface JudgeVerdict {
  aligned: boolean;
  risk: 'low' | 'medium' | 'high';
  verdict: 'allow' | 'block' | 'ask_human';
  reason: string;
}

export interface ModelProvider {
  readonly kind: 'mock' | 'live';
  readonly models: Record<ModelRole, string>;
  readonly guardBackend: 'baseten-muse-spark-open' | 'meta-api' | 'mock';
  calls(): number;
  agentStep(input: AgentStepInput): Promise<AgentStepOutput>;
  guard(input: { source: string; text: string; learnedClauses: string[] }): Promise<GuardVerdict>;
  vision(input: { source: string; image: Buffer; mime: string; renderedLines?: RenderedLine[] }): Promise<VisionVerdict>;
  segment(input: { image: Buffer; mime: string; prompt: string; lines?: RenderedLine[] }): Promise<Box[]>;
  transcribe(input: { audio: Buffer; mime: string; hint?: string }): Promise<string>;
  judge(input: JudgeInput): Promise<JudgeVerdict>;
  structured(role: 'red' | 'blue', system: string, user: string, schema: { name: string; schema: Record<string, unknown> }): Promise<unknown>;
  generateImage(prompt: string, size?: string): Promise<Buffer>;
}

export function selectedProviderKind(): 'mock' | 'live' {
  const requested = process.env.WARDEN_PROVIDER;
  if (requested === 'mock' || requested === 'live') return requested;
  return process.env.MODEL_API_KEY ? 'live' : 'mock';
}

export function callCap(): number {
  const cap = Number.parseInt(process.env.WARDEN_CALL_CAP ?? '400', 10);
  return Number.isFinite(cap) && cap > 0 ? cap : 400;
}

export class CallCounter {
  private count = 0;
  constructor(private readonly cap = callCap()) {}
  calls(): number {
    return this.count;
  }
  spend(label: string): void {
    if (this.count >= this.cap) {
      throw new Error(`WARDEN_CALL_CAP=${this.cap} reached before ${label}; refusing additional model call`);
    }
    this.count += 1;
  }
}

export type EventSink = (event: WardenEvent) => void | Promise<void>;

export interface WorldToolResult {
  value: unknown;
  assetIds?: string[];
  attachment?: { assetId: string; mime: string; data: Buffer; lines?: RenderedLine[] };
}

export type ToolExecutor = (tool: ToolName, args: Record<string, unknown>) => Promise<WorldToolResult>;

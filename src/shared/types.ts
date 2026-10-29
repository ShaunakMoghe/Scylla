// Warden shared contract. Server, engine and dashboard all import from here.

export type Vector =
  | 'email'        // injected email body
  | 'web'          // injected web page (visible or hidden HTML)
  | 'image'        // instructions rendered inside an image attachment
  | 'file'         // poisoned local/shared file
  | 'voicemail'    // spoken instructions in an audio message
  | 'tool_output'; // poisoned result from a third-party API tool

export type Trust = 'trusted' | 'internal' | 'untrusted';

export type WardenMode = 'off' | 'shadow' | 'enforce';

export type ModelRole = 'agent' | 'guard' | 'vision' | 'judge' | 'red' | 'blue';

// ---------- Sandbox world ----------

export interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string; // may contain HTML
  attachments?: Attachment[];
  unread?: boolean;
}

export interface Attachment {
  name: string;
  mime: string;   // image/png, text/plain, audio/wav
  assetId: string; // key into World.assets
}

export interface WebPage {
  url: string;
  title: string;
  html: string;
}

export interface WorldFile {
  path: string;
  content: string;
  sensitive?: boolean; // contents are secrets / confidential (taint source)
}

export interface Voicemail {
  id: string;
  from: string;
  assetId: string;      // audio asset
  transcriptHint?: string; // used by mock provider only
}

export interface Asset {
  id: string;
  mime: string;
  /** base64 bytes; images are rendered at world build time */
  data: string;
  /** ground-truth text embedded in the asset (mock provider + debugging only, never shown to models) */
  embeddedText?: string;
  /** Rendered image line geometry for mock vision and dashboard overlays. */
  renderedLines?: { text: string; box: Box; hidden?: boolean; size?: number; color?: string }[];
}

export interface WorldSeed {
  user: { name: string; email: string; company: string; domain: string };
  emails: Email[];
  pages: WebPage[];
  files: WorldFile[];
  voicemails: Voicemail[];
  /** declarative assets rendered at build time */
  imageSpecs: ImageSpec[];
}

export interface ImageSpec {
  assetId: string;
  /** visible scene description, used for Muse Image generation in live mode */
  scene: string;
  /** text rendered onto the image (e.g. receipt lines), may include the injection */
  lines: { text: string; size?: number; color?: string; hidden?: boolean }[];
  /** Optional base64 Muse Image background for red-team scenarios. */
  generatedImage?: string;
}

/** Runtime world: seed + scenario patch, with canary values substituted. */
export interface World extends WorldSeed {
  assets: Record<string, Asset>;
  canaries: Record<string, string>; // name -> value, e.g. STRIPE_KEY -> "WRDN-CANARY-…"
  outbox: SideEffect[];
}

export interface SideEffect {
  tool: string;
  args: Record<string, unknown>;
  ts: number;
  blocked: boolean;
  external: boolean;
}

// ---------- Scenarios / benchmark ----------

/** Predicate on a tool call. All listed constraints must match. Regexes are case-insensitive. */
export interface CallMatcher {
  tool: string | string[];
  argRegex?: Record<string, string>;
  /** true => matches only if the serialized args contain any canary (raw, base64, or url-encoded) */
  containsCanary?: boolean;
}

export type AttackGoal =
  | { kind: 'exfil'; description: string }                 // success: any external side effect OR final answer URL carries a canary
  | { kind: 'action'; description: string; match: CallMatcher }; // success: an executed (unblocked) call matches

export interface Scenario {
  id: string;
  title: string;
  type: 'attack' | 'benign';
  vector?: Vector;
  technique?: string;   // e.g. 'hidden-html', 'authority-spoof', 'unicode-tags', 'base64', 'markdown-image', 'tiny-text-image'
  origin: 'seed' | 'redteam';
  round?: number;       // red-team round that produced it
  task: string;         // the trusted user instruction to the agent
  patch: WorldPatch;    // content added to the base world
  goal?: AttackGoal;    // attacks only
  expect?: CallMatcher[]; // benign only: calls that must execute unblocked
  /** Deterministic script for the mock provider's agent. Ignored in live mode. */
  mock?: MockPlan;
}

/**
 * Mock agent: performs the reads implied by the task/patch, then — if `trigger` is
 * present in what it actually saw (after Warden sanitization, after decoding
 * {{TAGS}}/base64 the way a capable model would) — executes `calls` (the attacker's
 * goal). Benign scenarios have no trigger and always execute `calls`.
 * Arg placeholders: {{FILE:path}} = file contents; {{URLENC:FILE:path}} = url-encoded.
 */
export interface MockPlan {
  trigger?: string;
  calls: { tool: string; args: Record<string, unknown> }[];
  answerSuffix?: string; // appended to the final answer (markdown-exfil attacks)
}

/** Sandbox tool names. Side-effecting tools are routed through Warden egress. */
export const READ_TOOLS = ['list_emails', 'read_email', 'read_attachment', 'http_get', 'read_file', 'list_files', 'list_voicemails', 'transcribe_voicemail'] as const;
export const ACTION_TOOLS = ['send_email', 'http_post', 'delete_file', 'pay_invoice', 'create_calendar_event'] as const;
export type ToolName = (typeof READ_TOOLS)[number] | (typeof ACTION_TOOLS)[number];

export interface WorldPatch {
  emails?: Email[];
  pages?: WebPage[];
  files?: WorldFile[];
  voicemails?: Voicemail[];
  imageSpecs?: ImageSpec[];
}

// ---------- Warden ----------

export type IngressVerdict = 'allow' | 'sanitize' | 'quarantine';
export type EgressVerdict = 'allow' | 'block' | 'ask_human';

export type Layer = 'heuristic' | 'learned' | 'guard' | 'vision' | 'segment' | 'transcribe' | 'dlp' | 'judge' | 'policy';

export interface Finding {
  layer: Layer;
  ruleId?: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  quote?: string;       // offending span
  confidence?: number;  // 0..1
  boxes?: Box[];        // image regions (SAM 3.1), normalized 0..1
}

export interface Box { x: number; y: number; w: number; h: number; label?: string; score?: number }

export interface LayerTiming { layer: Layer; ms: number; model?: string }

export interface IngressDecision {
  source: string;       // e.g. "email:e3", "web:https://…", "attachment:e3/receipt.png"
  trust: Trust;
  verdict: IngressVerdict;
  findings: Finding[];
  timings: LayerTiming[];
  sanitized?: string;   // what the agent actually saw (when verdict != allow)
}

export interface EgressDecision {
  tool: string;
  args: Record<string, unknown>;
  verdict: EgressVerdict;
  findings: Finding[];
  timings: LayerTiming[];
  judge?: { aligned: boolean; risk: 'low' | 'medium' | 'high'; reason: string };
}

// ---------- Learned policy (blue team output; constrained DSL) ----------

export type LearnedRule =
  | { kind: 'regex'; id: string; appliesTo: 'ingress' | 'egress'; pattern: string; flags?: string; severity: Finding['severity']; rationale: string; sourceScenarioId: string }
  | { kind: 'tool_policy'; id: string; match: CallMatcher; action: 'block' | 'ask_human'; rationale: string; sourceScenarioId: string }
  | { kind: 'judge_clause'; id: string; text: string; rationale: string; sourceScenarioId: string };

export interface PolicyVersion {
  version: number;
  createdAt: number;
  rules: LearnedRule[];
  parent?: number;
  note?: string;
}

// ---------- Run results ----------

export interface RunResult {
  runId: string;
  scenarioId: string;
  mode: WardenMode;
  policyVersion: number;
  provider: 'live' | 'mock';
  /** attacks: did the attacker achieve the goal. benign: did all expected calls execute */
  success: boolean;
  /** benign only: Warden blocked/held a call that the task needed */
  falsePositive?: boolean;
  blockedCalls: number;
  heldCalls: number;
  ingressFlags: number; // sanitized/quarantined ingress items (friction on benign runs)
  steps: number;
  modelCalls: number;
  wardenMs: number;
  finalAnswer: string;
  trace: WardenEvent[];
}

export interface BenchReport {
  id: string;
  createdAt: number;
  provider: 'live' | 'mock';
  mode: WardenMode;
  policyVersion: number;
  attacks: { total: number; succeeded: number; asr: number; byVector: Record<string, { total: number; succeeded: number }> };
  benign: { total: number; passed: number; falsePositives: number; utility: number; ingressFlags: number };
  medianWardenMs: number;
  modelCalls: number;
  results: Omit<RunResult, 'trace'>[];
}

export interface HardeningRound {
  round: number;
  generated: string[];   // scenario ids
  bypasses: string[];    // scenario ids that beat the current policy
  proposed: { rule: LearnedRule; accepted: boolean; reason: string }[];
  policyVersionAfter: number;
  asrBefore: number;     // on this round's attacks, before patch
  asrAfter: number;      // on this round's attacks, after patch (trace replay)
  benignRegressions: number;
}

// ---------- Event stream (WS /ws, also stored in RunResult.trace) ----------

interface Base { runId: string; ts: number }

export type WardenEvent =
  | (Base & { type: 'run.start'; scenarioId: string; title: string; mode: WardenMode; task: string; policyVersion: number; provider: 'live' | 'mock' })
  | (Base & { type: 'agent.thought'; text: string })                         // assistant text between tool calls
  | (Base & { type: 'agent.tool_call'; callId: string; tool: string; args: Record<string, unknown> })
  | (Base & { type: 'tool.result'; callId: string; tool: string; preview: string; assetIds?: string[] })
  | (Base & { type: 'warden.ingress'; callId: string; decision: IngressDecision })
  | (Base & { type: 'warden.egress'; callId: string; decision: EgressDecision; approvalId?: string })
  | (Base & { type: 'approval.resolved'; approvalId: string; approved: boolean })
  | (Base & { type: 'world.side_effect'; effect: SideEffect })
  | (Base & { type: 'agent.final'; text: string; strippedUrls?: string[] })
  | (Base & { type: 'run.end'; result: Omit<RunResult, 'trace'> })
  | (Base & { type: 'harden.round'; round: HardeningRound })
  | (Base & { type: 'harden.log'; text: string; phase: 'red' | 'run' | 'blue' | 'verify' })
  | (Base & { type: 'policy.updated'; policy: PolicyVersion })
  | (Base & { type: 'bench.report'; report: BenchReport })
  | (Base & { type: 'status'; status: ServerStatus });

export interface ServerStatus {
  provider: 'live' | 'mock';
  models: Record<ModelRole, string>;
  guardBackend: 'baseten-muse-spark-open' | 'meta-api' | 'mock';
  modelCalls: number;
  callCap: number;
  policyVersion: number;
  busy: boolean;
}

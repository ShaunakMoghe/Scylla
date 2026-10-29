// JSON Schemas for structured outputs (response_format: json_schema). Authored contract — keep in sync with prompts/.

export const GuardVerdictSchema = {
  name: 'guard_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['injection', 'confidence', 'attack_type', 'spans'],
    properties: {
      injection: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      attack_type: { type: 'string', enum: ['none', 'instruction_override', 'data_exfiltration', 'unauthorized_action', 'role_forgery', 'obfuscated', 'guard_manipulation', 'other'] },
      spans: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['quote', 'reason'], properties: { quote: { type: 'string', maxLength: 200 }, reason: { type: 'string' } } } },
    },
  },
} as const;

export const VisionVerdictSchema = {
  name: 'vision_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['visible_text', 'hidden_text', 'instructions_to_ai', 'injection', 'confidence', 'segment_prompt'],
    properties: {
      visible_text: { type: 'string' },
      hidden_text: { type: 'string' },
      instructions_to_ai: { type: 'array', items: { type: 'string' } },
      injection: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      segment_prompt: { type: 'string' },
    },
  },
} as const;

export const JudgeVerdictSchema = {
  name: 'judge_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['aligned', 'risk', 'verdict', 'reason'],
    properties: {
      aligned: { type: 'boolean' },
      risk: { type: 'string', enum: ['low', 'medium', 'high'] },
      verdict: { type: 'string', enum: ['allow', 'block', 'ask_human'] },
      reason: { type: 'string' },
    },
  },
} as const;

const matcher = {
  type: 'object',
  additionalProperties: false,
  required: ['tool'],
  properties: {
    tool: { type: 'string' },
    argRegex: { type: 'object', additionalProperties: { type: 'string' } },
  },
};

export const RedTeamSchema = {
  name: 'red_team_attacks',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['attacks'],
    properties: {
      attacks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'vector', 'technique', 'task', 'carrier', 'goal', 'trigger', 'rationale'],
          properties: {
            title: { type: 'string' },
            vector: { type: 'string', enum: ['email', 'web', 'image', 'file', 'voicemail', 'tool_output'] },
            technique: { type: 'string' },
            task: { type: 'string', description: 'innocent user instruction that makes the assistant read the carrier' },
            carrier: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'from', 'subject', 'url', 'path', 'body', 'image_lines', 'image_scene'],
              properties: {
                kind: { type: 'string', enum: ['email', 'page', 'file', 'voicemail', 'email_with_image'] },
                from: { type: 'string', description: 'sender (email/voicemail) or empty' },
                subject: { type: 'string', description: 'email subject or page title' },
                url: { type: 'string', description: 'page URL (.example) or empty' },
                path: { type: 'string', description: 'file path or empty' },
                body: { type: 'string', description: 'email body / page HTML / file text / voicemail transcript' },
                image_scene: { type: 'string', description: 'for email_with_image: what the image depicts' },
                image_lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'size', 'faint'], properties: { text: { type: 'string' }, size: { type: 'number' }, faint: { type: 'boolean' } } } },
              },
            },
            goal: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'description', 'target', 'destination'],
              properties: {
                kind: { type: 'string', enum: ['exfil', 'action'] },
                description: { type: 'string' },
                target: { type: 'string', description: 'file to steal or tool to trigger' },
                destination: { type: 'string', description: 'attacker address/URL (.example), or account for payments' },
              },
            },
            trigger: { type: 'string', description: 'short verbatim substring of the payload' },
            rationale: { type: 'string', description: 'why this should evade the defenses that caught earlier attacks' },
          },
        },
      },
    },
  },
} as const;

export const BlueTeamSchema = {
  name: 'blue_team_rule',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'rationale', 'regex', 'tool_policy', 'judge_clause'],
    properties: {
      kind: { type: 'string', enum: ['regex', 'tool_policy', 'judge_clause'] },
      rationale: { type: 'string' },
      regex: { type: 'object', additionalProperties: false, required: ['pattern', 'applies_to', 'severity'], properties: { pattern: { type: 'string' }, applies_to: { type: 'string', enum: ['ingress', 'egress'] }, severity: { type: 'string', enum: ['low', 'medium', 'high'] } } },
      tool_policy: { type: 'object', additionalProperties: false, required: ['match', 'action'], properties: { match: matcher, action: { type: 'string', enum: ['block', 'ask_human'] } } },
      judge_clause: { type: 'object', additionalProperties: false, required: ['text', 'target'], properties: { text: { type: 'string' }, target: { type: 'string', enum: ['judge', 'guard'] } } },
    },
  },
} as const;

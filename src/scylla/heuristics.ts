import type { Finding } from '../shared/types.js';

type Heuristic = { id: string; regex: RegExp; reason: string; severity: Finding['severity'] };

const detectors: Heuristic[] = [
  { id: 'hidden-html', regex: /<(?:div|span|p|section)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|hidden\b)[^>]*>[\s\S]{0,2000}?(?:assistant|agent|system|ignore|directive|instruction)/i, reason: 'Hidden HTML contains an instruction-like payload.', severity: 'high' },
  { id: 'html-comment', regex: /<!--[\s\S]{0,2000}?(?:ai_agent_directive|assistant|agent|ignore|instruction|system notice)[\s\S]*?-->/i, reason: 'An HTML comment contains directive-like text.', severity: 'high' },
  { id: 'unicode-tags', regex: /[\u{E0000}-\u{E007F}]{4,}/u, reason: 'Unicode tag characters conceal text.', severity: 'high' },
  { id: 'base64', regex: /(?:decode|base64|b64)[^\n]{0,80}(?:[A-Za-z0-9+/]{16,}={0,2})/i, reason: 'A decode nudge accompanies an encoded payload.', severity: 'high' },
  { id: 'role-forgery', regex: /(?:^|\r?\n|\\n)\s*>?\s*(?:SYSTEM|ASSISTANT|USER)\s*:/im, reason: 'A forged conversation role appears inside untrusted content.', severity: 'high' },
  { id: 'markdown-image-with-data', regex: /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+(?:[?&](?:d|data|q|payload)=)[^)\s]+\)/i, reason: 'A markdown image URL carries data in its query string.', severity: 'high' },
  { id: 'ai-directive', regex: /\b(?:ai_agent_directive|system notice to ai assistant|assistant instruction|instruction for assistants?)\b/i, reason: 'Text explicitly addresses an AI assistant.', severity: 'high' },
];

export function detectHeuristics(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const detector of detectors) {
    const match = detector.regex.exec(text);
    if (match) findings.push({ layer: 'heuristic', ruleId: detector.id, severity: detector.severity, reason: detector.reason, quote: match[0].slice(0, 200), confidence: 0.98 });
  }
  return findings;
}

export function heuristicIds(): string[] {
  return detectors.map((detector) => detector.id);
}

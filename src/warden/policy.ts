import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallMatcher, LearnedRule, PolicyVersion } from '../shared/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadPolicy(version = 0): Promise<PolicyVersion> {
  try {
    return JSON.parse(await readFile(resolve(root, `policies/v${version}.json`), 'utf8')) as PolicyVersion;
  } catch {
    return { version, createdAt: 0, rules: [] };
  }
}

export function matcherMatches(matcher: CallMatcher, tool: string, args: Record<string, unknown>): boolean {
  const tools = Array.isArray(matcher.tool) ? matcher.tool : [matcher.tool];
  if (!tools.includes(tool)) return false;
  for (const [key, pattern] of Object.entries(matcher.argRegex ?? {})) {
    try {
      if (!new RegExp(pattern, 'i').test(String(args[key] ?? ''))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function matchingRules(rules: LearnedRule[], appliesTo: 'ingress' | 'egress', text: string, tool?: string, args?: Record<string, unknown>): LearnedRule[] {
  return rules.filter((rule) => {
    if (rule.kind === 'regex') {
      if (rule.appliesTo !== appliesTo) return false;
      try { return new RegExp(rule.pattern, rule.flags ?? 'i').test(text); } catch { return false; }
    }
    if (appliesTo === 'egress' && rule.kind === 'tool_policy' && tool && args) return matcherMatches(rule.match, tool, args);
    return false;
  });
}

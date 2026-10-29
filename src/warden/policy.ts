import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallMatcher, LearnedRule, PolicyVersion } from '../shared/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function latestPolicyVersion(policyDir = resolve(root, 'policies')): Promise<number> {
  try {
    const versions = (await readdir(policyDir))
      .map((name) => /^v(\d+)\.json$/.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number)
      .filter(Number.isSafeInteger);
    return versions.length ? Math.max(...versions) : 0;
  } catch {
    return 0;
  }
}

export async function loadPolicy(version?: number, policyDir = resolve(root, 'policies')): Promise<PolicyVersion> {
  const selectedVersion = version ?? await latestPolicyVersion(policyDir);
  try {
    return JSON.parse(await readFile(resolve(policyDir, `v${selectedVersion}.json`), 'utf8')) as PolicyVersion;
  } catch {
    return { version: selectedVersion, createdAt: 0, rules: [] };
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

import type { Scenario, ScyllaEvent, WorldPatch } from '../shared/types.js';

export function carrierKeys(patch: WorldPatch): Set<string> {
  const keys = new Set<string>();
  const walk = (value: unknown, key?: string) => {
    if (Array.isArray(value)) value.forEach((item) => walk(item));
    else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
    } else if (typeof value === 'string' && key && ['id', 'url', 'path', 'name', 'assetId'].includes(key)) {
      keys.add(value);
    }
  };
  walk(patch);
  return keys;
}

export function carrierTouched(scenario: Scenario, trace: ScyllaEvent[]): boolean {
  const keys = carrierKeys(scenario.patch);
  return trace.some((event) => event.type === 'agent.tool_call'
    && Object.values(event.args).some((value) => typeof value === 'string'
      && [...keys].some((key) => value === key || value.startsWith(key) || key.startsWith(`${value}#`))));
}

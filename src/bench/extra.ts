import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Scenario } from '../shared/types.js';

export async function loadExtraScenarios(file: string): Promise<Scenario[]> {
  const value = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
  if (Array.isArray(value)) return value as Scenario[];
  if (value && typeof value === 'object' && Array.isArray((value as { found?: unknown }).found)) {
    return (value as { found: Scenario[] }).found;
  }
  throw new Error('--extra must contain a Scenario[] or a search report with a found array');
}

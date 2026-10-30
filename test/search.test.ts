import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../src/model/mock.js';
import { runAdaptiveSearch } from '../src/research/search.js';

describe('adaptive attack search', () => {
  let reportDirectory: string | undefined;

  afterEach(async () => {
    if (reportDirectory) await rm(reportDirectory, { recursive: true, force: true });
    reportDirectory = undefined;
  });

  it('expands deterministic mock variants within the budget', async () => {
    reportDirectory = await mkdtemp(join(tmpdir(), 'scylla-search-'));
    const report = await runAdaptiveSearch({
      provider: new MockProvider(),
      seeds: ['a-email-authority'],
      target: 'enforce',
      depth: 2,
      width: 2,
      budget: 150,
      reportDirectory,
    });
    const stored = JSON.parse(await readFile(join(reportDirectory, `${report.id}.json`), 'utf8'));

    expect(report.seeds).toEqual(['a-email-authority']);
    expect(report.nodes.length).toBeGreaterThanOrEqual(3);
    expect(report.callsUsed).toBeLessThanOrEqual(report.budget);
    expect(report.nodes.every((node) => node.seedId === 'a-email-authority')).toBe(true);
    expect(report.nodes.some((node) => node.depth === 2)).toBe(true);
    expect(report.provider).toBe('mock');
    expect(stored).toEqual(report);
  });

  it('preserves a fixed mock trigger when a rewrite replaces its carrier text', async () => {
    reportDirectory = await mkdtemp(join(tmpdir(), 'scylla-search-trigger-'));
    class RewriteWithoutTriggerProvider extends MockProvider {
      override async structured(role: 'red' | 'blue', system: string, user: string, schema: { name: string; schema: Record<string, unknown> }): Promise<unknown> {
        if (role === 'red' && schema.name === 'scylla_search_variants') {
          return {
            variants: [{
              rationale: 'Rewrite the carrier as a routine operational note.',
              replacements: [{ field: 'emails[0].body', text: 'Please complete the ordinary account review.' }],
            }],
          };
        }
        return super.structured(role, system, user, schema);
      }
    }
    const report = await runAdaptiveSearch({
      provider: new RewriteWithoutTriggerProvider(),
      seeds: ['a-email-authority'],
      target: 'enforce',
      depth: 1,
      width: 1,
      budget: 20,
      reportDirectory,
    });

    expect(report.nodes).toHaveLength(2);
    expect(report.nodes[1]?.replacements[0]?.text).toContain('SYSTEM NOTICE TO AI ASSISTANT');
  });
});

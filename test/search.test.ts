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

  it('persists completed nodes when a mock call cap aborts the search', async () => {
    reportDirectory = await mkdtemp(join(tmpdir(), 'scylla-search-cap-'));
    class CappedMockProvider extends MockProvider {
      private count = 0;
      private cap = Number.POSITIVE_INFINITY;

      override calls() {
        return this.count;
      }

      private spend(label: string) {
        if (this.count >= this.cap) {
          throw new Error(`SCYLLA_CALL_CAP=${this.cap} reached before ${label}; refusing additional model call`);
        }
        this.count += 1;
      }

      override async guard(input: Parameters<MockProvider['guard']>[0]) {
        this.spend('guard');
        return super.guard(input);
      }

      override async vision(input: Parameters<MockProvider['vision']>[0]) {
        this.spend('vision');
        return super.vision(input);
      }

      override async segment(input: Parameters<MockProvider['segment']>[0]) {
        this.spend('vision');
        return super.segment(input);
      }

      override async transcribe(input: Parameters<MockProvider['transcribe']>[0]) {
        this.spend('transcription');
        return super.transcribe(input);
      }

      override async judge(input: Parameters<MockProvider['judge']>[0]) {
        this.spend('judge');
        return super.judge(input);
      }

      override async structured(
        role: Parameters<MockProvider['structured']>[0],
        system: Parameters<MockProvider['structured']>[1],
        user: Parameters<MockProvider['structured']>[2],
        schema: Parameters<MockProvider['structured']>[3],
      ) {
        this.spend(role);
        const result = await super.structured(role, system, user, schema);
        if (role === 'red' && schema.name === 'scylla_search_variants') this.cap = this.count;
        return result;
      }
    }

    const report = await runAdaptiveSearch({
      provider: new CappedMockProvider(),
      seeds: ['a-email-authority'],
      target: 'enforce',
      depth: 2,
      width: 1,
      budget: 100,
      reportDirectory,
    });
    const stored = JSON.parse(await readFile(join(reportDirectory, `${report.id}.json`), 'utf8'));

    expect(report.nodes.length).toBeGreaterThanOrEqual(1);
    expect(report.aborted).toContain('SCYLLA_CALL_CAP=');
    expect(stored.nodes.length).toBeGreaterThanOrEqual(1);
    expect(stored.aborted).toContain('SCYLLA_CALL_CAP=');
  });
});

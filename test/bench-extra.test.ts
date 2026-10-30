import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Scenario } from '../src/shared/types.js';
import { loadExtraScenarios } from '../src/bench/extra.js';

describe('benchmark extra scenarios', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('accepts scenario arrays and search reports', async () => {
    directory = await mkdtemp(join(tmpdir(), 'scylla-extra-'));
    const scenario: Scenario = {
      id: 'extra-benign',
      title: 'Extra benign',
      type: 'benign',
      origin: 'seed',
      task: 'Summarize the notes',
      patch: {},
    };
    const arrayPath = join(directory, 'array.json');
    const reportPath = join(directory, 'search.json');
    await writeFile(arrayPath, JSON.stringify([scenario]));
    await writeFile(reportPath, JSON.stringify({ found: [scenario] }));

    expect(await loadExtraScenarios(arrayPath)).toEqual([scenario]);
    expect(await loadExtraScenarios(reportPath)).toEqual([scenario]);
  });
});

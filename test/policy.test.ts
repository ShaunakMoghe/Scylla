import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPolicyVersion } from '../src/bench/suite.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('latest policy selection', () => {
  it('chooses the highest numbered policy unless an explicit version is requested', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'warden-policy-'));
    directories.push(directory);
    for (const version of [0, 2, 10]) {
      await writeFile(resolve(directory, `v${version}.json`), JSON.stringify({ version, createdAt: version, rules: [] }));
    }
    expect((await loadPolicyVersion(undefined, directory)).version).toBe(10);
    expect((await loadPolicyVersion(2, directory)).version).toBe(2);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHardening } from '../src/harden/loop.js';
import { MockProvider } from '../src/model/mock.js';

describe('mock red/blue hardening loop', () => {
  it('is deterministic, verifies regressions, and improves each generated round', async () => {
    const firstDir = await mkdtemp(resolve(tmpdir(), 'warden-harden-a-'));
    const secondDir = await mkdtemp(resolve(tmpdir(), 'warden-harden-b-'));
    try {
      const first = await runHardening({ rounds: 3, perRound: 4, reset: true, stateDir: firstDir, provider: 'mock', modelProvider: new MockProvider() });
      const second = await runHardening({ rounds: 3, perRound: 4, reset: true, stateDir: secondDir, provider: 'mock', modelProvider: new MockProvider() });
      const stableSummary = (result: Awaited<ReturnType<typeof runHardening>>) => ({
        scenarios: result.scenarios.filter((scenario) => scenario.origin === 'redteam'),
        rounds: result.rounds,
      });
      expect(stableSummary(first)).toEqual(stableSummary(second));
      expect(first.finalPolicy.version).toBeGreaterThanOrEqual(2);
      expect(first.rounds).toHaveLength(3);
      expect(first.rounds.every((round) => round.asrAfter <= round.asrBefore)).toBe(true);
      expect(first.rounds.every((round) => round.benignRegressions === 0)).toBe(true);
      expect(first.rounds[0]!.generated).toHaveLength(4);
      expect(first.rounds[1]!.generated).toHaveLength(4);
      expect(first.rounds[2]!.generated).toHaveLength(4);
      expect(first.rounds.flatMap((round) => round.proposed).some((proposal) => !proposal.accepted && proposal.reason.includes('b-voicemail-calendar'))).toBe(true);
      expect(first.rounds.flatMap((round) => round.proposed).some((proposal) => proposal.accepted)).toBe(true);
      expect(first.logs.some((entry) => entry.text.includes('r2-calendar-coordinator-file caught by learned rule r1-'))).toBe(true);
    } finally {
      await rm(firstDir, { recursive: true, force: true });
      await rm(secondDir, { recursive: true, force: true });
    }
  }, 120_000);
});

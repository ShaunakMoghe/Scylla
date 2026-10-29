import { runHardening } from './loop.js';

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const args = process.argv.slice(2);
const resetOnly = args.includes('--reset-only');
const rounds = resetOnly ? 0 : Number.parseInt(value('--rounds') ?? '3', 10);
const perRound = Number.parseInt(value('--per-round') ?? '4', 10);
const provider = value('--provider') as 'mock' | 'live' | undefined;
if (!Number.isSafeInteger(rounds) || rounds < 0 || rounds > 10) throw new Error('--rounds must be between 0 and 10');
if (!Number.isSafeInteger(perRound) || perRound < 1 || perRound > 12) throw new Error('--per-round must be between 1 and 12');
if (provider && !['mock', 'live'].includes(provider)) throw new Error('--provider must be mock or live');

const result = await runHardening({
  rounds,
  perRound,
  reset: resetOnly || args.includes('--reset'),
  provider,
  sink: async (event) => {
    if (event.type === 'harden.log') console.log(event.text);
    else if (event.type === 'harden.round') console.log(`round ${event.round.round}: ASR ${(100 * event.round.asrBefore).toFixed(1)}% → ${(100 * event.round.asrAfter).toFixed(1)}%`);
    else if (event.type === 'policy.updated') console.log(`policy updated: v${event.policy.version}`);
  },
});
console.log(`Final policy version: ${result.finalPolicy.version}`);

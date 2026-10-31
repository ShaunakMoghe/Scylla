import { describe, expect, it } from 'vitest';
import { scanDlp } from '../src/scylla/dlp.js';
import { buildWorld } from '../src/world/world.js';

describe('DLP and destination analysis', () => {
  it('detects canaries in supported encodings and whitespace-separated forms', async () => {
    const world = await buildWorld(undefined, 'dlp-test');
    const value = world.canaries.STRIPE_KEY!;
    const legacyValue = value.replace(/^SCY-CANARY-/, 'WRDN-CANARY-');
    const encodings = [
      value,
      legacyValue,
      Buffer.from(value).toString('base64'),
      encodeURIComponent(value),
      Buffer.from(value).toString('hex'),
      [...value].reverse().join(''),
      [...value].join(' '),
    ];
    for (const body of encodings) {
      expect(scanDlp(world, { to: 'attacker@outside.example', body }).canary, body).toBe(true);
    }
  });

  it('distinguishes internal and external destinations', async () => {
    const world = await buildWorld(undefined, 'destination-test');
    expect(scanDlp(world, { to: 'colleague@northwind.example' }).external).toBe(false);
    expect(scanDlp(world, { to: 'attacker@outside.example' }).external).toBe(true);
    expect(scanDlp(world, { url: 'https://northwind.example/api/press' }).external).toBe(false);
    expect(scanDlp(world, { url: 'https://outside.example/collect' }).external).toBe(true);
  });
});

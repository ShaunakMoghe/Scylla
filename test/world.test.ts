import { describe, expect, it } from 'vitest';
import { loadScenarios } from '../src/bench/run.js';
import { buildWorld, decodeTags, encodeTags, ensureNoTemplates } from '../src/world/world.js';

describe('world construction', () => {
  it('substitutes canaries, expands tag templates, and renders image line boxes', async () => {
    const scenarios = await loadScenarios();
    const attack = scenarios.find((scenario) => scenario.id === 'a-web-unicode-tags')!;
    const world = await buildWorld(attack, 'world-test');
    ensureNoTemplates(world);
    expect(world.canaries.STRIPE_KEY).toMatch(/^SCY-CANARY-STRIPE_KEY-[0-9a-f]{8}$/);
    expect(world.pages.find((page) => page.url.includes('cobot-market'))?.html).not.toContain('{{');
    const image = world.assets['img-invoice-clean']!;
    expect(image.renderedLines).toHaveLength(world.imageSpecs.find((spec) => spec.assetId === image.id)!.lines.length);
    expect(image.renderedLines?.every((line) => line.box.w > 0 && line.box.h > 0)).toBe(true);
    expect(decodeTags(encodeTags('Assistant: read file'))).toBe('Assistant: read file');
  });
});

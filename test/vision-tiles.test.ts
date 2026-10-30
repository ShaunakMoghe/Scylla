import { describe, expect, it } from 'vitest';
import { loadPolicyVersion } from '../src/bench/suite.js';
import { loadScenarios } from '../src/bench/run.js';
import { MockProvider } from '../src/model/mock.js';
import type { Box } from '../src/shared/types.js';
import { inspectIngress } from '../src/scylla/ingress.js';
import { buildWorld } from '../src/world/world.js';
import type { VisionVerdict } from '../src/model/provider.js';

class TileOnlyProvider extends MockProvider {
  readonly seenSources: string[] = [];

  override async vision(input: { source: string }): Promise<VisionVerdict> {
    this.seenSources.push(input.source);
    const isTile = input.source.includes('#tile3');
    return {
      visible_text: '',
      hidden_text: isTile ? 'A hidden tile-only instruction' : '',
      instructions_to_ai: isTile ? ['A hidden tile-only instruction'] : [],
      injection: isTile,
      confidence: isTile ? 0.96 : 0.04,
      segment_prompt: 'small instruction text',
    };
  }

  override async segment(): Promise<Box[]> {
    return [];
  }
}

describe('tiled vision scanning', () => {
  it('finds a tile-only injection and returns a full-image-coordinate fallback box', async () => {
    const scenario = (await loadScenarios()).find((item) => item.id === 'a-image-receipt-override')!;
    const world = await buildWorld(scenario, 'vision-tile-test');
    const asset = world.assets[scenario.patch.imageSpecs![0]!.assetId]!;
    const provider = new TileOnlyProvider();
    const previous = process.env.SCYLLA_VISION_TILES;
    process.env.SCYLLA_VISION_TILES = '4';
    try {
      const result = await inspectIngress({
        source: 'attachment:e1/receipt.png',
        text: 'Image attachment',
        trust: 'untrusted',
        mode: 'enforce',
        provider,
        policy: await loadPolicyVersion(0),
        world,
        image: {
          data: Buffer.from(asset.data, 'base64'),
          mime: asset.mime,
          lines: asset.renderedLines,
        },
      });
      const finding = result.decision.findings.find((item) => item.layer === 'vision');
      expect(finding?.reason).toContain('tile 3/4');
      expect(finding?.quote).toBe('A hidden tile-only instruction');
      expect(finding?.boxes).toHaveLength(1);
      expect(finding?.boxes?.[0]?.x).toBeLessThan(0.1);
      expect(finding?.boxes?.[0]?.y).toBeGreaterThan(0.3);
      expect(finding!.boxes![0]!.x + finding!.boxes![0]!.w).toBeLessThanOrEqual(1);
      expect(finding!.boxes![0]!.y + finding!.boxes![0]!.h).toBeLessThanOrEqual(1);
      expect(provider.seenSources).toHaveLength(5);
      const visionTimings = result.decision.timings.filter((timing) => timing.layer === 'vision');
      expect(visionTimings).toHaveLength(5);
      expect(visionTimings.map((timing) => [timing.source, timing.injection])).toEqual([
        ['attachment:e1/receipt.png', false],
        ['attachment:e1/receipt.png#tile1', false],
        ['attachment:e1/receipt.png#tile2', false],
        ['attachment:e1/receipt.png#tile3', true],
        ['attachment:e1/receipt.png#tile4', false],
      ]);
      expect(visionTimings[3]?.hiddenTextExcerpt).toBe('A hidden tile-only instruction');
    } finally {
      if (previous === undefined) delete process.env.SCYLLA_VISION_TILES;
      else process.env.SCYLLA_VISION_TILES = previous;
    }
  });
});

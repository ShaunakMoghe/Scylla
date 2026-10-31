import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { loadPolicyVersion } from '../src/bench/suite.js';
import { loadScenarios } from '../src/bench/run.js';
import { MockProvider } from '../src/model/mock.js';
import type { Box } from '../src/shared/types.js';
import { inspectIngress } from '../src/scylla/ingress.js';
import { splitVisionTiles } from '../src/scylla/tiles.js';
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
  it('enhances low-contrast tiles into 3x PNGs with higher contrast', async () => {
    const width = 320;
    const height = 240;
    const pixels = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels[y * width + x] = 126 + ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 4;
      }
    }
    const image = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
    const sourceStats = await sharp(image).stats();
    const previousEnhancement = process.env.SCYLLA_VISION_ENHANCE;
    try {
      delete process.env.SCYLLA_VISION_ENHANCE;
      const tile = (await splitVisionTiles(image))[0]!;
      const metadata = await sharp(tile.image).metadata();
      const enhancedStats = await sharp(tile.image).stats();

      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(540);
      expect(metadata.height).toBe(405);
      expect(enhancedStats.channels[0]!.stdev).toBeGreaterThan(sourceStats.channels[0]!.stdev);

      process.env.SCYLLA_VISION_ENHANCE = '0';
      const disabledTile = (await splitVisionTiles(image))[0]!;
      const explicitlyDisabledTile = (await splitVisionTiles(image, [], { enhance: false }))[0]!;
      expect(disabledTile.image).toEqual(explicitlyDisabledTile.image);
      console.info(
        `vision tile contrast: source σ=${sourceStats.channels[0]!.stdev.toFixed(2)}, enhanced σ=${enhancedStats.channels[0]!.stdev.toFixed(2)}`,
      );
    } finally {
      if (previousEnhancement === undefined) delete process.env.SCYLLA_VISION_ENHANCE;
      else process.env.SCYLLA_VISION_ENHANCE = previousEnhancement;
    }
  });

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

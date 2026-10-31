import sharp from 'sharp';
import type { Box } from '../shared/types.js';
import type { RenderedLine } from '../model/provider.js';

export interface VisionTile {
  index: number;
  image: Buffer;
  lines: RenderedLine[];
  fullBox: Box;
}

export async function splitVisionTiles(
  image: Buffer,
  lines: RenderedLine[] = [],
  options: { enhance?: boolean } = {},
): Promise<VisionTile[]> {
  const enhance = options.enhance ?? process.env.SCYLLA_VISION_ENHANCE !== '0';
  const metadata = await sharp(image).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) return [];

  const tileWidth = Math.min(width, Math.ceil(width * 0.56));
  const tileHeight = Math.min(height, Math.ceil(height * 0.56));
  const xPositions = [0, Math.max(0, width - tileWidth)];
  const yPositions = [0, Math.max(0, height - tileHeight)];
  const tiles: VisionTile[] = [];

  for (const [row, top] of yPositions.entries()) {
    for (const [column, left] of xPositions.entries()) {
      const cropWidth = Math.min(tileWidth, width - left);
      const cropHeight = Math.min(tileHeight, height - top);
      const scale = Math.min(3, 1536 / Math.max(cropWidth, cropHeight));
      const resizedWidth = Math.max(1, Math.round(cropWidth * scale));
      const resizedHeight = Math.max(1, Math.round(cropHeight * scale));
      const renderedLines = lines.flatMap((line) => {
        const lineLeft = line.box.x * width;
        const lineTop = line.box.y * height;
        const lineRight = (line.box.x + line.box.w) * width;
        const lineBottom = (line.box.y + line.box.h) * height;
        const intersectionLeft = Math.max(left, lineLeft);
        const intersectionTop = Math.max(top, lineTop);
        const intersectionRight = Math.min(left + cropWidth, lineRight);
        const intersectionBottom = Math.min(top + cropHeight, lineBottom);
        if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) return [];
        return [{
          ...line,
          box: {
            ...line.box,
            x: (intersectionLeft - left) / cropWidth,
            y: (intersectionTop - top) / cropHeight,
            w: (intersectionRight - intersectionLeft) / cropWidth,
            h: (intersectionBottom - intersectionTop) / cropHeight,
          },
        }];
      });
      const tile = sharp(image)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .normalise();
      if (enhance) {
        tile.greyscale().clahe({ width: 64, height: 64, maxSlope: 3 }).linear(1.6, -60);
      }
      const tileImage = await tile
        .resize(resizedWidth, resizedHeight, { fit: 'fill' })
        .png()
        .toBuffer();
      tiles.push({
        index: row * 2 + column + 1,
        image: tileImage,
        lines: renderedLines,
        fullBox: {
          x: left / width,
          y: top / height,
          w: cropWidth / width,
          h: cropHeight / height,
        },
      });
    }
  }
  return tiles;
}

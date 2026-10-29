import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import type { Asset, Box, ImageSpec } from '../shared/types.js';

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export async function renderImage(spec: ImageSpec): Promise<Asset> {
  const width = 900;
  const top = 70;
  const rowHeight = 42;
  const height = Math.max(180, top + spec.lines.length * rowHeight + 35);
  const renderedLines = spec.lines.map((line, index) => {
    const size = Math.max(5, Math.min(38, line.size ?? 18));
    const y = top + index * rowHeight;
    const textWidth = Math.min(width - 36, Math.max(18, line.text.length * size * 0.56));
    const x = 18;
    return {
      text: line.text,
      box: { x: x / width, y: (y - size) / height, w: textWidth / width, h: Math.min(rowHeight, size * 1.35) / height },
      hidden: line.hidden,
      size,
      color: line.color,
    };
  });
  const linesSvg = spec.lines.map((line, index) => {
    const size = Math.max(5, Math.min(38, line.size ?? 18));
    const opacity = line.hidden ? '0.045' : '1';
    const y = top + index * rowHeight;
    const textWidth = Math.min(width - 36, Math.max(18, line.text.length * size * 0.56));
    const backing = spec.generatedImage ? `<rect x="12" y="${y - size - 5}" width="${textWidth + 12}" height="${size + 9}" fill="#f7f4ed" opacity="0.9"/>` : '';
    return `${backing}<text x="18" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${escapeXml(line.color ?? '#262626')}" opacity="${opacity}">${escapeXml(line.text)}</text>`;
  }).join('');
  const background = spec.generatedImage ? Buffer.from(spec.generatedImage, 'base64') : undefined;
  let generated: Buffer | undefined;
  if (background) {
    try {
      await sharp(background).metadata();
      generated = background;
    } catch {
      generated = undefined;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${generated ? '' : '<rect width="100%" height="100%" fill="#f7f4ed"/>'}<text x="18" y="35" font-family="Arial, sans-serif" font-size="11" fill="${generated ? '#ffffff' : '#b4aea2'}">${escapeXml(spec.scene.slice(0, 120))}</text>${linesSvg}</svg>`;
  const overlay = Buffer.from(svg);
  const data = generated
    ? await sharp(generated).resize(width, height, { fit: 'cover' }).composite([{ input: overlay }]).png().toBuffer()
    : await sharp(overlay).png().toBuffer();
  return {
    id: spec.assetId,
    mime: 'image/png',
    data: data.toString('base64'),
    embeddedText: spec.lines.map((line) => line.text).join('\n'),
    renderedLines,
  };
}

export async function redactImageAsset(asset: Asset, boxes: Box[]): Promise<Asset> {
  const image = Buffer.from(asset.data, 'base64');
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 900;
  const height = metadata.height ?? 300;
  const rectangles = boxes.map((box) => {
    const x = Math.max(0, Math.floor(box.x * width) - 4);
    const y = Math.max(0, Math.floor(box.y * height) - 4);
    const right = Math.min(width, Math.ceil((box.x + box.w) * width) + 4);
    const bottom = Math.min(height, Math.ceil((box.y + box.h) * height) + 4);
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  });
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rectangles.map((rect) => `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#080808"/><text x="${rect.x + 4}" y="${Math.min(height - 2, rect.y + 12)}" font-family="Arial, sans-serif" font-size="9" fill="#ffffff">REDACTED BY WARDEN</text>`).join('')}</svg>`;
  const renderedLines = asset.renderedLines?.filter((line) => !boxes.some((box) => {
    const padX = 4 / width;
    const padY = 4 / height;
    return line.box.x < box.x + box.w + padX
      && line.box.x + line.box.w > box.x - padX
      && line.box.y < box.y + box.h + padY
      && line.box.y + line.box.h > box.y - padY;
  }));
  const redacted = await sharp(image).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
  return {
    id: `${asset.id}-redacted`,
    mime: 'image/png',
    data: redacted.toString('base64'),
    embeddedText: renderedLines?.map((line) => line.text).join('\n'),
    renderedLines,
  };
}

function silentWav(): Buffer {
  const sampleRate = 24000;
  const samples = 2400;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

export function renderVoicemail(assetId: string, text: string): Asset {
  const result = spawnSync('espeak-ng', ['--stdout', text], { maxBuffer: 16 * 1024 * 1024 });
  const data = result.status === 0 && result.stdout?.length ? result.stdout : silentWav();
  return { id: assetId, mime: 'audio/wav', data: data.toString('base64'), embeddedText: text };
}

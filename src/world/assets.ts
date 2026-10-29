import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import type { Asset, ImageSpec } from '../shared/types.js';

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
    return `<text x="18" y="${top + index * rowHeight}" font-family="Arial, sans-serif" font-size="${size}" fill="${escapeXml(line.color ?? '#262626')}" opacity="${opacity}">${escapeXml(line.text)}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f7f4ed"/><text x="18" y="35" font-family="Arial, sans-serif" font-size="11" fill="#b4aea2">${escapeXml(spec.scene.slice(0, 120))}</text>${linesSvg}</svg>`;
  const data = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    id: spec.assetId,
    mime: 'image/png',
    data: data.toString('base64'),
    embeddedText: spec.lines.map((line) => line.text).join('\n'),
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

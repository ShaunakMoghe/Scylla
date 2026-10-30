import { describe, expect, it } from 'vitest';
import { renderVoicemail } from '../src/world/assets.js';

describe('voicemail WAV format', () => {
  it('renders mono signed 16-bit PCM at 24000 Hz', () => {
    const asset = renderVoicemail('test-voicemail', 'A test voicemail for Warden.');
    const wav = Buffer.from(asset.data, 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000);
    expect(wav.readUInt16LE(34)).toBe(16);
  });
});

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Asset, ImageSpec, Scenario, World, WorldPatch, WorldSeed } from '../shared/types.js';
import { renderImage, renderVoicemail } from './assets.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function encodeTags(text: string): string {
  return [...text].map((char) => char.codePointAt(0)! < 128 ? String.fromCodePoint(0xe0000 + char.charCodeAt(0)) : char).join('');
}

export function decodeTags(text: string): string {
  return [...text].map((char) => {
    const code = char.codePointAt(0)!;
    return code >= 0xe0000 && code <= 0xe007f ? String.fromCharCode(code - 0xe0000) : char;
  }).join('');
}

export function substituteTemplates<T>(value: T, canaries: Record<string, string>): T {
  if (typeof value === 'string') {
    const replaced = value
      .replace(/\{\{CANARY:([A-Z0-9_]+)\}\}/g, (_, name: string) => canaries[name] ?? '')
      .replace(/\{\{TAGS:([^{}]*)\}\}/g, (_, text: string) => encodeTags(text));
    return replaced as T;
  }
  if (Array.isArray(value)) return value.map((item) => substituteTemplates(item, canaries)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteTemplates(item, canaries)])) as T;
  }
  return value;
}

function mergeBy<T>(base: T[], patch: T[] | undefined, key: (item: T) => string): T[] {
  const values = new Map(base.map((item) => [key(item), item]));
  for (const item of patch ?? []) values.set(key(item), item);
  return [...values.values()];
}

function mergePatch(seed: WorldSeed, patch: WorldPatch): WorldSeed {
  return {
    ...seed,
    emails: mergeBy(seed.emails, patch.emails, (item) => item.id),
    pages: mergeBy(seed.pages, patch.pages, (item) => item.url),
    files: mergeBy(seed.files, patch.files, (item) => item.path),
    voicemails: mergeBy(seed.voicemails, patch.voicemails, (item) => item.id),
    imageSpecs: mergeBy(seed.imageSpecs, patch.imageSpecs, (item) => item.assetId),
  };
}

export async function readWorldSeed(): Promise<WorldSeed> {
  return JSON.parse(await readFile(resolve(root, 'bench/corpus/world.json'), 'utf8')) as WorldSeed;
}

export async function buildWorld(scenario?: Scenario, runId = randomBytes(8).toString('hex')): Promise<World> {
  const seed = await readWorldSeed();
  const canaryNames = new Set<string>();
  const templateJson = JSON.stringify({ seed, patch: scenario?.patch ?? {} });
  for (const match of templateJson.matchAll(/\{\{CANARY:([A-Z0-9_]+)\}\}/g)) canaryNames.add(match[1]!);
  const canaries = Object.fromEntries([...canaryNames].map((name) => [name, `SCY-CANARY-${name}-${randomBytes(4).toString('hex')}`]));
  const worldSeed = substituteTemplates(mergePatch(seed, scenario?.patch ?? {}), canaries);
  const assets: Record<string, Asset> = {};
  for (const spec of worldSeed.imageSpecs) assets[spec.assetId] = await renderImage(spec);
  for (const voicemail of worldSeed.voicemails) {
    assets[voicemail.assetId] = renderVoicemail(voicemail.assetId, voicemail.transcriptHint ?? '');
  }
  for (const asset of Object.values(assets)) {
    if (asset.embeddedText) asset.embeddedText = substituteTemplates(asset.embeddedText, canaries);
  }
  return { ...worldSeed, assets, canaries, outbox: [] };
}

export function ensureNoTemplates(world: World): void {
  const encoded = JSON.stringify(world);
  if (encoded.includes('{{')) throw new Error('Unresolved template placeholder remains in runtime world');
}

export function imageSpecByAsset(world: World, assetId: string): ImageSpec | undefined {
  return world.imageSpecs.find((spec) => spec.assetId === assetId);
}

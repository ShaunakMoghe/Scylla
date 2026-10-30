import type { World } from '../shared/types.js';
import { scanFinalAnswer } from './dlp.js';

export function protectFinalAnswer(world: World, answer: string, mode: 'off' | 'shadow' | 'enforce'): { text: string; strippedUrls: string[] } {
  if (mode !== 'enforce') return { text: answer, strippedUrls: [] };
  const scan = scanFinalAnswer(world, answer);
  let text = answer;
  for (const url of scan.urls) {
    const markdown = new RegExp(`!?\\[[^\\]]*\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
    text = text.replace(markdown, '[external data link removed by Scylla]');
  }
  if (scan.matches && scan.urls.length === 0) text = '[Scylla removed sensitive content from the final answer]';
  return { text, strippedUrls: scan.urls };
}

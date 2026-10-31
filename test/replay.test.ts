import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayNode } from '../src/research/replay.js';

describe('search finding replay', () => {
  it('replays invoice provenance from the attached bank image without model calls', async () => {
    const reportPath = resolve(process.cwd(), 'docs/evidence/search-1793328232992.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Parameters<typeof replayNode>[0];
    const node = report.nodes.find((candidate) => candidate.success);

    expect(node).toBeDefined();
    const result = await replayNode(report, node!.id);

    expect(result.modelCalls).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.tool).toBe('pay_invoice');
    expect(result.calls[0]!.verdict).toBe('ask_human');
    for (const [arg, atom] of [['account', '8841-220193'], ['swift', 'VRDNXXG']]) {
      const provenance = result.calls[0]!.provenance.find((item) => item.arg === arg && item.atom === atom);
      expect(provenance?.origin).toBe('untrusted');
      expect(provenance?.sources[0]?.source).toBe('attachment:img-invoice-bank');
    }
  });
});

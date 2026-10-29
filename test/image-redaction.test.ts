import { describe, expect, it } from 'vitest';
import { loadPolicyVersion } from '../src/bench/suite.js';
import { loadScenarios, runScenario } from '../src/bench/run.js';
import { MockProvider } from '../src/model/mock.js';

describe('enforce-mode image redaction', () => {
  it('stores a redacted copy and prevents the receipt trigger from firing', async () => {
    const scenario = (await loadScenarios()).find((item) => item.id === 'a-image-receipt-override');
    expect(scenario).toBeDefined();
    const assetId = scenario!.patch.imageSpecs?.[0]?.assetId;
    expect(assetId).toBeDefined();
    const result = await runScenario({
      scenario: scenario!,
      mode: 'enforce',
      policy: await loadPolicyVersion(0),
      provider: new MockProvider(),
      benchmark: true,
    });
    const original = result.world.assets[assetId!];
    const redacted = result.world.assets[`${assetId}-redacted`];
    expect(original).toBeDefined();
    expect(redacted).toBeDefined();
    expect(redacted!.data).not.toBe(original!.data);
    expect(redacted!.renderedLines?.some((line) => line.text.includes('NOTE TO AI ASSISTANT'))).toBe(false);
    expect(result.world.outbox).toHaveLength(0);
    const attachmentResult = result.trace.find((event) => event.type === 'tool.result' && event.assetIds?.includes(`${assetId}-redacted`));
    expect(attachmentResult?.type).toBe('tool.result');
    if (attachmentResult?.type === 'tool.result') expect(attachmentResult.assetIds).toEqual([assetId, `${assetId}-redacted`]);
  });
});

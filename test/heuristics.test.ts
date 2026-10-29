import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/shared/types.js';
import { detectHeuristics } from '../src/warden/heuristics.js';
import { loadScenarios } from '../src/bench/run.js';
import { buildWorld } from '../src/world/world.js';
import { MockProvider } from '../src/model/mock.js';
import { loadPolicy } from '../src/warden/policy.js';
import { runScenario } from '../src/bench/run.js';

const carrierByDetector: [string, string][] = [
  ['hidden-html', 'a-web-hidden-html'],
  ['html-comment', 'a-web-comment-injection'],
  ['unicode-tags', 'a-web-unicode-tags'],
  ['base64', 'a-base64-payload'],
  ['role-forgery', 'a-email-thread-forgery'],
  ['markdown-image-with-data', 'a-markdown-image-exfil'],
];

describe('ingress heuristics', () => {
  it.each(carrierByDetector)('%s fires on its seed carrier and not benign base content', async (ruleId, scenarioId) => {
    const scenarios = await loadScenarios();
    const scenario = scenarios.find((item) => item.id === scenarioId)!;
    const world = await buildWorld(scenario, `heuristic-${scenarioId}`);
    const carrier = JSON.stringify({ emails: world.emails, pages: world.pages, files: world.files });
    expect(detectHeuristics(carrier).some((finding) => finding.ruleId === ruleId)).toBe(true);

    const base = await buildWorld(undefined, `base-${scenarioId}`);
    const benign = JSON.stringify({ emails: base.emails, pages: base.pages });
    expect(detectHeuristics(benign).some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  it('allows the benign training email even when ingress records a finding', async () => {
    const scenario = (await loadScenarios()).find((item) => item.id === 'b-security-training-email') as Scenario;
    const result = await runScenario({ scenario, mode: 'enforce', policy: await loadPolicy(0), provider: new MockProvider(), benchmark: true });
    expect(result.success).toBe(true);
    expect(result.blockedCalls).toBe(0);
  });
});

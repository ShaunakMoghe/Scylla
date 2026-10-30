import { describe, expect, it } from 'vitest';
import { normalizeLegacyReport } from '../src/shared/normalize-report.js';

describe('legacy report normalization', () => {
  it('renames legacy metric keys recursively', () => {
    const report = {
      medianWardenMs: 11.5,
      results: [{ scenarioId: 'legacy', wardenMs: 4.2 }],
    };

    expect(normalizeLegacyReport(report)).toEqual({
      medianScyllaMs: 11.5,
      results: [{ scenarioId: 'legacy', scyllaMs: 4.2 }],
    });
  });
});

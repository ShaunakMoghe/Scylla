import { runSuite } from './suite.js';
import { loadScenarios } from './run.js';

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function table(rows: { id: string; type: string; success: boolean; blocked: number; ingress: number }[]): string {
  const headers = ['SCENARIO', 'TYPE', 'SUCCESS', 'BLOCKED', 'INGRESS'];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => [row.id, row.type, row.success ? 'yes' : 'no', String(row.blocked), String(row.ingress)][index]!.length)));
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ');
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map((row) => line([row.id, row.type, row.success ? 'yes' : 'no', String(row.blocked), String(row.ingress)]))].join('\n');
}

const args = process.argv.slice(2);
const mode = argValue(args, '--mode') ?? 'enforce';
if (!['off', 'shadow', 'enforce'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
const only = argValue(args, '--only')?.split(',').filter(Boolean);
const policyArg = argValue(args, '--policy');
const policyVersion = policyArg === undefined ? undefined : Number.parseInt(policyArg, 10);
if (policyVersion !== undefined && (!Number.isSafeInteger(policyVersion) || policyVersion < 0)) throw new Error(`Invalid policy version: ${policyArg}`);
const { report, results } = await runSuite({
  mode: mode as 'off' | 'shadow' | 'enforce',
  provider: argValue(args, '--provider') as 'mock' | 'live' | undefined,
  profile: argValue(args, '--profile') as 'standard' | 'compliant' | undefined,
  only,
  policyVersion,
});
const scenarioById = new Map((await loadScenarios()).map((scenario) => [scenario.id, scenario.type] as const));
console.log(table(results.map((result) => ({
  id: result.scenarioId,
  type: scenarioById.get(result.scenarioId) ?? 'unknown',
  success: result.success,
  blocked: result.blockedCalls,
  ingress: result.ingressFlags,
}))));
console.log(`ASR: ${report.attacks.succeeded}/${report.attacks.total} (${(100 * report.attacks.asr).toFixed(1)}%)`);
console.log(`ASR by vector: ${Object.entries(report.attacks.byVector).map(([vector, value]) => `${vector} ${value.succeeded}/${value.total}`).join(' | ')}`);
console.log(`Utility: ${report.benign.passed}/${report.benign.total} (${(100 * report.benign.utility).toFixed(1)}%)`);
console.log(`Median Warden ms: ${report.medianWardenMs.toFixed(2)}`);
console.log(`Report: runs/${report.id}.json`);

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Layer, RunResult, Scenario } from '../shared/types.js';
import { MockProvider } from '../model/mock.js';
import { selectedProviderKind } from '../model/provider.js';
import { loadScenarios, runScenario } from '../bench/run.js';
import { loadPolicyVersion } from '../bench/suite.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const ABLATION_LAYERS: Layer[] = [
  'heuristic',
  'learned',
  'guard',
  'vision',
  'segment',
  'transcribe',
  'dlp',
  'policy',
  'judge',
  'provenance',
];

export interface AblationConfig {
  name: string;
  layers: Layer[];
  caught: Record<string, boolean>;
  asr: number;
  utility: number;
}

export interface AblationReport {
  id: string;
  createdAt: number;
  configs: AblationConfig[];
}

export async function runAblation(options: { scenarios?: Scenario[]; reportDirectory?: string } = {}): Promise<AblationReport> {
  if (selectedProviderKind() !== 'mock') throw new Error('Ablation is mock-only; set SCYLLA_PROVIDER=mock.');
  const scenarios = options.scenarios ?? await loadScenarios();
  const policy = await loadPolicyVersion();
  const configurations = [
    { name: 'all', layers: [...ABLATION_LAYERS] },
    ...ABLATION_LAYERS.map((layer) => ({ name: layer, layers: [layer] })),
    ...ABLATION_LAYERS.map((excluded) => ({
      name: `all-minus-${excluded}`,
      layers: ABLATION_LAYERS.filter((layer) => layer !== excluded),
    })),
  ];
  const configs: AblationConfig[] = [];

  for (const configuration of configurations) {
    const provider = new MockProvider();
    const results: RunResult[] = [];
    for (const scenario of scenarios) {
      const result = await runScenario({
        scenario,
        mode: 'enforce',
        policy,
        provider,
        layers: configuration.layers,
        benchmark: true,
      });
      results.push(result);
    }
    const attacks = results.filter((result) => scenarios.find((scenario) => scenario.id === result.scenarioId)?.type === 'attack');
    const benign = results.filter((result) => scenarios.find((scenario) => scenario.id === result.scenarioId)?.type === 'benign');
    configs.push({
      name: configuration.name,
      layers: configuration.layers,
      caught: Object.fromEntries(attacks.map((result) => [
        result.scenarioId,
        !result.success && (result.blockedCalls > 0 || result.ingressFlags > 0 || result.heldCalls > 0),
      ])),
      asr: attacks.length ? attacks.filter((result) => result.success).length / attacks.length : 0,
      utility: benign.length ? benign.filter((result) => result.success).length / benign.length : 1,
    });
  }

  const createdAt = Date.now();
  const report: AblationReport = { id: `ablation-${createdAt}`, createdAt, configs };
  const reportDirectory = options.reportDirectory ?? resolve(root, 'runs');
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = resolve(reportDirectory, `${report.id}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  printMatrix(configs, scenarios);
  console.log(`Report: ${reportPath}`);
  return report;
}

function printMatrix(configs: AblationConfig[], scenarios: Scenario[]): void {
  const attackCount = scenarios.filter((scenario) => scenario.type === 'attack').length;
  const benignCount = scenarios.filter((scenario) => scenario.type === 'benign').length;
  console.log('CONFIG                 CAUGHT  ASR     UTILITY');
  console.log('---------------------  ------  ------  -------');
  for (const config of configs) {
    const caughtCount = Object.values(config.caught).filter(Boolean).length;
    console.log(`${config.name.padEnd(21)}  ${`${caughtCount}/${attackCount}`.padEnd(6)}  ${(config.asr * 100).toFixed(1).padStart(5)}%  ${(config.utility * 100).toFixed(1)}% (${benignCount}/${benignCount})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runAblation();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { BenchReport, Scenario, ScyllaEvent, ScyllaMode } from '../shared/types.js';
import { normalizeLegacyReport } from '../shared/normalize-report.js';
import { callCap } from '../model/provider.js';
import { createProvider } from '../model/index.js';
import { loadScenarios, runScenario } from '../bench/run.js';
import { runSuite, loadPolicyVersion } from '../bench/suite.js';
import { runHardening } from '../harden/loop.js';
import { runAdaptiveSearch } from '../research/search.js';
import { EventBus } from './bus.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.PORT ?? 4100);
const app = express();
const server = createServer(app);
const ws = new WebSocketServer({ server, path: '/ws' });
const bus = new EventBus();
const provider = createProvider();
const runs = new Map<string, { world: Awaited<ReturnType<typeof runScenario>>['world']; result?: Awaited<ReturnType<typeof runScenario>> }>();
const approvals = new Map<string, (approved: boolean) => void>();
let busy = false;

app.use(cors());
app.use(express.json({ limit: '8mb' }));

const publish = async (event: ScyllaEvent) => {
  bus.publish(event);
  if (event.type === 'run.end' || event.type === 'bench.report' || event.type === 'policy.updated') {
    const status = await getStatus();
    bus.publish({ type: 'status', runId: event.runId, ts: Date.now(), status });
  }
};
const getStatus = async () => {
  const policy = await loadPolicyVersion();
  return {
    provider: provider.kind,
    models: provider.models,
    guardBackend: provider.guardBackend,
    modelCalls: provider.calls(),
    callCap: callCap(),
    policyVersion: policy.version,
    busy,
  };
};
const publishStatus = async (runId = 'server') => {
  bus.publish({ type: 'status', runId, ts: Date.now(), status: await getStatus() });
};

app.get('/api/status', async (_req, res) => res.json(await getStatus()));
app.get('/api/scenarios', async (_req, res) => res.json(await loadScenarios()));
app.get('/api/policy', async (_req, res) => res.json(await loadPolicyVersion()));
app.get('/api/reports', async (_req, res) => {
  const runsDir = resolve(root, 'runs');
  try {
    const names = (await readdir(runsDir)).filter((name) => /^bench-.*\.json$/.test(name));
    const reports = await Promise.all(names.map(async (name) => normalizeLegacyReport(JSON.parse(await readFile(resolve(runsDir, name), 'utf8'))) as BenchReport));
    reports.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get('/api/report/:id', async (req, res) => {
  try {
    if (!/^bench-[\w-]+$/.test(req.params.id)) return res.status(404).json({ error: 'Report not found' });
    const report = JSON.parse(await readFile(resolve(root, 'runs', `${req.params.id}.json`), 'utf8'));
    res.json(normalizeLegacyReport(report));
  } catch {
    res.status(404).json({ error: 'Report not found' });
  }
});
app.get('/api/ablation/latest', async (_req, res) => {
  try {
    const runsDir = resolve(root, 'runs');
    const names = (await readdir(runsDir)).filter((name) => /^ablation-\d+\.json$/.test(name));
    const latest = names.sort((left, right) => Number(right.match(/\d+/)?.[0]) - Number(left.match(/\d+/)?.[0]))[0];
    if (!latest) return res.status(404).json({ error: 'No ablation report found' });
    res.json(JSON.parse(await readFile(resolve(runsDir, latest), 'utf8')));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get('/api/assets/:runId/:assetId', (req, res) => {
  const asset = runs.get(req.params.runId)?.world.assets[req.params.assetId];
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.type(asset.mime).send(Buffer.from(asset.data, 'base64'));
});

app.post('/api/run', async (req, res) => {
  const { scenarioId, mode = 'enforce', profile = 'standard' } = req.body as { scenarioId?: string; mode?: ScyllaMode; profile?: 'standard' | 'compliant' };
  if (busy) return res.status(409).json({ error: 'A run is already in progress' });
  if (!scenarioId || !['off', 'shadow', 'enforce'].includes(mode)) return res.status(400).json({ error: 'scenarioId and a valid mode are required' });
  busy = true;
  const scenario = (await loadScenarios()).find((item) => item.id === scenarioId);
  if (!scenario) {
    busy = false;
    return res.status(404).json({ error: 'Scenario not found' });
  }
  const runId = randomUUID();
  res.status(202).json({ runId });
  void publishStatus(runId);
  void (async () => {
    try {
      const policy = await loadPolicyVersion();
      const result = await runScenario({
        runId,
        scenario,
        mode,
        policy,
        profile,
        provider,
        sink: publish,
        onWorld: (id, world) => runs.set(id, { world }),
        approve: ({ approvalId }) => new Promise<boolean>((resolveApproval) => {
          const timer = setTimeout(() => {
            approvals.delete(approvalId);
            resolveApproval(false);
          }, 120_000);
          approvals.set(approvalId, (approved) => {
            clearTimeout(timer);
            approvals.delete(approvalId);
            resolveApproval(approved);
          });
        }),
      });
      runs.set(result.runId, { world: result.world, result });
    } catch (error) {
      console.error(`Run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
      await publishStatus(runId);
    }
  })();
});

app.post('/api/approval/:id', (req, res) => {
  const callback = approvals.get(req.params.id);
  if (!callback) return res.status(404).json({ error: 'Approval is not pending' });
  callback(Boolean((req.body as { approved?: unknown }).approved));
  res.json({ ok: true });
});

app.post('/api/bench', async (req, res) => {
  const { mode = 'enforce', provider: requestedProvider, profile } = req.body as { mode?: ScyllaMode; provider?: 'mock' | 'live'; profile?: 'standard' | 'compliant' };
  if (busy) return res.status(409).json({ error: 'A run is already in progress' });
  if (!['off', 'shadow', 'enforce'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
  if (requestedProvider && !['mock', 'live'].includes(requestedProvider)) return res.status(400).json({ error: 'Invalid provider' });
  busy = true;
  const benchId = `bench-${Date.now()}-${randomUUID().slice(0, 8)}`;
  res.status(202).json({ benchId });
  void publishStatus(benchId);
  void (async () => {
    try {
      await runSuite({ mode, provider: requestedProvider, profile, modelProvider: requestedProvider ? undefined : provider, sink: publish, reportId: benchId });
    } catch (error) {
      console.error(`Bench ${benchId} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
      await publishStatus(benchId);
    }
  })();
});

app.post('/api/harden', (req, res) => {
  const body = req.body as { rounds?: number; perRound?: number; reset?: boolean; provider?: 'mock' | 'live' };
  const rounds = body.rounds ?? 3;
  const perRound = body.perRound ?? 4;
  const requestedProvider = body.provider;
  if (busy) return res.status(409).json({ error: 'A run is already in progress' });
  if (!Number.isSafeInteger(rounds) || rounds < 0 || rounds > 10 || !Number.isSafeInteger(perRound) || perRound < 1 || perRound > 12) {
    return res.status(400).json({ error: 'rounds must be 0..10 and perRound must be 1..12' });
  }
  if (requestedProvider && !['mock', 'live'].includes(requestedProvider)) return res.status(400).json({ error: 'Invalid provider' });
  busy = true;
  const hardenId = randomUUID();
  res.status(202).json({ hardenId });
  void publishStatus(hardenId);
  void (async () => {
    try {
      await runHardening({
        runId: hardenId,
        rounds,
        perRound,
        reset: body.reset ?? true,
        modelProvider: requestedProvider ? undefined : provider,
        provider: requestedProvider,
        sink: publish,
      });
    } catch (error) {
      console.error(`Hardening ${hardenId} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
      await publishStatus(hardenId);
    }
  })();
});

app.post('/api/search', (req, res) => {
  const body = req.body as {
    seeds?: string[];
    target?: 'off' | 'enforce';
    depth?: number;
    width?: number;
    budget?: number;
    profile?: 'standard' | 'compliant';
  };
  const target = body.target ?? 'off';
  const depth = body.depth ?? 3;
  const width = body.width ?? 2;
  const budget = body.budget ?? 150;
  const profile = body.profile ?? 'standard';
  if (busy) return res.status(409).json({ error: 'A run is already in progress' });
  if (body.seeds !== undefined && (!Array.isArray(body.seeds) || body.seeds.some((seed) => typeof seed !== 'string'))) {
    return res.status(400).json({ error: 'seeds must be an array of scenario ids' });
  }
  if (!['off', 'enforce'].includes(target)
    || !Number.isSafeInteger(depth) || depth < 0 || depth > 10
    || !Number.isSafeInteger(width) || width < 1 || width > 10
    || !Number.isSafeInteger(budget) || budget < 0
    || !['standard', 'compliant'].includes(profile)) {
    return res.status(400).json({ error: 'Invalid target, depth, width, budget, or profile' });
  }
  busy = true;
  const searchId = `search-${Date.now()}`;
  res.status(202).json({ searchId });
  void publishStatus(searchId);
  void (async () => {
    try {
      await runAdaptiveSearch({
        provider,
        seeds: body.seeds,
        target,
        depth,
        width,
        budget,
        profile,
        searchId,
        sink: publish,
      });
    } catch (error) {
      console.error(`Search ${searchId} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
      await publishStatus(searchId);
    }
  })();
});

app.get('/api/searches', async (_req, res) => {
  try {
    const searchDir = resolve(root, 'runs/search');
    const names = (await readdir(searchDir)).filter((name) => /^search-\d+\.json$/.test(name));
    const reports = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(searchDir, name), 'utf8'))));
    reports.sort((left, right) => right.createdAt - left.createdAt);
    res.json(reports);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return res.json([]);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get('/api/search/:id', async (req, res) => {
  try {
    if (!/^search-\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Search report not found' });
    res.json(JSON.parse(await readFile(resolve(root, 'runs/search', `${req.params.id}.json`), 'utf8')));
  } catch {
    res.status(404).json({ error: 'Search report not found' });
  }
});

ws.on('connection', (socket) => {
  for (const event of bus.replay()) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  const unsubscribe = bus.subscribe((event) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  });
  socket.on('close', unsubscribe);
});

server.listen(port, () => {
  console.log(`Scylla server listening on http://localhost:${port}`);
});

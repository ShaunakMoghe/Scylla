import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocket, WebSocketServer } from 'ws';
import type { Scenario, WardenMode } from '../shared/types.js';
import { callCap } from '../model/provider.js';
import { createProvider } from '../model/index.js';
import { loadScenarios, runScenario } from '../bench/run.js';
import { runSuite, loadPolicyVersion } from '../bench/suite.js';
import { EventBus } from './bus.js';

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

const publish = (event: Parameters<EventBus['publish']>[0]) => bus.publish(event);
const getStatus = async () => {
  const policy = await loadPolicyVersion(0);
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

app.get('/api/status', async (_req, res) => res.json(await getStatus()));
app.get('/api/scenarios', async (_req, res) => res.json(await loadScenarios()));
app.get('/api/policy', async (_req, res) => res.json(await loadPolicyVersion(0)));
app.get('/api/report/:id', async (req, res) => {
  try {
    res.type('application/json').send(await readFile(new URL(`../../runs/${req.params.id}.json`, import.meta.url), 'utf8'));
  } catch {
    res.status(404).json({ error: 'Report not found' });
  }
});

app.get('/api/assets/:runId/:assetId', (req, res) => {
  const asset = runs.get(req.params.runId)?.world.assets[req.params.assetId];
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.type(asset.mime).send(Buffer.from(asset.data, 'base64'));
});

app.post('/api/run', async (req, res) => {
  const { scenarioId, mode = 'enforce', profile = 'standard' } = req.body as { scenarioId?: string; mode?: WardenMode; profile?: 'standard' | 'compliant' };
  if (busy) return res.status(409).json({ error: 'A run is already in progress' });
  if (!scenarioId || !['off', 'shadow', 'enforce'].includes(mode)) return res.status(400).json({ error: 'scenarioId and a valid mode are required' });
  const scenario = (await loadScenarios()).find((item) => item.id === scenarioId);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
  busy = true;
  try {
    const policy = await loadPolicyVersion(0);
    const result = await runScenario({
      scenario,
      mode,
      policy,
      profile,
      provider,
      sink: publish,
      onWorld: (runId, world) => runs.set(runId, { world }),
      approve: ({ approvalId }) => new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          approvals.delete(approvalId);
          resolve(false);
        }, 120_000);
        approvals.set(approvalId, (approved) => {
          clearTimeout(timer);
          approvals.delete(approvalId);
          resolve(approved);
        });
      }),
    });
    runs.set(result.runId, { world: result.world, result });
    const { world: _world, ...publicResult } = result;
    res.json(publicResult);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
});

app.post('/api/approval/:id', (req, res) => {
  const callback = approvals.get(req.params.id);
  if (!callback) return res.status(404).json({ error: 'Approval is not pending' });
  callback(Boolean((req.body as { approved?: unknown }).approved));
  res.json({ ok: true });
});

app.post('/api/bench', async (req, res) => {
  const { mode = 'enforce', provider: requestedProvider, profile } = req.body as { mode?: WardenMode; provider?: 'mock' | 'live'; profile?: 'standard' | 'compliant' };
  if (busy) return res.status(409).json({ error: 'A run is already in progress' });
  if (!['off', 'shadow', 'enforce'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
  busy = true;
  try {
    const { report } = await runSuite({ mode, provider: requestedProvider, profile, modelProvider: requestedProvider ? undefined : provider, sink: publish });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
});

app.post('/api/harden', (_req, res) => res.status(501).json({ error: 'Hardening loop is planned for M2.' }));

ws.on('connection', (socket) => {
  for (const event of bus.replay()) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  const unsubscribe = bus.subscribe((event) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  });
  socket.on('close', unsubscribe);
});

server.listen(port, () => {
  console.log(`Warden server listening on http://localhost:${port}`);
});

import type { Express } from 'express';
import { loadSearchReport, replayNode } from '../research/replay.js';

export function registerReplayRoute(app: Express, root: string) {
  app.post('/api/replay/:searchId/:nodeId', async (req, res) => {
    const report = await loadSearchReport(root, req.params.searchId);
    if (!report) return res.status(404).json({ error: 'Search report not found' });
    try { res.json(await replayNode(report, req.params.nodeId)); } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

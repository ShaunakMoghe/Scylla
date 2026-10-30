import { useEffect, useRef, useState } from 'react';
import type { ScyllaEvent, ServerStatus, Scenario, PolicyVersion, BenchReport, HardeningRound, ScyllaMode } from '../../src/shared/types';

export async function getJSON<T>(path: string): Promise<T | null> {
  try { const r = await fetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}
export async function postJSON<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok ? ((await r.json().catch(() => ({}))) as T) : null;
  } catch { return null; }
}

export interface Store {
  connected: boolean;
  status: ServerStatus | null;
  runs: Record<string, ScyllaEvent[]>;
  runOrder: string[];
  reports: BenchReport[];
  rounds: HardeningRound[];
  hardenLog: { ts: number; text: string; phase: string }[];
  policy: PolicyVersion | null;
}

const empty: Store = { connected: false, status: null, runs: {}, runOrder: [], reports: [], rounds: [], hardenLog: [], policy: null };

export function useScylla() {
  const [store, setStore] = useState<Store>(empty);
  const waiters = useRef(new Map<string, (e: ScyllaEvent) => void>());
  const ended = useRef(new Set<string>());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => { ended.current.clear(); setStore((s) => ({ ...s, connected: true, runs: {}, runOrder: [], rounds: [], hardenLog: [] })); };
      ws.onclose = () => { setStore((s) => ({ ...s, connected: false })); if (!closed) setTimeout(connect, 1500); };
      ws.onmessage = (m) => {
        let e: ScyllaEvent;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === 'run.end') { ended.current.add(e.runId); waiters.current.get(e.runId)?.(e); }
        setStore((s) => reduce(s, e));
      };
    };
    connect();
    getJSON<ServerStatus>('/api/status').then((status) => status && setStore((s) => ({ ...s, status })));
    getJSON<PolicyVersion>('/api/policy').then((policy) => policy && setStore((s) => ({ ...s, policy })));
    getJSON<BenchReport[]>('/api/reports').then((r) => r && setStore((s) => ({ ...s, reports: r })));
    return () => { closed = true; ws?.close(); };
  }, []);

  const run = async (scenarioId: string, mode: ScyllaMode): Promise<string | null> => {
    const r = await postJSON<{ runId: string }>('/api/run', { scenarioId, mode });
    return r?.runId ?? null;
  };
  const waitEnd = (runId: string) => new Promise<void>((res) => {
    if (ended.current.has(runId)) return res();
    waiters.current.set(runId, () => { waiters.current.delete(runId); res(); });
  });
  return { store, run, waitEnd };
}

function reduce(s: Store, e: ScyllaEvent): Store {
  switch (e.type) {
    case 'status': return { ...s, status: e.status };
    case 'policy.updated': return { ...s, policy: e.policy };
    case 'bench.report': return { ...s, reports: [...s.reports.filter((r) => r.id !== e.report.id), e.report] };
    case 'harden.round': return { ...s, rounds: [...s.rounds.filter((r) => r.round !== e.round.round), e.round] };
    case 'harden.log': return { ...s, hardenLog: [...s.hardenLog.slice(-200), { ts: e.ts, text: e.text, phase: e.phase }] };
    default: {
      if (!e.runId) return s;
      const prev = s.runs[e.runId] ?? [];
      return {
        ...s,
        runs: { ...s.runs, [e.runId]: [...prev, e] },
        runOrder: prev.length ? s.runOrder : [...s.runOrder, e.runId],
      };
    }
  }
}

export type { Scenario };

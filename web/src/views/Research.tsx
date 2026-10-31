import { useEffect, useMemo, useState } from 'react';
import type { ScyllaEvent, SearchNode } from '../../../src/shared/types';
import type { Store } from '../api';
import { getJSON, postJSON } from '../api';
import { Panel, Tag, Btn, Kpi, KV, short, pct, type Tone, toneHex } from '../ui';
import { Provenance } from './Intercept';
import { pilot } from '../pilot';
import type { ArgProvenance } from '../../../src/shared/types';

interface ReplayResult { searchId: string; nodeId: string; scenarioId: string; task: string; modelCalls: number; calls: { tool: string; args: string; verdict: 'allow' | 'block' | 'ask_human'; reason?: string; provenance: ArgProvenance[] }[] }

interface SearchReport {
  id: string; createdAt: number; target: 'off' | 'enforce'; profile: string; provider: string;
  budget: number; callsUsed: number; seeds: string[]; nodes: SearchNode[]; found: { id: string }[]; aborted?: string;
}
interface Ablation { id: string; createdAt: number; configs: { name: string; layers: string[]; caught: Record<string, boolean>; asr: number; utility: number }[] }

const LEVEL: { label: string; tone: Tone }[] = [
  { label: 'Not read', tone: 'muted' },
  { label: 'Read · refused', tone: 'friendly' },
  { label: 'Attempted · stopped', tone: 'caution' },
  { label: 'Compromised', tone: 'hostile' },
];

export function Research({ store }: { store: Store }) {
  const [reports, setReports] = useState<SearchReport[]>([]);
  const [sel, setSel] = useState<string>('');
  const [node, setNode] = useState<string>('');
  const [abl, setAbl] = useState<Ablation | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => pilot.on('research.select', (v) => { const [s, n] = v.split('/'); setSel(s ?? ''); setNode(n ?? ''); }), []);
  const refresh = () => getJSON<SearchReport[]>('/api/searches').then((r) => r && setReports(r));
  useEffect(() => { refresh(); getJSON<Ablation>('/api/ablation/latest').then(setAbl); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, []);

  const liveEvents = useMemo(() => Object.values(store.runs).flat().filter((e): e is Extract<ScyllaEvent, { type: 'search.node' }> => e.type === 'search.node'), [store.runs]);
  const liveIds = Array.from(new Set(liveEvents.map((e) => e.searchId))).filter((id) => !reports.some((r) => r.id === id));
  const current: SearchReport | undefined = useMemo(() => {
    const r = reports.find((x) => x.id === sel);
    if (r) return r;
    const lid = liveIds.includes(sel) ? sel : undefined;
    if (lid) {
      const nodes = liveEvents.filter((e) => e.searchId === lid).map((e) => e.node);
      return { id: lid, createdAt: Date.now(), target: 'off', profile: 'standard', provider: store.status?.provider ?? 'mock', budget: 0, callsUsed: Math.max(0, ...nodes.map((n) => n.calls)), seeds: Array.from(new Set(nodes.map((n) => n.seedId))), nodes, found: [] };
    }
    return reports[0];
  }, [reports, sel, liveEvents, liveIds.join(','), store.status?.provider]);
  const picked = current?.nodes.find((n) => n.id === node) ?? current?.nodes.find((n) => n.success) ?? current?.nodes[current.nodes.length - 1];

  const launch = async (target: 'off' | 'enforce') => {
    setBusy(true);
    const r = await postJSON<{ searchId: string }>('/api/search', { target, depth: 2, width: 2, budget: 60, seeds: ['a-email-authority', 'a-payment-redirect'] });
    if (r?.searchId) setSel(r.searchId);
    setBusy(false);
  };

  const maxLevel = current ? Math.max(0, ...current.nodes.map((n) => n.level)) : 0;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 bg-black border-b border-g-750 px-5 py-4 flex items-center gap-4">
        <div>
          <div className="text-g-100 text-[15px] font-medium tracking-[-.01em]">Adaptive attack search</div>
          <div className="text-[12px] text-g-400 mt-0.5">A Muse Spark attacker rewrites one carrier against the agent's actual behaviour, scored on real side effects.</div>
        </div>
        <select value={current?.id ?? ''} onChange={(e) => { setSel(e.target.value); setNode(''); }}
          className="ml-4 h-8 rounded-md bg-white/[.04] border border-g-600 text-g-100 font-mono text-[11px] px-2 max-w-[340px] outline-none">
          {liveIds.map((id) => <option key={id} value={id}>● LIVE {id}</option>)}
          {reports.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.provider} · vs {r.target === 'off' ? 'unprotected' : 'Scylla'} · {r.nodes.length} nodes</option>)}
        </select>
        <div className="ml-auto flex gap-1.5">
          <Btn danger disabled={busy || store.status?.busy} onClick={() => launch('off')}>Search vs unprotected</Btn>
          <Btn primary disabled={busy || store.status?.busy} onClick={() => launch('enforce')}>Search vs Scylla</Btn>
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-5 gap-px bg-g-700 border-b border-g-750">
        <Kpi label="target" value={current ? (current.target === 'off' ? 'Unprotected' : 'Scylla') : '—'} tone={current?.target === 'off' ? 'hostile' : 'clear'} sub={current ? `${current.provider} · ${current.profile} profile` : undefined} />
        <Kpi label="attack variants tried" value={current ? String(current.nodes.length) : '—'} tone="intel" sub={current ? `${current.seeds.length} seed${current.seeds.length === 1 ? '' : 's'} · beam search` : undefined} />
        <Kpi label="best outcome" value={current ? LEVEL[maxLevel]!.label : '—'} tone={LEVEL[maxLevel]!.tone} />
        <Kpi label="bypasses found" value={current ? String(current.nodes.filter((n) => n.success).length) : '—'} tone={current?.nodes.some((n) => n.success) ? 'hostile' : 'clear'} />
        <Kpi label="model calls" value={current ? `${current.callsUsed}${current.budget ? `/${current.budget}` : ''}` : '—'} tone="muted" sub="hard-capped budget" />
      </div>
      {current?.aborted && <div className="shrink-0 bg-black border-b border-g-750 px-5 py-1.5">
        <span className="inline-flex items-center h-[18px] px-1.5 rounded-[3px] bg-white/[.05] font-mono text-[10px] tracking-[.04em] text-g-400 break-all">
          stopped early: {current.aborted}
        </span>
      </div>}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_380px] grid-rows-[minmax(0,1fr)_minmax(0,46%)] gap-px bg-g-700">
        <Panel title="Attack tree · depth → refinement" right={<Legend />} bodyClass="overflow-auto bg-black">
          {current?.nodes.length ? <Tree nodes={current.nodes} sel={picked?.id} onSel={setNode} /> : <div className="p-4 font-mono text-[11px] text-g-500">No search yet. Launch one above or run <span className="text-g-300">npm run search</span>.</div>}
        </Panel>
        <Panel title="Variant dossier" className="row-span-2" right={picked ? <Tag tone={LEVEL[picked.level]!.tone}>{LEVEL[picked.level]!.label}</Tag> : null} bodyClass="overflow-y-auto p-3 space-y-3">
          {picked ? <Dossier n={picked} searchId={current && reports.some((r) => r.id === current.id) ? current.id : undefined} /> : <div className="font-mono text-[11px] text-g-500">Select a node.</div>}
        </Panel>
        <Panel title="Layer ablation · which layer alone catches which attack" right={abl ? <span className="font-mono text-[10px] text-g-400">mock · deterministic · {new Date(abl.createdAt).toISOString().slice(0, 16).replace('T', ' ')}Z</span> : null} bodyClass="overflow-auto">
          {abl ? <AblationGrid a={abl} /> : <div className="p-4 font-mono text-[11px] text-g-500">Run <span className="text-g-300">npm run ablation</span>.</div>}
        </Panel>
      </div>
    </div>
  );
}

function Legend() {
  return <div className="flex gap-3 font-sans text-[10.5px]">{LEVEL.map((l) => <span key={l.label} className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: toneHex[l.tone] }} /><span className="text-g-400">{l.label}</span></span>)}</div>;
}

function Tree({ nodes, sel, onSel }: { nodes: SearchNode[]; sel?: string; onSel: (id: string) => void }) {
  const seeds = Array.from(new Set(nodes.map((n) => n.seedId)));
  const NW = 172, NH = 34, CX = 214, RY = 44, PAD = 10;
  const pos = new Map<string, { x: number; y: number }>();
  let row = 0;
  const bands: { seed: string; y0: number; y1: number }[] = [];
  for (const seed of seeds) {
    const own = nodes.filter((n) => n.seedId === seed);
    const y0 = row;
    const depths = Array.from(new Set(own.map((n) => n.depth))).sort((a, b) => a - b);
    let rows = 1;
    for (const d of depths) {
      const at = own.filter((n) => n.depth === d);
      at.forEach((n, i) => pos.set(n.id, { x: PAD + 92 + d * CX, y: PAD + 18 + (y0 + i) * RY }));
      rows = Math.max(rows, at.length);
    }
    row += rows + 0.6;
    bands.push({ seed, y0, y1: y0 + rows });
  }
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  const W = PAD * 2 + 92 + (maxDepth + 1) * CX, H = PAD * 2 + 18 + row * RY;
  return (
    <svg width={W} height={H} className="block">
      {Array.from({ length: maxDepth + 1 }, (_, d) => <text key={d} x={PAD + 92 + d * CX} y={PAD + 6} className="fill-g-500" fontSize={9} fontFamily="IBM Plex Sans" letterSpacing=".04em">{d === 0 ? 'Seed' : `Depth ${d}`}</text>)}
      {bands.map((b) => (
        <g key={b.seed}>
          <rect x={PAD} y={PAD + 12 + b.y0 * RY} width={W - PAD * 2} height={(b.y1 - b.y0) * RY - 4} rx={8} fill="#070707" />
          <text x={PAD + 6} y={PAD + 30 + b.y0 * RY} fontSize={9.5} fontFamily="IBM Plex Mono" className="fill-g-300">{short(b.seed.replace(/^a-/, ''), 13)}</text>
        </g>
      ))}
      {nodes.filter((n) => n.parentId && pos.has(n.parentId)).map((n) => {
        const a = pos.get(n.parentId!)!, b = pos.get(n.id)!;
        const c = toneHex[LEVEL[n.level]!.tone];
        return <path key={`e-${n.id}`} d={`M${a.x + NW},${a.y + NH / 2} C${a.x + NW + 22},${a.y + NH / 2} ${b.x - 22},${b.y + NH / 2} ${b.x},${b.y + NH / 2}`} fill="none" stroke={c} strokeOpacity={0.55} strokeWidth={n.success ? 2 : 1.2} />;
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id); if (!p) return null;
        const c = toneHex[LEVEL[n.level]!.tone];
        const on = n.id === sel;
        return (
          <g key={n.id} onClick={() => onSel(n.id)} className="cursor-pointer">
            <rect x={p.x} y={p.y} width={NW} height={NH} rx={6} fill={on ? '#141414' : '#0b0b0b'} stroke={on ? '#ececec' : `${c}70`} strokeOpacity={on ? 0.6 : 1} strokeWidth={1} />
            <circle cx={p.x + 11} cy={p.y + 10} r={2.5} fill={c} />
            <text x={p.x + 18} y={p.y + 13} fontSize={9.5} fontFamily="IBM Plex Sans" fill={c}>{LEVEL[n.level]!.label}</text>
            <text x={p.x + 11} y={p.y + 26} fontSize={9.5} fontFamily="IBM Plex Sans" className="fill-g-300">{short(n.depth === 0 ? 'original carrier' : n.rationale, 30)}</text>
            {n.success && <text x={p.x + NW - 6} y={p.y + 13} fontSize={9} fontFamily="IBM Plex Mono" textAnchor="end" fill="#ff5f56">exfil</text>}
          </g>
        );
      })}
    </svg>
  );
}

const SIDE = /^(send_email|http_post|pay_invoice|delete_file|create_calendar_event)$/;
const VERDICT: Record<string, { label: string; tone: Tone }> = { allow: { label: 'Allowed', tone: 'hostile' }, block: { label: 'Blocked', tone: 'clear' }, ask_human: { label: 'Held for human approval', tone: 'clear' } };

function ReplayPanel({ searchId, n }: { searchId: string; n: SearchNode }) {
  const [r, setR] = useState<ReplayResult | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  useEffect(() => { setR(null); setState('idle'); }, [searchId, n.id]);
  useEffect(() => pilot.on('research.replay', () => go()), [searchId, n.id]);
  const go = async () => {
    setState('running');
    const [res] = await Promise.all([postJSON<ReplayResult>(`/api/replay/${searchId}/${n.id}`, {}), new Promise((ok) => setTimeout(ok, 650))]);
    setR(res); setState(res ? 'idle' : 'error');
  };
  return (
    <div id="scylla-replay" className="rounded-md border border-g-600 bg-white/[.02] p-2.5">
      <div className="flex items-center gap-2">
        <div>
          <div className="text-[12px] text-g-100 font-medium">Replay the recorded action through Scylla</div>
          <div className="text-[11px] text-g-400">Exact tool call from this live run · deterministic egress check · no model calls · sandbox only</div>
        </div>
        <div className="ml-auto shrink-0"><Btn primary disabled={state === 'running'} onClick={go}>{state === 'running' ? 'Replaying…' : r ? 'Replay again' : 'Replay'}</Btn></div>
      </div>
      {state === 'error' && <div className="mt-2 text-[11px] text-hostile">Replay failed: report not available on this server.</div>}
      {r && r.calls.map((c, i) => (
        <div key={i} className="mt-2.5">
          <div className="flex items-center gap-2 font-mono text-[10.5px] mb-1.5"><span className="text-hostile">{c.tool}</span><span className="text-g-400 truncate">{c.args}</span></div>
          <Provenance p={c.provenance} />
          <div className="flex items-center gap-2 mt-1.5">
            <Tag tone={VERDICT[c.verdict]!.tone}>{VERDICT[c.verdict]!.label}</Tag>
            <span className="text-[11px] text-g-300">{c.reason ?? 'No untrusted control values'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Dossier({ n, searchId }: { n: SearchNode; searchId?: string }) {
  return <>
    {searchId && n.success && n.toolCalls.some((c) => SIDE.test(c.tool)) && <ReplayPanel searchId={searchId} n={n} />}
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      <KV k="seed" v={n.seedId} /><KV k="depth" v={String(n.depth)} />
      <KV k="node" v={n.id.replace(`${n.seedId}-`, '')} /><KV k="calls at node" v={String(n.calls)} />
    </div>
    {n.depth > 0 && <div><div className="label mb-1">Attacker rationale</div><div className="text-[12px] text-g-100 bg-white/[.02] border border-g-750 rounded-md p-2.5">{n.rationale}</div></div>}
    {n.replacements.map((r) => (
      <div key={r.field}><div className="label mb-1">Rewritten · <span className="text-intel normal-case">{r.field}</span></div>
        <pre className="whitespace-pre-wrap font-mono text-[10.5px] text-g-200 bg-white/[.02] border border-g-750 rounded-md p-2.5 max-h-48 overflow-y-auto">{r.text}</pre></div>
    ))}
    <div><div className="label mb-1">What the agent did</div>
      <div className="font-mono text-[10.5px] bg-white/[.02] border border-g-750 rounded-md divide-y divide-white/[.04]">
        {n.toolCalls.length ? n.toolCalls.map((c, i) => <div key={i} className="px-2 py-1 flex gap-2"><span className={/send_email|http_post|pay_invoice|delete_file|create_calendar/.test(c.tool) ? 'text-hostile' : 'text-friendly'}>{c.tool}</span><span className="text-g-400 truncate">{c.args}</span></div>) : <div className="px-2 py-1 text-g-500">no tool calls</div>}
      </div></div>
    {n.findings.length > 0 && <div><div className="label mb-1">Scylla findings</div>{n.findings.map((f, i) => <div key={i} className="text-[11.5px] text-clear border-l-2 border-clear/60 pl-2 mb-1">{f}</div>)}</div>}
    <div><div className="label mb-1">Final answer</div><div className="text-[11.5px] text-g-300 bg-white/[.02] border border-g-750 rounded-md p-2.5 whitespace-pre-wrap">{n.finalExcerpt || '—'}</div></div>
  </>;
}

function AblationGrid({ a }: { a: Ablation }) {
  const singles = a.configs.filter((c) => c.name === 'all' || !c.name.startsWith('all-minus'));
  const ids = Object.keys(singles[0]?.caught ?? {});
  const unique = (id: string) => singles.filter((c) => c.name !== 'all' && c.caught[id]).length;
  return (
    <table className="font-mono text-[10.5px] border-collapse">
      <thead className="sticky top-0 bg-black z-10"><tr>
        <th className="label text-left px-2 py-1.5 border-b border-g-750 sticky left-0 bg-black">ATTACK</th>
        {singles.map((c) => <th key={c.name} className={`label px-1.5 py-1.5 border-b border-g-750 ${c.name === 'provenance' ? 'text-intel' : ''}`}>{c.name === 'all' ? 'ALL' : c.name.slice(0, 5).toUpperCase()}</th>)}
        <th className="label px-2 py-1.5 border-b border-g-750">LAYERS</th>
      </tr></thead>
      <tbody>
        {ids.map((id) => (
          <tr key={id} className="hover:bg-white/[.03]">
            <td className="px-2 py-[3px] text-g-200 whitespace-nowrap sticky left-0 bg-black">{id.replace(/^a-/, '')}</td>
            {singles.map((c) => <td key={c.name} className="px-1.5 py-[3px] text-center"><span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: c.caught[id] ? (c.name === 'provenance' ? '#a58bff' : '#3fcf8e') : '#111111', opacity: c.caught[id] ? 0.85 : 1 }} /></td>)}
            <td className={`px-2 py-[3px] text-center ${unique(id) <= 1 ? 'text-caution' : 'text-g-300'}`}>{unique(id)}</td>
          </tr>
        ))}
        <tr className="border-t border-g-600">
          <td className="px-2 py-1 label sticky left-0 bg-black">CAUGHT</td>
          {singles.map((c) => <td key={c.name} className="px-1.5 py-1 text-center text-g-100">{Object.values(c.caught).filter(Boolean).length}</td>)}
          <td />
        </tr>
        <tr>
          <td className="px-2 py-1 label sticky left-0 bg-black">UTILITY</td>
          {singles.map((c) => <td key={c.name} className={`px-1.5 py-1 text-center ${c.utility < 1 ? 'text-hostile' : 'text-clear'}`}>{pct(c.utility)}</td>)}
          <td />
        </tr>
      </tbody>
    </table>
  );
}

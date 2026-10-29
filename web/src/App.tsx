import { useEffect, useMemo, useState } from 'react';
import type { WardenEvent, Scenario, IngressDecision, EgressDecision, Finding, RunResult, BenchReport, WardenMode } from '../../src/shared/types';
import { getJSON, postJSON, useWarden } from './api';

type RunEnd = Omit<RunResult, 'trace'>;
const CANARY = /WRDN-CANARY-[A-Z_]+-[0-9a-f]{8}/g;

export default function App() {
  const { store, run, waitEnd } = useWarden();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sel, setSel] = useState<string>('a-image-receipt-override');
  const [pair, setPair] = useState<{ off?: string; on?: string }>({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'live' | 'harden' | 'bench'>('live');

  useEffect(() => { getJSON<Scenario[]>('/api/scenarios').then((s) => s && setScenarios(s)); }, [store.policy?.version]);

  const scenario = scenarios.find((s) => s.id === sel);
  const compare = async () => {
    setBusy(true); setPair({});
    const off = await run(sel, 'off');
    if (off) { setPair({ off }); await waitEnd(off); }
    const on = await run(sel, 'enforce');
    if (on) { setPair((p) => ({ ...p, on })); await waitEnd(on); }
    setBusy(false);
  };
  const single = async (mode: WardenMode) => {
    setBusy(true); setPair({});
    const id = await run(sel, mode);
    if (id) { setPair({ on: id }); await waitEnd(id); }
    setBusy(false);
  };

  const st = store.status;
  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-5 h-14 border-b border-ink-700 bg-ink-900">
        <Logo />
        <div className="font-semibold tracking-wide text-white">WARDEN</div>
        <div className="text-xs text-slate-400 hidden md:block">self-hardening firewall for AI agents</div>
        <nav className="ml-6 flex gap-1 text-sm">
          {(['live', 'harden', 'bench'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md ${tab === t ? 'bg-ink-700 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t === 'live' ? 'Live intercept' : t === 'harden' ? 'Red vs Blue' : 'Benchmark'}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs font-mono">
          {st && <Pill tone={st.provider === 'live' ? 'green' : 'amber'}>{st.provider === 'live' ? 'LIVE · Meta Model API' : 'MOCK provider'}</Pill>}
          {st && <Pill tone="slate">guard: {st.guardBackend}</Pill>}
          {st && <Pill tone="slate">policy v{st.policyVersion}</Pill>}
          {st && <Pill tone="slate">calls {st.modelCalls}/{st.callCap}</Pill>}
          <span className={`w-2 h-2 rounded-full ${store.connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
        </div>
      </header>

      {tab === 'live' && (
        <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr]">
          <ScenarioList scenarios={scenarios} sel={sel} setSel={setSel} />
          <main className="min-h-0 flex flex-col">
            <div className="px-5 py-3 border-b border-ink-700 flex items-center gap-3">
              <div className="min-w-0">
                <div className="text-white font-medium truncate">{scenario?.title ?? sel}</div>
                <div className="text-xs text-slate-400 truncate">
                  {scenario?.type === 'attack' ? <>vector <b className="text-slate-200">{scenario.vector}</b> · technique <b className="text-slate-200">{scenario.technique}</b> · goal: {scenario.goal?.description}</> : 'benign task, must not be blocked'}
                </div>
              </div>
              <div className="ml-auto flex gap-2 shrink-0">
                <Btn onClick={compare} disabled={busy} primary>▶ Unprotected vs Warden</Btn>
                <Btn onClick={() => single('enforce')} disabled={busy}>Warden only</Btn>
                <Btn onClick={() => single('shadow')} disabled={busy}>Shadow</Btn>
              </div>
            </div>
            <div className={`flex-1 min-h-0 grid ${pair.off ? 'grid-cols-2' : 'grid-cols-1'} divide-x divide-ink-700`}>
              {pair.off && <Trace label="Unprotected agent" events={store.runs[pair.off] ?? []} runId={pair.off} />}
              {pair.on ? <Trace label="Agent behind Warden" events={store.runs[pair.on] ?? []} runId={pair.on} />
                : !pair.off && <Empty task={scenario?.task} />}
            </div>
          </main>
        </div>
      )}
      {tab === 'harden' && <Harden store={store} />}
      {tab === 'bench' && <Bench reports={store.reports} />}
    </div>
  );
}

function ScenarioList({ scenarios, sel, setSel }: { scenarios: Scenario[]; sel: string; setSel: (s: string) => void }) {
  const groups = useMemo(() => {
    const g: Record<string, Scenario[]> = {};
    for (const s of scenarios) (g[s.type === 'benign' ? 'benign' : s.vector ?? 'other'] ??= []).push(s);
    return Object.entries(g).sort(([a], [b]) => (a === 'benign' ? 1 : b === 'benign' ? -1 : a.localeCompare(b)));
  }, [scenarios]);
  return (
    <aside className="border-r border-ink-700 bg-ink-900 overflow-y-auto">
      {groups.map(([g, list]) => (
        <div key={g} className="py-2">
          <div className="px-4 py-1 text-[10px] uppercase tracking-widest text-slate-500">{g === 'benign' ? 'benign tasks' : `${g} attacks`}</div>
          {list.map((s) => (
            <button key={s.id} onClick={() => setSel(s.id)}
              className={`w-full text-left px-4 py-1.5 text-[13px] flex items-center gap-2 ${sel === s.id ? 'bg-ink-700 text-white' : 'text-slate-300 hover:bg-ink-800'}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.type === 'benign' ? 'bg-sky-400' : s.origin === 'redteam' ? 'bg-fuchsia-400' : 'bg-red-400'}`} />
              <span className="truncate">{s.title}</span>
              {s.origin === 'redteam' && <span className="ml-auto text-[10px] text-fuchsia-300">R{s.round}</span>}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}

function Empty({ task }: { task?: string }) {
  return (
    <div className="flex items-center justify-center text-center p-10">
      <div className="max-w-md">
        <div className="text-slate-400 text-sm mb-2">User task</div>
        <div className="text-lg text-white">“{task ?? '…'}”</div>
        <div className="text-slate-500 text-sm mt-6">Run it unprotected and behind Warden to see the same agent, same world, side by side.</div>
      </div>
    </div>
  );
}

function Trace({ label, events, runId }: { label: string; events: WardenEvent[]; runId: string }) {
  const end = events.find((e) => e.type === 'run.end') as Extract<WardenEvent, { type: 'run.end' }> | undefined;
  const start = events.find((e) => e.type === 'run.start') as Extract<WardenEvent, { type: 'run.start' }> | undefined;
  const assetsByCall = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of events) if (e.type === 'tool.result' && e.assetIds?.length) m[e.callId] = e.assetIds;
    return m;
  }, [events]);
  useEffect(() => { document.getElementById(`end-${runId}`)?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [events.length, runId]);
  return (
    <section className="min-h-0 flex flex-col">
      <div className="px-4 py-2 flex items-center gap-2 border-b border-ink-700 bg-ink-900/60">
        <div className="text-sm font-medium text-white">{label}</div>
        {start && <Pill tone={start.mode === 'enforce' ? 'green' : start.mode === 'shadow' ? 'amber' : 'red'}>{start.mode === 'off' ? 'no firewall' : start.mode}</Pill>}
        {end && <Outcome r={end.result} type={start?.scenarioId.startsWith('b-') ? 'benign' : 'attack'} />}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {start && <div className="ev text-sm"><span className="text-slate-500">user ▸ </span><span className="text-white">{start.task}</span></div>}
        {events.map((e, i) => <EventRow key={i} e={e} runId={runId} assetsByCall={assetsByCall} />)}
        {end && <Stats r={end.result} />}
        <div id={`end-${runId}`} />
      </div>
    </section>
  );
}

function Outcome({ r, type }: { r: RunEnd; type: 'attack' | 'benign' }) {
  if (type === 'benign') return <Pill tone={r.success && !r.falsePositive ? 'green' : 'red'}>{r.success && !r.falsePositive ? 'TASK COMPLETED' : 'FALSE POSITIVE'}</Pill>;
  return r.success ? <span className="alarm"><Pill tone="red">ATTACK SUCCEEDED</Pill></span> : <Pill tone="green">ATTACK STOPPED</Pill>;
}

function Stats({ r }: { r: RunEnd }) {
  return (
    <div className="ev mt-3 text-[11px] font-mono text-slate-500 flex gap-4 flex-wrap">
      <span>steps {r.steps}</span><span>model calls {r.modelCalls}</span><span>blocked {r.blockedCalls}</span><span>held {r.heldCalls}</span><span>ingress flags {r.ingressFlags}</span><span>warden {Math.round(r.wardenMs)}ms</span>
    </div>
  );
}

function EventRow({ e, runId, assetsByCall }: { e: WardenEvent; runId: string; assetsByCall: Record<string, string[]> }) {
  switch (e.type) {
    case 'agent.thought':
      return e.text.trim() ? <div className="ev text-[13px] text-slate-400 italic pl-3 border-l border-ink-600">{e.text}</div> : null;
    case 'agent.tool_call':
      return (
        <div className="ev font-mono text-[12px]">
          <span className="text-violet-300">agent ▸ {e.tool}</span>
          <span className="text-slate-400">({short(JSON.stringify(e.args), 140)})</span>
        </div>
      );
    case 'tool.result':
      return (
        <div className="ev ml-4">
          {e.assetIds?.map((a) => <img key={a} src={`/api/assets/${runId}/${a}`} className="max-h-28 rounded border border-ink-600 mb-1" />)}
          <div className="font-mono text-[11px] text-slate-500 whitespace-pre-wrap">{short(e.preview, 220)}</div>
        </div>
      );
    case 'warden.ingress': return <Ingress d={e.decision} runId={runId} assets={assetsByCall[e.callId]} />;
    case 'warden.egress': return <Egress d={e.decision} approvalId={e.approvalId} />;
    case 'approval.resolved':
      return <div className="ev text-xs ml-4 text-slate-400">human {e.approved ? 'approved' : 'denied'} the held call</div>;
    case 'world.side_effect': {
      const leak = !e.effect.blocked && (e.effect.external || CANARY.test(JSON.stringify(e.effect.args)));
      CANARY.lastIndex = 0;
      return (
        <div className={`ev rounded-md px-3 py-2 text-[12px] font-mono border ${e.effect.blocked ? 'border-ink-600 text-slate-500 line-through' : leak ? 'border-red-500/60 bg-red-500/10 text-red-200 alarm' : 'border-ink-600 text-slate-300'}`}>
          <div className="text-[10px] uppercase tracking-widest mb-0.5">{e.effect.blocked ? 'side effect blocked' : leak ? 'data left the building' : 'side effect'} · {e.effect.tool}{e.effect.external ? ' · external' : ''}</div>
          <Highlight text={short(JSON.stringify(e.effect.args), 400)} />
        </div>
      );
    }
    case 'agent.final':
      return (
        <div className="ev rounded-md bg-ink-800 border border-ink-600 px-3 py-2 text-[13px] text-slate-200 whitespace-pre-wrap">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">final answer</div>
          <Highlight text={e.text} />
          {e.strippedUrls?.length ? <div className="mt-2 text-[11px] text-emerald-300 font-mono">Warden stripped {e.strippedUrls.length} exfiltration URL(s): {e.strippedUrls.map((u) => short(u, 80)).join(', ')}</div> : null}
        </div>
      );
    default: return null;
  }
}

const verdictTone = { allow: 'green', sanitize: 'amber', quarantine: 'red', block: 'red', ask_human: 'amber' } as const;

function Ingress({ d, runId, assets }: { d: IngressDecision; runId: string; assets?: string[] }) {
  const boxes = d.findings.flatMap((f) => f.boxes ?? []);
  const clean = d.verdict === 'allow' && !d.findings.length;
  return (
    <div className={`ev ml-4 rounded-md border px-3 py-2 ${clean ? 'border-ink-700 bg-ink-900/50' : d.verdict === 'quarantine' ? 'border-red-500/50 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex items-center gap-2 text-[11px]">
        <Shield /><span className="text-slate-300 font-medium">Warden ingress</span>
        <Pill tone={verdictTone[d.verdict]}>{d.verdict}</Pill>
        <span className="font-mono text-slate-500 truncate">{d.source}</span>
        <Timings t={d.timings} />
      </div>
      {d.findings.length > 0 && <Findings f={d.findings} />}
      {boxes.length > 0 && assets?.[0] && <BoxedImage src={`/api/assets/${runId}/${assets[0]}`} boxes={boxes} />}
    </div>
  );
}

function Egress({ d, approvalId }: { d: EgressDecision; approvalId?: string }) {
  const [done, setDone] = useState<boolean | null>(null);
  return (
    <div className={`ev ml-4 rounded-md border px-3 py-2 ${d.verdict === 'allow' ? 'border-ink-700 bg-ink-900/50' : d.verdict === 'block' ? 'border-red-500/50 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex items-center gap-2 text-[11px]">
        <Shield /><span className="text-slate-300 font-medium">Warden egress</span>
        <Pill tone={verdictTone[d.verdict]}>{d.verdict === 'ask_human' ? 'held for human' : d.verdict}</Pill>
        <span className="font-mono text-slate-400">{d.tool}</span>
        <Timings t={d.timings} />
      </div>
      {d.judge && <div className="mt-1 text-[12px] text-slate-300"><span className="text-slate-500">judge ({d.judge.risk} risk): </span>{d.judge.reason}</div>}
      {d.findings.length > 0 && <Findings f={d.findings} />}
      {approvalId && done === null && d.verdict === 'ask_human' && (
        <div className="mt-2 flex gap-2">
          <Btn onClick={async () => { await postJSON(`/api/approval/${approvalId}`, { approved: true }); setDone(true); }}>Approve</Btn>
          <Btn onClick={async () => { await postJSON(`/api/approval/${approvalId}`, { approved: false }); setDone(false); }} primary>Deny</Btn>
        </div>
      )}
    </div>
  );
}

function Findings({ f }: { f: Finding[] }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {f.map((x, i) => (
        <li key={i} className="text-[12px] flex gap-2">
          <span className={`font-mono text-[10px] uppercase px-1.5 rounded h-fit mt-0.5 ${x.severity === 'high' ? 'bg-red-500/20 text-red-300' : x.severity === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-500/20 text-slate-300'}`}>{x.layer}</span>
          <span className="text-slate-300">{x.reason}{x.quote && <span className="block font-mono text-[11px] text-red-200/80 mt-0.5">“{short(x.quote, 180)}”</span>}</span>
        </li>
      ))}
    </ul>
  );
}

function BoxedImage({ src, boxes }: { src: string; boxes: Finding['boxes'] & {} }) {
  return (
    <div className="mt-2 relative inline-block">
      <img src={src} className="max-h-72 rounded border border-ink-600" />
      {boxes.map((b, i) => (
        <div key={i} className="absolute border-2 border-red-500 bg-red-500/15 rounded-sm" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
          <span className="absolute -top-4 left-0 text-[9px] font-mono bg-red-500 text-white px-1 rounded-sm whitespace-nowrap">SAM 3.1 · {b.label ?? 'payload'}</span>
        </div>
      ))}
    </div>
  );
}

function Timings({ t }: { t: { layer: string; ms: number; model?: string }[] }) {
  return (
    <span className="ml-auto flex gap-1 shrink-0">
      {t.map((x, i) => <span key={i} title={x.model} className="font-mono text-[10px] text-slate-500 bg-ink-800 rounded px-1">{x.layer} {Math.round(x.ms)}ms</span>)}
    </span>
  );
}

function Harden({ store }: { store: ReturnType<typeof useWarden>['store'] }) {
  const [busy, setBusy] = useState(false);
  const rounds = [...store.rounds].sort((a, b) => a.round - b.round);
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[1fr_420px]">
      <div className="overflow-y-auto p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-white font-medium">Self-hardening loop</div>
            <div className="text-xs text-slate-400">Red team invents attacks → bypasses are replayed → blue team proposes a rule → rule ships only if replay proves it blocks the bypass with zero benign regressions.</div>
          </div>
          <Btn primary disabled={busy} onClick={async () => { setBusy(true); await postJSON('/api/harden', { rounds: 3, perRound: 4 }); setBusy(false); }}>Run 3 rounds</Btn>
        </div>
        <AsrCurve rounds={rounds} />
        {rounds.map((r) => (
          <div key={r.round} className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-white font-medium">Round {r.round}</span>
              <Pill tone="slate">{r.generated.length} new attacks</Pill>
              <Pill tone={r.bypasses.length ? 'red' : 'green'}>{r.bypasses.length} bypassed</Pill>
              <span className="ml-auto font-mono text-xs text-slate-400">ASR {pct(r.asrBefore)} → <span className="text-emerald-300">{pct(r.asrAfter)}</span> · policy v{r.policyVersionAfter}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {r.proposed.map((p, i) => (
                <li key={i} className={`text-[12px] rounded border px-3 py-2 ${p.accepted ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-ink-600 bg-ink-800/60'}`}>
                  <div className="flex gap-2 items-center">
                    <Pill tone={p.accepted ? 'green' : 'slate'}>{p.accepted ? 'shipped' : 'rejected'}</Pill>
                    <span className="font-mono text-slate-400">{p.rule.kind}</span>
                    <span className="text-slate-500 truncate">from {p.rule.sourceScenarioId}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-200 mt-1 break-all">{p.rule.kind === 'regex' ? `/${p.rule.pattern}/` : p.rule.kind === 'judge_clause' ? p.rule.text : `${p.rule.action} ${JSON.stringify(p.rule.match)}`}</div>
                  <div className="text-slate-400 mt-1">{p.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <aside className="border-l border-ink-700 bg-ink-900 flex flex-col min-h-0">
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-ink-700">agent log</div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1">
          {store.hardenLog.map((l, i) => (
            <div key={i} className="ev"><span className={l.phase === 'red' ? 'text-red-300' : l.phase === 'blue' ? 'text-sky-300' : l.phase === 'verify' ? 'text-emerald-300' : 'text-slate-400'}>[{l.phase}]</span> <span className="text-slate-300">{l.text}</span></div>
          ))}
        </div>
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-t border-ink-700">policy v{store.policy?.version ?? 0} · {store.policy?.rules.length ?? 0} learned rules</div>
      </aside>
    </div>
  );
}

function AsrCurve({ rounds }: { rounds: { round: number; asrBefore: number; asrAfter: number }[] }) {
  if (!rounds.length) return <div className="rounded-lg border border-dashed border-ink-600 p-6 text-sm text-slate-500 text-center">No rounds yet.</div>;
  const W = 600, H = 120, n = rounds.length;
  const x = (i: number) => 30 + (i * (W - 60)) / Math.max(1, n - 1);
  const y = (v: number) => 10 + (1 - v) * (H - 30);
  const path = (k: 'asrBefore' | 'asrAfter') => rounds.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[k])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl">
      <path d={path('asrBefore')} stroke="#f87171" fill="none" strokeWidth="2" />
      <path d={path('asrAfter')} stroke="#34d399" fill="none" strokeWidth="2" />
      {rounds.map((r, i) => <text key={i} x={x(i)} y={H - 4} fontSize="10" fill="#64748b" textAnchor="middle">R{r.round}</text>)}
      <text x={W - 30} y={y(rounds[n - 1].asrBefore) - 4} fontSize="10" fill="#f87171" textAnchor="end">new-attack ASR before patch</text>
      <text x={W - 30} y={y(rounds[n - 1].asrAfter) + 12} fontSize="10" fill="#34d399" textAnchor="end">after verified patch</text>
    </svg>
  );
}

function Bench({ reports }: { reports: BenchReport[] }) {
  const [busy, setBusy] = useState(false);
  const latest = (m: WardenMode) => [...reports].filter((r) => r.mode === m).sort((a, b) => b.createdAt - a.createdAt)[0];
  const off = latest('off'), on = latest('enforce');
  const vectors = Array.from(new Set([...Object.keys(off?.attacks.byVector ?? {}), ...Object.keys(on?.attacks.byVector ?? {})]));
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="text-white font-medium">Benchmark · same agent, same corpus</div>
        <div className="ml-auto flex gap-2">
          {(['off', 'enforce'] as const).map((m) => <Btn key={m} disabled={busy} primary={m === 'enforce'} onClick={async () => { setBusy(true); await postJSON('/api/bench', { mode: m }); setBusy(false); }}>Run {m === 'off' ? 'unprotected' : 'with Warden'}</Btn>)}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Big label="attack success, unprotected" v={off ? pct(off.attacks.asr) : '–'} tone="red" />
        <Big label="attack success, Warden" v={on ? pct(on.attacks.asr) : '–'} tone="green" />
        <Big label="benign utility, Warden" v={on ? pct(on.benign.utility) : '–'} tone="sky" />
        <Big label="median Warden latency" v={on ? `${Math.round(on.medianWardenMs)}ms` : '–'} tone="slate" />
      </div>
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">attack success by vector</div>
      <div className="space-y-2 max-w-3xl">
        {vectors.map((v) => {
          const a = off?.attacks.byVector[v], b = on?.attacks.byVector[v];
          return (
            <div key={v} className="grid grid-cols-[110px_1fr_1fr] gap-3 items-center text-sm">
              <span className="text-slate-300">{v}</span>
              <Bar frac={a ? a.succeeded / a.total : 0} label={a ? `${a.succeeded}/${a.total}` : '–'} color="bg-red-500/70" />
              <Bar frac={b ? b.succeeded / b.total : 0} label={b ? `${b.succeeded}/${b.total}` : '–'} color="bg-emerald-500/70" />
            </div>
          );
        })}
      </div>
      {on && <div className="mt-6 text-xs text-slate-500 font-mono">provider {on.provider} · policy v{on.policyVersion} · {on.modelCalls} model calls · {new Date(on.createdAt).toLocaleString()}</div>}
    </div>
  );
}

function Big({ label, v, tone }: { label: string; v: string; tone: 'red' | 'green' | 'sky' | 'slate' }) {
  const c = { red: 'text-red-400', green: 'text-emerald-400', sky: 'text-sky-300', slate: 'text-slate-200' }[tone];
  return <div className="rounded-lg border border-ink-700 bg-ink-900 p-4"><div className={`text-4xl font-semibold ${c}`}>{v}</div><div className="text-xs text-slate-400 mt-1">{label}</div></div>;
}
function Bar({ frac, label, color }: { frac: number; label: string; color: string }) {
  return <div className="h-6 bg-ink-800 rounded relative overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.max(frac * 100, 1)}%` }} /><span className="absolute inset-0 flex items-center px-2 text-[11px] font-mono text-white">{label}</span></div>;
}

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(WRDN-CANARY-[A-Z_]+-[0-9a-f]{8})/g);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="bg-red-500/30 text-red-200 rounded px-0.5">{p}</mark> : <span key={i}>{p}</span>))}</>;
}
function Pill({ children, tone }: { children: React.ReactNode; tone: 'green' | 'red' | 'amber' | 'slate' }) {
  const c = { green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', red: 'bg-red-500/15 text-red-300 border-red-500/40', amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30', slate: 'bg-ink-800 text-slate-300 border-ink-600' }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide whitespace-nowrap ${c}`}>{children}</span>;
}
function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={`px-3 py-1.5 rounded-md text-sm disabled:opacity-40 ${primary ? 'bg-emerald-500 text-ink-950 font-medium hover:bg-emerald-400' : 'bg-ink-700 text-slate-200 hover:bg-ink-600'}`}>{children}</button>;
}
function Shield() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></svg>; }
function Logo() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" fill="#10b98122" stroke="#34d399" strokeWidth="1.8" /><path d="M8 12l3 3 5-6" stroke="#34d399" strokeWidth="2" /></svg>; }
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
const pct = (v: number) => `${Math.round(v * 100)}%`;

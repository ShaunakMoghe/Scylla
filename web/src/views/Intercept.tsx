import { useEffect, useMemo, useState } from 'react';
import type { WardenEvent, Scenario, WardenMode, RunResult, Finding } from '../../../src/shared/types';
import { getJSON, postJSON, type useWarden } from '../api';
import { LinkGraph, collectCalls, isLeak, type CallInfo } from '../graph';
import { Panel, Tag, Btn, KV, Glyph, vectorGlyph, toolGlyph, short, unfence, clock, hash, Highlight, type Tone } from '../ui';

type RunEnd = Omit<RunResult, 'trace'>;
type Props = ReturnType<typeof useWarden>;

export function Intercept({ store, run, waitEnd }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sel, setSel] = useState('a-image-receipt-override');
  const [pair, setPair] = useState<{ off?: string; on?: string }>({});
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<{ runId: string; callId?: string } | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => { getJSON<Scenario[]>('/api/scenarios').then((s) => s && setScenarios(s)); }, [store.policy?.version]);
  const scenario = scenarios.find((s) => s.id === sel);

  const go = async (modes: WardenMode[]) => {
    setBusy(true); setPair({}); setFocus(null);
    for (const m of modes) {
      const id = await run(sel, m);
      if (!id) continue;
      setPair((p) => (m === 'off' ? { ...p, off: id } : { ...p, on: id }));
      setFocus({ runId: id });
      await waitEnd(id);
    }
    setBusy(false);
  };

  const lanes = [pair.off && { id: pair.off, label: 'SUBJECT A · UNPROTECTED' }, pair.on && { id: pair.on, label: 'SUBJECT B · BEHIND WARDEN' }].filter(Boolean) as { id: string; label: string }[];

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[250px_1fr_340px] gap-px bg-g-700">
      <Targets scenarios={scenarios} sel={sel} setSel={(s) => { setSel(s); setPair({}); setFocus(null); }} q={q} setQ={setQ} />
      <div className="min-h-0 min-w-0 flex flex-col bg-g-950">
        <div className="shrink-0 bg-g-900 border-b border-g-700 px-3 py-2 flex items-start gap-3">
          <div className="w-9 h-9 grid place-items-center border border-g-600 shrink-0" style={{ color: scenario?.type === 'benign' ? '#3d9df3' : '#ff4d4d' }}>
            <Glyph kind={scenario?.type === 'benign' ? 'user' : vectorGlyph(scenario?.vector)} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-g-400">{scenario ? `TGT-${hash(scenario.id).slice(0, 6)}` : ''}</span>
              <span className="text-g-100 font-medium truncate">{scenario?.title ?? sel}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {scenario?.type === 'attack' ? <>
                <Tag tone="hostile">hostile</Tag><Tag>{scenario.vector}</Tag><Tag>{scenario.technique}</Tag>
                {scenario.origin === 'redteam' && <Tag tone="intel">red team R{scenario.round}</Tag>}
                <span className="font-mono text-[10.5px] text-g-300 truncate">OBJECTIVE · {scenario.goal?.description}</span>
              </> : scenario ? <><Tag tone="friendly">benign</Tag><span className="font-mono text-[10.5px] text-g-300">MUST COMPLETE WITHOUT FRICTION</span></> : null}
            </div>
            <div className="font-mono text-[11px] text-g-200 mt-1.5 truncate"><span className="text-g-500">TASKING ▸ </span>“{scenario?.task}”</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Btn primary disabled={busy} onClick={() => go(['off', 'enforce'])}>▶ Compare</Btn>
            <Btn disabled={busy} onClick={() => go(['enforce'])}>Enforce</Btn>
            <Btn disabled={busy} onClick={() => go(['shadow'])}>Shadow</Btn>
          </div>
        </div>
        {lanes.length === 0 ? (
          <div className="flex-1 grid place-items-center grid-bg">
            <div className="text-center">
              <div className="label mb-2">No active tasking</div>
              <div className="font-mono text-[11px] text-g-400 max-w-sm">Run COMPARE to execute the same task on the same agent and world, once exposed and once behind Warden.</div>
            </div>
          </div>
        ) : (
          <div className={`flex-1 min-h-0 grid ${lanes.length === 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-px bg-g-700`}>
            {lanes.map((l) => (
              <Lane key={l.id} label={l.label} runId={l.id} events={store.runs[l.id] ?? []} scenario={scenario}
                focus={focus?.runId === l.id ? focus.callId : undefined} onFocus={(callId) => setFocus({ runId: l.id, callId })} active={focus?.runId === l.id} />
            ))}
          </div>
        )}
      </div>
      <Inspector focus={focus} events={focus ? store.runs[focus.runId] ?? [] : []} scenario={scenario} />
    </div>
  );
}

function Targets({ scenarios, sel, setSel, q, setQ }: { scenarios: Scenario[]; sel: string; setSel: (s: string) => void; q: string; setQ: (s: string) => void }) {
  const groups = useMemo(() => {
    const g: Record<string, Scenario[]> = {};
    for (const s of scenarios) if (!q || `${s.title} ${s.id} ${s.technique}`.toLowerCase().includes(q.toLowerCase())) (g[s.type === 'benign' ? 'benign' : s.vector ?? 'other'] ??= []).push(s);
    return Object.entries(g).sort(([a], [b]) => (a === 'benign' ? 1 : b === 'benign' ? -1 : a.localeCompare(b)));
  }, [scenarios, q]);
  return (
    <Panel title="Target packages" right={<span className="font-mono text-[10px] text-g-400">{scenarios.length}</span>} bodyClass="flex flex-col">
      <div className="p-2 border-b border-g-700">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SEARCH OBJECTS…" className="w-full h-7 px-2 bg-g-950 border border-g-600 font-mono text-[11px] text-g-100 placeholder:text-g-500 outline-none focus:border-friendly" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.map(([g, list]) => (
          <div key={g}>
            <div className="sticky top-0 bg-g-850 px-2.5 h-6 flex items-center gap-2 border-b border-g-700">
              <Glyph kind={g === 'benign' ? 'user' : vectorGlyph(g)} size={11} color={g === 'benign' ? '#3d9df3' : '#ff4d4d'} />
              <span className="label">{g === 'benign' ? 'benign tasks' : `${g} vector`}</span>
              <span className="ml-auto font-mono text-[10px] text-g-500">{list.length}</span>
            </div>
            {list.map((s) => (
              <button key={s.id} onClick={() => setSel(s.id)}
                className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 border-l-2 ${sel === s.id ? 'border-friendly bg-friendly/10' : 'border-transparent hover:bg-g-800'}`}>
                <span className={`w-1.5 h-1.5 shrink-0 ${s.type === 'benign' ? 'bg-friendly' : s.origin === 'redteam' ? 'bg-intel' : 'bg-hostile'}`} />
                <span className="min-w-0">
                  <span className={`block truncate text-[12px] ${sel === s.id ? 'text-g-100' : 'text-g-200'}`}>{s.title}</span>
                  <span className="block font-mono text-[9.5px] text-g-500 truncate">{s.id}</span>
                </span>
                {s.origin === 'redteam' && <span className="ml-auto font-mono text-[9px] text-intel">R{s.round}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function outcome(end: RunEnd | undefined, scenario?: Scenario): { text: string; tone: Tone } | null {
  if (!end) return null;
  if (scenario?.type === 'benign') return end.success && !end.falsePositive ? { text: 'task completed', tone: 'clear' } : { text: 'false positive', tone: 'hostile' };
  return end.success ? { text: 'compromised', tone: 'hostile' } : { text: 'attack stopped', tone: 'clear' };
}

function Lane({ label, runId, events, scenario, focus, onFocus, active }: { label: string; runId: string; events: WardenEvent[]; scenario?: Scenario; focus?: string; onFocus: (c?: string) => void; active: boolean }) {
  const start = events.find((e) => e.type === 'run.start') as Extract<WardenEvent, { type: 'run.start' }> | undefined;
  const end = (events.find((e) => e.type === 'run.end') as Extract<WardenEvent, { type: 'run.end' }> | undefined)?.result;
  const o = outcome(end, scenario);
  useEffect(() => { document.getElementById(`feed-end-${runId}`)?.scrollIntoView({ block: 'end' }); }, [events.length, runId]);
  return (
    <div className={`min-h-0 min-w-0 flex flex-col bg-g-900 ${active ? 'outline outline-1 outline-friendly/40 -outline-offset-1' : ''}`}>
      <header className="h-7 shrink-0 flex items-center gap-2 px-2.5 border-b border-g-700 bg-g-850">
        <span className={`w-1 h-3 ${start?.mode === 'off' ? 'bg-hostile' : 'bg-clear'}`} />
        <span className="label text-g-200">{label}</span>
        {start && <Tag tone={start.mode === 'off' ? 'hostile' : start.mode === 'shadow' ? 'caution' : 'clear'}>{start.mode === 'off' ? 'no firewall' : start.mode}</Tag>}
        <span className="ml-auto">{o ? <Tag tone={o.tone} solid>{o.text}</Tag> : <span className="font-mono text-[10px] text-caution blink">● EXECUTING</span>}</span>
      </header>
      <div className="shrink-0 h-[44%] min-h-[200px] border-b border-g-700 bg-g-950" onClick={() => onFocus(undefined)}>
        <LinkGraph events={events} mode={start?.mode} selected={focus} onSelect={onFocus} />
      </div>
      <div className="h-6 shrink-0 flex items-center px-2.5 border-b border-g-700 bg-g-850">
        <span className="label">Activity feed</span>
        {end && <span className="ml-auto font-mono text-[9.5px] text-g-400">STEPS {end.steps} · CALLS {end.modelCalls} · BLOCKED {end.blockedCalls} · FLAGS {end.ingressFlags} · WARDEN {Math.round(end.wardenMs)}MS</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px]">
        {events.map((e, i) => <FeedRow key={i} e={e} onFocus={onFocus} focus={focus} t0={start?.ts ?? e.ts} />)}
        <div id={`feed-end-${runId}`} />
      </div>
    </div>
  );
}

function FeedRow({ e, onFocus, focus, t0 }: { e: WardenEvent; onFocus: (c?: string) => void; focus?: string; t0: number }) {
  const t = `+${((e.ts - t0) / 1000).toFixed(2)}s`;
  const row = (tone: Tone | 'text', tag: string, body: React.ReactNode, callId?: string) => (
    <div onClick={() => callId && onFocus(callId)}
      className={`ev grid grid-cols-[52px_74px_1fr] gap-2 px-2.5 py-[3px] border-b border-g-800 ${callId ? 'cursor-pointer hover:bg-g-800' : ''} ${callId && focus === callId ? 'bg-friendly/10' : ''}`}>
      <span className="text-g-500">{t}</span>
      <span className={tone === 'text' ? 'text-g-300' : { friendly: 'text-friendly', hostile: 'text-hostile', caution: 'text-caution', clear: 'text-clear', intel: 'text-intel', muted: 'text-g-400' }[tone]}>{tag}</span>
      <span className="min-w-0 break-all text-g-200">{body}</span>
    </div>
  );
  switch (e.type) {
    case 'run.start': return row('friendly', 'TASKING', <span className="text-g-100">{e.task}</span>);
    case 'agent.thought': return e.text.trim() ? row('muted', 'REASON', <span className="italic text-g-300">{short(e.text, 260)}</span>) : null;
    case 'agent.tool_call': return row('intel', 'CALL', <>{e.tool}<span className="text-g-400">({short(JSON.stringify(e.args), 110)})</span></>, e.callId);
    case 'tool.result': return row('muted', 'RESULT', <span className="text-g-400">{short(unfence(e.preview), 140)}</span>, e.callId);
    case 'warden.ingress': {
      const d = e.decision; const tone: Tone = d.verdict === 'quarantine' ? 'hostile' : d.verdict === 'sanitize' || d.findings.length ? 'caution' : 'clear';
      return row(tone, `IN·${d.verdict.toUpperCase().slice(0, 6)}`, <>{d.source}{d.findings.length ? <span className="text-g-400"> — {d.findings.map((f) => f.layer).join(', ')}</span> : null}</>, e.callId);
    }
    case 'warden.egress': {
      const d = e.decision; const tone: Tone = d.verdict === 'block' ? 'hostile' : d.verdict === 'ask_human' ? 'caution' : 'clear';
      return row(tone, `OUT·${d.verdict === 'ask_human' ? 'HOLD' : d.verdict.toUpperCase()}`, <>{d.tool}{d.judge ? <span className="text-g-400"> — {short(d.judge.reason, 120)}</span> : null}</>, e.callId);
    }
    case 'approval.resolved': return row(e.approved ? 'caution' : 'clear', 'OPERATOR', e.approved ? 'approved held call' : 'denied held call');
    case 'world.side_effect': {
      const leak = !e.effect.blocked && e.effect.external;
      return row(e.effect.blocked ? 'muted' : leak ? 'hostile' : 'friendly', e.effect.blocked ? 'NULLIFIED' : leak ? 'EXFIL' : 'EFFECT', <span className={e.effect.blocked ? 'line-through text-g-500' : ''}><Highlight text={`${e.effect.tool} ${short(JSON.stringify(e.effect.args), 200)}`} /></span>);
    }
    case 'agent.final': return row('friendly', 'FINAL', <><Highlight text={short(e.text, 400)} />{e.strippedUrls?.length ? <span className="text-clear"> [stripped {e.strippedUrls.length} exfil url]</span> : null}</>);
    case 'run.end': return row('muted', 'END', `run complete · success=${e.result.success}`);
    default: return null;
  }
}

function Inspector({ focus, events, scenario }: { focus: { runId: string; callId?: string } | null; events: WardenEvent[]; scenario?: Scenario }) {
  const calls = useMemo(() => collectCalls(events), [events]);
  const call = calls.find((c) => c.callId === focus?.callId);
  const start = events.find((e) => e.type === 'run.start') as Extract<WardenEvent, { type: 'run.start' }> | undefined;
  const end = (events.find((e) => e.type === 'run.end') as Extract<WardenEvent, { type: 'run.end' }> | undefined)?.result;
  const final = events.find((e) => e.type === 'agent.final') as Extract<WardenEvent, { type: 'agent.final' }> | undefined;
  return (
    <Panel title="Inspector" right={call ? <Tag tone="friendly">object</Tag> : start ? <Tag>run</Tag> : null} bodyClass="overflow-y-auto">
      {!focus ? <div className="p-4 font-mono text-[11px] text-g-500">Select a node or feed entry to inspect it.</div>
        : call ? <CallDetail call={call} runId={focus.runId} />
        : start ? (
          <div className="p-3 space-y-3">
            <div>
              <div className="label mb-1.5">Run</div>
              <KV k="run id" v={start.runId.slice(0, 8)} />
              <KV k="mode" v={start.mode} tone={start.mode === 'off' ? 'hostile' : 'clear'} />
              <KV k="provider" v={start.provider} />
              <KV k="policy" v={`v${start.policyVersion}`} tone="friendly" />
              <KV k="started" v={`${clock(start.ts)}Z`} />
            </div>
            {end && (
              <div>
                <div className="label mb-1.5">Assessment</div>
                {(() => { const o = outcome(end, scenario); return o ? <div className="mb-2"><Tag tone={o.tone} solid>{o.text}</Tag></div> : null; })()}
                <KV k="steps" v={end.steps} /><KV k="model calls" v={end.modelCalls} /><KV k="blocked" v={end.blockedCalls} tone={end.blockedCalls ? 'clear' : undefined} />
                <KV k="held" v={end.heldCalls} /><KV k="ingress flags" v={end.ingressFlags} /><KV k="warden time" v={`${Math.round(end.wardenMs)} ms`} />
              </div>
            )}
            <div>
              <div className="label mb-1.5">Objects</div>
              {calls.map((c) => (
                <div key={c.callId} className="flex items-center gap-2 py-1 border-b border-g-800 font-mono text-[11px]">
                  <Glyph kind={toolGlyph(c.tool)} size={12} color={isLeak(c) ? '#ff4d4d' : '#7f8b97'} />
                  <span className="text-g-200">{c.tool}</span>
                  <span className="ml-auto text-g-500">{c.ingress?.verdict ?? c.egress?.verdict ?? (c.effect ? 'executed' : '')}</span>
                </div>
              ))}
            </div>
            {final && (
              <div>
                <div className="label mb-1.5">Final answer</div>
                <div className="font-mono text-[11px] text-g-200 whitespace-pre-wrap break-words bg-g-950 border border-g-700 p-2"><Highlight text={final.text} /></div>
              </div>
            )}
          </div>
        ) : null}
    </Panel>
  );
}

function CallDetail({ call, runId }: { call: CallInfo; runId: string }) {
  const [done, setDone] = useState<boolean | null>(null);
  const boxes = call.ingress?.findings.flatMap((f) => f.boxes ?? []) ?? [];
  const assets = call.assetIds ?? [];
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 grid place-items-center border border-g-600"><Glyph kind={toolGlyph(call.tool)} size={16} color="#3d9df3" /></div>
        <div>
          <div className="font-mono text-[12px] text-g-100">{call.tool}</div>
          <div className="font-mono text-[9.5px] text-g-500">{call.kind === 'read' ? 'INGRESS OBJECT' : 'EGRESS ACTION'} · {call.callId.slice(0, 10)}</div>
        </div>
      </div>
      <div>
        <div className="label mb-1">Arguments</div>
        {Object.entries(call.args).map(([k, v]) => <KV key={k} k={k} v={<Highlight text={short(typeof v === 'string' ? v : JSON.stringify(v), 300)} />} />)}
      </div>
      {call.ingress && (
        <div>
          <div className="label mb-1 flex items-center gap-2">Ingress decision <Tag tone={call.ingress.verdict === 'quarantine' ? 'hostile' : call.ingress.verdict === 'sanitize' ? 'caution' : 'clear'}>{call.ingress.verdict}</Tag></div>
          <KV k="source" v={call.ingress.source} /><KV k="trust" v={call.ingress.trust} tone={call.ingress.trust === 'untrusted' ? 'caution' : undefined} />
          <Findings f={call.ingress.findings} />
          <Timings t={call.ingress.timings} />
        </div>
      )}
      {assets.length > 0 && call.tool === 'read_attachment' && (
        <div>
          <div className="label mb-1">Imagery {boxes.length ? '· SAM 3.1 segmentation' : ''}</div>
          <div className="relative inline-block border border-g-600">
            <img src={`/api/assets/${runId}/${assets[0]}`} className="block max-w-full" />
            {boxes.map((b, i) => (
              <div key={i} className="absolute border border-hostile bg-hostile/15" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                <span className="absolute -top-3.5 left-0 font-mono text-[8.5px] bg-hostile text-g-950 px-1 whitespace-nowrap">{short(b.label ?? 'payload', 24)}</span>
              </div>
            ))}
          </div>
          {assets.length > 1 && <>
            <div className="label mt-2 mb-1 text-clear">Delivered to agent · redacted</div>
            <img src={`/api/assets/${runId}/${assets[assets.length - 1]}`} className="block max-w-full border border-clear/50" />
          </>}
        </div>
      )}
      {call.preview && (
        <div>
          <div className="label mb-1">{call.ingress && call.ingress.verdict !== 'allow' ? 'Content delivered to agent' : 'Content'}</div>
          <div className="font-mono text-[10.5px] text-g-300 whitespace-pre-wrap break-words bg-g-950 border border-g-700 p-2 max-h-56 overflow-y-auto">{unfence(call.preview)}</div>
        </div>
      )}
      {call.egress && (
        <div>
          <div className="label mb-1 flex items-center gap-2">Egress decision <Tag tone={call.egress.verdict === 'block' ? 'hostile' : call.egress.verdict === 'ask_human' ? 'caution' : 'clear'}>{call.egress.verdict === 'ask_human' ? 'held' : call.egress.verdict}</Tag></div>
          {call.egress.judge && <div className="bg-g-950 border border-g-700 p-2 mb-1.5">
            <div className="font-mono text-[9.5px] text-g-400 mb-0.5">MUSE SPARK JUDGE · {call.egress.judge.aligned ? 'ALIGNED' : 'MISALIGNED'} · RISK {call.egress.judge.risk.toUpperCase()}</div>
            <div className="text-[12px] text-g-100">{call.egress.judge.reason}</div>
          </div>}
          <Findings f={call.egress.findings} />
          <Timings t={call.egress.timings} />
          {call.approvalId && call.egress.verdict === 'ask_human' && done === null && (
            <div className="mt-2 flex gap-1.5">
              <Btn onClick={async () => { await postJSON(`/api/approval/${call.approvalId}`, { approved: false }); setDone(false); }} primary>Deny</Btn>
              <Btn danger onClick={async () => { await postJSON(`/api/approval/${call.approvalId}`, { approved: true }); setDone(true); }}>Approve</Btn>
            </div>
          )}
        </div>
      )}
      {call.effect && (
        <div>
          <div className="label mb-1">Side effect</div>
          <div className={`font-mono text-[10.5px] p-2 border ${call.effect.blocked ? 'border-g-600 text-g-500 line-through' : isLeak(call) ? 'border-hostile/60 bg-hostile/10 text-hostile' : 'border-g-600 text-g-200'}`}>
            {call.effect.blocked ? 'NULLIFIED' : call.effect.external ? 'EXTERNAL' : 'INTERNAL'} · <Highlight text={short(JSON.stringify(call.effect.args), 400)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Findings({ f }: { f: Finding[] }) {
  if (!f.length) return <div className="font-mono text-[10.5px] text-g-500 mt-1">no findings</div>;
  return (
    <div className="mt-1.5 space-y-1.5">
      {f.map((x, i) => (
        <div key={i} className="border-l-2 pl-2" style={{ borderColor: x.severity === 'high' ? '#ff4d4d' : x.severity === 'medium' ? '#f2a93b' : '#56626f' }}>
          <div className="flex items-center gap-1.5"><Tag tone={x.severity === 'high' ? 'hostile' : x.severity === 'medium' ? 'caution' : 'muted'}>{x.layer}</Tag>{x.ruleId && <span className="font-mono text-[9.5px] text-intel">{x.ruleId}</span>}{x.confidence !== undefined && <span className="font-mono text-[9.5px] text-g-500">conf {x.confidence.toFixed(2)}</span>}</div>
          <div className="text-[11.5px] text-g-200 mt-0.5">{x.reason}</div>
          {x.quote && <div className="font-mono text-[10px] text-hostile/90 mt-0.5 break-all">“{short(x.quote, 200)}”</div>}
        </div>
      ))}
    </div>
  );
}

function Timings({ t }: { t: { layer: string; ms: number; model?: string }[] }) {
  if (!t.length) return null;
  const total = t.reduce((a, x) => a + x.ms, 0) || 1;
  return (
    <div className="mt-2">
      <div className="flex h-1.5 bg-g-800">{t.map((x, i) => <div key={i} title={`${x.layer} ${Math.round(x.ms)}ms`} style={{ width: `${(x.ms / total) * 100}%`, background: ['#3d9df3', '#a77bf3', '#35c48a', '#f2a93b', '#ff4d4d', '#7f8b97'][i % 6] }} />)}</div>
      <div className="flex flex-wrap gap-x-2 mt-1 font-mono text-[9.5px] text-g-400">{t.map((x, i) => <span key={i} title={x.model}>{x.layer} {x.ms < 1 ? '<1' : Math.round(x.ms)}ms</span>)}</div>
    </div>
  );
}

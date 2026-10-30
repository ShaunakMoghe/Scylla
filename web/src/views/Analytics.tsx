import { useState } from 'react';
import type { BenchReport, ScyllaMode } from '../../../src/shared/types';
import { postJSON } from '../api';
import { Panel, Tag, Btn, Kpi, pct, Glyph, vectorGlyph } from '../ui';

export function Analytics({ reports }: { reports: BenchReport[] }) {
  const [busy, setBusy] = useState(false);
  const latest = (m: ScyllaMode) => [...reports].filter((r) => r.mode === m).sort((a, b) => b.createdAt - a.createdAt)[0];
  const off = latest('off'), on = latest('enforce');
  const vectors = Array.from(new Set([...Object.keys(off?.attacks.byVector ?? {}), ...Object.keys(on?.attacks.byVector ?? {})])).sort();
  const ids = Array.from(new Set([...(off?.results ?? []), ...(on?.results ?? [])].map((r) => r.scenarioId)));
  const res = (r: BenchReport | undefined, id: string) => r?.results.find((x) => x.scenarioId === id);
  const ms = (v?: number) => (v === undefined ? '—' : v < 1 ? '<1ms' : `${Math.round(v)}ms`);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 bg-black border-b border-g-750 px-5 py-4 flex items-center gap-4">
        <div>
          <div className="text-g-100 text-[15px] font-medium tracking-[-.01em]">Benchmark · same agent, same corpus</div>
          <div className="text-[12px] text-g-400 mt-0.5 flex items-center gap-2">
            <span>{on ? `Latest · ${on.provider} provider · policy v${on.policyVersion} · ${on.modelCalls} model calls · ${new Date(on.createdAt).toISOString().slice(0, 16).replace('T', ' ')}Z` : 'No reports'}</span>
            {on && <Tag>{on.profile ?? 'standard'} profile</Tag>}
          </div>
        </div>
        <div className="ml-auto flex gap-1.5">
          <Btn danger disabled={busy} onClick={async () => { setBusy(true); await postJSON('/api/bench', { mode: 'off' }); setBusy(false); }}>Run unprotected</Btn>
          <Btn primary disabled={busy} onClick={async () => { setBusy(true); await postJSON('/api/bench', { mode: 'enforce' }); setBusy(false); }}>Run with Scylla</Btn>
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-5 gap-px bg-g-700 border-b border-g-750">
        <Kpi label="attack success · unprotected" value={off ? pct(off.attacks.asr) : '—'} tone="hostile" sub={off ? `${off.attacks.succeeded}/${off.attacks.total} compromised` : undefined} />
        <Kpi label="attack success · scylla" value={on ? pct(on.attacks.asr) : '—'} tone="clear" sub={on ? `${on.attacks.succeeded}/${on.attacks.total} compromised` : undefined} />
        <Kpi label="benign utility · scylla" value={on ? pct(on.benign.utility) : '—'} tone="friendly" sub={on ? `${on.benign.passed}/${on.benign.total} completed · ${on.benign.falsePositives} FP` : undefined} />
        <Kpi label="ingress friction" value={on ? String(on.benign.ingressFlags) : '—'} tone="caution" sub="flags on benign runs" />
        <Kpi label="median scylla latency" value={ms(on?.medianScyllaMs)} tone="muted" />
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[400px_1fr] gap-px bg-g-700">
        <Panel title="Threat matrix · vector × posture" bodyClass="p-3 overflow-y-auto">
          <div className="grid grid-cols-[120px_1fr_1fr] gap-px bg-g-700 border border-g-750 font-mono text-[11px]">
            <div className="bg-black px-2 py-1.5 label">vector</div>
            <div className="bg-black px-2 py-1.5 label text-hostile">unprotected</div>
            <div className="bg-black px-2 py-1.5 label text-clear">scylla</div>
            {vectors.map((v) => {
              const a = off?.attacks.byVector[v], b = on?.attacks.byVector[v];
              return [
                <div key={`${v}-l`} className="bg-black px-2 py-2 flex items-center gap-2 text-g-200"><Glyph kind={vectorGlyph(v)} size={12} color="#8a8a8a" />{v}</div>,
                <Cell key={`${v}-a`} n={a?.succeeded} d={a?.total} />,
                <Cell key={`${v}-b`} n={b?.succeeded} d={b?.total} />,
              ];
            })}
          </div>
          <div className="mt-3 font-mono text-[10px] text-g-500">Cell = attacks that achieved their objective / attacks on that vector. Intensity scales with success rate.</div>
        </Panel>
        <Panel title="Scenario results" right={<span className="font-mono text-[10px] text-g-400">{ids.length}</span>} bodyClass="overflow-y-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-black"><tr className="text-left">{['SCENARIO', 'TYPE', 'UNPROTECTED', 'SCYLLA', 'BLOCKED', 'FLAGS', 'SCYLLA MS'].map((h) => <th key={h} className="label px-2.5 py-1.5 border-b border-g-750 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {ids.map((id) => {
                const a = res(off, id), b = res(on, id), benign = id.startsWith('b-');
                const tag = (r?: typeof a) => !r ? <span className="text-g-600">—</span> : benign ? <Tag tone={r.success && !r.falsePositive ? 'clear' : 'hostile'}>{r.success && !r.falsePositive ? 'done' : 'blocked'}</Tag> : <Tag tone={r.success ? 'hostile' : 'clear'}>{r.success ? 'compromised' : 'stopped'}</Tag>;
                return (
                  <tr key={id} className="border-b border-white/[.04] hover:bg-white/[.03]/60">
                    <td className="px-2.5 py-1 text-g-200">{id}</td>
                    <td className="px-2.5 py-1"><span className={benign ? 'text-friendly' : 'text-hostile'}>{benign ? 'BENIGN' : 'ATTACK'}</span></td>
                    <td className="px-2.5 py-1">{tag(a)}</td>
                    <td className="px-2.5 py-1">{tag(b)}</td>
                    <td className="px-2.5 py-1 text-g-300">{b?.blockedCalls ?? '—'}</td>
                    <td className="px-2.5 py-1 text-g-300">{b?.ingressFlags ?? '—'}</td>
                    <td className="px-2.5 py-1 text-g-400">{ms(b?.scyllaMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

function Cell({ n, d }: { n?: number; d?: number }) {
  if (n === undefined || !d) return <div className="bg-black px-2 py-2 text-g-600">—</div>;
  const f = n / d;
  return (
    <div className="px-2 py-2 flex items-center justify-between" style={{ background: f ? `rgba(255,95,86,${0.12 + f * 0.5})` : 'rgba(63,207,142,.10)' }}>
      <span className={f ? 'text-g-100' : 'text-clear'}>{n}/{d}</span>
      <span className={f ? 'text-hostile' : 'text-clear'}>{pct(f)}</span>
    </div>
  );
}

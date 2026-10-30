import { useEffect, useState } from 'react';
import { postJSON, type Store } from '../api';
import { Panel, Tag, Btn, Kpi, pct, clock, short } from '../ui';

export function Campaign({ store }: { store: Store }) {
  const [busy, setBusy] = useState(false);
  const rounds = [...store.rounds].sort((a, b) => a.round - b.round);
  const generated = rounds.reduce((a, r) => a + r.generated.length, 0);
  const bypasses = rounds.reduce((a, r) => a + r.bypasses.length, 0);
  const proposals = rounds.flatMap((r) => r.proposed.map((p) => ({ ...p, round: r.round })));
  const shipped = proposals.filter((p) => p.accepted).length;
  const regress = rounds.reduce((a, r) => a + r.benignRegressions, 0);
  useEffect(() => { document.getElementById('oplog-end')?.scrollIntoView({ block: 'end' }); }, [store.hardenLog.length]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 bg-black border-b border-g-750 px-5 py-4 flex items-center gap-4">
        <div>
          <div className="text-g-100 text-[15px] font-medium tracking-[-.01em]">Self-hardening campaign</div>
          <div className="text-[12px] text-g-400 mt-0.5">Red team generates attacks, bypasses are replayed, blue team proposes a rule. A rule ships only if replay blocks the bypass with zero benign regressions.</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {store.status?.busy && <span className="text-[11.5px] text-g-300">Campaign running…</span>}
          <Btn primary disabled={busy || store.status?.busy} onClick={async () => { setBusy(true); await postJSON('/api/harden', { rounds: 3, perRound: 4 }); setBusy(false); }}>Launch 3 rounds</Btn>
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-6 gap-px bg-g-700 border-b border-g-750">
        <Kpi label="rounds" value={String(rounds.length)} tone="friendly" />
        <Kpi label="attacks generated" value={String(generated)} tone="intel" sub="muse spark red team" />
        <Kpi label="bypasses found" value={String(bypasses)} tone="hostile" />
        <Kpi label="rules shipped" value={String(shipped)} tone="clear" sub={`${proposals.length - shipped} rejected`} />
        <Kpi label="benign regressions" value={String(regress)} tone={regress ? 'hostile' : 'clear'} />
        <Kpi label="policy" value={`v${store.policy?.version ?? 0}`} tone="friendly" sub={`${store.policy?.rules.length ?? 0} learned rules`} />
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_380px] gap-px bg-g-700">
        <div className="min-h-0 grid grid-rows-[230px_1fr] gap-px bg-g-700">
          <Panel title="Attack success rate · per round" right={<><Legend c="#ff5f56" t="before patch" /><Legend c="#3fcf8e" t="after verified patch" /></>}>
            <AsrChart rounds={rounds} />
          </Panel>
          <Panel title="Rule ledger" right={<span className="font-mono text-[10px] text-g-400">{proposals.length} proposals</span>} bodyClass="overflow-y-auto">
            {proposals.length === 0 ? <div className="p-4 font-mono text-[11px] text-g-500">No proposals yet. Launch a campaign.</div> : (
              <table className="w-full font-mono text-[11px]">
                <thead className="sticky top-0 bg-black">
                  <tr className="text-left">{['RND', 'STATUS', 'KIND', 'RULE', 'SOURCE', 'VERIFIER'].map((h) => <th key={h} className="label px-2.5 py-1.5 border-b border-g-750 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {proposals.map((p, i) => (
                    <tr key={i} className="border-b border-white/[.04] align-top hover:bg-white/[.03]/60">
                      <td className="px-2.5 py-1.5 text-g-400">R{p.round}</td>
                      <td className="px-2.5 py-1.5"><Tag tone={p.accepted ? 'clear' : 'hostile'}>{p.accepted ? 'shipped' : 'rejected'}</Tag></td>
                      <td className="px-2.5 py-1.5 text-intel">{p.rule.kind}</td>
                      <td className="px-2.5 py-1.5 text-g-100 break-all max-w-[340px]">{p.rule.kind === 'regex' ? `/${p.rule.pattern}/` : p.rule.kind === 'judge_clause' ? p.rule.text : `${p.rule.action} ${JSON.stringify(p.rule.match)}`}</td>
                      <td className="px-2.5 py-1.5 text-g-400">{p.rule.sourceScenarioId}</td>
                      <td className="px-2.5 py-1.5 text-g-300 font-sans text-[11.5px]">{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <Panel title="Operations log" right={<span className="font-mono text-[10px] text-g-400">{store.hardenLog.length}</span>} bodyClass="overflow-y-auto">
          <div className="font-mono text-[10.5px]">
            {store.hardenLog.length === 0 && <div className="p-4 text-g-500">Awaiting campaign.</div>}
            {store.hardenLog.map((l, i) => (
              <div key={i} className="ev grid grid-cols-[66px_44px_1fr] gap-1.5 px-2.5 py-[3px] border-b border-white/[.04]">
                <span className="text-g-500">{clock(l.ts).slice(0, 8)}</span>
                <span className={{ red: 'text-hostile', blue: 'text-friendly', verify: 'text-clear', run: 'text-g-300' }[l.phase]}>{l.phase.toUpperCase()}</span>
                <span className="text-g-200 break-words">{short(l.text, 400)}</span>
              </div>
            ))}
            <div id="oplog-end" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="flex items-center gap-1 font-mono text-[9.5px] text-g-400"><span className="w-2 h-2" style={{ background: c }} />{t}</span>;
}

function AsrChart({ rounds }: { rounds: Store['rounds'] }) {
  if (!rounds.length) return <div className="h-full grid place-items-center grid-bg text-[12.5px] text-g-400">No rounds yet</div>;
  const W = 700, H = 190, L = 40, B = 26, T = 14;
  const n = Math.max(rounds.length, 3), slot = (W - L - 10) / n, ph = H - B - T;
  const y = (v: number) => T + ph * (1 - v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} stroke="#1a1a1a" />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" fill="#5c5c5c" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }}>{v * 100}%</text>
        </g>
      ))}
      {rounds.map((r, i) => {
        const cx = L + slot * i + slot / 2, bw = Math.min(34, slot / 4);
        return (
          <g key={r.round}>
            <rect x={cx - bw - 3} y={y(r.asrBefore)} width={bw} height={Math.max(ph * r.asrBefore, 1.5)} fill="#ff5f56" opacity={0.85} />
            <rect x={cx + 3} y={y(r.asrAfter)} width={bw} height={Math.max(ph * r.asrAfter, 1.5)} fill="#3fcf8e" opacity={0.9} />
            <text x={cx - bw / 2 - 3} y={y(r.asrBefore) - 4} textAnchor="middle" fill="#ff5f56" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}>{pct(r.asrBefore)}</text>
            <text x={cx + bw / 2 + 3} y={y(r.asrAfter) - 4} textAnchor="middle" fill="#3fcf8e" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}>{pct(r.asrAfter)}</text>
            <text x={cx} y={H - 10} textAnchor="middle" fill="#b4b4b4" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}>ROUND {r.round} · {r.generated.length} ATK · → v{r.policyVersionAfter}</text>
          </g>
        );
      })}
    </svg>
  );
}

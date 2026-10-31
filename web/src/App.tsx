import { useEffect, useRef, useState } from 'react';
import { pilot, sleep } from './pilot';
import { useScylla } from './api';
import { Glyph, clock } from './ui';
import { Intercept } from './views/Intercept';
import { Campaign } from './views/Campaign';
import { Analytics } from './views/Analytics';
import { Research } from './views/Research';

type View = 'intercept' | 'campaign' | 'analytics' | 'research';
const NAV: { id: View; glyph: 'intercept' | 'campaign' | 'analytics' | 'policy'; label: string; hint: string }[] = [
  { id: 'intercept', glyph: 'intercept', label: 'Intercept', hint: 'Live run: unprotected vs Scylla' },
  { id: 'campaign', glyph: 'campaign', label: 'Red / Blue', hint: 'Self-hardening campaign' },
  { id: 'analytics', glyph: 'analytics', label: 'Analytics', hint: 'Benchmark' },
  { id: 'research', glyph: 'policy', label: 'Research', hint: 'Adaptive attack search + layer ablation' },
];

const DEMO_SEARCH = 'search-1793328232992/a-payment-redirect-n5';
type Step = { view: View; caption: string; act?: () => Promise<void> | void; dwell: number };
const SCRIPT: Step[] = [
  { view: 'intercept', caption: 'An attacker hid instructions inside an invoice image. Same agent, same inbox: unprotected on the left, behind Scylla on the right.', act: () => pilot.emit('intercept.compare', 'a-image-receipt-override'), dwell: 3500 },
  { view: 'intercept', caption: 'Unprotected, the agent obeys the image. Behind Scylla, vision catches the injected text before the agent ever reads it, so nothing leaves the sandbox.', dwell: 8000 },
  { view: 'analytics', caption: 'Across 28 scenarios on the deliberately gullible mock agent: 18/18 attacks land unprotected, 0/18 behind Scylla, 10/10 benign tasks still complete.', dwell: 8000 },
  { view: 'research', caption: 'Live on Muse Spark: an adaptive attacker rewrote the invoice until the unprotected agent paid an attacker-controlled account.', act: () => pilot.emit('research.select', DEMO_SEARCH), dwell: 8500 },
  { view: 'research', caption: 'Replaying that exact payment through Scylla: the account and SWIFT code trace back to the untrusted attachment, so the payment is held for a human. No model calls.', act: () => pilot.emit('research.replay'), dwell: 10000 },
  { view: 'research', caption: 'Scylla: a self-hardening firewall for AI agents.', dwell: 4000 },
];

export default function App() {
  const scylla = useScylla();
  const { store } = scylla;
  const [view, setView] = useState<View>('intercept');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const [caption, setCaption] = useState<{ i: number; text: string } | null>(null);
  const stop = useRef(false);
  const autopilot = async () => {
    stop.current = false;
    for (let i = 0; i < SCRIPT.length && !stop.current; i++) {
      const step = SCRIPT[i]!;
      setView(step.view); setCaption({ i, text: step.caption });
      await sleep(600);
      if (stop.current) break;
      await step.act?.();
      await sleep(step.dwell);
    }
    setCaption(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { stop.current = true; setCaption(null); } };
    window.addEventListener('keydown', key);
    if (new URLSearchParams(location.search).has('autopilot')) setTimeout(autopilot, 1500);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const st = store.status;
  const live = st?.provider === 'live';

  return (
    <div className="h-full flex flex-col bg-black">
      <header className="h-12 shrink-0 flex items-center gap-4 px-4 border-b border-g-750">
        <div className="flex items-center gap-2.5">
          <Glyph kind="shield" size={16} color="#ececec" />
          <span className="font-sans font-semibold text-[14px] tracking-[-.01em] text-g-100">Scylla</span>
          <span className="font-sans text-[12px] text-g-400">Agent firewall</span>
        </div>
        <div className="h-4 w-px bg-g-600" />
        <div className="font-sans text-[12px] flex items-center gap-2">
          <span className="text-g-400">northwind-ops</span>
          <span className="text-g-500">/</span><span className="text-g-100">{NAV.find((n) => n.id === view)?.label}</span>
        </div>
        <div className="ml-auto flex items-center gap-5 font-sans text-[11.5px]">
          <button onClick={() => (caption ? (stop.current = true, setCaption(null)) : autopilot())} disabled={!caption && !!st?.busy}
            className="h-7 px-3 rounded-md border border-g-600 text-g-100 hover:bg-g-800 disabled:opacity-35">{caption ? 'Stop autopilot' : 'Demo autopilot'}</button>
          <Stat k="Provider" v={live ? 'Meta Model API' : 'Mock'} c={live ? 'text-clear' : 'text-caution'} />
          <Stat k="Guard" v={st?.guardBackend ?? '—'} />
          <Stat k="Policy" v={st ? `v${st.policyVersion}` : '—'} />
          <Stat k="Calls" v={st ? `${st.modelCalls} / ${st.callCap}` : '—'} />
          <div className="flex items-center gap-1.5 pl-1">
            <span className={`w-1.5 h-1.5 rounded-full ${store.connected ? 'bg-clear' : 'bg-hostile blink'}`} />
            <span className="text-g-300">{store.connected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex">
        <nav className="w-[64px] shrink-0 border-r border-g-750 bg-black flex flex-col items-center py-3 gap-1.5">
          {NAV.map((n) => (
            <button key={n.id} title={n.hint} onClick={() => setView(n.id)}
              className={`w-[52px] h-[52px] rounded-lg flex flex-col items-center justify-center gap-1.5 transition-colors ${view === n.id ? 'bg-white/[.07] text-g-100' : 'text-g-400 hover:text-g-100 hover:bg-white/[.03]'}`}>
              <Glyph kind={n.glyph} size={16} />
              <span className="font-sans text-[9.5px]">{n.label}</span>
            </button>
          ))}
        </nav>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          {view === 'intercept' && <Intercept {...scylla} />}
          {view === 'campaign' && <Campaign store={store} />}
          {view === 'analytics' && <Analytics reports={store.reports} />}
          {view === 'research' && <Research store={store} />}
        </main>
      </div>
      {caption && (
        <div className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-6">
          <div className="max-w-[760px] rounded-xl bg-black/90 border border-g-600 px-5 py-3 shadow-[0_12px_40px_rgba(0,0,0,.8)]">
            <div className="flex items-center gap-2 text-[10.5px] text-g-400 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-clear" />Autopilot · {caption.i + 1}/{SCRIPT.length}<span className="ml-auto">Esc to stop</span>
            </div>
            <div className="text-[14px] leading-snug text-g-100">{caption.text}</div>
          </div>
        </div>
      )}
      <footer className="h-7 shrink-0 flex items-center gap-5 px-4 border-t border-g-750 bg-black font-mono text-[10.5px] text-g-500">
        <span>{st ? Array.from(new Set(Object.values(st.models))).join(' · ') : '—'}</span>
        <span>Sandbox · fictional entities · no real side effects</span>
        <span className="ml-auto">{st?.busy ? <span className="text-caution">Running…</span> : 'Idle'}</span>
        <span>{clock(now).slice(0, 8)}Z</span>
      </footer>
    </div>
  );
}

function Stat({ k, v, c = 'text-g-200' }: { k: string; v: string; c?: string }) {
  return <span className="flex items-center gap-1.5"><span className="text-g-500">{k}</span><span className={c}>{v}</span></span>;
}

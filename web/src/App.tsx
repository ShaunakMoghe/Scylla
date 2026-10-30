import { useEffect, useState } from 'react';
import { useWarden } from './api';
import { Glyph, clock } from './ui';
import { Intercept } from './views/Intercept';
import { Campaign } from './views/Campaign';
import { Analytics } from './views/Analytics';

type View = 'intercept' | 'campaign' | 'analytics';
const NAV: { id: View; glyph: 'intercept' | 'campaign' | 'analytics'; label: string; hint: string }[] = [
  { id: 'intercept', glyph: 'intercept', label: 'Intercept', hint: 'Live run: unprotected vs Warden' },
  { id: 'campaign', glyph: 'campaign', label: 'Red / Blue', hint: 'Self-hardening campaign' },
  { id: 'analytics', glyph: 'analytics', label: 'Analytics', hint: 'Benchmark' },
];

export default function App() {
  const warden = useWarden();
  const { store } = warden;
  const [view, setView] = useState<View>('intercept');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const st = store.status;
  const live = st?.provider === 'live';

  return (
    <div className="h-full flex flex-col bg-g-950">
      <div className="h-[18px] shrink-0 flex items-center justify-center bg-clear/15 border-b border-clear/30 font-mono text-[9.5px] tracking-[.3em] text-clear">
        SANDBOX // FICTIONAL ENTITIES // NORTHWIND.EXAMPLE // NO REAL SIDE EFFECTS
      </div>
      <header className="h-11 shrink-0 flex items-center gap-3 px-3 border-b border-g-700 bg-g-900">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 grid place-items-center border border-clear/60 bg-clear/10"><Glyph kind="shield" size={15} color="#35c48a" /></div>
          <div className="leading-none">
            <div className="font-cond font-semibold tracking-[.28em] text-[13px] text-g-100">WARDEN</div>
            <div className="font-mono text-[9px] tracking-[.18em] text-g-400 mt-1">AGENT FIREWALL CONSOLE</div>
          </div>
        </div>
        <div className="h-6 w-px bg-g-700 mx-2" />
        <div className="font-mono text-[11px] text-g-300 flex items-center gap-2">
          <span className="text-g-500">WORKSPACE</span><span className="text-g-100">northwind-ops</span>
          <span className="text-g-600">/</span><span className="text-g-100">{NAV.find((n) => n.id === view)?.label.toUpperCase()}</span>
        </div>
        <div className="ml-auto flex items-center gap-4 font-mono text-[10.5px]">
          <Stat k="PROVIDER" v={live ? 'META MODEL API' : 'MOCK'} c={live ? 'text-clear' : 'text-caution'} />
          <Stat k="GUARD" v={st?.guardBackend ?? '—'} />
          <Stat k="POLICY" v={st ? `v${st.policyVersion}` : '—'} c="text-friendly" />
          <Stat k="CALLS" v={st ? `${st.modelCalls}/${st.callCap}` : '—'} />
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 ${store.connected ? 'bg-clear' : 'bg-hostile blink'}`} />
            <span className={store.connected ? 'text-clear' : 'text-hostile'}>{store.connected ? 'LINK UP' : 'NO LINK'}</span>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex">
        <nav className="w-[52px] shrink-0 border-r border-g-700 bg-g-900 flex flex-col items-center py-2 gap-1">
          {NAV.map((n) => (
            <button key={n.id} title={n.hint} onClick={() => setView(n.id)}
              className={`w-11 h-12 flex flex-col items-center justify-center gap-1 border-l-2 ${view === n.id ? 'border-friendly bg-friendly/10 text-friendly' : 'border-transparent text-g-400 hover:text-g-100 hover:bg-g-800'}`}>
              <Glyph kind={n.glyph} size={17} />
              <span className="font-cond text-[8.5px] tracking-[.08em] uppercase">{n.label}</span>
            </button>
          ))}
        </nav>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          {view === 'intercept' && <Intercept {...warden} />}
          {view === 'campaign' && <Campaign store={store} />}
          {view === 'analytics' && <Analytics reports={store.reports} />}
        </main>
      </div>
      <footer className="h-5 shrink-0 flex items-center gap-4 px-3 border-t border-g-700 bg-g-900 font-mono text-[9.5px] text-g-400">
        <span>MODELS {st ? Array.from(new Set(Object.values(st.models))).join(' · ') : '—'}</span>
        <span className="ml-auto">{st?.busy ? <span className="text-caution blink">● TASKING IN PROGRESS</span> : 'IDLE'}</span>
        <span>{clock(now).slice(0, 8)}Z</span>
      </footer>
    </div>
  );
}

function Stat({ k, v, c = 'text-g-100' }: { k: string; v: string; c?: string }) {
  return <span className="flex items-center gap-1.5"><span className="text-g-500">{k}</span><span className={`${c} uppercase`}>{v}</span></span>;
}

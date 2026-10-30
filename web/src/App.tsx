import { useEffect, useState } from 'react';
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

export default function App() {
  const scylla = useScylla();
  const { store } = scylla;
  const [view, setView] = useState<View>('intercept');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
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

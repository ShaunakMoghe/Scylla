import type { ReactNode } from 'react';

export type Tone = 'friendly' | 'hostile' | 'caution' | 'clear' | 'intel' | 'muted';
export const toneText: Record<Tone, string> = { friendly: 'text-friendly', hostile: 'text-hostile', caution: 'text-caution', clear: 'text-clear', intel: 'text-intel', muted: 'text-g-300' };
export const toneHex: Record<Tone, string> = { friendly: '#7aa2ff', hostile: '#ff5f56', caution: '#e5a443', clear: '#3fcf8e', intel: '#a58bff', muted: '#5c5c5c' };

export function Panel({ title, right, children, className = '', bodyClass = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`flex flex-col min-h-0 bg-black ${className}`}>
      {title !== undefined && (
        <header className="flex items-center gap-2 h-9 px-4 border-b border-g-750 shrink-0">
          <span className="label !text-g-300">{title}</span>
          <div className="ml-auto flex items-center gap-1.5">{right}</div>
        </header>
      )}
      <div className={`flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Tag({ children, tone = 'muted', solid }: { children: ReactNode; tone?: Tone; solid?: boolean }) {
  const hex = toneHex[tone];
  return (
    <span className="inline-flex items-center h-[18px] px-1.5 rounded-[3px] font-mono text-[10px] uppercase tracking-[.04em] whitespace-nowrap"
      style={solid ? { background: hex, color: '#000000' } : { color: tone === 'muted' ? '#9a9a9a' : hex, background: tone === 'muted' ? 'rgba(255,255,255,.05)' : `${hex}1a` }}>
      {children}
    </span>
  );
}

export function Btn({ children, onClick, disabled, primary, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const c = primary ? 'bg-g-100 text-black border-g-100 hover:bg-white' : danger ? 'border-hostile/35 text-hostile hover:bg-hostile/10' : 'border-g-600 text-g-100 hover:bg-g-800';
  return (
    <button onClick={onClick} disabled={disabled} className={`h-7 px-3 rounded-md border font-sans text-[12px] font-medium disabled:opacity-35 disabled:cursor-not-allowed ${c}`}>
      {children}
    </button>
  );
}

export function Kpi({ label, value, sub, tone = 'muted' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="bg-black px-5 py-4">
      <div className="label flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full" style={{ background: toneHex[tone] }} />{label}</div>
      <div className={`font-sans font-light text-[26px] leading-8 mt-1.5 tracking-tight ${tone === 'muted' || tone === 'intel' || tone === 'friendly' ? 'text-g-100' : toneText[tone]}`}>{value}</div>
      {sub && <div className="font-mono text-[10.5px] text-g-400 mt-1">{sub}</div>}
    </div>
  );
}

export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[11px] leading-5">
      <span className="text-g-400 w-24 shrink-0 uppercase text-[10px] tracking-wider">{k}</span>
      <span className={`min-w-0 break-all ${tone ? toneText[tone] : 'text-g-100'}`}>{v}</span>
    </div>
  );
}

export function Glyph({ kind, size = 14, color = 'currentColor' }: { kind: 'shield' | 'intercept' | 'campaign' | 'analytics' | 'policy' | 'email' | 'web' | 'image' | 'file' | 'voice' | 'agent' | 'user' | 'send' | 'pay' | 'calendar' | 'delete' | 'post' | 'globe'; size?: number; color?: string }) {
  const p: Record<string, ReactNode> = {
    shield: <path d="M12 2l8 3.5v6c0 5-3.4 9-8 10.5C7.4 20.5 4 16.5 4 11.5v-6L12 2z" />,
    intercept: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v5M12 18v5M1 12h5M18 12h5" /></>,
    campaign: <><path d="M4 20l5-6 4 3 7-9" /><path d="M15 8h5v5" /></>,
    analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    policy: <><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5M9 13h8M9 17h6" /></>,
    email: <><rect x="3" y="5" width="18" height="14" /><path d="M3 6l9 7 9-7" /></>,
    web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></>,
    image: <><rect x="3" y="4" width="18" height="16" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></>,
    file: <><path d="M6 2h8l5 5v15H6z" /><path d="M14 2v5h5" /></>,
    voice: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v4" /></>,
    agent: <><rect x="4" y="7" width="16" height="12" /><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5" /></>,
    send: <path d="M3 11l18-8-8 18-2-8-8-2z" />,
    post: <><path d="M12 19V5M5 12l7-7 7 7" /></>,
    pay: <><rect x="2" y="6" width="20" height="13" /><path d="M2 10h20M6 15h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
    delete: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="square">{p[kind]}</svg>;
}

export const toolGlyph = (tool: string): Parameters<typeof Glyph>[0]['kind'] =>
  ({ list_emails: 'email', read_email: 'email', read_attachment: 'image', http_get: 'web', read_file: 'file', list_files: 'file', list_voicemails: 'voice', transcribe_voicemail: 'voice', send_email: 'send', http_post: 'post', delete_file: 'delete', pay_invoice: 'pay', create_calendar_event: 'calendar' } as const)[tool] ?? 'file';

export const vectorGlyph = (v?: string): Parameters<typeof Glyph>[0]['kind'] =>
  ({ email: 'email', web: 'web', image: 'image', file: 'file', voice: 'voice', tool: 'agent' } as const)[v as 'email'] ?? 'file';

export const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
export const unfence = (s: string) => s.replace(/<untrusted-data[^>]*>\n?/g, '').replace(/\n?<\/untrusted-data>/g, '').trim();
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const clock = (ts: number) => new Date(ts).toISOString().slice(11, 23);
export const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).toUpperCase().padStart(8, '0'); };

export function Highlight({ text }: { text: string }) {
  const parts = text.split(/(WRDN-CANARY-[A-Z_]+-[0-9a-f]{8})/g);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="bg-hostile/25 text-hostile px-0.5">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

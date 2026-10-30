import { useMemo } from 'react';
import type { WardenEvent, IngressDecision, EgressDecision, SideEffect, WardenMode } from '../../src/shared/types';
import { Glyph, toolGlyph, toneHex, short, type Tone } from './ui';

const READS = new Set(['list_emails', 'read_email', 'read_attachment', 'http_get', 'read_file', 'list_files', 'list_voicemails', 'transcribe_voicemail']);
const CANARY = /WRDN-CANARY-[A-Z_]+-[0-9a-f]{8}/;

export interface CallInfo {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  kind: 'read' | 'action';
  ingress?: IngressDecision;
  egress?: EgressDecision;
  approvalId?: string;
  effect?: SideEffect;
  preview?: string;
  assetIds?: string[];
  ts: number;
}

export function collectCalls(events: WardenEvent[]): CallInfo[] {
  const calls = new Map<string, CallInfo>();
  let lastAction: CallInfo | undefined;
  for (const e of events) {
    if (e.type === 'agent.tool_call') {
      const c: CallInfo = { callId: e.callId, tool: e.tool, args: e.args, kind: READS.has(e.tool) ? 'read' : 'action', ts: e.ts };
      calls.set(e.callId, c);
      if (c.kind === 'action') lastAction = c;
    } else if (e.type === 'tool.result') {
      const c = calls.get(e.callId);
      if (c) { c.preview = e.preview; c.assetIds = e.assetIds; }
    } else if (e.type === 'warden.ingress') {
      const c = calls.get(e.callId);
      if (c) c.ingress = e.decision;
    } else if (e.type === 'warden.egress') {
      const c = calls.get(e.callId);
      if (c) { c.egress = e.decision; c.approvalId = e.approvalId; }
    } else if (e.type === 'world.side_effect') {
      const c = [...calls.values()].reverse().find((x) => x.kind === 'action' && x.tool === e.effect.tool && !x.effect) ?? lastAction;
      if (c) c.effect = e.effect;
    }
  }
  return [...calls.values()];
}

export const isLeak = (c: CallInfo) => !!c.effect && !c.effect.blocked && (c.effect.external || CANARY.test(JSON.stringify(c.effect.args)));

export function readTone(c: CallInfo, mode?: WardenMode): Tone {
  if (!c.ingress || mode === 'off') return 'muted';
  if (c.ingress.verdict === 'quarantine') return 'hostile';
  if (c.ingress.verdict === 'sanitize') return 'caution';
  return c.ingress.findings.length ? 'caution' : 'friendly';
}
export function actionTone(c: CallInfo): Tone {
  if (isLeak(c)) return 'hostile';
  if (c.egress?.verdict === 'block' || c.effect?.blocked) return 'clear';
  if (c.egress?.verdict === 'ask_human') return 'caution';
  return 'friendly';
}

function destOf(c: CallInfo): string {
  const a = c.args as Record<string, string>;
  const raw = a.to ?? a.url ?? a.payee ?? a.attendees ?? a.path ?? '';
  const s = Array.isArray(raw) ? raw.join(', ') : String(raw);
  try { if (s.startsWith('http')) return new URL(s).host; } catch { /* keep raw */ }
  return s;
}
function srcLabel(c: CallInfo): string {
  if (c.ingress?.source) return c.ingress.source.replace(/^(\w+):/, '$1 · ');
  const a = c.args as Record<string, string>;
  return String(a.id ?? a.url ?? a.path ?? a.name ?? '');
}

const W = 860, NW = 150, NH = 38;
const X = { src: 14, inWall: 228, agent: 355, outWall: 548, act: 590, dest: 760 };

export function LinkGraph({ events, mode, selected, onSelect }: { events: WardenEvent[]; mode?: WardenMode; selected?: string; onSelect: (callId?: string) => void }) {
  const calls = useMemo(() => collectCalls(events), [events]);
  const reads = calls.filter((c) => c.kind === 'read' && c.tool !== 'list_emails' && c.tool !== 'list_files' && c.tool !== 'list_voicemails');
  const acts = calls.filter((c) => c.kind === 'action');
  const rows = Math.max(reads.length, acts.length, 3);
  const H = rows * 54 + 46;
  const yAt = (i: number, n: number) => 40 + (H - 40) / 2 + (i - (n - 1) / 2) * 54;
  const agentY = 40 + (H - 40) / 2;
  const guarded = mode && mode !== 'off';
  const done = events.some((e) => e.type === 'run.end');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" onClick={() => onSelect(undefined)}>
      <defs>
        <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#26303d" /></pattern>
      </defs>
      <rect width={W} height={H} fill="url(#dots)" />
      {['SOURCES · UNTRUSTED', 'AGENT', 'ACTIONS', 'DESTINATION'].map((t, i) => (
        <text key={t} x={[X.src, X.agent - 20, X.act, X.dest][i]} y={18} className="label" fill="#56626f" style={{ fontSize: 9 }}>{t}</text>
      ))}
      {[X.inWall, X.outWall].map((x, i) => (
        <g key={x}>
          <line x1={x} y1={28} x2={x} y2={H - 8} stroke={guarded ? '#35c48a' : '#36414f'} strokeWidth={guarded ? 2 : 1} strokeDasharray={guarded ? '0' : '3 5'} opacity={guarded ? 0.7 : 1} />
          <rect x={x - 38} y={24} width={76} height={14} fill="#0b0e12" />
          <text x={x} y={34} textAnchor="middle" fill={guarded ? '#35c48a' : '#56626f'} style={{ fontSize: 8.5, letterSpacing: '.14em', fontFamily: 'IBM Plex Mono' }}>{guarded ? (i ? 'EGRESS ▣' : 'INGRESS ▣') : 'NO FIREWALL'}</text>
        </g>
      ))}

      {reads.map((c, i) => {
        const y = yAt(i, reads.length), tone = readTone(c, mode), col = toneHex[tone];
        const blockedAtWall = guarded && c.ingress?.verdict === 'quarantine';
        return (
          <g key={`e-${c.callId}`}>
            <path d={`M${X.src + NW} ${y} C ${X.inWall - 30} ${y}, ${X.inWall - 30} ${y}, ${X.inWall} ${y}`} stroke={col} strokeWidth={1.6} fill="none" className={done ? '' : 'flow'} />
            <path d={`M${X.inWall} ${y} C ${X.inWall + 60} ${y}, ${X.agent - 60} ${agentY}, ${X.agent} ${agentY}`} stroke={blockedAtWall ? '#36414f' : col} strokeWidth={1.4} fill="none" strokeDasharray={blockedAtWall ? '2 4' : undefined} />
            {guarded && c.ingress && c.ingress.verdict !== 'allow' && <WallMark x={X.inWall} y={y} tone={tone} glyph={c.ingress.verdict === 'quarantine' ? '✕' : '≈'} />}
          </g>
        );
      })}
      {acts.map((c, i) => {
        const y = yAt(i, acts.length), tone = actionTone(c), col = toneHex[tone];
        const stopped = c.egress?.verdict === 'block' || c.effect?.blocked || (c.egress?.verdict === 'ask_human' && !c.effect);
        return (
          <g key={`e-${c.callId}`}>
            <path d={`M${X.agent + 70} ${agentY} C ${X.outWall - 50} ${agentY}, ${X.outWall - 50} ${y}, ${X.outWall} ${y}`} stroke={stopped ? toneHex.hostile : col} strokeWidth={1.6} fill="none" opacity={0.9} />
            {!stopped && <line x1={X.outWall} y1={y} x2={X.act} y2={y} stroke={col} strokeWidth={1.6} />}
            {stopped && <WallMark x={X.outWall} y={y} tone={c.egress?.verdict === 'ask_human' ? 'caution' : 'hostile'} glyph={c.egress?.verdict === 'ask_human' ? 'Ⅱ' : '✕'} />}
            {c.effect && !c.effect.blocked && (
              <line x1={X.act + NW - 40} y1={y} x2={X.dest} y2={y} stroke={col} strokeWidth={isLeak(c) ? 2.4 : 1.4} className={isLeak(c) ? 'flow' : ''} />
            )}
          </g>
        );
      })}

      <Node x={X.agent - 20} y={agentY} w={110} tone={guarded ? 'clear' : 'friendly'} glyph="agent" title="MUSE SPARK" sub={guarded ? 'agent · protected' : 'agent · exposed'} />
      {reads.map((c, i) => (
        <Node key={c.callId} x={X.src} y={yAt(i, reads.length)} tone={readTone(c, mode)} glyph={toolGlyph(c.tool)} title={c.tool} sub={short(srcLabel(c), 22)}
          selected={selected === c.callId} onClick={() => onSelect(c.callId)} badge={c.ingress?.findings.length ? String(c.ingress.findings.length) : undefined} />
      ))}
      {acts.map((c, i) => {
        const y = yAt(i, acts.length), tone = actionTone(c);
        return (
          <g key={c.callId}>
            <Node x={X.act} y={y} w={NW - 40} tone={tone === 'clear' ? 'muted' : tone} glyph={toolGlyph(c.tool)} title={c.tool} sub={c.egress ? (c.egress.verdict === 'ask_human' ? 'held' : c.egress.verdict) : 'executed'}
              selected={selected === c.callId} onClick={() => onSelect(c.callId)} strike={tone === 'clear'} />
            {c.effect && !c.effect.blocked && (
              <g>
                {isLeak(c) && <circle cx={X.dest + 8} cy={y} r={6} fill="none" stroke={toneHex.hostile} className="ping" />}
                <rect x={X.dest} y={y - 13} width={92} height={26} fill="#0b0e12" stroke={toneHex[tone]} strokeWidth={1} />
                <text x={X.dest + 6} y={y - 2} fill={toneHex[tone]} style={{ fontSize: 8.5, fontFamily: 'IBM Plex Mono', letterSpacing: '.08em' }}>{isLeak(c) ? 'EXFIL ▲' : c.effect.external ? 'EXTERNAL' : 'INTERNAL'}</text>
                <text x={X.dest + 6} y={y + 9} fill="#a9b3bd" style={{ fontSize: 8.5, fontFamily: 'IBM Plex Mono' }}>{short(destOf(c), 15)}</text>
              </g>
            )}
          </g>
        );
      })}
      {!calls.length && <text x={W / 2} y={H - 18} textAnchor="middle" fill="#56626f" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono', letterSpacing: '.12em' }}>AWAITING TASKING</text>}
    </svg>
  );
}

function WallMark({ x, y, tone, glyph }: { x: number; y: number; tone: Tone; glyph: string }) {
  return (
    <g>
      <rect x={x - 9} y={y - 9} width={18} height={18} fill="#07090c" stroke={toneHex[tone]} strokeWidth={1.5} transform={`rotate(45 ${x} ${y})`} />
      <text x={x} y={y + 4} textAnchor="middle" fill={toneHex[tone]} style={{ fontSize: 11, fontWeight: 700 }}>{glyph}</text>
    </g>
  );
}

function Node({ x, y, w = NW, tone, glyph, title, sub, selected, onClick, badge, strike }: { x: number; y: number; w?: number; tone: Tone; glyph: Parameters<typeof Glyph>[0]['kind']; title: string; sub: string; selected?: boolean; onClick?: () => void; badge?: string; strike?: boolean }) {
  const col = toneHex[tone];
  return (
    <g transform={`translate(${x} ${y - NH / 2})`} onClick={(e) => { e.stopPropagation(); onClick?.(); }} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {selected && <rect x={-4} y={-4} width={w + 8} height={NH + 8} fill="none" stroke="#3d9df3" strokeWidth={1} strokeDasharray="3 2" />}
      <rect width={w} height={NH} fill="#0e1217" stroke={col} strokeWidth={1.2} />
      <rect width={NH} height={NH} fill={`${col}22`} />
      <g transform={`translate(${NH / 2 - 8} ${NH / 2 - 8})`}><Glyph kind={glyph} size={16} color={col} /></g>
      <text x={NH + 7} y={15} fill="#d3dae0" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono', textDecoration: strike ? 'line-through' : undefined }}>{short(title, Math.floor((w - NH - 10) / 6.2))}</text>
      <text x={NH + 7} y={28} fill={tone === 'muted' ? '#7f8b97' : col} style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }}>{short(sub, Math.floor((w - NH - 10) / 5.6))}</text>
      {badge && (
        <g transform={`translate(${w - 8} -6)`}>
          <rect width={14} height={14} fill={col} />
          <text x={7} y={10.5} textAnchor="middle" fill="#07090c" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono', fontWeight: 700 }}>{badge}</text>
        </g>
      )}
    </g>
  );
}

import type { Finding, Trust } from '../shared/types.js';

export function fence(text: string, source: string, trust: Trust, verdict: 'allow' | 'sanitize' | 'quarantine', findings: Finding[], mode: 'off' | 'shadow' | 'enforce'): string {
  let content = text;
  if (mode === 'enforce' && verdict === 'quarantine') {
    content = `[Warden quarantined this content: ${findings.map((finding) => finding.reason).join('; ')}]`;
  } else if (mode === 'enforce') {
    for (const finding of findings) {
      if (!finding.quote) continue;
      content = content.replace(finding.quote, `[REDACTED BY WARDEN: ${finding.ruleId ?? finding.layer}]`);
    }
  }
  const status = mode === 'off' ? 'off' : verdict === 'allow' ? 'checked' : verdict;
  return `<untrusted-data source="${source.replaceAll('"', '&quot;')}" trust="${trust}" warden="${status}">\n${content}\n</untrusted-data>`;
}

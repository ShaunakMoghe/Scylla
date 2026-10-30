import type { Box, Finding, IngressDecision, Layer, LayerTiming, PolicyVersion, Trust, World } from '../shared/types.js';
import type { ModelProvider, RenderedLine } from '../model/provider.js';
import { detectHeuristics } from './heuristics.js';
import { matchingRules } from './policy.js';
import { fence } from './fence.js';
import { splitVisionTiles } from './tiles.js';

export interface IngressInput {
  source: string;
  text: string;
  trust: Trust;
  mode: 'off' | 'shadow' | 'enforce';
  layers?: Layer[];
  provider: ModelProvider;
  policy: PolicyVersion;
  world?: World;
  image?: { data: Buffer; mime: string; lines?: RenderedLine[] };
  audio?: { data: Buffer; mime: string; hint?: string };
}

export async function inspectIngress(input: IngressInput): Promise<{ decision: IngressDecision; content: string }> {
  const findings: Finding[] = [];
  const timings: LayerTiming[] = [];
  let text = input.text;
  if (input.mode !== 'off') {
    let start = performance.now();
    if (enabled(input.layers, 'heuristic')) {
      const heuristicFindings = detectHeuristics(text);
      findings.push(...heuristicFindings);
      timings.push({ layer: 'heuristic', ms: performance.now() - start });
    }
    if (enabled(input.layers, 'learned')) {
      start = performance.now();
      const learned = matchingRules(input.policy.rules, 'ingress', text);
      findings.push(...learned.map((rule) => ({ layer: 'learned' as const, ruleId: rule.id, severity: rule.kind === 'regex' ? rule.severity : 'medium' as const, reason: rule.rationale, quote: text.match(new RegExp(rule.kind === 'regex' ? rule.pattern : '(?!x)x', rule.kind === 'regex' ? rule.flags ?? 'i' : ''))?.[0] })));
      timings.push({ layer: 'learned', ms: performance.now() - start });
    }
    if (enabled(input.layers, 'guard') && !(input.mode === 'enforce' && findings.some((finding) => finding.severity === 'high'))) {
      start = performance.now();
      const prompt = await input.provider.guard({ source: input.source, text, learnedClauses: input.policy.rules.filter((rule) => rule.kind === 'judge_clause').map((rule) => rule.text) });
      if (prompt.injection) findings.push(...prompt.spans.map((span) => ({ layer: 'guard' as const, severity: prompt.confidence >= 0.85 ? 'high' as const : 'medium' as const, reason: span.reason, quote: span.quote, confidence: prompt.confidence })));
      timings.push({ layer: 'guard', ms: performance.now() - start, model: input.provider.models.guard });
    }
    if (input.image && enabled(input.layers, 'vision')) {
      start = performance.now();
      const vision = await input.provider.vision({ source: input.source, image: input.image.data, mime: input.image.mime, renderedLines: input.image.lines });
      timings.push({ layer: 'vision', ms: performance.now() - start, model: input.provider.models.vision });
      if (vision.injection) {
        const quote = vision.instructions_to_ai[0] ?? vision.hidden_text ?? vision.visible_text;
        let boxes;
        if (vision.segment_prompt && enabled(input.layers, 'segment')) {
          start = performance.now();
          boxes = await input.provider.segment({ image: input.image.data, mime: input.image.mime, prompt: vision.segment_prompt, lines: input.image.lines });
          timings.push({ layer: 'segment', ms: performance.now() - start, model: input.provider.models.vision });
        }
        findings.push({ layer: 'vision', severity: vision.confidence >= 0.85 ? 'high' : 'medium', reason: 'Image contains text instructing the assistant.', quote, confidence: vision.confidence, boxes });
      } else if (visionTilesEnabled()) {
        const tiles = await splitVisionTiles(input.image.data, input.image.lines);
        const results = await Promise.all(tiles.map(async (tile) => {
          const tileStart = performance.now();
          const tileVision = await input.provider.vision({
            source: `${input.source}#tile${tile.index}`,
            image: tile.image,
            mime: 'image/png',
            renderedLines: tile.lines,
          });
          return { tile, vision: tileVision, ms: performance.now() - tileStart };
        }));
        for (const result of results) {
          timings.push({ layer: 'vision', ms: result.ms, model: input.provider.models.vision });
          if (!result.vision.injection) continue;
          const quote = result.vision.instructions_to_ai[0] ?? result.vision.hidden_text ?? result.vision.visible_text;
          const segmentStart = performance.now();
          let boxes: Box[] = [];
          if (enabled(input.layers, 'segment')) {
            boxes = await input.provider.segment({
              image: input.image.data,
              mime: input.image.mime,
              prompt: result.vision.segment_prompt,
              lines: input.image.lines,
            });
            timings.push({ layer: 'segment', ms: performance.now() - segmentStart, model: input.provider.models.vision });
          }
          if (!boxes.length) boxes = [{ ...result.tile.fullBox, label: `tile ${result.tile.index}/4` }];
          findings.push({
            layer: 'vision',
            severity: result.vision.confidence >= 0.85 ? 'high' : 'medium',
            reason: `Tiled vision scan (tile ${result.tile.index}/4) found text instructing the assistant.`,
            quote,
            confidence: result.vision.confidence,
            boxes,
          });
        }
      }
    }
    if (input.audio && enabled(input.layers, 'transcribe')) {
      start = performance.now();
      text = await input.provider.transcribe({ audio: input.audio.data, mime: input.audio.mime, hint: input.audio.hint });
      const transcribed = enabled(input.layers, 'heuristic') ? detectHeuristics(text) : [];
      const guardFindings = enabled(input.layers, 'guard')
        ? (await input.provider.guard({ source: input.source, text, learnedClauses: [] })).spans.map((span) => ({ layer: 'transcribe' as const, severity: 'high' as const, reason: span.reason, quote: span.quote }))
        : [];
      findings.push(...transcribed, ...guardFindings);
      timings.push({ layer: 'transcribe', ms: performance.now() - start, model: input.provider.models.vision });
    }
  }
  const effective = input.mode === 'off' ? [] : findings;
  const verdict = effective.some((finding) => finding.severity === 'high') ? 'quarantine' : effective.length ? 'sanitize' : 'allow';
  const decision: IngressDecision = {
    source: input.source,
    trust: input.trust,
    verdict,
    findings: effective,
    timings,
    sanitized: verdict === 'allow' ? undefined : fence(text, input.source, input.trust, verdict, effective, input.mode),
  };
  return { decision, content: fence(text, input.source, input.trust, verdict, effective, input.mode) };
}

function enabled(layers: Layer[] | undefined, layer: Layer): boolean {
  return layers === undefined || layers.includes(layer);
}

function visionTilesEnabled(): boolean {
  const configured = process.env.SCYLLA_VISION_TILES;
  if (configured === undefined || configured.trim() === '') return true;
  const count = Number(configured);
  return Number.isFinite(count) ? count > 0 : true;
}

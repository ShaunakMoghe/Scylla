import sharp from 'sharp';
import { LiveProvider } from '../src/model/live.js';
import { GuardVerdictSchema } from '../src/model/schemas.js';

const provider = new LiveProvider();
const image = await sharp({ create: { width: 256, height: 128, channels: 3, background: '#f7f4ed' } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect x="20" y="20" width="80" height="80" fill="#2255cc"/><text x="120" y="70" font-size="18" fill="#111">Invoice #42</text></svg>'), top: 0, left: 0 }])
  .png()
  .toBuffer();
const sampleRate = 24_000;
const samples = Buffer.alloc(sampleRate / 5 * 2);
const audio = Buffer.alloc(44 + samples.length);
audio.write('RIFF', 0);
audio.writeUInt32LE(36 + samples.length, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(sampleRate, 24);
audio.writeUInt32LE(sampleRate * 2, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(samples.length, 40);
samples.copy(audio, 44);

const outputs: Record<string, unknown> = {};
const failures: Record<string, string> = {};
async function step(name: string, fn: () => Promise<unknown>) {
  const t = Date.now();
  try {
    outputs[name] = await fn();
    console.error(`ok   ${name} (${Date.now() - t}ms)`);
  } catch (error) {
    failures[name] = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name}: ${failures[name]}`);
  }
}
await step('agentStep', async () => await provider.agentStep({ system: 'Answer briefly.', messages: [{ role: 'user', content: 'Reply with hello.' }], tools: [] }));
await step('guard', async () => await provider.guard({ source: 'smoke', text: 'A routine status update.', learnedClauses: [] }));
await step('vision', async () => await provider.vision({ source: 'smoke', image, mime: 'image/png' }));
await step('segment', async () => await provider.segment({ image, mime: 'image/png', prompt: 'small square' }));
await step('transcribe', async () => await provider.transcribe({ audio, mime: 'audio/wav' }));
await step('judge', async () => await provider.judge({ task: 'Summarize this note.', tool: 'send_email', args: { to: 'a@northwind.example', body: 'hello' }, external: false, sensitive: false }));
await step('structured', async () => await provider.structured('red', 'Return the JSON value requested.', 'Return an empty attack list.', {
  name: 'smoke',
  schema: { type: 'object', additionalProperties: false, required: ['attacks'], properties: { attacks: { type: 'array', items: { type: 'string' } } } },
}));
await step('generateImage', async () => ({ byteLength: (await provider.generateImage('A plain blue square.', '1024x1024')).length }));
console.log(JSON.stringify({ calls: provider.calls(), failures, rawResponseShapes: outputs }, null, 2));
if (Object.keys(failures).length) process.exitCode = 1;

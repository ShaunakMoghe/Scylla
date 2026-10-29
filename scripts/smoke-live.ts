import { LiveProvider } from '../src/model/live.js';
import { GuardVerdictSchema } from '../src/model/schemas.js';

const provider = new LiveProvider();
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6mcAAAAASUVORK5CYII=',
  'base64',
);
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
outputs.agentStep = await provider.agentStep({ system: 'Answer briefly.', messages: [{ role: 'user', content: 'Reply with hello.' }], tools: [] });
outputs.guard = await provider.guard({ source: 'smoke', text: 'A routine status update.', learnedClauses: [] });
outputs.vision = await provider.vision({ source: 'smoke', image, mime: 'image/png' });
outputs.segment = await provider.segment({ image, mime: 'image/png', prompt: 'small square' });
outputs.transcribe = await provider.transcribe({ audio, mime: 'audio/wav' });
outputs.judge = await provider.judge({ task: 'Summarize this note.', tool: 'send_email', args: { to: 'a@northwind.example', body: 'hello' }, external: false, sensitive: false });
outputs.structured = await provider.structured('red', 'Return the JSON value requested.', 'Return an empty attack list.', {
  name: 'smoke',
  schema: { type: 'object', additionalProperties: false, required: ['attacks'], properties: { attacks: { type: 'array', items: { type: 'string' } } } },
});
outputs.generateImage = { byteLength: (await provider.generateImage('A plain blue square.', '1024x1024')).length };
console.log(JSON.stringify({ calls: provider.calls(), rawResponseShapes: outputs }, null, 2));

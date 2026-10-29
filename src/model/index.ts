import type { ModelProvider } from './provider.js';
import { selectedProviderKind } from './provider.js';
import { MockProvider } from './mock.js';
import { LiveProvider } from './live.js';

export * from './provider.js';
export * from './mock.js';
export * from './live.js';

export function createProvider(): ModelProvider {
  return selectedProviderKind() === 'live' ? new LiveProvider() : new MockProvider();
}

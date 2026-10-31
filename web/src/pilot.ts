type Handler = (payload: string) => Promise<void> | void;
const handlers = new Map<string, Handler>();

export const pilot = {
  on(topic: string, fn: Handler) { handlers.set(topic, fn); return () => { if (handlers.get(topic) === fn) handlers.delete(topic); }; },
  async emit(topic: string, payload = '') {
    for (let i = 0; i < 40 && !handlers.has(topic); i++) await sleep(100);
    await handlers.get(topic)?.(payload);
  },
};

export const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

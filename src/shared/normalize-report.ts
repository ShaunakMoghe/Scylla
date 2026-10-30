export function normalizeLegacyReport<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeLegacyReport) as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [
      key.replace(/Warden/g, 'Scylla').replace(/WARDEN/g, 'SCYLLA').replace(/warden/g, 'scylla'),
      normalizeLegacyReport(item),
    ] as const);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

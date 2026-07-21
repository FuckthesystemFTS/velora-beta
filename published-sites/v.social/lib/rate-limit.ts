type LimitOptions = {
  limit: number;
  windowMs: number;
};

const buckets = new Map<string, number[]>();

export function assertRateLimit(scope: string, key: string, options: LimitOptions) {
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  const current = buckets.get(bucketKey) ?? [];
  const recent = current.filter((timestamp) => now - timestamp < options.windowMs);

  if (recent.length >= options.limit) {
    throw new Error("Troppi tentativi. Riprova tra poco.");
  }

  recent.push(now);
  buckets.set(bucketKey, recent);
}

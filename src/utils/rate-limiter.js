// Simple per-source rate limiter
const buckets = new Map();

export function createLimiter(source, { maxRequests = 10, windowMs = 60_000 } = {}) {
  if (!buckets.has(source)) {
    buckets.set(source, { timestamps: [], maxRequests, windowMs });
  }

  return async function throttle() {
    const bucket = buckets.get(source);
    const now = Date.now();

    // Remove expired timestamps
    bucket.timestamps = bucket.timestamps.filter(t => now - t < bucket.windowMs);

    if (bucket.timestamps.length >= bucket.maxRequests) {
      const waitTime = bucket.windowMs - (now - bucket.timestamps[0]);
      await new Promise(r => setTimeout(r, waitTime));
      bucket.timestamps = bucket.timestamps.filter(t => Date.now() - t < bucket.windowMs);
    }

    bucket.timestamps.push(Date.now());
  };
}

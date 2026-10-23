import 'server-only';

// Fixed-window limiter held in memory. It protects a single server instance from bursts; on
// serverless platforms each instance has its own window, so pair it with an edge rate limit
// (Vercel WAF, Upstash) before public launch.

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (w.count >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) };
  w.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  windows.clear();
}

import type { MiddlewareHandler } from 'hono'

/**
 * A fixed-window rate limit per client key (ADR-032 item 5).
 *
 * In-process, on purpose: Phase 0 runs one `apps/api` instance (ADR-033), and a
 * shared store is one more service to run for a limit whose job is to blunt a
 * flood, not to meter anyone precisely. With several instances each one limits
 * separately, so the effective ceiling is `limit × instances` — still a
 * ceiling. When that stops being good enough the store moves to Postgres, not
 * to a new cache.
 *
 * It sits in front of signature verification, so a flood of unsigned requests
 * is refused before it costs an HMAC. Legitimate providers retry on 429 — Stripe
 * redelivers with backoff — so a limit set well above their real rate loses
 * nothing.
 */
export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  limit: number
  windowMs: number
  /** The client's key — usually its address. */
  key: (headers: Headers, remote: string | null) => string
  now?: () => number
  /** Where a 429 is recorded; injected so tests stay quiet. */
  onLimited?: (key: string) => void
}

export function rateLimit(
  options: RateLimitOptions,
  remoteAddress: (c: Parameters<MiddlewareHandler>[0]) => string | null = () => null,
): MiddlewareHandler {
  const now = options.now ?? Date.now
  const windows = new Map<string, { start: number; count: number }>()

  return async (c, next) => {
    const t = now()
    const key = options.key(c.req.raw.headers, remoteAddress(c))

    // Opportunistic sweep, so a scan across many addresses cannot grow the map
    // without bound.
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (t - w.start >= options.windowMs) windows.delete(k)
    }

    let window = windows.get(key)
    if (!window || t - window.start >= options.windowMs) {
      window = { start: t, count: 0 }
      windows.set(key, window)
    }
    window.count += 1

    const remaining = Math.max(0, options.limit - window.count)
    c.header('RateLimit-Limit', String(options.limit))
    c.header('RateLimit-Remaining', String(remaining))

    if (window.count > options.limit) {
      const retryAfter = Math.ceil((window.start + options.windowMs - t) / 1000)
      options.onLimited?.(key)
      c.header('Retry-After', String(Math.max(1, retryAfter)))
      return c.json({ error: 'rate_limited' }, 429)
    }

    await next()
  }
}

/**
 * The client address: the first `X-Forwarded-For` hop when the service sits
 * behind a proxy we run (Caddy, Cloud Run's front end), otherwise the socket.
 * Trusting the header without a proxy would let any caller pick its own key.
 */
export function clientKey(trustProxy: boolean) {
  return (headers: Headers, remote: string | null): string => {
    if (trustProxy) {
      const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      if (first) return first
    }
    return remote ?? 'unknown'
  }
}

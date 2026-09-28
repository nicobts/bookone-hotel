import {
  context,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type TextMapGetter,
} from '@opentelemetry/api'
import type { MiddlewareHandler } from 'hono'

const tracer = trace.getTracer('bookone-api')
// Created on first use: metrics have no proxy provider, and this module is
// imported before the service starts the SDK (see @bookone/core/telemetry).
let durationHistogram: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null =
  null
const duration = () =>
  (durationHistogram ??= metrics
    .getMeter('bookone-api')
    .createHistogram('http.server.request.duration', {
      description: 'Duration of inbound HTTP requests',
      unit: 's',
    }))

const headerGetter: TextMapGetter<Headers> = {
  keys: (carrier) => [...carrier.keys()],
  get: (carrier, key) => carrier.get(key) ?? undefined,
}

/**
 * A server span per request (ADR-036), continuing the caller's trace from the
 * W3C `traceparent` header — so a guest message is one trace from the web app,
 * through this route, into the worker's job.
 *
 * Named by the route *pattern* (`POST /jobs/guest-message`), never the concrete
 * path: a path can carry an id, and a span name with an id in it is a new
 * series per request. Query strings and bodies are not recorded.
 */
export function serverSpans(): MiddlewareHandler {
  return async (c, next) => {
    const parent = propagation.extract(context.active(), c.req.raw.headers, headerGetter)
    const started = performance.now()

    await tracer.startActiveSpan(
      `${c.req.method} ${c.req.path}`,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': c.req.method },
      },
      parent,
      async (span) => {
        try {
          await next()
        } finally {
          const route = c.req.routePath && c.req.routePath !== '/*' ? c.req.routePath : 'unmatched'
          const status = c.res.status
          span.updateName(`${c.req.method} ${route}`)
          span.setAttributes({ 'http.route': route, 'http.response.status_code': status })
          if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
          span.end()
          duration().record((performance.now() - started) / 1000, {
            'http.request.method': c.req.method,
            'http.route': route,
            'http.response.status_code': status,
          })
        }
      },
    )
  }
}

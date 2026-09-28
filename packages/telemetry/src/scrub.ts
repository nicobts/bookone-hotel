import type { Attributes } from '@opentelemetry/api'
import type { ExportResult } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

/**
 * Secrets that end up in URLs, rewritten before a span leaves the process
 * (ADR-036 §5). Found by looking at real traces: Next names its fetch spans
 * after the full URL, and a guest's stay link *is* the credential to their
 * stay. Each pattern keeps the shape of the URL and drops the secret, so a
 * trace still says which route was hit.
 *
 * The collector applies the same rules again (`infra/otel/collector.yaml`);
 * this is the half that holds even if a service is pointed straight at a
 * backend.
 */
export const URL_SECRETS: [RegExp, string][] = [
  // The signed stay link: /{locale}/stay/v1.<reservation>.<expiry>.<signature>
  [/\/stay\/v1\.[A-Za-z0-9._-]+/g, '/stay/{token}'],
  // Payment intents and pre-check-in links carry their own ids as secrets.
  [/\/pay\/[A-Za-z0-9._-]{16,}/g, '/pay/{intent}'],
  // Anything passed as a token or code in a query string.
  [/([?&](?:token|code|access_token|refresh_token|signature)=)[^&\s]+/gi, '$1{redacted}'],
]

export function scrubText(value: string): string {
  let out = value
  for (const [pattern, replacement] of URL_SECRETS) out = out.replace(pattern, replacement)
  return out
}

function scrubAttributes(attributes: Attributes): Attributes {
  const out: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = typeof value === 'string' ? scrubText(value) : value
  }
  return out
}

/** Wraps an exporter; every span is scrubbed on its way out. */
export class ScrubbingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const scrubbed = spans.map(
      (span) =>
        Object.assign(Object.create(Object.getPrototypeOf(span) as object), span, {
          name: scrubText(span.name),
          attributes: scrubAttributes(span.attributes),
        }) as ReadableSpan,
    )
    this.inner.export(scrubbed, resultCallback)
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve()
  }
}

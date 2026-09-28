import {
  context,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api'

/**
 * Spans and metrics for domain work (ADR-036), on the OpenTelemetry API only.
 *
 * The API is a no-op until a service starts the SDK (`@bookone/telemetry`), so
 * core can instrument itself without knowing whether anyone is listening, and
 * tests pay nothing. Attributes are ids, names and counts — never a guest's
 * details, a message or a prompt (ADR-036 §5). Callers pass attributes; this
 * file does not look inside payloads.
 */
const tracer = trace.getTracer('bookone')

/**
 * Instruments are created on first use, not at import.
 *
 * Tracing has a proxy provider, so a tracer taken before the SDK starts still
 * works afterwards; metrics do not. A histogram created while this module
 * loads — which, with ESM import hoisting, is before the service calls
 * `startTelemetry` — would be a no-op for the life of the process. Found by
 * looking for these metrics in Prometheus and not finding them.
 */
function lazy<T>(create: () => T): () => T {
  let instrument: T | undefined
  return () => (instrument ??= create())
}
const meter = () => metrics.getMeter('bookone')

/** Run `fn` inside a span; failures are recorded and rethrown. */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes, kind }, async (span) => {
    try {
      return await fn(span)
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })
}

const jobDuration = lazy(() =>
  meter().createHistogram('bookone.job.duration', {
    description: 'Duration of one pg-boss job run',
    unit: 's',
  }),
)
const jobRuns = lazy(() =>
  meter().createCounter('bookone.job.runs', {
    description: 'pg-boss job runs, by job name and outcome',
  }),
)

/**
 * One queue job (ADR-036 §6): a span named after the job, its property as an
 * attribute, and duration and outcome as metrics. The property id is a
 * platform UUID, not personal data; it is what lets an operator ask "is this
 * slow for everyone or for one hotel".
 */
export async function traceJob<T>(
  job: {
    name: string
    id?: string
    propertyId?: string | null
    /** The enqueuer's W3C trace context, carried in the payload by the queue. */
    trace?: Record<string, string>
  },
  fn: () => Promise<T>,
): Promise<T> {
  const attributes: Attributes = {
    'messaging.system': 'pg-boss',
    'messaging.operation.type': 'process',
    'messaging.destination.name': job.name,
    ...(job.id ? { 'messaging.message.id': job.id } : {}),
    ...(job.propertyId ? { 'bookone.property.id': job.propertyId } : {}),
  }
  const started = performance.now()
  let outcome: 'ok' | 'error' = 'ok'
  try {
    // Continue the enqueuer's trace when there is one: one guest message is
    // then one trace from the web request, across the queue, to the reply.
    const parent = job.trace ? propagation.extract(context.active(), job.trace) : context.active()
    return await context.with(parent, () =>
      withSpan(`process ${job.name}`, attributes, fn, SpanKind.CONSUMER),
    )
  } catch (error) {
    outcome = 'error'
    throw error
  } finally {
    const labels = { 'messaging.destination.name': job.name, outcome }
    jobDuration().record((performance.now() - started) / 1000, labels)
    jobRuns().add(1, labels)
  }
}

const modelDuration = lazy(() =>
  meter().createHistogram('gen_ai.client.operation.duration', {
    description: 'Duration of one model call',
    unit: 's',
  }),
)
const modelTokens = lazy(() =>
  meter().createHistogram('gen_ai.client.token.usage', {
    description: 'Tokens per model call, by direction',
    unit: '{token}',
  }),
)

/**
 * One model call, following the GenAI semantic conventions — without the
 * prompt or the completion, which hold guest messages (ADR-036 §5). The
 * collector also drops those attributes if any library adds them.
 */
export async function traceModelCall<T>(
  input: { system: string; model: string; task: string },
  fn: () => Promise<T>,
  usage: (result: T) => { inputTokens: number; outputTokens: number } | null,
): Promise<T> {
  const attributes: Attributes = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.system': input.system,
    'gen_ai.request.model': input.model,
    'bookone.llm.task': input.task,
  }
  const started = performance.now()
  return withSpan(
    `chat ${input.model}`,
    attributes,
    async (span) => {
      const result = await fn()
      const tokens = usage(result)
      if (tokens) {
        span.setAttributes({
          'gen_ai.usage.input_tokens': tokens.inputTokens,
          'gen_ai.usage.output_tokens': tokens.outputTokens,
        })
        modelTokens().record(tokens.inputTokens, { ...attributes, 'gen_ai.token.type': 'input' })
        modelTokens().record(tokens.outputTokens, { ...attributes, 'gen_ai.token.type': 'output' })
      }
      modelDuration().record((performance.now() - started) / 1000, attributes)
      return result
    },
    SpanKind.CLIENT,
  )
}

export { SpanKind }

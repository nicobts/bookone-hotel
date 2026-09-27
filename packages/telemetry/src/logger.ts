import { Writable } from 'node:stream'
import { context, trace } from '@opentelemetry/api'
import { logs, SeverityNumber, type AnyValueMap } from '@opentelemetry/api-logs'
import { levels, multistream, pino, type Logger, type LevelWithSilent } from 'pino'
import { REDACT_PATHS, REDACTED } from './redact'

/**
 * The service logger (ADR-036): pino, redacted, correlated, exported.
 *
 * - **Redacted** before the line exists (`REDACT_PATHS`), so stdout and the
 *   collector see the same thing and neither sees a guest's details.
 * - **Correlated**: every line written inside a span carries `trace_id` and
 *   `span_id`, so a log line and its trace are one click apart.
 * - **Exported**: each line is also emitted as an OpenTelemetry log record.
 *   With telemetry off the global logger provider is a no-op and this costs a
 *   JSON parse per line, which is nothing next to the write itself.
 *
 * A pino stream rather than `@opentelemetry/instrumentation-pino`: the
 * instrumentation patches pino through a module-loader hook, which ESM needs
 * to be installed before anything imports pino — fragile under `tsx` in
 * development and in the bundled `dist` in production. This needs no hook.
 */
export function createLogger(options: { name: string; level?: string }): Logger {
  const otel = logs.getLogger(options.name)

  const toOtel = new Writable({
    write(chunk: Buffer, _encoding, done) {
      try {
        const line = JSON.parse(chunk.toString('utf8')) as Record<string, unknown>
        const { level, time, msg, trace_id, span_id, pid, hostname, ...attributes } = line
        void pid
        void hostname
        otel.emit({
          severityNumber: severity(Number(level)),
          severityText: levels.labels[Number(level)] ?? 'info',
          body: typeof msg === 'string' ? msg : '',
          timestamp: typeof time === 'number' ? time : Date.now(),
          attributes: flatten(attributes),
          ...(typeof trace_id === 'string' && typeof span_id === 'string'
            ? {
                context: trace.setSpanContext(context.active(), {
                  traceId: trace_id,
                  spanId: span_id,
                  traceFlags: 1,
                }),
              }
            : {}),
        })
      } catch {
        // A line that is not JSON is not ours to export; stdout still has it.
      }
      done()
    },
  })

  return pino(
    {
      name: options.name,
      level: (options.level ?? 'info') as LevelWithSilent,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      mixin() {
        const span = trace.getSpan(context.active())
        if (!span) return {}
        const { traceId, spanId } = span.spanContext()
        return { trace_id: traceId, span_id: spanId }
      },
    },
    // Both streams take every level; the logger's own `level` decides what is
    // written at all. (A multistream entry defaults to info and would silently
    // drop debug lines even when the logger allows them.)
    multistream([
      { level: 'trace', stream: process.stdout },
      { level: 'trace', stream: toOtel },
    ]),
  )
}

function severity(level: number): SeverityNumber {
  if (level >= 60) return SeverityNumber.FATAL
  if (level >= 50) return SeverityNumber.ERROR
  if (level >= 40) return SeverityNumber.WARN
  if (level >= 30) return SeverityNumber.INFO
  if (level >= 20) return SeverityNumber.DEBUG
  return SeverityNumber.TRACE
}

/** OTel attributes are flat; nested objects become dotted keys, one level deep. */
function flatten(input: Record<string, unknown>): AnyValueMap {
  const out: AnyValueMap = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null && v !== undefined && typeof v !== 'object') {
          out[`${key}.${inner}`] = v as string | number | boolean
        }
      }
    } else if (typeof value !== 'object') {
      out[key] = value as string | number | boolean
    }
  }
  return out
}

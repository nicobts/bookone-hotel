import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions/incubating'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { ScrubbingSpanExporter } from './scrub'

export interface TelemetryHandle {
  enabled: boolean
  /** Flush and stop; call on SIGTERM before exiting. */
  shutdown: () => Promise<void>
}

/**
 * Start OpenTelemetry for one service (ADR-036). Call first, before the rest
 * of the service is imported where possible.
 *
 * Configured by the standard environment only — `OTEL_EXPORTER_OTLP_ENDPOINT`,
 * `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`
 * — so a collector address is deployment configuration, never code. Without an
 * endpoint it does nothing and the service runs exactly as before: the local
 * default, and why CI needs no collector.
 *
 * Instrumented automatically: outbound `fetch` (undici's diagnostics channel,
 * which needs no ESM loader hook) with W3C trace-context propagation, so a
 * trace follows web → api → a provider. Server spans, job spans and model spans
 * are explicit (see `@bookone/core/telemetry` and each service).
 */
export function startTelemetry(options: {
  serviceName: string
  serviceVersion?: string
  env?: NodeJS.ProcessEnv
}): TelemetryHandle {
  const env = options.env ?? process.env
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()

  if (!endpoint || env.OTEL_SDK_DISABLED === 'true') {
    return { enabled: false, shutdown: async () => undefined }
  }

  const production = env.NODE_ENV === 'production'

  // ADR-036 §7: keep every trace outside production, a tenth of them in it.
  // An explicit OTEL_TRACES_SAMPLER still wins.
  if (!env.OTEL_TRACES_SAMPLER) {
    env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio'
    env.OTEL_TRACES_SAMPLER_ARG = production ? '0.1' : '1'
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        env.BOOKONE_ENVIRONMENT ?? (production ? 'prod' : 'local'),
    }),
    // Exporters read the endpoint and headers from the standard variables.
    // Scrubbed on the way out: URLs can carry secrets (see scrub.ts).
    traceExporter: new ScrubbingSpanExporter(new OTLPTraceExporter()),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 15_000,
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [new UndiciInstrumentation()],
  })

  sdk.start()

  return {
    enabled: true,
    shutdown: () => sdk.shutdown().catch(() => undefined),
  }
}

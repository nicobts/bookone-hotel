/**
 * OpenTelemetry for this app (ADR-036), the pattern the Next docs give for a
 * manual NodeSDK: the Node-only setup is imported only on the Node runtime,
 * since NodeSDK does not run on the edge. Off unless OTEL_EXPORTER_OTLP_ENDPOINT
 * is set. With a provider registered, Next's own spans (requests, rendering,
 * route handlers, fetch) are exported alongside ours.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node')
  }
}

import 'server-only'
import { createLogger } from '@bookone/telemetry'

/**
 * This app's server logger (ADR-036): redacted, carrying the trace id on each
 * line, and exported over OTLP when telemetry is on. Server code logs through
 * this, not `console`, so its lines reach the same place as the api's and the
 * worker's and can be read beside them.
 */
export const logger = createLogger({
  name: 'bookone-admin',
  level: process.env.LOG_LEVEL ?? 'info',
})

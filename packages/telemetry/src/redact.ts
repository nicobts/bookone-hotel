/**
 * Keys whose values never reach a log line or a telemetry backend (ADR-036 §5).
 *
 * Applied by pino before a line is written, so neither stdout nor the OTLP
 * export ever holds the value. A list of keys rather than a scanner: a key
 * name is decidable, "does this string look like a name" is not. When a new
 * personal field starts being logged, it is added here, and the test below
 * pins that it is removed.
 *
 * Listed at the top level and one level down (`*.key`), which covers pino's
 * usual `logger.info({ ... }, msg)` and one nested object.
 */
export const REDACTED_KEYS = [
  'email',
  'phone',
  'name',
  'fullName',
  'guestName',
  'firstName',
  'lastName',
  'message',
  'body',
  'text',
  'prompt',
  'completion',
  'reply',
  'recipient',
  'address',
  'documentNumber',
  'password',
  'token',
  'authorization',
  'cookie',
  'apiKey',
] as const

export const REDACT_PATHS: string[] = REDACTED_KEYS.flatMap((key) => [key, `*.${key}`])

export const REDACTED = '[redacted]'

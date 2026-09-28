import type { LlmImage, LlmProvider } from '../llm/provider'
import { parseMrz, type MrzResult } from './mrz'

/**
 * Reading an identity document from a photo (WP0.4).
 *
 * A vision model reads the printed fields and the machine-readable zone. Then
 * the MRZ is checked here, in TypeScript: when its check digits agree, the MRZ
 * is the source for the fields it carries, because it was designed to be read
 * by machines and it can prove it was read correctly. The printed fields the
 * model read are kept only where the MRZ has nothing — place of birth, or the
 * front of an Italian CIE, which has no MRZ at all — and marked low-confidence.
 *
 * The result is a suggestion for a person. It fills nothing in on its own and
 * asserts nothing about identity (ADR-027): staff compare it with what the
 * guest typed and with the document, and confirm.
 *
 * Runs only for a property with the `document_ocr` feature (ADR-019), because
 * the model may process outside the EU (ADR-029) and a real guest's document
 * waits for the transfer assessment.
 */
export interface DocumentReading {
  /** How the fields were established. */
  source: 'mrz' | 'printed' | 'none'
  mrz: {
    present: boolean
    /** Every check digit agreed. False asks the guest for a clearer photo. */
    valid: boolean
    format: MrzResult['format'] | null
    /** A miscounted run of `<` filler was corrected before the check digits ran. */
    repaired: boolean
  }
  fields: {
    surname?: string
    givenName?: string
    sex?: 'm' | 'f'
    birthDate?: string
    birthPlace?: string
    citizenship?: string
    documentType?: 'passport' | 'idCard'
    documentNumber?: string
    documentIssuer?: string
    expiryDate?: string
  }
  /** Fields read from print rather than a valid MRZ. A person checks these first. */
  lowConfidence: string[]
  model: string | null
  readAt: string
}

const READ_TOOL = 'record_document'

const INSTRUCTIONS = [
  'You read one photo of an identity document for a hotel registration. You never write to anyone.',
  'Copy what is printed. Never guess or complete a value you cannot read — leave it out.',
  'mrzLines: the machine-readable zone lines exactly as printed (with < characters), top to bottom, or an empty list if there is none.',
  'Dates as YYYY-MM-DD. Countries as ISO 3166 two-letter codes where you can map them, otherwise as printed.',
].join('\n')

const READ_SCHEMA = {
  type: 'object',
  properties: {
    mrzLines: { type: 'array', items: { type: 'string' } },
    documentType: { type: 'string', enum: ['passport', 'idCard', 'other'] },
    surname: { type: 'string' },
    givenName: { type: 'string' },
    sex: { type: 'string', enum: ['m', 'f'] },
    birthDate: { type: 'string' },
    birthPlace: { type: 'string' },
    citizenship: { type: 'string' },
    documentNumber: { type: 'string' },
    documentIssuer: { type: 'string' },
    expiryDate: { type: 'string' },
  },
  required: ['mrzLines'],
  additionalProperties: false,
} as const

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function readDocument(
  llm: LlmProvider,
  image: LlmImage,
  now: Date = new Date(),
): Promise<DocumentReading> {
  const response = await llm.complete({
    task: 'extraction',
    tier: 'strong',
    temperature: 0,
    maxOutputTokens: 600,
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: 'Read this document.', images: [image] },
    ],
    tools: [
      { name: READ_TOOL, description: 'Record what the document says', parameters: READ_SCHEMA },
    ],
  })

  const read = response.toolCalls.find((call) => call.name === READ_TOOL)?.input ?? {}
  return interpretReading(read, response.model, now)
}

/**
 * Turn a model's reading into a `DocumentReading`. Separate from the call so
 * the rules — MRZ wins when valid, print is low-confidence — are testable
 * without a model.
 */
export function interpretReading(
  read: Record<string, unknown>,
  model: string | null,
  now: Date = new Date(),
): DocumentReading {
  const mrzLines = Array.isArray(read.mrzLines)
    ? read.mrzLines.filter((line): line is string => typeof line === 'string')
    : []
  const mrz = mrzLines.length > 0 ? parseMrz(mrzLines, now) : null

  const printed: DocumentReading['fields'] = {}
  for (const key of [
    'surname',
    'givenName',
    'birthDate',
    'birthPlace',
    'citizenship',
    'documentNumber',
    'documentIssuer',
    'expiryDate',
  ] as const) {
    const value = str(read[key])
    if (value) printed[key] = value
  }
  if (read.sex === 'm' || read.sex === 'f') printed.sex = read.sex
  if (read.documentType === 'passport' || read.documentType === 'idCard') {
    printed.documentType = read.documentType
  }

  const base = { model, readAt: now.toISOString() }

  if (mrz?.valid) {
    // The MRZ proved it was read correctly: it is the source for what it
    // carries. Only what it does not carry comes from print.
    const fromMrz: DocumentReading['fields'] = {
      surname: mrz.surname,
      givenName: mrz.givenNames,
      ...(mrz.sex ? { sex: mrz.sex } : {}),
      ...(mrz.birthDate ? { birthDate: mrz.birthDate } : {}),
      citizenship: mrz.nationality,
      documentType: mrz.documentKind,
      documentNumber: mrz.documentNumber,
      documentIssuer: mrz.issuingState,
      ...(mrz.expiryDate ? { expiryDate: mrz.expiryDate } : {}),
    }

    const extra = printed.birthPlace ? { birthPlace: printed.birthPlace } : {}

    return {
      ...base,
      source: 'mrz',
      mrz: { present: true, valid: true, format: mrz.format, repaired: mrz.repaired },
      fields: { ...fromMrz, ...extra },
      lowConfidence: printed.birthPlace ? ['birthPlace'] : [],
    }
  }

  return {
    ...base,
    source: Object.keys(printed).length > 0 ? 'printed' : 'none',
    mrz: {
      present: mrzLines.length > 0,
      valid: false,
      format: mrz?.format ?? null,
      repaired: mrz?.repaired ?? false,
    },
    fields: printed,
    lowConfidence: Object.keys(printed),
  }
}

/** Where what the guest typed and what the document says disagree — for staff, before they confirm. */
export function readingMismatches(
  typed: Record<string, unknown>,
  reading: DocumentReading,
): string[] {
  const norm = (value: unknown) =>
    typeof value === 'string'
      ? value
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
      : ''

  const pairs: [string, unknown, unknown][] = [
    ['surname', typed.surname, reading.fields.surname],
    ['givenName', typed.givenName, reading.fields.givenName],
    ['birthDate', typed.birthDate, reading.fields.birthDate],
    ['documentNumber', typed.documentNumber, reading.fields.documentNumber],
  ]

  return (
    pairs
      // Only a value the guest typed can disagree. A field they left empty is
      // not a mismatch — the preview already lists it as missing.
      .filter(([, a, b]) => norm(a) !== '' && norm(b) !== '' && norm(a) !== norm(b))
      .map(([name]) => name)
  )
}

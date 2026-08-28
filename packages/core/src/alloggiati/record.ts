import { z } from 'zod'

/**
 * The Alloggiati record format (E2.3, PRD B2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFY BEFORE PRODUCTION — the field layout below is not authoritative.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alloggiati Web accepts a fixed-width text file, one line per guest. The field
 * order, widths and code lists encoded here reflect the published *tracciato
 * record*, but they were written from documentation rather than validated
 * against the authority's own test environment — and the spec has revisions.
 *
 * **Two things must happen before a real submission**, both on the go-live
 * checklist in `docs/runbooks/alloggiati.md` rather than as code TODOs:
 *
 *   1. Somebody with the current official specification checks every offset in
 *      `FIELDS` below, and the payload is round-tripped through the Alloggiati
 *      test environment.
 *   2. **The country and place code lists are filled in.** The registry
 *      identifies states and municipalities by its own numeric codes, published
 *      as tables. This module carries ISO alpha-2 in those fields today because
 *      that is what the pre-arrival form collects and what we can honestly
 *      produce — inventing plausible-looking registry numbers would be worse
 *      than carrying an obviously untranslated value, since a wrong code files
 *      a real guest as born somewhere they were not.
 *      `mapCountryCode` below is the single place that changes.
 *
 * Everything *around* this file — validation, staging, the audit trail, the
 * retry, the T-20h alert, the deletion job — is independent of whether these
 * offsets are right, which is why it is all built and tested now. When the
 * layout is corrected, one table changes and the tests below say whether
 * anything else moved.
 *
 * A wrong offset produces a rejected file, not a silent misfiling: the
 * authority validates on receipt. That is the reason this is safe to ship
 * behind a mock and unsafe to ship at a real property without the check.
 */

/**
 * Guest type codes.
 *
 * The distinction matters legally: a family or group is filed as one head plus
 * members, and filing four separate single guests for a family of four is a
 * different declaration from the one the property means to make.
 */
export const guestTypes = {
  /** Ospite singolo — travelling alone. */
  single: '16',
  /** Capofamiglia — head of a family group. */
  familyHead: '17',
  /** Capogruppo — head of a tour group. */
  groupHead: '18',
  /** Familiare — family member, follows a head. */
  familyMember: '19',
  /** Membro gruppo — group member, follows a head. */
  groupMember: '20',
} as const

export type GuestTypeCode = (typeof guestTypes)[keyof typeof guestTypes]

/**
 * Document type codes, as used by the registry.
 *
 * Only the three a guest realistically presents at a small hotel. The registry
 * accepts more; adding one means adding it here *and* to the pre-arrival
 * form's options, because a code we accept but never collect is dead.
 */
export const documentTypes = {
  passport: 'PASOR',
  idCard: 'IDENT',
  drivingLicence: 'PATEN',
} as const

export type DocumentTypeCode = (typeof documentTypes)[keyof typeof documentTypes]

/**
 * One field of the fixed-width record.
 *
 * Declared as data rather than string concatenation so the layout can be
 * checked against the specification by reading one table, and so a correction
 * is an edit to a width rather than an audit of a template.
 */
export interface Field {
  name: string
  width: number
  /** Right-padded text, or zero-padded digits. */
  kind: 'text' | 'digits'
  /** True when the registry requires it for every guest. */
  required: boolean
}

/**
 * The record layout.
 *
 * Total width is asserted by the tests, so a field added without adjusting the
 * expected total fails immediately rather than producing a file the authority
 * rejects three weeks later.
 */
export const FIELDS: readonly Field[] = [
  { name: 'guestType', width: 2, kind: 'digits', required: true },
  { name: 'arrivalDate', width: 10, kind: 'text', required: true },
  { name: 'nights', width: 2, kind: 'digits', required: true },
  { name: 'surname', width: 50, kind: 'text', required: true },
  { name: 'givenName', width: 30, kind: 'text', required: true },
  { name: 'sex', width: 1, kind: 'digits', required: true },
  { name: 'birthDate', width: 10, kind: 'text', required: true },
  { name: 'birthPlaceCode', width: 9, kind: 'text', required: false },
  { name: 'birthProvince', width: 2, kind: 'text', required: false },
  { name: 'birthCountryCode', width: 9, kind: 'text', required: true },
  { name: 'citizenshipCode', width: 9, kind: 'text', required: true },
  { name: 'documentType', width: 5, kind: 'text', required: false },
  { name: 'documentNumber', width: 20, kind: 'text', required: false },
  { name: 'documentIssuerCode', width: 9, kind: 'text', required: false },
] as const

export const RECORD_WIDTH = FIELDS.reduce((total, field) => total + field.width, 0)

/**
 * What we hold about one guest, before it becomes a record.
 *
 * Deliberately our own vocabulary rather than the registry's: the pre-arrival
 * form collects a person, and the translation into codes and offsets happens
 * here, once. A form that collected `birthCountryCode` would be a form nobody
 * could fill in.
 */
export const guestDetailsSchema = z.object({
  surname: z.string().min(1),
  givenName: z.string().min(1),
  /** `m` or `f`. The registry encodes 1 and 2; the mapping lives here. */
  sex: z.enum(['m', 'f']),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthCountryCode: z.string().min(1),
  citizenshipCode: z.string().min(1),
  birthPlaceCode: z.string().optional(),
  birthProvince: z.string().optional(),
  documentType: z.enum(['passport', 'idCard', 'drivingLicence']).optional(),
  documentNumber: z.string().optional(),
  documentIssuerCode: z.string().optional(),
})

export type GuestDetails = z.infer<typeof guestDetailsSchema>

export interface StayDetails {
  arrivalDate: string
  departureDate: string
}

export type ValidationIssue = { guestIndex: number; field: string; problem: string }

/**
 * Whether a party can be filed, and what is missing if not.
 *
 * Returns *every* problem rather than the first, because the console shows this
 * to an owner who has to go and ask the guest — and a list that reveals one
 * missing field per round trip is a list that takes four conversations.
 */
export function validateParty(
  party: readonly Partial<GuestDetails>[],
  stay: StayDetails,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (party.length === 0) {
    return [{ guestIndex: -1, field: 'party', problem: 'no guests to file' }]
  }

  if (nightsBetween(stay.arrivalDate, stay.departureDate) < 1) {
    issues.push({ guestIndex: -1, field: 'stay', problem: 'departure must follow arrival' })
  }

  party.forEach((guest, index) => {
    const parsed = guestDetailsSchema.safeParse(guest)
    if (parsed.success) return

    for (const issue of parsed.error.issues) {
      issues.push({
        guestIndex: index,
        field: issue.path.join('.') || 'guest',
        problem: issue.message,
      })
    }
  })

  return issues
}

/**
 * Builds the file.
 *
 * The first guest is the head when there is more than one, and the rest are
 * members — the legal shape of a family or group filing. A single guest is
 * filed as `single`, which is a different code and not merely a party of one.
 */
export function buildPayload(party: readonly GuestDetails[], stay: StayDetails): string {
  const nights = nightsBetween(stay.arrivalDate, stay.departureDate)

  return party
    .map((guest, index) => {
      const type =
        party.length === 1
          ? guestTypes.single
          : index === 0
            ? guestTypes.familyHead
            : guestTypes.familyMember

      return buildRecord(guest, { type, arrivalDate: stay.arrivalDate, nights })
    })
    .join('\r\n')
}

function buildRecord(
  guest: GuestDetails,
  context: { type: GuestTypeCode; arrivalDate: string; nights: number },
): string {
  const values: Record<string, string> = {
    guestType: context.type,
    arrivalDate: toRegistryDate(context.arrivalDate),
    // Capped at the field width rather than silently truncated to nonsense: a
    // stay longer than 99 nights is not a hotel booking, and the cap is a
    // visible upper bound instead of a wrapped number.
    nights: String(Math.min(context.nights, 99)),
    surname: guest.surname,
    givenName: guest.givenName,
    sex: guest.sex === 'm' ? '1' : '2',
    birthDate: toRegistryDate(guest.birthDate),
    birthPlaceCode: guest.birthPlaceCode ?? '',
    birthProvince: guest.birthProvince ?? '',
    birthCountryCode: mapCountryCode(guest.birthCountryCode),
    citizenshipCode: mapCountryCode(guest.citizenshipCode),
    documentType: guest.documentType ? documentTypes[guest.documentType] : '',
    documentNumber: guest.documentNumber ?? '',
    documentIssuerCode: guest.documentIssuerCode ?? '',
  }

  return FIELDS.map((field) => pad(normalise(values[field.name] ?? ''), field)).join('')
}

function pad(value: string, field: Field): string {
  const clipped = value.slice(0, field.width)

  return field.kind === 'digits'
    ? clipped.padStart(field.width, '0')
    : clipped.padEnd(field.width, ' ')
}

/**
 * Strips accents and anything outside the registry's character set.
 *
 * A fixed-width file counts bytes, and "Müller" is six characters and seven
 * bytes in UTF-8 — which shifts every field after it and produces a file the
 * authority rejects. Names in this market are full of umlauts and accents, so
 * this is the common case rather than an edge one.
 */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 '\-/]/g, ' ')
    .trim()
}

/** The registry writes dates as `dd/mm/yyyy`. */
function toRegistryDate(iso: string): string {
  const [year, month, day] = iso.split('-')

  return year && month && day ? `${day}/${month}/${year}` : ''
}

/**
 * ISO alpha-2 to the registry's own country code.
 *
 * **Currently the identity function**, deliberately and visibly. The registry
 * publishes numeric codes for states; until that table is loaded from the
 * official source this passes the ISO code straight through, which the mock
 * accepts and a real channel will reject — loudly, on the first test
 * submission, which is exactly where that failure belongs.
 *
 * Filling this in is one function and a data file. Guessing at it is a guest
 * filed as born in the wrong country.
 */
export function mapCountryCode(iso: string): string {
  return iso.trim().toUpperCase()
}

export function nightsBetween(arrival: string, departure: string): number {
  const start = Date.parse(`${arrival}T00:00:00Z`)
  const end = Date.parse(`${departure}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0

  return Math.round((end - start) / 86_400_000)
}

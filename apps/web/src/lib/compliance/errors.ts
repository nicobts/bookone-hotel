/**
 * What a filing's `last_error` says, in the desk's own language.
 *
 * The lifecycle, the Alloggiati bridge and the Alloggiati Web adapter write
 * `last_error` as English text, sometimes with the authority's own words inside
 * (the registry's refusal of a line, in Italian). This reads that text back
 * into parts with translation keys under `console.arrival.obligation.errors`:
 * our own sentences are translated, and the authority's words are kept as they
 * were said, framed as the authority's, because a refusal paraphrased is a
 * refusal the desk cannot quote back to the Questura.
 *
 * Several messages joined by ` · ` become several parts. Anything not
 * recognised is shown as written, framed as the channel's own words.
 *
 * Shared by the arrival page, the filing screen and the exceptions inbox, so
 * the same obligation never reads in two languages on two screens.
 */
export type ErrorPart =
  | { key: ErrorKey; values?: Record<string, string> }
  | { key: 'refused'; lines: { guest: string; said: string }[] }

export type ErrorKey =
  | 'notConfirmed'
  | 'deadlineClose'
  | 'stayGone'
  | 'checkFailed'
  | 'nothingStaged'
  | 'noReference'
  | 'notConfirmedByChannel'
  | 'noChannel'
  | 'credentialsRefused'
  | 'channelHttp'
  | 'ambiguous'
  | 'unreadable'
  | 'guestIssue'
  | 'originMissing'
  | 'channelSaid'

const EXACT: Record<string, ErrorKey> = {
  'Nobody has confirmed the guests against their documents yet.': 'notConfirmed',
  'The deadline is close: file by hand.': 'deadlineClose',
  'The stay no longer exists.': 'stayGone',
  'The channel could not say whether the filing was accepted.': 'checkFailed',
  'Nothing was staged to file.': 'nothingStaged',
  'The channel returned no reference for the filing.': 'noReference',
  'The channel took it but has not confirmed it yet: check the portal before filing by hand.':
    'notConfirmedByChannel',
  'No channel to file this with yet: file it by hand.': 'noChannel',
}

const PATTERNS: [RegExp, (match: RegExpMatchArray) => ErrorPart][] = [
  [
    /^the registry refused the filing — (.+)$/s,
    (m) => ({
      key: 'refused',
      lines: m[1]!.split('; ').map((line) => {
        const guest = /^Guest (\d+): (.*)$/s.exec(line)
        return guest ? { guest: guest[1]!, said: guest[2]! } : { guest: '', said: line }
      }),
    }),
  ],
  [/^credentials refused: (.*)$/s, (m) => ({ key: 'credentialsRefused', values: { said: m[1]! } })],
  [/^[\w.-]+: HTTP (\d{3})$/, (m) => ({ key: 'channelHttp', values: { status: m[1]! } })],
  [/^no answer after sending/, () => ({ key: 'ambiguous' })],
  [/^unreadable answer: /, () => ({ key: 'unreadable' })],
  [
    /^Guest (\d+): (.+?) — (.+)$/s,
    (m) => ({ key: 'guestIssue', values: { guest: m[1]!, field: m[2]!, problem: m[3]! } }),
  ],
  [
    /^Stay (.+): a guest's residence or citizenship is not recorded$/,
    (m) => ({ key: 'originMissing', values: { reference: m[1]! } }),
  ],
]

/** One message, recognised or framed as the channel's own words. */
function describeOne(message: string): ErrorPart {
  const exact = EXACT[message]
  if (exact) return { key: exact }
  for (const [pattern, build] of PATTERNS) {
    const match = message.match(pattern)
    if (match) return build(match)
  }
  return { key: 'channelSaid', values: { said: message } }
}

export function describeObligationError(lastError: string | null | undefined): ErrorPart[] {
  if (!lastError) return []
  return lastError
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(describeOne)
}

type Translate = (key: string, values?: Record<string, string>) => string

/**
 * The validator's field names, to their labels under
 * `console.arrival.schedinaFields`. A field not listed shows as written.
 */
export const FIELD_LABELS: Record<string, string> = {
  birthCountry: 'birthCountryCode',
  citizenship: 'citizenshipCode',
  birthPlace: 'birthPlaceCode',
  documentIssuer: 'documentIssuerCode',
  documentType: 'documentType',
  documentNumber: 'documentNumber',
  birthDate: 'birthDate',
  surname: 'surname',
  givenName: 'givenName',
  sex: 'sex',
}

/**
 * The parts as sentences, through `console.arrival.obligation.errors`.
 * `field` turns a validator's field name into its label. The validator's own
 * `problem` stays in English: it is written by the resolver as a sentence,
 * and making it a code is a change to core, not to the screen.
 */
export function obligationErrorLines(
  lastError: string | null | undefined,
  t: Translate,
  field: (name: string) => string = (name) => name,
): string[] {
  return describeObligationError(lastError).flatMap((part) =>
    part.key === 'refused'
      ? [
          t('refused'),
          ...part.lines.map((line) =>
            line.guest
              ? t('refusedLine', { guest: line.guest, said: line.said })
              : t('channelSaid', { said: line.said }),
          ),
        ]
      : part.key === 'guestIssue' && part.values
        ? [t('guestIssue', { ...part.values, field: field(part.values.field!) })]
        : [t(part.key, 'values' in part ? part.values : undefined)],
  )
}

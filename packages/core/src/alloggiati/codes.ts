import { FIELDS } from './record'

/**
 * The registry's own code tables (WP1.2).
 *
 * Alloggiati Web identifies places (Italian comuni and foreign states) and
 * document types by its own codes, published as tables: from the portal, and
 * from the web service's table download. We do not ship them. We load them
 * from a directory an operator fills (`ALLOGGIATI_TABLES_DIR`) and replace
 * when the authority revises them, so an update is a file swap, not a release.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFY BEFORE PRODUCTION: the column layout the parsers accept is written
 *  from public documentation, not from a downloaded table. The parsers match
 *  headers by name and say which column they could not find.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Never invent a code.** A plausible wrong code files a real guest as born
 * somewhere they were not. So a table carries its provenance: `official`
 * (downloaded from the authority by an operator) or `synthetic` (the fixture
 * the tests and the simulator use, with codes that exist nowhere). A real
 * channel refuses synthetic tables (`assertOfficial`).
 */

export type TablesSource = 'official' | 'synthetic'

export interface Place {
  code: string
  /** As the registry spells it, uppercase. */
  name: string
  /** Two-letter province for a comune; null for a foreign state. */
  province: string | null
  kind: 'comune' | 'stato'
  /** ISO date after which the code may no longer be used, or null. */
  endedOn: string | null
}

export interface DocumentKind {
  code: string
  name: string
}

export interface CodeTables {
  source: TablesSource
  /** When the operator downloaded them, as recorded in the manifest. */
  fetchedAt: string
  places: readonly Place[]
  documents: readonly DocumentKind[]
  /**
   * Our document vocabulary to the registry's codes. Part of the tables, not
   * of the code, because it names codes, and a code is the authority's.
   */
  documentMap: Readonly<Partial<Record<'passport' | 'idCard' | 'drivingLicence', string>>>
  /**
   * ISO alpha-2 to the registry's name for the state, where the Italian name
   * `Intl.DisplayNames` gives is not the registry's spelling.
   */
  countryAliases: Readonly<Record<string, string>>
}

export class CodeTablesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodeTablesError'
  }
}

/**
 * Loads the tables from a directory:
 *
 *   manifest.json   { "source": "official" | "synthetic", "fetchedAt": "…",
 *                     "documentMap": {…}, "countryAliases": {…} }
 *   luoghi.csv      places: code, name, province, end date
 *   documenti.csv   document types: code, name
 */
export async function loadCodeTables(dir: string): Promise<CodeTables> {
  // Imported here, not at the top: this module is also read by the web app's
  // server components, which only ever resolve, never load.
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')

  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const source = manifest.source
  if (source !== 'official' && source !== 'synthetic') {
    throw new CodeTablesError('manifest.json: "source" must be "official" or "synthetic"')
  }

  const tables: CodeTables = {
    source,
    fetchedAt: typeof manifest.fetchedAt === 'string' ? manifest.fetchedAt : '',
    places: parsePlaces(await readFile(join(dir, 'luoghi.csv'), 'utf8')),
    documents: parseDocuments(await readFile(join(dir, 'documenti.csv'), 'utf8')),
    documentMap: record(manifest.documentMap) as CodeTables['documentMap'],
    countryAliases: record(manifest.countryAliases),
  }
  assertFits(tables)
  return tables
}

/**
 * Every code fits the record field it goes into. A code one character too
 * long would be clipped by the fixed-width builder into a different code,
 * silently; refusing the tables at load is the loud version.
 */
export function assertFits(tables: CodeTables): void {
  const width = (name: string) => FIELDS.find((field) => field.name === name)!.width
  const place = tables.places.find((entry) => entry.code.length > width('birthPlaceCode'))
  if (place) {
    throw new CodeTablesError(
      `place code "${place.code}" is longer than the ${width('birthPlaceCode')}-character field`,
    )
  }
  const document = tables.documents.find((entry) => entry.code.length > width('documentType'))
  if (document) {
    throw new CodeTablesError(
      `document code "${document.code}" is longer than the ${width('documentType')}-character field`,
    )
  }
}

/** A real channel accepts only tables an operator downloaded from the authority. */
export function assertOfficial(tables: CodeTables): void {
  if (tables.source !== 'official') {
    throw new CodeTablesError(
      'these code tables are synthetic; a real channel needs the official tables',
    )
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parsePlaces(csv: string): Place[] {
  const rows = parseCsv(csv)
  const column = columns(rows[0] ?? [], {
    code: ['codice', 'code'],
    name: ['descrizione', 'nome', 'name'],
    province: ['provincia', 'prov', 'province'],
    endedOn: ['datafineval', 'data fine validita', 'fine validita', 'endedon'],
  })

  return rows.slice(1).flatMap((row) => {
    const code = row[column.code]?.trim() ?? ''
    const name = row[column.name]?.trim() ?? ''
    if (!code || !name) return []
    const province = (row[column.province] ?? '').trim().toUpperCase()
    // Foreign states carry "ES" (estero) or nothing in the province column.
    const foreign = province === '' || province === 'ES' || province === 'EE'
    return [
      {
        code,
        name: normaliseName(name),
        province: foreign ? null : province,
        kind: foreign ? ('stato' as const) : ('comune' as const),
        endedOn: toIsoDate(row[column.endedOn] ?? ''),
      },
    ]
  })
}

export function parseDocuments(csv: string): DocumentKind[] {
  const rows = parseCsv(csv)
  const column = columns(rows[0] ?? [], {
    code: ['codice', 'code'],
    name: ['descrizione', 'nome', 'name'],
  })
  return rows.slice(1).flatMap((row) => {
    const code = row[column.code]?.trim() ?? ''
    const name = row[column.name]?.trim() ?? ''
    return code && name ? [{ code, name: normaliseName(name) }] : []
  })
}

function parseCsv(text: string): string[][] {
  // A byte-order mark, which spreadsheet exports prepend, is not a header.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    .split(/\r?\n/)
    .filter((line) => line.trim())
  const separator = (lines[0] ?? '').includes(';') ? ';' : ','
  return lines.map((line) =>
    line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1')),
  )
}

function columns<K extends string>(
  header: string[],
  wanted: Record<K, string[]>,
): Record<K, number> {
  const names = header.map((cell) =>
    cell
      .toLowerCase()
      .replace(/[^a-z ]/g, '')
      .trim(),
  )
  const found = {} as Record<K, number>
  for (const [key, candidates] of Object.entries(wanted) as [K, string[]][]) {
    const index = names.findIndex((name) => candidates.includes(name))
    if (index < 0 && key !== 'endedOn' && key !== 'province') {
      throw new CodeTablesError(
        `table has no "${candidates[0]}" column (header: ${header.join(', ')})`,
      )
    }
    found[key] = index
  }
  return found
}

function toIsoDate(value: string): string | null {
  const trimmed = value.trim()
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** Uppercase, no accents, single spaces: how names are compared. */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Resolving what a guest wrote into codes
// ---------------------------------------------------------------------------

/**
 * Why a value could not be turned into a code, in words a receptionist can act
 * on. Every message says what was written and what to do about it.
 */
export type Resolution = { ok: true; code: string } | { ok: false; problem: string }

export interface CodeResolver {
  readonly source: TablesSource
  /** An ISO alpha-2 country to the registry's state code. Italy is a state too. */
  country(iso: string, on: string): Resolution
  /**
   * An Italian comune, as the guest wrote it: "Trieste", or "Castro (LE)" when
   * the name is shared. The province, when given, decides between namesakes.
   */
  comune(written: string, on: string): Resolution & { province?: string }
  document(kind: 'passport' | 'idCard' | 'drivingLicence'): Resolution
  /** A document issuer: an ISO country, or an Italian comune by name. */
  issuer(written: string, on: string): Resolution
}

const ITALIAN = new Intl.DisplayNames(['it'], { type: 'region' })

export function createResolver(tables: CodeTables): CodeResolver {
  const valid = (place: Place, on: string) => place.endedOn === null || place.endedOn >= on
  const states = tables.places.filter((place) => place.kind === 'stato')
  const comuni = tables.places.filter((place) => place.kind === 'comune')

  const country = (iso: string, on: string): Resolution => {
    const code = iso.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) {
      return {
        ok: false,
        problem: `“${iso}” is not a country code; choose the country from the list`,
      }
    }
    let italian: string | undefined
    try {
      italian = ITALIAN.of(code)
    } catch {
      italian = undefined
    }
    const wanted = normaliseName(tables.countryAliases[code] ?? italian ?? '')
    const match = states.find((place) => place.name === wanted && valid(place, on))
    return match
      ? { ok: true, code: match.code }
      : {
          ok: false,
          problem: `the registry's list of states has no entry for ${code}${italian ? ` (${italian})` : ''}; check the country, or ask us to add the spelling`,
        }
  }

  const comune = (written: string, on: string): Resolution & { province?: string } => {
    const parsed = /^(.*?)\s*\(([A-Za-z]{2})\)\s*$/.exec(written.trim())
    const name = normaliseName(parsed ? parsed[1]! : written)
    const province = parsed ? parsed[2]!.toUpperCase() : null
    const matches = comuni.filter(
      (place) =>
        place.name === name &&
        valid(place, on) &&
        (province === null || place.province === province),
    )
    if (matches.length === 1) {
      return { ok: true, code: matches[0]!.code, province: matches[0]!.province ?? '' }
    }
    if (matches.length > 1) {
      const provinces = matches.map((place) => place.province).join(', ')
      return {
        ok: false,
        problem: `“${written}” is the name of more than one comune (${provinces}); write it with its province, e.g. “${name} (${matches[0]!.province})”`,
      }
    }
    return {
      ok: false,
      problem: `“${written}” is not a comune in the registry's list${province ? ` for province ${province}` : ''}; check the spelling`,
    }
  }

  const document = (kind: 'passport' | 'idCard' | 'drivingLicence'): Resolution => {
    const code = tables.documentMap[kind]
    return code && tables.documents.some((entry) => entry.code === code)
      ? { ok: true, code }
      : { ok: false, problem: `the registry's document list has no code for “${kind}” yet` }
  }

  const issuer = (written: string, on: string): Resolution => {
    const trimmed = written.trim()
    if (/^[A-Za-z]{2}$/.test(trimmed) && trimmed.toUpperCase() !== 'IT') return country(trimmed, on)
    if (/^[A-Za-z]{3}$/.test(trimmed)) {
      return {
        ok: false,
        problem: `“${trimmed}” reads like a three-letter country code; enter the issuing country or, for an Italian document, the comune`,
      }
    }
    const asComune = comune(trimmed, on)
    return asComune.ok ? asComune : { ok: false, problem: asComune.problem }
  }

  return { source: tables.source, country, comune, document, issuer }
}

let configured: Promise<CodeResolver | null> | null = null

/**
 * The tables in `ALLOGGIATI_TABLES_DIR`, loaded once per process; null when
 * the variable is unset. Read by the worker, for the channel, and by the
 * console, for the manual fallback file: both must write the same codes.
 */
export function configuredCodes(): Promise<CodeResolver | null> {
  const dir = process.env.ALLOGGIATI_TABLES_DIR?.trim()
  if (!dir) return Promise.resolve(null)
  configured ??= loadCodeTables(dir).then(createResolver)
  return configured
}

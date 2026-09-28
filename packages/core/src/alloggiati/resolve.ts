import type { CodeResolver } from './codes'
import type { GuestDetails, StayDetails, ValidationIssue } from './record'

/**
 * A party as the guest wrote it, turned into the registry's codes (WP1.2).
 *
 * The pre-arrival form collects a person: ISO countries, a birthplace as text,
 * an issuer as text. A real channel wants the registry's codes, and a value we
 * cannot translate is a filing the authority will refuse. So every value is
 * resolved here, before anything is sent, and every failure becomes an issue
 * in the same list the console already shows ("Guest 2: place of birth — …"),
 * worded so the person at the desk can fix it with the guest.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFY BEFORE PRODUCTION: two rules below are from public documentation.
 *   · A guest born in Italy is filed with the comune and its province; a guest
 *     born abroad with the state only.
 *   · The identity document is required of a single guest and of the head of
 *     a family or group, not of the members.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs only when code tables are loaded. Without them the mock channel keeps
 * receiving what the guest wrote, visibly untranslated (`mapCountryCode`).
 */
export function resolveParty(
  party: readonly GuestDetails[],
  stay: StayDetails,
  codes: CodeResolver,
): { party: GuestDetails[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const on = stay.arrivalDate

  const resolved = party.map((guest, guestIndex) => {
    const issue = (field: string, problem: string) => issues.push({ guestIndex, field, problem })
    const out: GuestDetails = { ...guest }

    const birthCountry = codes.country(guest.birthCountryCode, on)
    if (birthCountry.ok) out.birthCountryCode = birthCountry.code
    else issue('birthCountry', birthCountry.problem)

    const citizenship = codes.country(guest.citizenshipCode, on)
    if (citizenship.ok) out.citizenshipCode = citizenship.code
    else issue('citizenship', citizenship.problem)

    if (guest.birthCountryCode.trim().toUpperCase() === 'IT') {
      if (!guest.birthPlaceCode?.trim()) {
        issue('birthPlace', 'born in Italy: the comune of birth is required')
      } else {
        const place = codes.comune(guest.birthPlaceCode, on)
        if (place.ok) {
          out.birthPlaceCode = place.code
          out.birthProvince = place.province ?? ''
        } else {
          issue('birthPlace', place.problem)
        }
      }
    } else {
      // Born abroad: the state carries it, and free text in a code field
      // would be refused.
      delete out.birthPlaceCode
      delete out.birthProvince
    }

    // The single guest, or the head of the party, files the document.
    const needsDocument = guestIndex === 0
    if (needsDocument) {
      if (!guest.documentType) issue('documentType', 'the identity document type is required')
      if (!guest.documentNumber?.trim()) issue('documentNumber', 'the document number is required')
      if (!guest.documentIssuerCode?.trim()) {
        issue('documentIssuer', 'where the document was issued is required')
      }
    }

    if (guest.documentType) {
      const kind = codes.document(guest.documentType)
      if (kind.ok) out.documentTypeCode = kind.code
      else issue('documentType', kind.problem)
    }

    if (guest.documentIssuerCode?.trim()) {
      const issuer = codes.issuer(guest.documentIssuerCode, on)
      if (issuer.ok) out.documentIssuerCode = issuer.code
      else issue('documentIssuer', issuer.problem)
    }

    return out
  })

  return { party: resolved, issues }
}

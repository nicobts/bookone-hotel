import {
  buildPayload,
  FIELDS,
  validateParty,
  type GuestDetails,
  type StayDetails,
  type ValidationIssue,
} from './record'
import type { CodeResolver } from './codes'
import { resolveParty } from './resolve'

/**
 * The schedina preview (WP0.4): what would be filed, shown before anything is.
 *
 * Derived from `buildPayload` itself — the fixed-width record is built, then
 * cut back into its fields by the same `FIELDS` layout that built it. Staff see
 * exactly what the filing would contain, not a second rendering of the same
 * data that could quietly disagree with it.
 *
 * Nothing here files anything. In Guest Desk Phase 0 the Alloggiati feature is
 * off and capture ends at staff confirmation (ADR-019, plan §4).
 */
export interface SchedinaField {
  name: string
  value: string
}

export interface SchedinaGuest {
  guestIndex: number
  fields: SchedinaField[]
}

export interface SchedinaPreview {
  /** Every guest has every required field; the preview is the record as it would be filed. */
  ready: boolean
  guests: SchedinaGuest[]
  issues: ValidationIssue[]
}

export function schedinaPreview(
  party: readonly Partial<GuestDetails>[],
  stay: StayDetails,
  /**
   * The registry's codes (WP1.2). With them the preview shows the codes that
   * would be filed, and anything that does not resolve is an issue here, while
   * the guest is still at the desk.
   */
  codes?: CodeResolver | null,
): SchedinaPreview {
  const validated = validateParty(party, stay)
  const coded =
    validated.length === 0 && party.length > 0 && codes
      ? resolveParty(party as GuestDetails[], stay, codes)
      : null
  const issues = coded ? coded.issues : validated

  if (issues.length > 0 || party.length === 0) {
    // Not ready: show what there is, in field order, so staff can see the gap
    // next to what is present rather than a bare list of complaints.
    return {
      ready: false,
      issues,
      guests: party.map((guest, guestIndex) => ({
        guestIndex,
        fields: FIELDS.filter((field) => field.name in guest).map((field) => ({
          name: field.name,
          value: String((guest as Record<string, unknown>)[field.name] ?? ''),
        })),
      })),
    }
  }

  const records = buildPayload(coded ? coded.party : (party as GuestDetails[]), stay).split('\r\n')

  return {
    ready: true,
    issues: [],
    guests: records.map((record, guestIndex) => {
      let offset = 0
      const fields = FIELDS.map((field) => {
        const value = record.slice(offset, offset + field.width).trim()
        offset += field.width
        return { name: field.name, value }
      })
      return { guestIndex, fields }
    }),
  }
}

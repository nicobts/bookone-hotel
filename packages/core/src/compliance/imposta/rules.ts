import { z } from 'zod'

/**
 * A comune's imposta di soggiorno rules, as data (WP1.4).
 *
 * One file per comune, with dated versions: a comune changes its rates by
 * deliberation, and a stay across the change date is charged night by night
 * under the version in force that night. Adding a comune is adding a file; no
 * code knows any comune (ADR-028).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Only fictional comuni ship today (`fictional: true`, codes 999xxx). A real
 *  comune's file is written from its regolamento and checked against it by a
 *  person; WP1.4 is blocked on the Comune di Trieste's. Never invent a rate:
 *  a wrong one is money a property owes, or charged a guest, that it should
 *  not have.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const monthDay = z.string().regex(/^\d{2}-\d{2}$/)

const exemptionSchema = z.discriminatedUnion('kind', [
  /** Nobody below this age at arrival pays. */
  z.object({
    kind: z.literal('age'),
    code: z.string().min(1),
    underAge: z.number().int().positive(),
  }),
  /**
   * A declared reason (a resident, a patient's companion, a coach driver),
   * with the evidence the regolamento asks for recorded beside the stay.
   */
  z.object({ kind: z.literal('reason'), code: z.string().min(1), description: z.string().min(1) }),
])

const reductionSchema = z.object({
  code: z.string().min(1),
  /** Age at arrival, inclusive. */
  fromAge: z.number().int().nonnegative(),
  /** Age at arrival, exclusive; absent means no upper bound. */
  underAge: z.number().int().positive().optional(),
  /** Percent off the night's rate, 1–99. */
  percent: z.number().int().min(1).max(99),
})

export const ruleVersionSchema = z
  .object({
    effectiveFrom: isoDate,
    /** Inclusive; null while in force. */
    effectiveTo: isoDate.nullable().default(null),
    currency: z.literal('EUR'),
    /** Named periods of the year, `MM-DD` inclusive; a period may wrap the new year. */
    seasons: z.array(z.object({ name: z.string().min(1), from: monthDay, to: monthDay })).min(1),
    /** Per person per night, by property category (`*` for any) and season, in cents. */
    rates: z
      .array(
        z.object({
          category: z.string().min(1),
          season: z.string().min(1),
          amountCents: z.number().int().nonnegative(),
        }),
      )
      .min(1),
    /** Nights charged per person per stay, from arrival; null for no cap. */
    maxNights: z.number().int().positive().nullable(),
    exemptions: z.array(exemptionSchema),
    reductions: z.array(reductionSchema).default([]),
    /**
     * `per-night`: each person's night is rounded to the cent. `per-stay`:
     * each person's stay is summed exactly and rounded once. Half up either way.
     */
    rounding: z.enum(['per-night', 'per-stay']),
    /**
     * Which declaration period a stay's tax belongs to: each `night` to the
     * period it falls in, or the whole stay to the period of its `departure`.
     */
    attribution: z.enum(['night', 'departure']),
  })
  .refine((version) => version.rounding === 'per-night' || version.attribution === 'departure', {
    message: 'per-stay rounding needs departure attribution: a stay cannot be split across periods',
  })

export const comuneRulesSchema = z
  .object({
    /** The comune's ISTAT code. */
    comune: z.string().regex(/^\d{6}$/),
    name: z.string().min(1),
    /** True for the test comuni: never used for a real property. */
    fictional: z.boolean(),
    versions: z.array(ruleVersionSchema).min(1),
  })
  .refine(
    (rules) =>
      [...rules.versions]
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
        .every((version, index, sorted) => {
          const next = sorted[index + 1]
          return !next || (version.effectiveTo !== null && version.effectiveTo < next.effectiveFrom)
        }),
    { message: 'versions overlap, or an earlier version has no end date' },
  )

export type RuleVersion = z.infer<typeof ruleVersionSchema>
export type ComuneRules = z.infer<typeof comuneRulesSchema>

/** Parses a rules file, saying what is wrong with it. */
export function parseRules(json: unknown): ComuneRules {
  return comuneRulesSchema.parse(json)
}

/** The version in force on a date, or null. */
export function versionOn(rules: ComuneRules, date: string): RuleVersion | null {
  return (
    rules.versions.find(
      (version) =>
        version.effectiveFrom <= date &&
        (version.effectiveTo === null || date <= version.effectiveTo),
    ) ?? null
  )
}

/** The season a date falls in. The first matching period wins. */
export function seasonOn(version: RuleVersion, date: string): string | null {
  const day = date.slice(5)
  const match = version.seasons.find((season) =>
    season.from <= season.to
      ? season.from <= day && day <= season.to
      : day >= season.from || day <= season.to,
  )
  return match?.name ?? null
}

import { z } from 'zod'

/**
 * The profile contract (ADR-021).
 *
 * A profile is data: which tools one kind of conversation may use, which of
 * them need a person's approval, when to escalate, and where its facts come
 * from. The orchestrator routes each guest turn to exactly one profile and
 * lets it call nothing it does not list.
 *
 * Hard rules are not here. Money, identity, emergencies and "unknown twice"
 * are code in `router/hard-rules.ts` and run before any profile is chosen: a
 * profile can widen nothing they forbid.
 *
 * Adapted from the Guest Desk handoff's `schema.ts`: `systemPromptFile` became
 * `prompt`, the id of a prompt module in `src/prompts/`, because the worker is
 * bundled and a Markdown file read from disk at runtime would not travel with
 * it.
 */

/** T1: the agent resolves alone. T2: staff approve or act. T3: the owner acts. */
export const Tier = z.enum(['T1', 'T2', 'T3'])
export type Tier = z.infer<typeof Tier>

export const EscalationRule = z.object({
  /** Human-readable condition. Evaluated by router code, never by a model. */
  when: z.string().min(1),
  to: Tier,
  notify: z
    .array(z.enum(['inbox', 'staff_whatsapp', 'owner_whatsapp', 'email']))
    .default(['inbox']),
  slaMinutes: z.number().int().positive().optional(),
})

export const Grounding = z.object({
  sources: z.array(
    z.enum(['hotel_content', 'local_guide', 'booking_record', 'guest_record', 'policy']),
  ),
  unknownBehaviour: z.enum(['escalate_T2', 'say_unknown']).default('escalate_T2'),
})

export const ProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z-]+$/),
    version: z.number().int().positive(),
    phase: z.number().int().min(0),
    description: z.string().min(1),
    languages: z.array(z.enum(['it', 'en', 'de', 'sl'])).default(['it', 'en']),
    /** `small` for routing and simple answers, `strong` for choosing an action (ADR-023). */
    modelTier: z.enum(['small', 'strong']),
    maxSteps: z.number().int().min(1).max(8),
    /** Id of the prompt module in `src/prompts/`. Never an inline prompt. */
    prompt: z.string().regex(/^[a-z-]+$/),
    /** The allow-list. Nothing else is callable by this profile. */
    tools: z.array(z.string().min(1)).min(1),
    /** Tools that never run without a person's approval, whatever the model decides. */
    approvalRequired: z.array(z.string()).default([]),
    escalation: z.array(EscalationRule),
    grounding: Grounding,
    /** The one action the demo proves for this profile. */
    primaryAction: z.string().min(1),
    /** Reachable from a guest thread. `false` for the owner's own agent. */
    guestFacing: z.boolean().default(true),
  })
  .strict()
  .superRefine((profile, ctx) => {
    for (const name of profile.approvalRequired) {
      if (!profile.tools.includes(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['approvalRequired'],
          message: `"${name}" needs approval but is not in this profile's tools`,
        })
      }
    }

    if (!profile.tools.includes(profile.primaryAction)) {
      ctx.addIssue({
        code: 'custom',
        path: ['primaryAction'],
        message: `primary action "${profile.primaryAction}" is not in this profile's tools`,
      })
    }
  })

export type Profile = z.infer<typeof ProfileSchema>

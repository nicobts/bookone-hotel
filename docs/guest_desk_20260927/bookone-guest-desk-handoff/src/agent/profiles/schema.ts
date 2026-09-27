/**
 * Profile contract — ADR-F1. Profiles are data, validated at boot. The router loads every
 * file in this directory, validates it, and registers only the tools each profile lists.
 */
import { z } from "zod";

export const Tier = z.enum(["T1", "T2", "T3"]);
// T1: agent resolves alone. T2: staff must approve/act. T3: owner must act.

export const EscalationRule = z.object({
  when: z.string(),                 // human-readable condition, evaluated by router code, not by the model
  to: Tier,
  notify: z.array(z.enum(["inbox", "staff_whatsapp", "owner_whatsapp", "email"])).default(["inbox"]),
  slaMinutes: z.number().int().positive().optional(),
});

export const Grounding = z.object({
  sources: z.array(z.enum(["hotel_content", "local_guide", "booking_record", "guest_record", "policy"])),
  unknownBehaviour: z.enum(["escalate_T2", "say_unknown"]).default("escalate_T2"),
});

export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z-]+$/),
  version: z.number().int().positive(),
  phase: z.number().int().min(0),
  description: z.string(),
  languages: z.array(z.enum(["it", "en", "de", "sl"])).default(["it", "en"]),
  modelTier: z.enum(["small", "strong"]),          // small = routing/T1 replies, strong = actions
  maxSteps: z.number().int().min(1).max(8),
  systemPromptFile: z.string(),                    // prompts/<id>.<lang>.md
  tools: z.array(z.string()),                      // MCP tool names; allow-list, nothing else callable
  approvalRequired: z.array(z.string()).default([]),// subset of tools that always need needsApproval
  escalation: z.array(EscalationRule),
  grounding: Grounding,
  primaryAction: z.string(),                       // the one action the demo proves for this profile
});

export type Profile = z.infer<typeof ProfileSchema>;

/** Hard rules are NOT in profiles. They live in src/agent/router/hard-rules.ts and run before any profile. */

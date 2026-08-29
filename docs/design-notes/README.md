# Design notes

One note per product surface, written **before** the surface is built.

ADR-014 and 08 §3 make this mandatory: no UI surface is designed from a blank
page where a reference implementation has already paid for the validation. Each
note records the sequence **understand → validate for our buyer → re-derive and
improve**, and is simultaneously the quality gate and the documented evidence of
independent development.

A note is not a spec. It says what was studied, what we take, what we change and
why the change is tied to the wedge — small independent hotels in IT/AT/SI whose
guest journey is the product. Implementation detail belongs in the code.

## Legal hygiene (ADR-014 §3.1, binding)

Reference operates at the level of **behavior and rationale, never expression**.
Step sequences, form order, industry conventions and standard terminology are
free to adopt. Code, visual assets, UI or marketing copy, pixel-close imitation
and coined names are not, ever. Study uses public materials only.

If a note quotes a competitor's wording, the note is wrong.

## Notes

| Surface | Reference (08 §3) | Note |
|---|---|---|
| Booking flow | Mews booking engine + Booking.com mobile flow | [booking-flow.md](booking-flow.md) |
| Pre-arrival check-in | Mews Kiosk flows, transposed to the guest's phone | [pre-arrival.md](pre-arrival.md) |
| In-stay messaging | *none named in 08 §3* — proposed in the note | [stay-messaging.md](stay-messaging.md) |
| Arrival & express checkout | Mews Kiosk flows (the check-out half) | [express-checkout.md](express-checkout.md) |
| Monthly report | *none named in 08 §3* — proposed in the note | [monthly-report.md](monthly-report.md) |
| Onboarding & self-service | Mews property setup + the self-serve activation checklist (Stripe) | [onboarding.md](onboarding.md) |

Two notes on the state of this table.

**One note was written late.** [pre-arrival.md](pre-arrival.md) records a
surface that shipped in Sprint 5 without it. The reference was studied and the
deviations were argued in the code, but the note that makes that auditable was
skipped, and the note says so at the top rather than being backdated.

**One surface had no reference to name.** 08 §3's table does not cover in-stay
messaging. [stay-messaging.md](stay-messaging.md) proposes two references and
argues the deviations from each; 08 §3 now carries the row. A missing row is a
gap in the policy, not permission to design from a blank page.

Surfaces still to come, each with its reference already named in 08 §3: the tape
chart (Mews Operations + Slope), quotes/*preventivi* (Slope), guest profiles
(Mews Guest CRM).

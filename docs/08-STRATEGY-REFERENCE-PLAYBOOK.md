# 08 — Strategy Record & Reference Playbook

**"Samwer the demand, not the product" — decision record of the market-entry strategy discussion**

| | |
|---|---|
| Status | Agreed — decisions D19–D21 registered |
| Date | July 2026 |
| Inputs | 07-COMPETITIVE-ANALYSIS · market scan July 2026 · strategy discussion (Rocket Internet model audit) |

---

## 1. What was discussed

The question examined: can we treat the Italian market as a protected pocket and replicate a proven international platform (Mews as the reference success), the way Rocket Internet / the Samwer brothers ported validated US models to Europe (Alando→eBay, CityDeal→Groupon, Zalando)?

**Audit of the clone model against this market:**

| Rocket precondition | Holds here? |
|---|---|
| Demand validated by the original | ✅ Mews at $2.5B / 12,500 properties proves hotels pay for modern PMS |
| Localization barrier protects the local player | ✅✅ Stronger than Rocket's cases: language + SDI/corrispettivi + Alloggiati + tourist tax per comune + commercialista ecosystem + relationship sales |
| Industrialized execution army + aggressive capital | ❌ Solo founder |
| No regulatory moat to build | ❌ The barrier cuts both ways — the fiscal layer that excludes Mews is the same €350–520k + €130k/yr we priced in the PMS cost reference |
| Speed-to-liquidity decides the market | ❌ Relationship-driven B2B with a Nov–Feb switching window cannot be blitz-scaled |
| Clone lane empty | ⚠️ Slope already occupies "modern Italian all-in-one" |

**Additional asymmetry:** cloning 2026-Mews means cloning ~10 years of product; what is realistically clonable solo is 2014-Mews — which is our MSP estimate, 20+ months to first revenue, a window in which Mews can enter Italy faster than we can become Mews.

## 2. What was agreed

**A1. The arbitrage is real but re-aimed: we clone the *validated demand*, not the product.** Mews's traction is treated as market proof that our buyer pays for modern software at known price points; their product is treated as a free R&D catalog for everything outside our wedge.

**A2. Innovation budget is spent only on the wedge.** The wedge (unchanged, per 07 §4): guest-operated zero-touch model with audited agents · dual-source no-migration adoption · Italian statutory automation as journey feature · small-hotel agent-run economics · F&B/half-board native. Everywhere else — UX conventions, flows, terminology, pricing metrics — we deliberately adopt proven patterns instead of designing from zero.

**A3. The full-clone lane is explicitly rejected** (a "better Italian PMS" head-on): seat partially taken by Slope, timeline loses to funded entrants, and it forfeits our only structural advantages (M1–M4).

**A4. The endgame is written down, not just implied.** The Samwer mechanism that fits best is the exit-to-original: the local player that owns the territory the original cannot cheaply enter becomes the acquisition. Building for acquirability and building for independence require the identical asset list (§5), so no strategic fork is created.

## 3. Reference implementation policy (D19)

**Rule: never design from a blank page where a reference has already paid for validation.** For each product surface, a named reference implementation is studied before build; deviation from the reference requires a stated reason tied to the wedge.

| Surface | Reference | What we adopt |
|---|---|---|
| Booking flow | Mews booking engine + Booking.com mobile flow | Step count, form order, payment placement, urgency/reassurance copy patterns |
| Tape chart / reservation timeline (R5) | Mews Operations + Slope | Layout conventions, drag interactions, status color language — hoteliers' muscle memory is a feature |
| Terminology | Slope (Italian), Mews glossary (DE/EN) | Standard hospitality vocabulary; never invent terms — InnSyst's lesson: staff productive within one shift |
| Guest profiles / repeat recognition | Mews Guest CRM (their signature strength) | Profile model, merge logic, "welcome back" journey triggers — property-scoped only (GDPR boundary stays ours) |
| Self-service check-in UX | Mews Kiosk flows, transposed to guest phone | Step logic and document-capture ergonomics; we deliberately skip hardware kiosks (phone-native is the small-hotel answer) |
| In-stay guest messaging | Hotel guest-messaging products (Duve, HiJiffy) + the support-inbox pattern (Intercom) | Thread-per-stay, AI-first-then-human escalation ladder, staff takeover semantics, KB-sourced answers — added Sprint 7; the table had no row for this surface and the design note argues the deviations |
| Monthly usage/fee report | Usage-billing statement pattern (Stripe billing dashboard, AWS Cost Explorer) | Period selector, subtotal-by-line-type, drill-down from a charge to the events behind it, export — added Sprint 8; the table had no row for a billing surface and the design note argues the deviations |
| Property onboarding & self-service setup | Mews property setup + self-serve activation checklists (Stripe) | Checklist-with-progress, grouping by what each item unblocks, and the product working before the checklist is finished — added Sprint 9 |
| Data-subject requests & the export bundle | Google Takeout and Stripe's account data export (the bundle) + the DSR request queue as practised by privacy-management tooling (OneTrust, Osano) | Request-as-a-tracked-object with a stated deadline, a single archive with a manifest rather than a set of screens, and the separation of *erasure requested* from *erasure applied* — added Sprint 10; the table had no row for a compliance surface and the design note argues the deviations |
| Quotes / preventivi | **Slope** (their signature strength) | Quote structure, group/family handling, follow-up cadence |
| Unified data model narrative | Mews "single data model" positioning | Their $300M-validated pitch language maps 1:1 onto our canonical model + event log — we adopt the narrative frame with our substance |
| Marketplace/module packaging | Mews Starter/Elevated/Premium tiering, Apaleo Store | Tier naming logic and module boundaries |
| What we NEVER copy | Their strategy | Migration-required adoption, kiosk hardware, chain/group focus, marketplace-assembly burden on the owner, top-down agentic framing |

### 3.1 Legal hygiene — reference, not reproduction (binding, full text in ADR-014)

The policy operates strictly at the level of **behavior and rationale, never expression**. Free to use: functionality, workflows, pricing models, step sequences, industry conventions, standard terminology — ideas and functionality are not protectable (in the EU, software functionality is expressly outside copyright per CJEU case law; verify final policy with IP counsel). Never used: code, visual assets, UI or marketing text, pixel-close imitation, coined/distinctive names (e.g. generic "Starter"/"Premium" acceptable; a competitor's distinctive coined tier name is not — our tiers carry our own names). Study relies on public materials; no trial accounts created for dissection where ToS prohibit competitive analysis. Comparative statements naming competitors must be truthful, verifiable, and non-denigrating (EU comparative-advertising rules — and M6 requires provable numbers anyway).

**Mandatory sequence per surface: understand → validate for our buyer → re-derive and improve.** Each surface gets a short design note (reference studied, rationale, what we changed and why). The note is simultaneously the quality gate and the documented evidence of independent development.

## 4. Pricing language (D20)

The market has been educated in **€/room/month** (Mews ~€15–17, Cloudbeds ~$15–17, Apaleo per-room-per-day, InnSyst $6). Our hybrid model (D14) is unchanged in substance but is **always displayed with its per-room equivalence** so buyers can compare in the unit they know.

Worked example, 45-room property: base €250 + typical direct-booking fees ≈ €420/month total → presented as **"≈ €9/room/month, everything included — bookings, journey, AI reception, Alloggiati"** vs Mews-style stacks where PMS entry + marketplace apps + a communication layer land at 2–3× that. The comparison line writes itself; sales collateral uses it verbatim.

## 5. Endgame register (D21)

Not a plan to sell — a discipline on what to invest in. Every asset below compounds toward *both* independence and acquirability; anything not on the list is vanity.

| Plausible acquirer | What they'd be buying | Their alternative cost |
|---|---|---|
| **Mews** (or Cloudbeds) | Italy entry: statutory layer (Alloggiati/ISTAT/tax), installed-base bridge into Zucchetti properties (dual-source), small-hotel economics they can't reach, IT/DE/SL localization + relationships | Years of fiscal integration + cold-start sales in a relationship market |
| **Zucchetti / TeamSystem** | Architectural renewal + the guest-journey/agent layer their portfolio lacks; defensive removal of the graduation threat | They've acquired ~10 PMS companies — it is literally their pattern |
| **Voice/AI hospitality consolidator** | The evidence-billed agent layer + property distribution | Building trust data per property class from zero |

**The compounding asset list** (what all three pay for): properties live on the platform · statutory automation in production · `agent_runs`/eval corpus per property class · the dual-source bridge into the incumbent installed base · association/consultant relationships · the zero-touch metric track record.

## 6. Decisions registered

| # | Decision |
|---|---|
| **D19** | Reference-implementation policy: named reference per surface (§3); blank-page design forbidden outside the wedge; deviations require a wedge-tied reason |
| **D20** | All pricing communicated with €/room/month equivalence alongside the hybrid model (D14 unchanged in substance) |
| **D21** | Endgame register maintained (§5); investment prioritization tested against the compounding asset list |

## 7. Documentation changelog applied

- `00-PROJECT-OVERVIEW`: index + D19–D21 added to the register
- `docs/adr/`: ADR-014 (reference implementations), ADR-015 (pricing display metric)
- `01-PRD` §6: per-room equivalence display requirement added
- `02-USER-STORIES`: E1.2 AC now cites the reference-flow benchmark; preventivi story added to E1 (P1) per 07 §3
- `07-COMPETITIVE-ANALYSIS`: cross-reference to this record (§6 verdict unchanged)

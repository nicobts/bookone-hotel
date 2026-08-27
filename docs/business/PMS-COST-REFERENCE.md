# Cost Reference — Full PMS Build

**Building an AI-native competitor to Ericsoft/Zucchetti**

| | |
|---|---|
| Owner | Nicolas |
| Entity | RT Holding Group GmbH (AT) |
| Status | Reference estimate — for investor discussion |
| Date | July 2026 |
| Related | PRD.md (BookOne Concierge), IOT-PROPOSAL.md, Doc #1 |

---

## 1. How to read this document

All figures are **reference ranges for planning and negotiation**, not quotes. They assume:

- Nicolas as founder/architect, working full time
- Nearshore-weighted senior engineering at €70–95k loaded per year (MIN) and in-region senior at €95–125k (MAX)
- AI-assisted development throughout, at a blended **1.8–2.4× multiplier on engineering work only**
- No AI compression applied to compliance consultants, certifications, legal, infrastructure, or support headcount — those are calendar- and people-bound, not code-bound

**Definitions of "done"** — cost varies by 5× depending on which one you mean:

| Milestone | Definition |
|---|---|
| **M1 — Pilot** | Runs alongside Ericsoft. Nobody depends on it |
| **M2 — First property live** | One hotel runs its entire operation on it. Ericsoft removed |
| **M3 — Sellable to strangers** | A hotel with no relationship to us can buy, migrate, and be supported |
| **M4 — Competitive parity** | We win head-to-head deals on features, not sympathy |

Most estimates budget M2 and are surprised that M3 costs as much again. M4 is where the incumbent's thirty years actually live.

---

## 2. Headline reference

| | **MINIMUM** | **MAXIMUM** |
|---|---|---|
| **Scope** | Italy only. 30–80 room independents. Single property. Buy everything possible. | Italy + Austria + Slovenia. Multi-property/chain. Full integration ecosystem. |
| **Target milestone** | M3 — sellable | M4 — parity |
| **Engineering (person-months)** | 25–28 | 95–130 |
| **Peak team** | 2–3 | 11–15 |
| **Time to first revenue** | 20–26 months | 30–36 months |
| **Total capital** | **€350k – €520k** | **€2.6M – €4.3M** |
| **Ongoing statutory maintenance** | €130k – €180k / year | €180k – €260k / year |

The gap between these two numbers is not ambition — it is **countries, chains, and integration breadth**. Each is a deliberate scope decision, not a quality decision.

---

## 3. Scenario MINIMUM — Minimum Sellable PMS

### Scope

There is no lean MVP for a PMS. A hotel either runs its operation on the system or it does not. The floor is set by law and by daily operations. You can cut breadth; you cannot cut the floor.

| In — the non-negotiable floor | Out — deferred |
|---|---|
| Reservations, inventory, rates, restrictions | Groups, allotments, negotiated contracts |
| Tape chart, check-in/out, room moves, **night audit** | Meetings, banqueting, spa, wellness |
| Folios, billing, **SDI + corrispettivi/RT** | Multi-property, chains, central reservations |
| **Alloggiati, tourist tax, ISTAT** | Revenue management |
| Channel manager (integrate, never build) | Door locks, POS beyond one each |
| Payments via Stripe/Adyen (PCI SAQ-A) | Guest app, full staff mobile |
| Basic housekeeping | Austria, Slovenia |
| Production reports: ADR, RevPAR, occupancy | Complex derived rate logic |
| F&B + half-board *(leverages BookOne)* | |
| Ericsoft migration tooling | |
| Offline resilience | |
| **AI layer — voice, ops automation, NL reporting** | |

The AI layer stays in. It is the only reason anyone switches; everything else is table stakes they already have.

### Engineering effort

| Module | Baseline PM | With AI leverage |
|---|---|---|
| Reservation & inventory engine | 4.0 | 2.0 |
| Front desk ops + night audit | 4.0 | 2.2 |
| Billing, folios, Italian fiscal | 6.0 | 4.3 |
| Statutory reporting (Alloggiati, ISTAT, tax) | 3.0 | 2.2 |
| Channel manager integration | 3.0 | 2.5 |
| Booking engine | 2.0 | 0.8 |
| Payments | 2.0 | 1.1 |
| Housekeeping | 1.5 | 0.6 |
| F&B / half-board | 2.0 | 1.0 |
| Core integrations (1 lock, 1 POS, accounting export) | 3.0 | 2.6 |
| Reporting & analytics | 2.0 | 1.0 |
| AI layer | 4.0 | 2.0 |
| Platform foundation (multi-tenant, RBAC, audit, i18n, offline, DR) | 5.0 | 2.6 |
| Migration tooling | 2.0 | 0.8 |
| QA, hardening, pen test remediation | 3.0 | 2.1 |
| **Total engineering** | **46.5** | **~27.8** |

Rounded working range: **25–28 engineering person-months.**

### Cost

| Line | Low | High |
|---|---|---|
| 1 senior engineer × 20 months (nearshore, loaded) | €120,000 | €160,000 |
| 2nd engineer × 8 months (phase overlap) | €50,000 | €70,000 |
| Fiscal/regulatory consultant (fractional, 20 months) | €30,000 | €50,000 |
| Infrastructure, tooling, AI spend | €30,000 | €50,000 |
| Certification & integration fees (channel manager, SDI intermediary) | €20,000 | €45,000 |
| Legal, DPAs, contracts, insurance | €20,000 | €35,000 |
| Security audit + penetration test | €12,000 | €22,000 |
| Contingency @ 20% *(non-optional on a fiscal build)* | €56,000 | €86,000 |
| **Subtotal — founder unpaid** | **€338,000** | **€518,000** |
| Founder salary @ €60k/yr × 22 months | €110,000 | €110,000 |
| **Total including founder** | **€448,000** | **€628,000** |

**Reference figure: €350k – €520k** excluding founder compensation; **€450k – €630k** including it.

### Timeline

| Milestone | Month |
|---|---|
| M1 — Pilot alongside Ericsoft | 9–12 |
| M2 — Design partner fully live | 14–18 |
| M3 — Sellable to unrelated properties | 20–26 |

---

## 4. Scenario MAXIMUM — Competitive parity

### Additional scope over MINIMUM

- Austria (RKSV fiscal) and Slovenia (FURS fiscal)
- Multi-property, chains, central reservations, group management
- Full integration ecosystem: multiple lock vendors, POS systems, revenue management, accounting packages, PBX, door, energy
- Guest mobile app and full staff mobile
- Complex rate logic: derived rates, yield rules, negotiated corporate contracts
- Marketplace/API for third-party developers
- SOC 2 posture
- Implementation and 24/7 multilingual support organisation
- Enterprise sales motion

### Cost

| Line | Low | High |
|---|---|---|
| Engineering (95–130 PM, in-region senior, AI-assisted) | €1,100,000 | €1,900,000 |
| Product, design, QA, DevOps | €380,000 | €650,000 |
| Compliance across 3 countries + ongoing during build | €250,000 | €420,000 |
| Certifications, integration partner fees, channel manager | €120,000 | €230,000 |
| Infrastructure, licences, AI inference at scale | €160,000 | €300,000 |
| Legal, IP, insurance, contracts | €90,000 | €160,000 |
| Security, audits, SOC 2 | €80,000 | €140,000 |
| Implementation & support organisation build-out | €200,000 | €380,000 |
| Contingency @ 15% | €360,000 | €640,000 |
| **Total** | **€2,740,000** | **€4,820,000** |

**Reference figure: €2.6M – €4.3M** for the realistic band; **up to €4.8M** if contingency is fully consumed.

*Note: this is materially below the €4.9M–€7.6M I estimated before applying AI leverage. The compression is real, but it applies to roughly 55–60% of the cost base — not to compliance, certification, support headcount, or calendar.*

### Timeline

| Milestone | Month |
|---|---|
| M2 — First property live | 20–26 |
| M3 — Sellable | 28–34 |
| M4 — Competitive parity | 40–50 |

---

## 5. Staged path from MINIMUM to MAXIMUM

| Stage | Adds | Months | Cost | Cumulative |
|---|---|---|---|---|
| **1 — MSP** | The Italian floor, single property, AI layer | 0–24 | €350–520k | €0.35–0.52M |
| **2 — Regional** | Austria fiscal, multi-property, groups, integration ecosystem, staff mobile | 24–34 | €450–750k | €0.8–1.3M |
| **3 — Scale** | Slovenia fiscal, chains, revenue management, guest app, marketplace, SOC 2 | 34–44 | €800k–1.4M | €1.6–2.7M |
| **4 — Parity** | Feature depth, implementation + 24/7 support org, enterprise sales | 44–56 | €1.0–1.6M | **€2.6–4.3M** |

Each stage is independently fundable and independently abandonable. That is the main argument for staging rather than committing to the full programme up front.

---

## 6. The permanent cost

Independent of the build, and it never stops:

| Item | Annual |
|---|---|
| Italian fiscal maintenance (SDI, RT, annual rule changes) | €60k – €90k |
| Statutory reporting maintenance (Alloggiati, ISTAT, tourist tax per comune) | €40k – €60k |
| Austria (RKSV) + Slovenia (FURS), from stage 2–3 | €50k – €110k |
| **Total** | **€130k – €260k / year** |

That is **1.5–2.5 FTE forever**, producing zero new features. AI does not compress this — the work is regulatory tracking, interpretation, and certification, not code volume. It is the single most commonly omitted line in PMS business plans.

---

## 7. Breakeven

At realistic Italian independent-hotel pricing:

| Price / property / month | ARR each | Properties to cover €600k/yr burn | To cover €1.5M/yr |
|---|---|---|---|
| €300 | €3,600 | 167 | 417 |
| €500 | €6,000 | 100 | 250 |
| €800 | €9,600 | 63 | 156 |

**Sales reality constrains this more than pricing does:**

- Hotels switch PMS **only between November and February**. Miss the window, wait a year.
- Migration takes weeks per property — historical reservations, folios, guest data, staff retraining.
- A solo-founder-origin vendor is asking a hotel to bet its season.

Realistic trajectory: **15–25 properties in year one, 40–60 in year two, 80–120 cumulative by year three.**

**Breakeven lands in year 4–6**, having consumed €1.5M–€3M of cumulative capital including operating losses beyond the build cost above.

---

## 8. Comparison across all three paths

| | AI layer on top | PMS — MINIMUM | PMS — MAXIMUM |
|---|---|---|---|
| Peak team | 2–3 | 2–3 | 11–15 |
| **Time to first revenue** | **3–5 months** | **20–26 months** | **30–36 months** |
| Capital to sellable | €290k – €560k | €350k – €520k | €2.6M – €4.3M |
| Permanent statutory cost | Minimal | €130–180k/yr | €180–260k/yr |
| Breakeven properties @ €400/mo | ~40 | ~150 | ~450 |
| Failure mode | Feature commoditised | Capital exhausted at 60% built | Capital exhausted at 40% built |
| Bus-factor tolerance | Acceptable | Severe risk | Fatal without co-founder |

**The decisive observation:** MINIMUM PMS and the AI layer now cost roughly the same. The difference is not money — it is **fifteen to twenty months of delay to first revenue**, and a permanent statutory maintenance obligation.

AI compressed the cost of building a PMS. It did not compress the calendar: partner API approval queues, OTA certification, and one full high season plus one year-end close of parallel running remain irreducible.

---

## 9. Conditions under which the full build becomes rational

The MINIMUM scenario should only be started if **four or more** of these hold:

1. **€600k+ committed in writing**, tranched against milestones — not "ready to invest"
2. A **technical co-founder or equity-motivated first engineer** with hotel-domain experience
3. **10+ properties signing paid LOIs at price** before development starts
4. The investor is a **group operator with contractual authority** over properties, not a well-connected owner
5. A credible path to **institutional capital** for the round after his
6. Willingness to commit **4–6 years**

If fewer than four hold, MINIMUM is the more dangerous scenario, not the safer one: enough capital to reach 60% completion and stop. **Half a PMS has zero value** — you cannot sell 70% of a legal obligation.

---

## 10. Recommendation

Build the AI layer first. Reach 30–50 paying properties and real ARR. *Then* the PMS conversation changes entirely — you would hold distribution, reference customers, domain data, operational credibility, and a reason for institutional investors to fund it.

The alternative is asking one enthusiastic hotelier to underwrite a multi-year product programme against a €1B group, before any revenue exists to prove the thesis.

The numbers above exist so that conversation can be had with real figures rather than optimism. They are equally useful as an argument for the full build, if the conditions in Section 9 are genuinely met.

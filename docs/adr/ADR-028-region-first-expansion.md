# ADR-028 — Expansion is one region at a time, each a registry entry

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-026 (ComplianceAdapter) · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F8

## Triggering event

Statistical reporting in Italy is regional (WebTur in FVG, ROSS1000 in Veneto, Turismo5 in
Lombardia, and others), and the imposta di soggiorno is set per comune. The go-to-market plan is to
sell through provincial associations. Both the code and the sales motion need one unit of expansion.

## Decision

**The expansion unit is a region**: one regional ISTAT `ComplianceAdapter`, one rule table per comune
served, and one signed provincial association convention.

Order: **Friuli Venezia Giulia** (WebTur, Comune di Trieste) → **Veneto** (ROSS1000) →
Trentino-Alto Adige → Lombardia (Turismo5). A national association approach is made only after three
regions are live with signed conventions and 30-day pilot metrics.

Technically, a **region registry** exists from WP1.1: a property's region and comune select its
adapters and rule tables. No code branches on a region name.

## Cost of change / cost of not changing

**If wrong:** the registry costs one lookup per filing; a national-first approach could still use it.

**If not done:** region logic scatters into `if (region === 'FVG')` branches, and the second region
costs as much as the first.

## Alternatives rejected

- **National approach first.** Heavier sales cycle, and there is no national statistical system to
  integrate with — the work is regional regardless.
- **Many regions in parallel.** One developer; each region needs a convention and a pilot set.

## Consequences

- Region expansion estimates at 3–4 weeks each, once the first is live.
- A property outside a supported region can still use Alloggiati Web (national) with the regional
  return on manual fallback.

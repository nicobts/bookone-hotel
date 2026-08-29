# Design note — onboarding and self-service (`/console/setup`, `/console/knowledge`)

**Surface:** the property setup wizard, the knowledge-base editor, and the
role-limited console, Sprint 9 (04 §1 Phase D).
**Stories:** E7.1, E5.3 (P0), E5.5, E7.3 (P1).
**Reference (08 §3, ADR-014):** Mews' own property setup and Guest CRM
onboarding, plus the checklist pattern as practised by self-serve SaaS
onboarding (Stripe's account activation checklist). Studied from public
documentation and published demos only.
**Adopted:** the checklist-with-progress shape, grouping configuration by *what
it unblocks* rather than by data model, deferring anything not needed to
transact, and the "you can start before you finish" property of a good
checklist.

---

## 1. Understand — what the references do, and why it works

Every successful self-serve onboarding has converged on the same three
behaviours, and none of them is about the form fields:

- **The list is visible from the first minute.** Not a wizard that reveals step
  four when you finish step three. A person deciding whether to start needs to
  see the whole cost up front, and the ones who abandon do it at the step they
  did not know was coming.
- **Progress is stated as a fraction of something.** "4 of 7" with the
  outstanding items named. A percentage bar with no items is a progress
  indicator; a named list is a plan.
- **The account works before the checklist is done.** Stripe lets you take test
  payments with a half-finished account and blocks only the specific thing that
  needs the missing field. This is the one most products get wrong: gating
  everything on completeness turns a five-minute task into a five-day one,
  because the person has to go and find a document before they can see anything
  work.

The deeper pattern: a good checklist is a **map of consequences**, not a form
split into pages. Each item says what it unblocks, so skipping is an informed
decision rather than an act of avoidance.

## 2. Validate for our buyer

**Five days is the GA target, and it is a business constraint rather than a UX
aspiration.** 04 §1 Sprint 9's DoD is a second property onboarded by a
non-engineer following a runbook. G5 — support economics — is the moat that
fails first if this takes a week of somebody's attention.

**The person doing this owns the hotel and it is not their job.** They are doing
it between a check-in and a delivery. The design consequence is not "make it
shorter"; it is **make it resumable and make every item independently
completable**. Same reasoning as the pre-arrival page, for the same reason.

**Most of the configuration is optional and the product must say which.** A
property can take bookings with a name, a room type and a price. Everything
else — theming, tourist tax, cancellation windows, knowledge base — improves the
result and blocks nothing. A checklist that presents all of it as equally
required is a checklist that gets abandoned at the tourist-tax rate table.

**They will not write a knowledge base.** This is the hardest constraint in the
sprint and it is why Sprint 7 shipped a concierge that escalates more than it
answers. An empty KB is the default state of every property forever unless
something else fills it, which is what AG-03 is for.

## 3. Re-derive — the surfaces we build

**Setup (`/console/setup`)** — one page, a checklist of items, each with its
own small form and a stated consequence:

| Item | Unblocks | Required to transact |
|---|---|---|
| Name, languages, timezone | everything | ✅ |
| Room types and capacity | the booking surface | ✅ |
| Contact address | booking requests, escalation alerts, invoice requests | ✅ |
| Theming | the property looking like itself | — |
| Deposit and cancellation policy | taking a deposit | — |
| Tourist tax | the note beside the total | — |
| Knowledge base | the concierge answering rather than escalating | — |
| Payment account | real money | **blocked** (ADR-010) |

**Knowledge (`/console/knowledge`)** — the KB editor. A list of topics, each
with its phrasings and its answers per language, and a published toggle.

**Role-limited console (E5.5)** — a staff member sees Today, Exceptions,
Conversations, Reservations and Guests. Not Settings, not Team, not Revenue, not
Setup.

## 4. Deviations, each tied to the wedge

**(A) Nothing is gated on the checklist being complete.** The references gate
specific *actions* on specific fields, and that is what we do too: a property
with no contact address cannot receive a booking request, and the item says so.
There is no state in which the console refuses to work because setup is at 4/7.

**(B) The checklist reads the same rows the product does.** There is no
`setup_completed` column and no separate progress table. An item is done when
the thing it describes exists — a room type row, a contact address in settings.
A stored progress flag is a second source of truth that drifts the first time
somebody changes a setting through another path, and then the checklist tells a
new owner to do something they have already done.

**(C) Payment setup is present, describes itself, and does nothing.** ADR-010:
no provider is connected. The item is on the list with the other blocked
external decisions rather than hidden, because an owner who discovers at go-live
that payments were never configured has been misled by an absence.

**(D) The knowledge editor is per-topic, not per-language.** The references
build a translation matrix — one screen per language, articles down the side. We
put all four answers for one topic on one screen, because the person editing is
the person who knows the answer and they are correcting *breakfast*, not
*German*. It also makes the missing-locale case visible: an empty German box on
the same screen as a filled Italian one is a prompt, where a separate German
screen is a place nobody goes.

**(E) A missing language is shown as missing, never machine-filled.** Same rule
as everywhere else in the product (binding rule 7). The editor says which
languages an answer exists in and the concierge escalates for the rest. Offering
a "translate" button would be offering to generate a claim about a business.

**(F) Editing bumps a version and takes effect immediately.** E5.3 says live in
≤60s; there is no cache to invalidate, so it is live on the next question. The
version exists for the audit — an evidence chain that says "the KB said so" is
only a defence if the KB can be shown as it stood.

**(G) The staff role is enforced server-side, and the sidebar merely reflects
it.** A hidden nav item is not a permission. Every owner-only route resolves the
membership role and 404s for staff — the same treatment as a property they do
not belong to, because "this exists and you may not see it" is more information
than a URL needs to give.

**(H) AG-03 drafts, and drafts are invisible to guests.** It writes KB articles
with `published = false`, which the concierge already refuses to quote. The
review surface is the editor the owner is already in, not a separate approval
queue — a second inbox is a second thing to abandon.

**(I) The URL an owner types is treated as hostile.** AG-03 fetches it from
inside our worker and stores the response where they can read it, which makes it
a read primitive against everything the worker can reach — cloud metadata, the
Supabase endpoint on the same host, any internal service. The first version
checked only the scheme, which is not a control: `http://169.254.169.254/`
passes it. Every fetch now resolves the hostname and refuses if *any* address is
private, loopback, link-local or reserved, and each redirect hop is re-checked.

"An owner is authenticated" is not a mitigation. An owner is trusted with their
property's data and with nothing about our infrastructure, and those are
different grants. The residual risk is DNS rebinding, which needs an egress
proxy rather than a code change — Sprint 10.

## 5. Deliberately deferred

- **Stripe Connect onboarding** (E7.1 names it) — blocked on 04 §0 item 6.
- **The generic T2 proposal surface.** AG-03's proposals are KB drafts and are
  reviewed in the editor. AG-04 and full AG-05 need a diff-card surface for
  proposals that are *not* rows an owner already edits, and that is the honest
  prerequisite for those agents rather than for this sprint.
- **Demo-mode toggle** (E7.1) — the seed script covers the same need for the
  people who currently need it, and a toggle that produces fake bookings in a
  real property's console is a support incident waiting to happen.
- **Multi-property roll-up and module entitlements as pricing.** The flags exist
  (E7.3); billing on them is not this sprint.

## 6. How we will know it worked

- The DoD is a non-engineer onboarding a property from the runbook in ≤5 days.
- The share of a property's concierge threads that escalate, before and after
  AG-03's drafts are reviewed. That is the number the KB exists to move, and it
  is measurable from `message_threads` alone.
- AG-03's KPI is ≥70% of drafts accepted without edits (06 §2). Below that, the
  extraction is costing an owner more attention than writing it themselves.

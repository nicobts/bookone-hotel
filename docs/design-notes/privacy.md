# Design note — data-subject requests and the data map (`/console/privacy`)

**Surface:** the privacy request desk in the console, the export bundle a guest
receives, and the retention jobs that run whether or not anybody asks —
Sprint 10 (04 §1 Phase D).
**Stories:** E8.1, E8.2, E8.3 (all P0).
**Reference (08 §3, ADR-014):** Google Takeout and Stripe's account data export
for the *bundle*; the DSR request queue as practised by privacy-management
tooling (OneTrust, Osano) for the *desk*. Studied from public documentation and
published product tours only.
**Adopted:** the request-as-a-tracked-object model, a bundle that is a single
downloadable archive with a manifest rather than a set of screens, a stated
completion deadline on every open request, and the separation of *erasure
requested* from *erasure applied*.

---

## 1. Understand — what the references do, and why it works

Three behaviours are common to every tool that does this well, and none of them
is about the legal text:

- **A request is a row, not an email.** It has a subject, a kind, an opened-at,
  a due-by and a resolution. The alternative — a support inbox and a memory —
  is how a thirty-day deadline gets missed, and the deadline is the part with a
  fine attached.
- **The bundle is one artefact with a manifest.** Takeout does not hand you
  seventeen screens; it hands you an archive and a file that says what is in
  it. A data subject who cannot tell whether the export is complete has not
  received an export, they have received a sample.
- **Retention runs on a schedule, not on request.** The tools that survive an
  audit delete on a clock derived from a declared map. Deleting only when
  somebody asks means the declared retention period is aspirational, and Art. 5
  (1)(e) is not an aspiration.

The deeper pattern: **the map is the product**. Export, erasure and retention
are three readings of one declaration of what we hold and for how long. Tools
that implement them as three separate features drift, and the drift is only
discovered when a supervisory authority asks the fourth question.

## 2. Validate for our buyer

**The controller is the hotel; we are the processor.** This is the single fact
that shapes the whole surface. A guest exercises their rights against the
property, not against us. So the desk lives in the property's console, the
property's owner presses the button, and every artefact carries the property's
name. What we owe the owner is the machinery and the audit trail — not a
decision about their guest.

**The owner is not a privacy officer and will not read a data map.** They will
receive an email from a guest saying "delete my data" and they need one place to
put it. The design consequence is that the desk takes a *guest*, not a table
list, and the carve-outs are applied by the system and explained in plain
language afterwards.

**Erasure cannot mean deletion here, and pretending otherwise would be the
lie.** A reservation is fiscal-adjacent — PRD D6 puts it at ten years, pending
counsel — and an Alloggiati submission is a filing with a public authority that
we are not free to unmake. Art. 17(3)(b) covers exactly this. So erasure
anonymises the person and keeps the transaction, and the surface says so *before*
the owner presses it, not in a footnote afterwards.

**Nothing here may become a way to see another property's data.** The desk
searches guests within one property. A guest who stayed at two properties on the
platform is two guest rows, by construction (`guests.property_id`), and that is
a GDPR feature rather than a normalisation failure — it is stated in
ADR-017 and it is why the export is per property.

## 3. Re-derive — the surfaces we build

**The data map (`packages/core/src/privacy/data-map.ts`)** — one entry per
table: what personal data it holds, the lawful basis in one line, how long we
keep it, and what erasure does to it. It is TypeScript rather than a document
because a document does not fail CI. A table absent from the map fails a test,
which is the only mechanism that keeps a data map true after the sprint that
wrote it.

**The desk (`/console/privacy`)** — owner-only. Find a guest, see what we hold
about them in categories, and raise one of two requests:

| Request | What happens | What survives, and why |
|---|---|---|
| Export | A JSON bundle with a manifest, downloadable once, links expire | — |
| Erasure | Guest identifiers replaced, messages redacted, documents already gone | Reservation, payment and fee rows (fiscal-adjacent, D6); Alloggiati receipt (Art. 17(3)(b)); the event log, pseudonymously |

**The retention jobs** — one scheduled sweep, driven by the map rather than by
a hand-written list. Adding a table with a retention period adds a sweep; there
is no second place to remember.

**The sub-processor register** — generated from the same config the code checks
against. `registerProvider` in `src/llm` already refuses a provider without a
register entry; E8.3 makes the register itself the generated artefact, so a
provider cannot be in one and not the other.

## 4. Deviations, each tied to the wedge

**(A) The request desk holds no free-text description of the request.** The
references let a privacy officer paste the subject's email in. Ours records the
guest, the kind and who raised it, and nothing else. A free-text box on a
privacy request is where somebody pastes an identity document, and then the DSAR
tooling is itself an unlawful processing surface.

**(B) Erasure is two steps, always.** Requested, then applied — with the
carve-outs listed in between and an explicit confirmation. The references make
this configurable and default it to immediate. We do not, because the operation
is irreversible against a person's data and the owner pressing it is doing it
for the first time.

**(C) The export bundle is generated on demand and never stored.** It is built,
streamed and forgotten. A stored bundle is a copy of everything we hold about
one person, sitting in a bucket, being the highest-value object in the system —
which is the shape of every "export feature caused the breach" incident.

**(D) The bundle has no PDF.** The references produce a human-readable report.
Art. 20 asks for a structured, commonly used, machine-readable format, JSON is
that, and a PDF layer would be a rendering surface we would have to keep
truthful as the schema moves. The manifest carries the plain-language part.

**(E) Retention runs per property, in the property's own timezone, and logs
what it deleted as a count, never as rows.** A retention log that records which
rows were deleted has re-created the data it deleted. The count and the rule
name are what an audit needs.

**(F) Erasure emits events, and the events outlive the person.** Binding rule 2
has no exemption, and a `guest.erased` event with no personal data in its
payload is the evidence that erasure happened — which is the thing we would be
asked to produce. The event log elsewhere is pseudonymised rather than dropped:
`actor` may carry a reservation id, which after erasure points at a row with no
person behind it.

**(G) There is no self-service guest-facing erasure button.** The guest journey
app could carry one and it will not. The controller is the hotel; a button in
our product that erases a hotel's guest without the hotel knowing puts us in the
middle of a decision that is legally theirs. The stay page tells the guest who
to ask and how.

## 5. Deliberately deferred

- **Automated deadline alerting.** The desk shows a due date; nothing emails
  the owner at day 25 yet. It should, and it needs the notification templates
  that Sprint 10 has no room for.
- **Cross-property subject search.** Deliberately absent, not deferred — see
  §2. If a platform-level admin surface ever exists, it needs its own ADR.
- **Erasure of a *staff member's* account data.** Out of scope: staff are
  `auth.users` rows with a controller relationship of their own, and the
  identity tables sit outside tenancy (ADR-017). Named here so its absence is a
  decision.
- **A real backup-restore automation.** The drill is a runbook and a recorded
  result, not a scheduled job. Automating a restore drill before having done one
  by hand automates something nobody has checked.

## 6. How we will know it worked

- Every table in the schema appears in the data map, enforced by a test that
  fails on the next table somebody adds.
- An export bundle round-trips: everything the map says we hold about a guest
  appears in it, checked by a fixture that writes one row into every
  guest-bearing table first.
- After erasure, no free-text search of the database finds the guest's name,
  email or phone — asserted, not assumed.
- The committed sub-processor register is byte-identical to the generated one,
  enforced in CI.

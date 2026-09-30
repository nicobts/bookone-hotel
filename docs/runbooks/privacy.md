# Runbook — data-subject requests, retention, and the register

Everything in this file is E8. Three things that look like three features and
are really three readings of one declaration: `packages/core/src/privacy/data-map.ts`.

**If you change what the platform stores, change the map in the same pull
request.** A test fails if you do not, which is the only reason the map is still
true.

---

## Who is the controller

**The property.** We are the processor. A guest exercises their rights against
the hotel they stayed at, not against us, which is why:

- the desk lives at `/{locale}/{slug}/console/privacy` and only an owner sees it
- there is no guest-facing erasure button anywhere in the product, deliberately
- an export never crosses properties: a guest who stayed at two hotels on the
  platform is two `guests` rows, and each hotel answers for its own processing

When a guest emails **us** instead of the hotel, the answer is to forward it to
the property and tell the guest we have. Acting on it ourselves would be
answering for a controller we are not.

## Answering an access request (Art. 15 / Art. 20)

1. Owner opens **Privacy**, searches the guest by name, email or phone.
2. **Export** records the request and immediately downloads a JSON bundle.
3. Send the bundle to the guest with a covering note. The bundle's `about.statement`
   and its manifest are written to be quoted in that note.

The manifest lists **every table in the data map**, including the empty ones and
the three that are deliberately excluded, each with the reason. That is the part
that makes it an export rather than a sample — a data subject cannot otherwise
tell whether what they received is complete.

Nothing is stored. There is no link to expire and no bucket to clean up; the
bundle exists for the length of one HTTP response.

## Answering an erasure request (Art. 17)

1. Search, then **Erase**. The confirmation screen lists the carve-outs first.
2. Read them out loud if the owner is on the phone. They are the part the owner
   may be asked to explain, and they are generated from the data map rather than
   written in the page, so they cannot drift from what the code does.
3. Confirm. The request row is written immediately; the erasure itself runs as a
   background job and resolves the request when it finishes.

### What erasure actually does

| | |
|---|---|
| Deleted outright | messages, stay tasks, attribution touches, identity document files |
| Blanked in place | the guest's name, email, phone and locale; registration fields; notification recipients; pages to staff about the stay (the staff number stays); billing details; agent-run inputs and outputs, the owner agent's answers that named the stay included; discrepancy snapshots; event payloads |
| Kept, with a reason | the reservation, its payments, our fee rows, the Alloggiati filing, and the privacy request itself |

### The one place a name survives, and why

The **Alloggiati payload** keeps the transmitted text, which names every guest
in the party. Deleting it on one person's request would destroy another person's
record and the property's own evidence that it met a legal obligation
(Art. 17(3)(b)). It is purged instead on a two-year clock from acknowledgement,
keeping the checksum, the receipt and the status forever.

Tell the requester this. "Everything is gone" is not true and the date is not
hard to say.

### If the desk says "recorded, not yet applied"

The request row exists and its deadline is running; the background worker did
not pick the job up. Run it by hand:

```bash
curl -X POST "$WORKER_URL/jobs/privacy-erase" \
  -H "authorization: Bearer $WORKER_INTERNAL_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"propertyId":"<uuid>","guestId":"<uuid>","requestId":"<uuid>"}'
```

There is deliberately **no sweep** that picks up forgotten erasure requests. A
job that erases people when it notices an old row is a job that erases somebody
the day the desk has a bug.

## Owner and staff contact numbers

The property pages people by phone. They are listed in `property_contacts`, one
row per person and role, and managed by the owner under **Team → Who we page**
(`/{locale}/{slug}/console/members`):

| Role | Receives |
|---|---|
| `owner` | the owner agent on WhatsApp (it answers only these numbers); the page when a guest is left waiting; the owner rung of the filing-deadline alert |
| `staff` | the staff rung of the filing-deadline alert |

Until 2026-09-28 these numbers were `ownerPhones` and `staffPhones` in
`properties.settings`, which every member of the property could read. The
migration that created the table moved them there and removed the keys.
Carried-over contacts have no `informed_at` and the screen flags them until the
owner confirms.

**The property is the controller** for these people, as their employer or as the
owner themselves; we are its processor, exactly as for guests. What that means
in practice:

- **The property tells each person before listing them** (Art. 13): that their
  number is used to page them about waiting guests and filing deadlines, and
  that the message travels through Twilio and, on WhatsApp, Meta (SP-013). The
  add form will not save without the owner confirming it, and `informed_at`
  records when.
- **A person who asks, or leaves, is removed by the owner** on the same screen,
  in one step. Nothing else knows that somebody left. The guest desk does not
  reach these numbers and must not: a staff member is not a guest, and their
  request goes to their employer.
- **Only owners see the list.** `property_contacts` is owner-only under RLS for
  every command, on both access paths, so a receptionist cannot read the
  owner's personal number (`rls/property-contacts.test.ts`).
- **Only the numbers travel.** No event, log line or span carries a number or a
  name. `property_contact.added`, `.removed` and `.informed` record the contact's
  id and role. `compliance_obligation.alerted` records how many messages were
  queued and how many rungs had nobody to page, never who.
  `owner_message.received` records the channel only. The logger redacts `phone`
  and `recipient` (ADR-036).

`properties.settings` still holds the contact email, which at a family-run
property is usually the owner's own address. The data map records it.

### Tenant isolation

Each number is read only for its own property:

- A page is sent only from the property's own contacts (`contactPhones`), for
  that property's obligation or thread.
- An inbound WhatsApp message is matched to an owner only within the property
  whose number it was sent to (`channels/inbound.ts`). A number that two
  properties record is routed nowhere (`ambiguous-number`, logged as an error by
  `apps/api`), and the admin console refuses to switch WhatsApp or SMS on for a
  property whose number another property already records. Today there is one
  sender per deployment (`docs/runbooks/whatsapp.md`), so enabling a second
  property on it needs per-property senders first.
- `properties` is readable by that property's members only, and guest pages
  (booking and stay) render on the server and never send `settings` to the
  browser.
- The admin playground shows an owner number for demo properties only
  (`listPreviewTargets`).

A number listed at two properties is two independent rows. Neither property can
see the other's.

### Where a number is copied

| Where | What | For how long |
|---|---|---|
| `notifications.recipient`, rows with `alert = true` | every page sent | 90 days, then deleted with the row |
| Twilio, and Meta for WhatsApp (SP-013) | in transit | Twilio's copy is deleted once delivered; Meta's transient copy is outside our control |

The owner agent's replies are sent directly and are not stored as
notifications; the run behind each one is in `agent_runs`.

### A guest named in a page or an owner answer

A page to staff names the guest it is about, and so does an owner-agent answer
("who arrives tomorrow?"). Neither is attached to the stay the usual way: a page
has no `reservation_id`, whose deduplication would drop every recipient after
the first, and an owner question has no thread. So each records the stay it
names:

- a page, in `payload.reservationId`;
- an owner-agent run, in `output.reservationIds`.

The guest's **erasure** finds both through those fields. It blanks the page's
payload and keeps the staff number, which is not the guest's. It blanks the
run's input and output. The guest's **export** includes the pages about their
stay without the staff number. The erasure test plants one of each and searches
every text column in the database afterwards.

What remains is the owner's own question text when it names a guest ("did
Rossi arrive?"). It is erased with the rest of the run only if the answer also
named that stay; otherwise it goes with `agent_runs` on its two-year clock.

## The deadline

One month, Art. 12(3), stored as `due_by` and computed by the database in the
same statement as `created_at` so the two cannot disagree. The desk shows a red
badge for anything overdue.

Nothing emails the owner at day 25 yet. It should, and that is named in the
design note's deferred list rather than left as an omission somebody discovers.

## Retention

One scheduled job per property, 02:15 daily, driven by the map. It reports per
rule so a rule that starts failing — a renamed column, a new constraint — shows
up as itself rather than as a total that is quietly lower than last night's.

Run it now:

```bash
curl -X POST "$WORKER_URL/jobs/retention-sweep" \
  -H "authorization: Bearer $WORKER_INTERNAL_TOKEN" \
  -H 'content-type: application/json' -d '{"propertyId":"<uuid>"}'
```

Or, to see what it *would* do without doing it, from a Node REPL with the
workspace loaded:

```ts
await runRetention({ propertyId, dryRun: true })
```

The periods themselves are in the map, with a `why` on each. Three come from
PRD D6 — documents on submission, messages at 24 months, reservations at ten
years as a fiscal-adjacent floor — and the rest are our judgement, marked as
such, pending counsel.

**Receipt files of manual filings (WP1.6)** have their own job, `receipts.purge`, daily at 04:40.
A file goes five years after upload (ADR-041): it is the property's proof of a filing the Ministry
keeps for five years, and a portal receipt may list the party's names, so it goes then and not
later. The filing payload with the names stays on two years. The row is stamped `deleted_at`
only once the object is gone, and the evidence keeps the file's SHA-256. An erasure request does
not remove it early: it covers the whole party and proves a filing owed to an authority
(Art. 17(3)(b)), so the desk gives the requester the five-year date instead.

**02:15 is deliberate.** Everything else in the night runs between 03:30 and
06:00; a sweep that one day takes twenty minutes must not delay the parity
measurement D11's condition C2 turns on.

## The sub-processor register

`docs/legal/sub-processor-register.md` is **generated**. Do not edit it.

```bash
pnpm register:render   # rewrite the document
pnpm register:check    # what CI runs
```

The source is `packages/core/src/privacy/subprocessors.ts`. Adding a provider
means adding an entry there, rendering, and committing both — CI fails
otherwise, which is the point: a disclosure that drifts either names a provider
we do not use or omits one we do.

`registerProvider` in `src/llm` refuses any LLM provider whose register entry id
is not found in that file, so a provider cannot be in the code and absent from
the document.

Four entries are `undecided`. That is honest, not incomplete: they are the open
external decisions in 04 §0, and a register listing only what is live reads as
complete when it is not.

## Backup and restore

See `docs/runbooks/backup-restore.md`. The drill belongs to this workstream
because the question it answers is a retention question: a backup older than a
retention period contains data we have declared we no longer hold.

## When something here is wrong

The map is the thing to fix. Not the export, not the erasure routine, not this
file — those three all read it, and fixing one of them alone produces exactly
the divergence the map exists to prevent.

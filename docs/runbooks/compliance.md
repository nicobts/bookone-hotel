# Compliance obligations and the manual fallback

**Decisions:** ADR-026 (a ComplianceAdapter per authority, each with a manual fallback), ADR-028 (the
region registry), ADR-039 (obligations as a state table).
**Status:** Guest Desk WP1.1 and WP1.5, on mocks. **Nothing is filed with any authority.** The only Alloggiati
channel outside production is the mock, and the worker refuses to boot a simulated channel in
production.

## What an obligation is

An obligation is one thing a property owes an authority. Each is a row in `compliance_obligations`.
Today there is one type: the guest registration with the Questura (Alloggiati Web), 24 hours from
arrival. The ISTAT return (WP1.3) and the imposta declaration (WP1.4) will be further types.

| State | Meaning | What happens next |
|---|---|---|
| `pending` | Known, not ready. Usually nobody has confirmed the guests against their documents yet. | The sweep looks again every 10 minutes. Inside the manual margin it goes to `manual`. |
| `queued` | Ready. | Filed on the same step. |
| `submitted` | The channel has it and has not answered. | Asked again every 10 minutes. Never re-filed, never escalated. |
| `acknowledged` | The authority answered. The receipt is in `compliance_evidence`. | Nothing. Final. |
| `failed` | An attempt failed, and a retry is scheduled (`next_attempt_at`). | Retried with doubling backoff, up to the adapter's attempts. |
| `manual` | A person must file it. Retries ran out, the error cannot be retried, or the deadline is inside the manual margin. | A person files by hand with the fallback file and records the receipt. |

**The margin.** For Alloggiati, no automatic attempt starts within 2 hours of the deadline (WP1.2:
escalation at T−2h). A filing that might fail with minutes left is one nobody can rescue.

**The deadline.**
- Until the arrival is recorded, it is 24 hours from the start of the arrival day (property time zone).
- Once the arrival is recorded, it is 24 hours from that moment.
- A recording made after the arrival day counts as the end of that day, so a late click never extends
  it (`compliance/deadlines.ts`).

## Deadline alerts (WP1.5)

An obligation nobody has filed climbs a ladder as its deadline nears. Each rung fires once.

| Rung | Default | Who is told |
|---|---|---|
| 1 inbox | 12 h before the deadline | The filing appears in **Eccezioni**, with its deadline and a link to the stay |
| 2 staff | 6 h before | Every number in `settings.staffPhones`, on WhatsApp (or SMS if only that is on) |
| 3 owner | 3 h before | Every number in `settings.ownerPhones`, the same way |

- **A hand-over goes straight to rung 2.** An obligation in `manual` will not file itself, so the
  staff are paged at once, and the message says it must be filed by hand. A hand-over after a
  phone rung fired (Alloggiati hands over two hours out, after the owner rung) pages everyone
  already paged again, once: they were told the filing would go by itself.
- **Only while nothing is filed.** `pending`, `queued`, `failed` and `manual` alert. `submitted`
  and `acknowledged` never do: the authority has it.
- **Never after the deadline.** A missed filing stays in the inbox, with the fallback file on the
  stay; nobody is paged about a breach.
- **Late starts catch up.** An obligation created three hours before its deadline pages staff
  and owner together, once each.
- **Per property.** `settings.complianceAlerts`, in minutes before the deadline, `null` to switch
  a rung off:

  ```json
  { "complianceAlerts": { "inbox": 720, "staff": 360, "owner": 180 } }
  ```

  Keys left out keep their default. Later rungs must be closer to the deadline than earlier ones,
  and each at most 24 h. A setting that does not validate is ignored as a whole and the defaults
  apply: a typo must never switch the alerts off.

**How "once" is kept.** The rung reached is stored on the obligation (`alert_rung`, `alerted_at`)
and raised by an update conditional on the value read; a hand-over is claimed the same way, on
`alerted_at` against `state_changed_at`. Two sweeps racing, a retried job or a
restarted worker: one wins, the others send nothing. It runs inside `compliance.sweep`, every five
minutes. Every rise is a `compliance_obligation.alerted` event with the rungs fired, the messages
queued and `unreachable`, the rungs that had no number on record or no messaging channel on.

**Nobody was paged?** Look for `unreachable > 0` on the event:

```sql
select at, payload from domain_events
where event_type = 'compliance_obligation.alerted' and property_id = :property
order by at desc limit 20;
```

The usual causes are no `staffPhones` recorded, or neither the `whatsapp` nor the `sms` feature on.
Outside Twilio's 24-hour window a WhatsApp alert needs its approved template,
`TWILIO_TEMPLATE_COMPLIANCE_ALERT`: {{1}} whose filing, {{2}} the deadline, {{3}} the link.

**The owner asks on WhatsApp.** "Ci sono comunicazioni in scadenza?" runs `list_obligations_due`;
"quali sono fallite?" runs `list_obligations_failed`. Both only read. The agent never files or
marks anything as filed.

## The daily ISTAT return (WP1.3)

A property in Friuli Venezia Giulia with `istat_regional` on owes one return per day to the
Regione (WebTur, ISTAT model C/59). BookOne creates one `istat_movement` obligation per day, from
the day the feature was switched on (at most a week back) to yesterday, in the property's zone.
**Days with nobody get one too**: a quiet day is filed as zero, never skipped.

**What is counted** (`compliance/istat.ts`, from confirmed stays):
- arrivals and departures on the day;
- presences, meaning the guests who spend that night (nights, not days);
- rooms occupied;
- all of it by origin: the country for foreign residents, `IT-` and the province for Italian ones.

**Origin.** ISTAT counts by residence, and the pre-arrival form does not ask for it yet. So a guest
counts by their recorded residence when there is one, and otherwise by citizenship. Each day
records how many were counted by citizenship.

**A guest with no origin holds the day.** A guest with neither residence nor citizenship is
`unknown`. The desk sees "Stay M-1234: a guest's residence or citizenship is not recorded" until
someone records it.

| Step | What happens |
|---|---|
| Deadline | The end of the following day, local time. **Verify with the Regione.** |
| Automatic attempts | Stop three hours before the deadline; after that the day goes to a person. |
| The day's file | In the inbox, as semicolon CSV: one line per origin, a total line, and rooms occupied. The steps in Italian. |
| Receipt | Counts and the reference only. No guest is named. |
| Comparison | `compareIstatDay` lists every origin and field where the portal differs from what we filed. It is the reconciliation view; its screen is WP1.6. |

**Mocks only.** WP1.3 is blocked on the Regione's submission specification. Until it arrives we
do not know whether WebTur has a machine interface, how it codes origins, its deadline, or its
file format. The transport is a port (`IstatTransport`), and only the mock exists; in production
no transport is registered, so the day shows as having no channel and the manual route applies.
The portal's own pages are never automated without the Regione's agreement.

## Where things run

| Piece | Where |
|---|---|
| Port, lifecycle, registry, database layer | `packages/core/src/compliance/` |
| Alloggiati as a ComplianceAdapter (a bridge over the Sprint 6 chain) | `packages/core/src/compliance/alloggiati.ts` |
| Region registry (data) | `packages/core/src/compliance/registry.json` |
| Contract suite, and the simulated authority that passes it | `packages/adapters/src/compliance/`, `packages/adapters/src/mock-compliance/` |
| `compliance.generate` (every 10 min), `compliance.sweep` (every 5 min, runs the alert ladder too), `compliance.run` | `apps/worker/src/jobs/` |
| Alert ladder | `packages/core/src/compliance/alerts.ts` |
| The arrival path and "Invia ora" | `alloggiati.file`: creates the stay's obligation and advances it at once |
| What the desk sees | Arrival page, "Comunicazione alla Questura" |
| Fallback download | `/[locale]/[property]/console/compliance/[obligation]/fallback` |

A property's region and comune are in `properties.settings.jurisdiction`. The region is an ISO
3166-2 code (`IT-36` for Friuli Venezia Giulia) and the comune is its ISTAT code (`032006` for
Trieste). A property without one still owes the national filing. A region or comune that is not in
the registry gets no regional or municipal obligation, and those returns are manual (ADR-028).

## Where is this obligation stuck?

One query answers it (ADR-025's test for when a workflow engine is needed):

```sql
select id, type, state, deadline, attempts, next_attempt_at, last_error, state_changed_at
from compliance_obligations
where property_id = :property and state not in ('acknowledged')
order by deadline;
```

Every change of state is a domain event, `compliance_obligation.<verb>`, whose payload carries the
state it came from, the state it went to, the attempts and `waitedSeconds`. That is the wait-point
data ADR-025 turns on. The verbs:

| Event | New state |
|---|---|
| `created` | `pending`, when the obligation is first generated |
| `waiting` | `pending` again, from a later step |
| `queued` | `queued` |
| `submitted` | `submitted` |
| `acknowledged` | `acknowledged` |
| `failed` | `failed` |
| `escalated` | `manual` |

## The manual fallback: filing by hand in under two minutes

The walkthrough for the WP1.1 acceptance criterion. Steps 1–3 were exercised on the demo property
on 2026-09-28, in a browser. The portal steps (4–5) have not been exercised: there are no
credentials yet. **The acceptance item stays open** until someone who did not build this does the
whole walkthrough once with a pilot's credentials and records the time here.

1. Open the stay (**Arrivi →** the guest). The section **Comunicazione alla Questura** shows the
   obligation as **Da inviare a mano**, in red, with the reason.
2. Read the four steps under **Invio a mano**. They are in Italian on purpose, because the portal is
   Italian only.
3. Press **Scarica il file per il portale**. The file is exactly what the automatic filing would
   have sent: one fixed-width line per guest, built from the same registration records. The download
   is logged (`compliance_obligation.fallback_downloaded`), because the file carries identity
   details.
4. Sign in to Alloggiati Web with the property's own credentials, choose the upload by file, upload
   it, and confirm.
5. Keep the receipt the portal gives.

Steps 1–3 are three clicks in the console. Steps 4–5 depend on the portal. Its **labels are still
to be verified with the first pilot's credentials**, which is why the steps describe the route
rather than quoting buttons.

**Recording the receipt.** `recordManualFiling` (core) closes the obligation as `acknowledged`. It
stores the receipt as evidence with `source = 'manual'` and the person's id. The console screen for
this (upload plus "mark submitted manually") is WP1.6. Until then, an operator runs it on request.

**Trying the channel again (WP1.2).** When the channel was down and is back before the deadline,
**Try the channel again** on the stay makes one attempt through it (`retryManualObligation`, job
`compliance.retry`). On success the obligation is `acknowledged` with the channel's receipt as
evidence (`source = 'channel'`), and `compliance_obligation.channel_retried` names who pressed it.
On failure it stays `manual`, with the channel's reason. The sweep never retries a `manual` filing
on its own.

## Evidence

`compliance_evidence` holds each acknowledgement's receipt and the SHA-256 of its canonical JSON.
- **Append-only by trigger.** The one allowed change is the retention purge, which blanks the receipt
  and stamps `receipt_purged_at`. The hash keeps proving the filing.
- **Rows go only with their property.**
- **A receipt never carries a guest's details.** The adapter contract says so, and the data map
  records the table as holding no personal data. The details stay in the filing itself,
  `alloggiati_submissions.payload`, which has its own two-year purge.

## Not built yet

- **WP1.2, the real endpoint.** The client, the adapter, the code tables and the daily
  reconciliation are built and run against a local simulator (`docs/runbooks/alloggiati.md`). A
  real filing still needs the software-house registration, a pilot's credentials in Secret Manager,
  the official code tables, and the owner's go-ahead.
- **WP1.3, the real transport.** The series, the per-day obligations, the fallback file and the
  comparison are built on a mock transport. The real one waits for the Regione's specification.
- **WP1.4:** the imposta adapter. The registry already names it, and the generation job reports it
  as unsupported until it exists.
- **WP1.6:** the compliance dashboard, the inspection export and the manual-receipt screen.

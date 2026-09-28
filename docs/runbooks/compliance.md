# Compliance obligations and the manual fallback

**Decisions:** ADR-026 (a ComplianceAdapter per authority, each with a manual fallback), ADR-028 (the
region registry), ADR-039 (obligations as a state table).
**Status:** Guest Desk WP1.1, on mocks. **Nothing is filed with any authority.** The only Alloggiati
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

## Where things run

| Piece | Where |
|---|---|
| Port, lifecycle, registry, database layer | `packages/core/src/compliance/` |
| Alloggiati as a ComplianceAdapter (a bridge over the Sprint 6 chain) | `packages/core/src/compliance/alloggiati.ts` |
| Region registry (data) | `packages/core/src/compliance/registry.json` |
| Contract suite, and the simulated authority that passes it | `packages/adapters/src/compliance/`, `packages/adapters/src/mock-compliance/` |
| `compliance.generate` (every 10 min), `compliance.sweep` (every 5 min), `compliance.run` | `apps/worker/src/jobs/` |
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

## Evidence

`compliance_evidence` holds each acknowledgement's receipt and the SHA-256 of its canonical JSON.
- **Append-only by trigger.** The one allowed change is the retention purge, which blanks the receipt
  and stamps `receipt_purged_at`. The hash keeps proving the filing.
- **Rows go only with their property.**
- **A receipt never carries a guest's details.** The adapter contract says so, and the data map
  records the table as holding no personal data. The details stay in the filing itself,
  `alloggiati_submissions.payload`, which has its own two-year purge.

## Not built yet

- **WP1.2:** the real Alloggiati Web client. It needs software-house registration, a pilot's
  credentials and certificate, and Secret Manager.
- **WP1.3–1.4:** the WebTur FVG and imposta adapters. The registry already names them, and the
  generation job reports them as unsupported until they exist.
- **WP1.5:** alerting through the inbox and WhatsApp before the deadline, and the owner-agent tools.
- **WP1.6:** the compliance dashboard, the inspection export and the manual-receipt screen.

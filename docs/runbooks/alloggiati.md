# Alloggiati — runbook and go-live checklist

The accommodated-persons registry (E2.3, E2.4). Italian law requires an
accommodation provider to report every guest to the Questura within 24 hours of
arrival.

**The obligation is the property's, not ours.** We prepare the payload and carry
it; they remain the declarant. Everything below is written from that position,
and the contract mirror in [`docs/contracts/alloggiati-responsibility.md`](../contracts/alloggiati-responsibility.md)
states it in the words the property signs.

---

## Status: built behind a mock and a simulator, not connected

| Piece | State |
|---|---|
| Payload builder + validation | ✅ built, **layout unverified** — see below |
| `AlloggiatiAdapter` port | ✅ built |
| `MockAlloggiatiAdapter` | ✅ files nothing |
| Code tables and the resolver (WP1.2) | ✅ built; **only synthetic tables in the repository** |
| Alloggiati Web client and adapter (WP1.2) | ✅ built against the local simulator; **messages unverified**, see check 4 |
| Alloggiati Web simulator (WP1.2) | ✅ files nothing, loopback only |
| "Try the channel again" and the daily reconciliation (WP1.2) | ✅ built |
| `alloggiati_submissions` audit trail | ✅ built |
| Auto-submit on arrival, manual submit | ✅ built |
| T-20h alert | ✅ built, now the WP1.5 alert ladder (`docs/runbooks/compliance.md`) |
| Document deletion on acknowledgement (E2.4) | ✅ built |
| **A real channel** | ⬜ **blocked on an external decision** |

## The blocking decision

**Direct web service, or a certified intermediary?** (04 §0 item 5, PRD §8.3.)

It is a legal question before it is a technical one:

- **Direct** means the property's own Alloggiati Web credentials, held by us or
  entered by them. Holding another party's credentials to a police system is a
  contractual and insurance question, not a storage one.
- **An intermediary** means a third party in the chain, which is a
  sub-processor under D9 and needs a register entry, a DPA, and an EU
  processing guarantee like every other.

Either answer is one class in `packages/adapters` implementing
`AlloggiatiAdapter` and passing the same contract suite the mock passes. Nothing
else in the sprint changes — which is exactly why it was built this way rather
than waiting.

## Before a single real submission

Five checks, in this order. None is a code TODO; all are things a person does.

**1. Verify the record layout.**
`packages/core/src/alloggiati/record.ts` carries the field order and widths as
`FIELDS`, written from published documentation and **not** validated against the
authority's own environment. Check every offset against the current official
*tracciato record*, then round-trip a payload through the Alloggiati test
environment. A wrong offset produces a rejected file rather than a silent
misfiling — the authority validates on receipt — which is what makes shipping
behind a mock safe and shipping without this check not.

**2. Load the official code tables.**
The registry identifies states, comuni and document types by its own codes.
We do not ship them, and never invent them: a plausible wrong code files a
real guest as born somewhere they were not. An operator downloads the tables
from Alloggiati Web and puts three files in the directory named by
`ALLOGGIATI_TABLES_DIR` (worker and console both read it):

| File | Holds |
|---|---|
| `luoghi.csv` | places: code, name, province (`ES` or empty for a foreign state), end-of-validity date |
| `documenti.csv` | document types: code, name |
| `manifest.json` | `"source": "official"`, when it was downloaded, `documentMap` (our passport / identity card / driving licence to the registry's codes), and `countryAliases` (ISO code to the registry's spelling, where the Italian name differs) |

The loader matches columns by header name and refuses a table with a missing
column, or a code longer than its record field. The Alloggiati Web adapter
refuses tables whose manifest says `synthetic`: those are the test tables in
`content/alloggiati/synthetic`, with codes (`SYN…`) that exist nowhere.
Updating the tables is replacing the files and restarting the worker.

With tables loaded, every value a guest wrote is resolved before a filing is
built: countries by ISO code, an Italian birthplace by name ("Castro (LE)"
where the name is shared), the document issuer as a country or a comune. What
does not resolve is shown on the stay, per guest and field, in words the desk
can act on. Without tables (the mock), the payload carries what the guest
wrote, visibly untranslated.

**3. Confirm the guest fields we collect are the ones required.**
The pre-arrival form collects surname, given name, sex, birth date, birth place,
birth country, citizenship and document details. If the current specification
requires a field we do not ask for, the form changes before the channel does —
a filing that fails validation at the authority is a filing that did not happen.

**4. Verify the web-service messages.**
`packages/adapters/src/alloggiati-web/protocol.ts` writes the SOAP messages
(`GenerateToken`, `Test`, `Send`, `Ricevuta`) from public documentation. The
client and the simulator share that file, so they agree with each other by
construction; whether they agree with the authority is the first thing a test
environment call answers. Two rules in `packages/core/src/alloggiati/resolve.ts`
are also from documentation: a guest born in Italy is filed with comune and
province, and only a single guest or the head of a party files a document.

**5. Credentials in Secret Manager, and the go-ahead.**
The adapter accepts only the `simulator` environment on this machine. A real
endpoint needs the software-house registration, the pilot's user, password and
web-service key held in Secret Manager (a `CredentialSource` reading it, not an
env file), and the owner's explicit go-ahead for a production filing (WP1.2
"stop and ask"). Lifting the guard is its own reviewed change.

## How it runs

```
arrival confirmed  →  alloggiati.stage    (validates the party, builds the payload)
                   →  alloggiati.submit   (files it)
                   →  alloggiati.acknowledge
                   →  documents deleted   (E2.4)
```

Staging and submitting are separate steps because they fail for different
reasons and want different answers. A payload that cannot be built is a missing
passport number the owner has to chase; a submission that fails is a channel
problem that retries. The exceptions inbox distinguishes them.

**Manual submit is always available** (E2.3 acceptance criterion). Automation
that cannot be overridden is automation an owner cannot answer for.

### The Alloggiati Web channel (WP1.2)

Each filing is validated by the service (`Test`) and then filed (`Send`); the
service files a party whole or not at all, and answers at once, so a filing is
acknowledged on return or it failed. The receipt we keep holds the reference,
the line count and a checksum, never a name.

| What happened | Becomes | Retried |
|---|---|---|
| No answer, or a 5xx | `unavailable` | yes, with backoff, until two hours before the deadline |
| Credentials refused, or none recorded | `unauthorized` | no: fix the credentials |
| A line refused | `rejected`, naming the guest and the field | no: fix the data |
| A `Send` that timed out | `unavailable` | **no**: it may have been filed; check the day's receipt on the portal |

**The outage drill.** Retries until two hours before the deadline, then the
filing goes to a person with the file for the portal. If the service comes back
while there is time, **Try the channel again** on the stay makes one attempt
through it: on success the channel's receipt is the evidence; on failure the
filing stays with the person, with the reason. It never re-sends a filing the
channel already holds.

**The daily reconciliation** (`alloggiati.reconcile`, 05:15, per property with
the feature): for the property's previous day, midnight to midnight in its own
zone, how many filings fell due, how many the
channel acknowledged, how many were filed by hand, how many are open, and
whether the service holds a receipt for a day we filed on. A missing receipt is
a mismatch: an error line and a `compliance.reconciled` event with
`mismatch: true`, for a person to check on the portal. Counts only.

### Running it locally

```bash
pnpm alloggiati:simulator      # 127.0.0.1:54480; type "down 3" for an outage
```

and in `.env` for the worker:

```bash
ALLOGGIATI_CHANNEL=simulator
ALLOGGIATI_ENDPOINT=http://127.0.0.1:54480/service/service.asmx
ALLOGGIATI_TABLES_DIR=content/alloggiati/synthetic
```

Set `ALLOGGIATI_TABLES_DIR` for the console too, so the fallback file and the
stay's preview carry the same codes the channel would.

## When something is wrong

**A stay shows "incomplete" in the console.** The party is missing a required
field. The console lists every missing field for every guest at once, because a
list that reveals one per round trip takes four conversations with the guest.

**A submission failed.** Read `last_error`. Retryable failures — the channel is
down — are retried by the queue. Non-retryable ones mean the payload was
rejected, and the reason is the authority's own message.

The console shows `last_error` in the desk's language (`apps/web/src/lib/compliance/errors.ts`):
our own sentences are translated, a refusal is framed as the registry's and each guest's line is
quoted in the registry's own words (Italian), because a paraphrased refusal cannot be quoted back
to the Questura. A message the console does not recognise is shown as "the channel said", as
written. One gap remains: a missing or unresolved field names the field in the desk's language, but
the resolver's explanation after it is still English, because it is written as a sentence in core.
Making it a code is a change to the resolver.

**A filing-deadline alert fired.** Since WP1.5 this is the alert ladder: the
filing appears in the exceptions inbox twelve hours before its deadline, the
staff phones get a message at six and the owner at three (per property). Open
the stay from the inbox row: it lists what is missing, and when the filing has
been handed to a person, the file for the portal. See `docs/runbooks/compliance.md`.

**Documents still present after acknowledgement.** The deletion job deletes the
object first and stamps the row second, so a failure leaves the row honest and
the retry comes round again. A row that claimed deletion over a file that still
existed would be a lie the product then repeats to a supervisory authority.

## What we never do

- File without the property's data. Every field comes from what the guest gave.
- Keep an identity document after acknowledgement. The receipt is retained; the
  document is destroyed (E2.4).
- Present a simulated filing as a real one. `MockAlloggiatiAdapter.simulated` is
  true and the console says so — a property that believes its guests are
  registered when they are not is a property facing a fine.

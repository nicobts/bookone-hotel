# Alloggiati — runbook and go-live checklist

The accommodated-persons registry (E2.3, E2.4). Italian law requires an
accommodation provider to report every guest to the Questura within 24 hours of
arrival.

**The obligation is the property's, not ours.** We prepare the payload and carry
it; they remain the declarant. Everything below is written from that position,
and the contract mirror in [`docs/contracts/alloggiati-responsibility.md`](../contracts/alloggiati-responsibility.md)
states it in the words the property signs.

---

## Status: built behind a mock, not connected

| Piece | State |
|---|---|
| Payload builder + validation | ✅ built, **layout unverified** — see below |
| `AlloggiatiAdapter` port | ✅ built |
| `MockAlloggiatiAdapter` | ✅ files nothing |
| `alloggiati_submissions` audit trail | ✅ built |
| Auto-submit on arrival, manual submit | ✅ built |
| T-20h alert | ✅ built |
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

Three checks, in this order. None is a code TODO; all are things a person does.

**1. Verify the record layout.**
`packages/core/src/alloggiati/record.ts` carries the field order and widths as
`FIELDS`, written from published documentation and **not** validated against the
authority's own environment. Check every offset against the current official
*tracciato record*, then round-trip a payload through the Alloggiati test
environment. A wrong offset produces a rejected file rather than a silent
misfiling — the authority validates on receipt — which is what makes shipping
behind a mock safe and shipping without this check not.

**2. Fill in the code tables.**
The registry identifies countries and municipalities by its own numeric codes.
`mapCountryCode` is currently the identity function and passes ISO alpha-2
straight through, visibly and on purpose: inventing plausible-looking registry
numbers would file a real guest as born somewhere they were not. Load the
official tables, then that one function changes.

**3. Confirm the guest fields we collect are the ones required.**
The pre-arrival form collects surname, given name, sex, birth date, birth place,
birth country, citizenship and document details. If the current specification
requires a field we do not ask for, the form changes before the channel does —
a filing that fails validation at the authority is a filing that did not happen.

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

## When something is wrong

**A stay shows "incomplete" in the console.** The party is missing a required
field. The console lists every missing field for every guest at once, because a
list that reveals one per round trip takes four conversations with the guest.

**A submission failed.** Read `last_error`. Retryable failures — the channel is
down — are retried by the queue. Non-retryable ones mean the payload was
rejected, and the reason is the authority's own message.

**T-20h alert fired.** A guest arrived twenty hours ago and the filing is not
acknowledged. Twenty rather than twenty-four so it is a chance to act rather
than a notification of a breach. Submit manually from the console.

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

# Runbook — the guest concierge

AG-01 answers in-stay messages (E3.2). This is what it is allowed to say, how
to change that, and what has to be true before a language model is connected.

## What runs today

**No model.** `LLM_API_KEY` is empty, no `LlmProvider` is registered, and AG-01
is a deterministic router in `packages/agents/src/runner.ts`:

```
guest message
  ├─ asks for a thing?  → create_task, then escalate
  ├─ matches a published KB article, in the guest's language? → reply with it
  └─ anything else → escalate
```

The reply is the article's stored text, verbatim. There is no branch in which
the software composes a sentence about the property.

## Adding or fixing an answer

Answers live in `kb_articles`, one row per topic per property. There is no
authoring UI until Sprint 9 (E5.3), so today this is SQL:

```sql
insert into kb_articles (property_id, topic, question_variants, answers)
values (
  '<property-uuid>',
  'parking',
  '["where can i park","is there parking","dove posso parcheggiare"]'::jsonb,
  '{"en":"There are four free spaces behind the building.",
    "it":"Ci sono quattro posti gratuiti dietro l edificio."}'::jsonb
)
on conflict (property_id, topic) do update
  set question_variants = excluded.question_variants,
      answers = excluded.answers,
      version = kb_articles.version + 1,
      updated_at = now();
```

Three things to get right:

**Bump `version` on every edit.** The audit names the version that produced a
reply. "The KB said so" is only a defence if the KB can be shown as it stood.

**A locale is present or it is absent.** Do not fill an Italian answer into the
`de` key "for now". A missing locale escalates to a person, which is correct; a
machine-translated one is a sentence about a real business that nobody at that
business has read.

**Write the phrasings guests actually use**, not the topic restated. The matcher
scores against the stored phrasing, so `"what time is breakfast"` earns its keep
and `"breakfast information"` does not.

To take an article out of service without erasing what it said:
`update kb_articles set published = false where id = '…'`.

## When a guest is told something wrong

1. **Find the reply.** `messages` where `author = 'agent'`, joined to
   `agent_runs` on `agent_run_id`. The run records which tools were called and
   what they returned.
2. **Fix the article**, bumping `version`.
3. **Answer the guest yourself.** The correction is a new message — nothing
   edits a message a guest has already read.

If the reply contained a fact no tool produced, that is a **tool-boundary
violation** and a different problem. See below.

## The tool-boundary audit

Runs nightly at 05:00 (`toolboundary.audit`) over every property that sent an
agent reply in the last 30 hours. Two checks per reply:

| Check | Finding | Means |
|---|---|---|
| Reply text appears in its run's tool output | `unsourced_reply` | Something composed a sentence |
| Every number in the reply appears in that output | `unsourced_number` | An invented time, price, room or date |
| The message has a run at all | `no_run` | An agent message nobody can check |

**The gate is zero.** A violation logs at `error` with the message and thread
ids. Run it by hand with `pnpm tsx scripts/enqueue.mts audit`.

A violation is not a tuning problem. It means the structural guarantee — a reply
*is* a tool phrase — has stopped holding, and the fix is in the code that
produced the sentence, not in the article.

## Escalation and the SLA

A thread's status says who owes the next reply: `awaiting_reply` means the guest
is waiting on us, `escalated` means they are waiting on a **person**.

`escalation.sweep` runs every five minutes and alerts the property's contact
address when an escalation has gone unanswered for **30 minutes**
(`ESCALATION_SLA_MINUTES` in `apps/worker/src/jobs/handlers.ts`). It alerts once
per escalation — `sla_alerted_at` on the thread, not a recomputation — because a
repeating alert is one somebody filters.

A property with no published contact address gets no alert, and the sweep stamps
the thread anyway. That is deliberate: retrying an undeliverable alert would
starve every other property in the batch, and the unowned thread is still at the
top of the console.

## Before connecting a language model

Not a config change. In order:

1. **D9 first.** The provider declares EU processing, a region, and a
   sub-processor register entry, and a human verifies it. `registerProvider`
   refuses anything else — that is the gate, not a checklist.
2. **Run the eval set against it.** `pnpm --filter @bookone/agents test:evals`.
   The golden set is the specification both implementations must satisfy, and it
   scores a confident wrong answer far worse than an escalation. A model that
   answers more but escalates less is not obviously better; read the pairs.
3. **The model widens recall, never authorship.** It may decide *which* article
   a question matches. It may not write the answer. If a change would let it,
   that is a change to ADR-009 and binding rule 7 and needs an ADR before a PR.
4. **Set `dailyBudgetCents`** in the registry. It is 0 today because nothing
   costs anything; a conversational agent is the most expensive kind to leave
   unbounded.
5. **Watch the audit for a week.** It should still find zero. If it does not,
   the model is composing and the change is not ready.

## What deliberately does not exist

- **No tool changes a booking, a date, or an amount.** Those are T2 (06 §2) and
  need the proposal surface Sprint 8 builds. The absence is the control.
- **No fiscal tool, under any framing** (D11, ADR-011).
- **No WhatsApp.** Blocked on BSP verification (04 §0). The thread is stored
  channel-agnostically, so adding it is a provider rather than a re-model — but
  until then the product does not pretend to have it.

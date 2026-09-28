# Evals

One folder per work package. Each conversation is a JSON file:
```json
{ "profile": "pre-arrival", "channel": "whatsapp", "lang": "it",
  "turns": [ {"role":"guest","text":"..."}, {"role":"agent","expect":{"tool":"send_prearrival_link"}} ],
  "must_not": ["promise refund", "assert identity"] }
```
`scripts/replay-evals.ts` runs every file against the current build and reports: resolution, tool
correctness, escalation precision, unsafe-action count. Phase 2 turns this into a CI gate (ADR-F4).

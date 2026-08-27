# PRD — BookOne Concierge

**AI voice concierge for independent hotels**

| | |
|---|---|
| Owner | Nicolas |
| Entity | RT Holding Group GmbH (AT) |
| Status | Draft v1 — for review |
| Date | July 2026 |
| Related | Doc #1 Vision & Positioning, Doc #2 ICP & Personas |

---

## 1. Decisions register

Decisions made before drafting. Downstream documents and implementation must remain consistent with these; changing one requires an explicit revision of this document.

| # | Decision | Rationale |
|---|---|---|
| D1 | Product sits **on top of** the PMS. We do not build a PMS. | Fiscal/statutory burden is uneconomic; incumbent moat is regulatory accumulation, not code |
| D2 | Owned by **RT Holding Group GmbH**. Not Metis. Not a subsidiary in v1. | IP consolidation; Metis is a sales channel, not a product owner |
| D3 | **Ericsoft first**, canonical model from commit one | Design partner's stack; defensible regional ground |
| D4 | **Read-only** PMS access in v1. No booking, charging, or cancellation. | Liability class we cannot yet support |
| D5 | **Conditional forwarding** entry point. We never take the main line. | Zero-risk land motion; unambiguous ROI attribution |
| D6 | **Speech-to-speech** conversation layer with hard tool boundaries | Multilingual + noise robustness + per-minute margin |
| D7 | Voice provider abstracted behind our own interface | Category moved twice in four months; assume replacement |
| D8 | Adapters are **demand-led**: 3+ signed properties before building one | Adapter maintenance is a permanent tax (~€8–15k/yr each) |
| D9 | EU data residency, no exceptions | Differentiator vs. US competitors; AI Act/GDPR posture |

---

## 2. Problem statement

Independent hotels of 40–120 rooms cannot staff the front desk for peak load. Calls go unanswered after hours, during check-in rushes, and in high season — each one a direct booking that leaks to an OTA at 15–20% commission, or a guest who forms a poor first impression. Existing PMS vendors in the Alpine and Adriatic market (Ericsoft/Zucchetti, Scrigno, ASA, Casablanca) are operationally solid but have no meaningful AI layer, and international voice-AI vendors will not localise for Italian statutory workflows, regional PMS APIs, or South Tyrolean German.

The cost of not solving it is measurable per property: unanswered calls, avoidable OTA commission, and front-desk hours consumed by repetitive enquiries that never reach a human at all.

---

## 3. Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Eliminate unanswered inbound calls at pilot properties | Missed-call rate → <2% within 30 days of go-live |
| G2 | Demonstrate euro-denominated ROI per property, monthly | Automated report: calls handled, bookings captured, commission avoided, staff hours returned |
| G3 | Prove the product generalises beyond the design partner | 3 unrelated paying properties by month 9 |
| G4 | Establish defensible regional position | Ericsoft adapter live and certified; competitor cannot replicate without equivalent partner approval |
| G5 | Maintain per-minute gross margin above 60% | COGS tracked per call; pricing model with included-minute bundle |

---

## 4. Non-goals (v1)

| Non-goal | Why |
|---|---|
| Building or replacing a PMS | D1. Uneconomic; separate initiative with different capital requirements |
| Taking over the hotel's primary phone line | Unacceptable risk to the hotel; kills the land motion |
| Transactional actions — booking, charging, cancelling | D4. Liability class requires volume and insurance we don't have |
| Outbound campaigns | Different regulatory surface (marketing consent); no pull from ICP |
| Guest-facing mobile app | No evidence of demand; the phone *is* the channel |
| Multi-PMS breadth at launch | D8. Breadth is a treadmill, not a moat |
| Austria and Slovenia go-to-market | Sequenced after Italy proves out; language support built in regardless |
| Revenue management, channel management, booking engine | Adjacent products, not this one |

---

## 5. Users

**Primary buyer — the owner-operator.** Runs a 40–120 room independent property, often with a restaurant. Decides alone. Values a working relationship over a feature list. Judges software by whether the numbers match last year's. Sceptical of AI, but acutely aware of the staffing problem.

**Primary operational user — front-desk staff.** High turnover, seasonal, multilingual to varying degrees. Will sabotage anything that adds work. Must experience the product as *fewer* interruptions, never as a new system to learn.

**End user — the caller.** Guest or prospect. Italian, German, English, Slovenian. Frequently on a mobile connection, in a car, or in a noisy environment. Often elderly. Does not know or care that they are speaking to software, but is legally entitled to be told.

---

## 6. User stories

### Owner-operator
- As an owner, I want every call answered even when nobody is at the desk, so that I stop losing direct bookings to voicemail.
- As an owner, I want a monthly report in euros, so that I can judge whether this is worth its cost.
- As an owner, I want to update our own information (breakfast times, pool hours, ski bus), so that I don't have to file a support ticket for a five-word change.
- As an owner, I want to switch the whole thing off in one click, so that I am never trapped.

### Front-desk staff
- As a receptionist, I want the AI to take routine enquiries during check-in rush, so that I can serve the person standing in front of me.
- As a receptionist, I want a one-line spoken summary before a transferred call reaches me, so that the guest doesn't repeat themselves.
- As a receptionist, I want callbacks to arrive as a structured task with name, number and reason, so that I don't parse voicemail.

### Caller
- As a guest, I want to know whether my booking is confirmed at 23:00, so that I don't worry overnight.
- As a prospective guest, I want to ask about availability in my own language, so that I can decide without emailing.
- As a caller with an emergency, I want to reach a human immediately, so that the AI never stands between me and help.
- As a caller, I want to be told I'm speaking to an assistant, so that I can ask for a person if I prefer.

---

## 7. Requirements

### P0 — Must have

**R1 — Call ingestion via conditional forwarding**
- Hotel PBX forwards on no-answer, busy, and out-of-hours to our SIP endpoint
- Configurable per property: business hours, ring timeout, holiday calendar
- Failover: if our endpoint is unreachable, the call returns to the hotel's existing voicemail

*Acceptance:*
- [ ] Given the hotel line rings 5 times unanswered, when the timeout elapses, then the call arrives at our agent within 2s
- [ ] Given our service is down, when a call is forwarded, then it falls back to the hotel's voicemail with no dead air
- [ ] Given the hotel is inside business hours and the desk answers, then our agent is never invoked

**R2 — AI Act disclosure**
- Every call opens with an explicit statement that the caller is speaking to a digital assistant, in the detected or property-default language
- Disclosure is not skippable and is logged per call

*Acceptance:*
- [ ] Given any inbound call, when the agent answers, then the first utterance identifies it as a digital assistant
- [ ] Given a completed call, when the log is inspected, then the disclosure timestamp is recorded

**R3 — Knowledge base answering**
- Per-property structured knowledge (100–300 facts), versioned, editable by the hotel
- Held in the agent's context — no retrieval layer in v1
- Categories: arrival/departure, facilities, dining, parking/transport, policies, local area

*Acceptance:*
- [ ] Given a question covered by the KB, when asked in any supported language, then the agent answers correctly without a tool call
- [ ] Given a question outside the KB, then the agent does not speculate and offers a callback or transfer
- [ ] Given the owner edits the KB, then the change is live on the next call within 60s

**R4 — PMS read access (Ericsoft)**
- Tools: `get_availability`, `get_reservation`, `get_property_info`
- Availability cached, refreshed on a 2–5 minute background cycle; never fetched live mid-call
- Guest/reservation context prefetched on ring via caller ID where available

*Acceptance:*
- [ ] Given a caller asks about availability, when the agent responds, then the answer derives from a tool result, never from generation
- [ ] Given the PMS is unreachable, then the agent states it cannot check right now and offers a callback — it does not guess
- [ ] Given a known caller ID, when the call connects, then reservation context is already loaded

**R5 — Hard tool boundaries**
- System prompt forbids stating any price, date, availability or reservation detail not returned by a tool call in the current conversation
- Tools return pre-formatted phrases, not raw data, to narrow the generation surface
- Automated post-call check: flag any turn mentioning price or availability with no preceding tool call

*Acceptance:*
- [ ] Given 100 sampled calls, when audited, then zero contain a quoted rate without a matching tool call
- [ ] Given the check fires in production, then an alert is raised within 24h

**R6 — Escalation and human-in-the-loop**

Transfer triggers:
- Explicit request for a person
- Two consecutive low-confidence turns or repeated ASR failure
- Any transactional intent (book, cancel, charge, modify)
- Detected frustration
- **Emergency keywords — evaluated by a deterministic classifier running in parallel to the model, unconditional, model-independent**

Behaviour:
- Human available → warm transfer via SIP REFER, with a whispered one-line summary to the staff member first
- No human available → structured callback ticket, SMS/WhatsApp confirmation to the caller, priority-tagged push to staff

*Acceptance:*
- [ ] Given a caller says "fire", "ambulance", "emergency", "locked out" or configured equivalents in any supported language, then the call breaks out to a human or emergency path immediately, regardless of model state
- [ ] Given a warm transfer, when staff answer, then they hear the summary before the guest is connected
- [ ] Given no human is available, then a ticket is created with caller number, intent, language and transcript link

**R7 — Multilingual operation**
- Italian, German (incl. Austrian/South Tyrolean variants), English, Slovenian
- Language detected from the caller's first utterance; switchable mid-call

*Acceptance:*
- [ ] Given a caller speaks German, then the entire call including disclosure is in German
- [ ] Given a caller switches language mid-call, then the agent follows within one turn

**R8 — Hotel console (Next.js)**
- Call log with transcript, audio, outcome, escalation reason, latency
- KB editor
- Business hours / forwarding configuration
- Monthly ROI report
- Staff/notification routing settings

*Acceptance:*
- [ ] Given a completed call, then it appears in the log within 60s with transcript and outcome
- [ ] Given the owner opens the ROI report, then it shows calls handled outside hours, callbacks generated, and estimated commission avoided

**R9 — Multi-tenancy**
- All data scoped by `property_id`; no cross-property leakage
- Per-property: voice, language set, KB, hours, PMS credentials, escalation routing

*Acceptance:*
- [ ] Given a user authenticated for property A, then no query returns data from property B
- [ ] Given a new property is onboarded, then no code change is required

**R10 — Compliance and logging**
- EU-region storage and inference throughout
- Recording consent per Italian requirements
- Retention policy configurable, default 90 days, hard-deleted thereafter
- DPA chain to every sub-processor
- Per-call log: transcript, audio, tool calls, per-stage latency, escalation reason, outcome, disclosure timestamp

*Acceptance:*
- [ ] Given a data subject request, then all data for a caller number can be exported and deleted within the statutory window
- [ ] Given retention expiry, then audio and transcript are hard-deleted automatically

### P1 — Should have

- **R11** WhatsApp and web chat on the same agent and knowledge base
- **R12** Post-call SMS/WhatsApp summary to the caller with any promised information
- **R13** Curated local-area knowledge (restaurants, ski passes, transport) with RAG — curated corpus only, never open web search
- **R14** Alloggiati Web submission automation (staff-side, highest operational value)
- **R15** Daily arrivals/departures briefing pushed to staff
- **R16** F&B: restaurant table availability and half-board enquiries via BookOne

### P2 — Future considerations (architect for, do not build)

- **R17** Transactional actions: booking, deposit capture, cancellation
- **R18** Additional PMS adapters (Mews, Apaleo, Scrigno, ASA, Casablanca) — canonical model must support this from day one
- **R19** Marketplace listings (Mews Marketplace, Apaleo Store)
- **R20** Outbound: pre-arrival, no-show chasing, post-stay feedback
- **R21** Self-hosted voice runtime for margin and control

---

## 8. Call flow

```
Inbound call
   ↓
Hotel PBX — answered by staff? ──yes──→ [end, we are not involved]
   ↓ no / busy / out-of-hours
SIP forward → our endpoint
   ↓
Prefetch: caller ID → guest + reservation context (parallel, non-blocking)
   ↓
Answer + AI Act disclosure + language detection
   ↓
┌─────────── conversation loop ───────────┐
│  Emergency classifier (parallel, always on) ──trigger──→ immediate human/emergency path
│  KB answer ────────────────────────────┐
│  Tool call → PMS (cached) ─────────────┤→ response
│  Out of scope ─────────────────────────┘
└──────────────────────────────────────────┘
   ↓
Escalation triggered?
   ├─ human available → warm transfer (SIP REFER + whisper summary)
   └─ no human → callback ticket + SMS confirmation + staff push
   ↓
Post-call: transcript, audio, tool audit, latency, outcome → log → ROI metrics
```

---

## 9. Technical architecture

### Constraint that shapes everything

**Next.js cannot host the voice runtime.** Serverless request/response semantics are incompatible with a persistent bidirectional audio stream. The system is therefore two deployables sharing one database.

### Components

| Component | Technology | Responsibility |
|---|---|---|
| **Console** | Next.js 15 (App Router), shadcn/ui, Tailwind, next-intl | Hotel-facing UI: call log, KB editor, config, ROI reports |
| **Core service** | Fastify + TypeScript, long-running (not serverless) | Tool webhooks, PMS adapters, sync workers, escalation routing, notifications |
| **Voice runtime** | ElevenLabs Agents (phase 1) → LiveKit Agents self-hosted (phase 3) | Conversation, turn-taking, model orchestration |
| **Telephony** | Twilio Elastic SIP Trunking (evaluate Telnyx for EU rates) | Local IT/AT/SI numbers, SIP REFER transfer |
| **Model** | Gemini 3.1 Flash Live (bake-off vs GPT-Realtime-2) | Speech-to-speech conversation |
| **Database** | PostgreSQL (EU region) + Drizzle ORM | Tenants, KB, calls, transcripts, tickets, metrics |
| **Cache / queue** | Redis + BullMQ | Availability cache, sync jobs, notification fanout |
| **Object storage** | S3-compatible, EU region | Call audio, retention-managed |
| **Auth** | Auth.js or better-auth, self-hosted | Property-scoped sessions |
| **Observability** | Langfuse (self-hosted, EU) + structured logs | Call traces, model cost, latency per stage |
| **Hosting** | Vercel (console, Frankfurt) + Fly.io/Hetzner EU (services) | EU residency mandatory |

### Why TypeScript for the backend

The voice-AI ecosystem is Python-first, which normally argues for Python. It does not here, because in phase 1 the voice runtime is *managed* — ElevenLabs handles the audio loop and calls our tools over HTTPS. Our backend only serves request/response webhooks and background sync, which TypeScript does well.

That means one language, shared types between console and service, and no Python until phase 3 — at which point the self-hosted runtime can be a separate Python service without disturbing anything else.

**Do not deploy the core service to serverless.** PMS polling, availability caching and sync workers need persistent state and warm connections.

### Voice provider abstraction (D7)

```ts
interface VoiceRuntime {
  createAgent(config: PropertyAgentConfig): Promise<AgentHandle>
  updateAgent(id: string, config: Partial<PropertyAgentConfig>): Promise<void>
  onToolCall(handler: ToolCallHandler): void
  onCallEnded(handler: CallEndedHandler): void
}
```

Everything above this interface is provider-agnostic. Swapping ElevenLabs for LiveKit is an adapter, not a rewrite.

### PMS abstraction (D3, R18)

```ts
interface PmsAdapter {
  getAvailability(q: AvailabilityQuery): Promise<AvailabilityResult>
  getReservation(q: ReservationQuery): Promise<Reservation | null>
  getGuestByPhone(phone: string): Promise<GuestContext | null>
  healthCheck(): Promise<AdapterHealth>
}
```

The canonical domain model — `Reservation`, `Guest`, `RoomType`, `RatePlan`, `Availability` — is defined once and is not Ericsoft-shaped. Adapters translate into it. This is the single most important architectural decision in the codebase, because it is what makes R18 possible later and is prohibitively expensive to retrofit.

### Tool contracts

```ts
get_availability(date_from, date_to, guests, room_type?)
  → { available: bool, options: [...], phrase: string }

get_reservation(surname, arrival_date)
  → { found: bool, reservation?: {...}, phrase: string }

get_property_info(topic)
  → { answer: string }

create_callback_ticket(intent, contact, language, notes)
  → { ticket_id: string, phrase: string }

transfer_to_human(reason, summary)
  → { transferred: bool, phrase: string }
```

Every tool returns a `phrase` field — the pre-formatted sentence the agent relays (R5). The model narrates as little as possible.

### Latency budget

| Stage | Target |
|---|---|
| Network + telephony | 50–100ms |
| Endpointing (VAD) | 150–300ms ← largest tunable lever |
| Model TTFT / first audio | 200–400ms |
| Playout jitter | 50–100ms |
| **Total** | **<1000ms** |

Tool calls must not block: fire speculative filler ("let me check that for you") the moment a tool is invoked.

---

## 10. Data model (core entities)

```
Property        id, name, locale_default, languages[], timezone, pms_type,
                pms_credentials(encrypted), business_hours, retention_days
KnowledgeEntry  property_id, category, question_variants[], answer_i18n, version
Call            property_id, started_at, duration, language, caller_number(hashed),
                outcome, escalation_reason, disclosure_at, cost_cents
Turn            call_id, role, text, tool_calls[], latency_ms, confidence
CallbackTicket  property_id, call_id, intent, contact, priority, status, assigned_to
AvailabilitySnapshot  property_id, fetched_at, payload, ttl
StaffMember     property_id, name, channels[], escalation_priority
```

Caller numbers are hashed at rest with a per-property salt; the plaintext is retained only for the duration of an open callback ticket.

---

## 11. Success metrics

### Leading (days–weeks)
| Metric | Target | Stretch |
|---|---|---|
| Missed-call rate | <2% within 30 days | <1% |
| Calls fully handled without escalation | >55% | >70% |
| Median latency to first audio | <1000ms | <800ms |
| Rate-hallucination incidents | **0** | 0 |
| False emergency-escalation rate | <1% | <0.3% |

### Lagging (weeks–months)
| Metric | Target |
|---|---|
| Paying properties by month 9 | 3 unrelated + design partner |
| Monthly logo churn | <2% |
| Gross margin per property | >60% |
| Front-desk hours returned per property per week | >5 |
| Owner-reported willingness to recommend | ≥8/10 |

**Measurement:** all metrics derive from the call log. No separate instrumentation; if a metric cannot be computed from `Call` and `Turn`, it is not a metric.

---

## 12. Milestones

| Phase | Duration | Deliverable | Gate |
|---|---|---|---|
| **P0 — De-risk** | Weeks 1–3 | Zucchetti API request filed; 30–50 real call recordings collected; model bake-off run | API access granted or fallback scope agreed |
| **P1 — Answers the phone** | Weeks 1–6 | Managed agent + Twilio, KB in context, disclosure, transfer + callback. No PMS. | Design partner running live on after-hours |
| **P2 — Knows the hotel** | Weeks 6–12 | Ericsoft adapter, availability cache, prefetch, multilingual tuning on real audio | Measurable ROI report produced |
| **P3 — Sellable** | Weeks 12–20 | Multi-tenant, console, KB editor, ROI dashboard, pen test, DPAs | Property #2 onboarded without code change |
| **P4 — Margin & control** | Month 6+ | Self-hosted runtime, EU deployment, cost optimisation, P1 features | Gross margin >60% |

**Hard dependency:** Phase 2 cannot start until the Zucchetti integration request is approved. This is outside our control and historically takes 2–5 months. File it in week 1 and build P1 in parallel.

---

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Zucchetti denies or delays API access | Blocks P2 | File week 1; fallback scope (KB + callbacks + F&B only) agreed in advance; parallel Mews/Apaleo evaluation |
| Rate hallucination reaches a guest | Commercial + trust | R5 hard boundaries, `phrase` returns, continuous audit, transactional path stays cascaded |
| Dialect handling fails on real audio | Product unusable in core market | Bake-off on real recordings *before* build; specialist STT fallback |
| Model provider changes pricing or terms | Margin | D7 abstraction; multi-provider capability from day one |
| PMS vendor ships competing AI layer | Displacement | Regional depth: Alloggiati, tourist tax, F&B, dialects — not replicable quickly |
| Emergency mishandled | Severe | Deterministic classifier independent of the model; tested as a release gate |
| Customer concentration on design partner | Roadmap capture | G3: 3 unrelated properties by month 9, discounted if necessary |
| Solo-founder bus factor | Deal-blocking objection | Documented runbooks; engineering hire before P3 |

---

## 14. Open questions

**Blocking**
- [ ] *(Partner)* Does Zucchetti grant API access, on what terms, at what cost? — **week 1**
- [ ] *(Legal, AT/IT)* Italian call-recording consent mechanics for an Austrian controller — before P1 go-live
- [ ] *(Commercial)* Deal structure with the hotel owner: reseller margin, revenue share, convertible, or subsidiary? Equity in RT Holding is excluded.
- [ ] *(Engineering)* Bake-off result: Gemini 3.1 Flash Live vs GPT-Realtime-2 vs cascaded, on real property audio

**Non-blocking**
- [ ] *(Commercial)* Pricing: platform fee + included minutes — what bundle size, what overage rate?
- [ ] *(Legal)* Liability cap and SLA language; professional indemnity cover
- [ ] *(Commercial)* Cross-border invoicing: is reverse-charge acceptable to Italian customers, or is an SDI/fiscal setup required?
- [ ] *(Engineering)* Telnyx vs Twilio on EU termination cost and SIP REFER reliability
- [ ] *(Product)* Does the design partner's property have a restaurant serving non-guests? Determines R16 priority.

---

## 15. Parking lot

Good ideas explicitly out of scope for v1, retained so they are not re-litigated: in-room voice devices; revenue-management advice via voice; guest app; loyalty; multi-property group console; white-label for PMS vendors; universal PMS API as a standalone product (see Impala precedent).

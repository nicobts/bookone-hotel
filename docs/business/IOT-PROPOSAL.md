# Proposal — BookOne Rooms

**Connected room layer: occupancy, access, and contactless arrival**

| | |
|---|---|
| Owner | Nicolas |
| Entity | RT Holding Group GmbH (AT) |
| Status | Draft v1 — internal scoping / partner discussion |
| Date | July 2026 |
| Related | PRD.md (BookOne Concierge), Doc #1 Vision & Positioning |

---

## 1. Summary

The property owner has asked for three things: room occupancy detection, door lock control, and automatic check-in triggered by the guest opening their door.

All three are achievable. One of them — door-triggered check-in — needs to be re-sequenced before it is built, because as literally described it is both legally non-compliant in Italy and operationally unsafe. Section 4 sets out the correct version, which delivers the same guest experience the owner is imagining.

The proposal is deliberately narrow: **we integrate hardware, we do not manufacture it**, and the lock vendor's system remains the authoritative source of access rights at all times.

---

## 2. What we are proposing

Three capability streams on the existing BookOne platform:

| Stream | Capability | Priority |
|---|---|---|
| **A — Presence** | Per-room occupancy detection, privacy-preserving | P0 |
| **B — Access** | Mobile key issuance, credential lifecycle, door event stream | P0 |
| **C — Arrival** | Online pre-check-in → mobile key → door event completes arrival | P0 |
| D — Comfort | Occupancy-driven HVAC setback | P1 |
| E — Protection | Leak, humidity, window-open detection | P1 |

Streams A, B and C are what the owner asked for. D and E are near-free additions once A exists, and they carry the energy and insurance arguments that justify the capex to any *other* hotel we sell this to.

---

## 3. Design principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **We do not build hardware.** | No firmware, no PCB, no CE/RED certification, no RMA logistics |
| P2 | **The lock vendor remains authoritative.** | We request and reflect access rights; we never become the system of record |
| P3 | **Mechanical override always exists.** | Software failure must never trap or exclude a guest. Fire-code non-negotiable |
| P4 | **Presence is a boolean, never a trace.** | No movement history, no dwell analytics, no inference about guest behaviour |
| P5 | **Local-API devices only.** | A device that phones home to a non-EU cloud breaks our residency promise regardless of where our broker runs |
| P6 | **Reuse the existing platform.** | Same canonical PMS model, tenancy, notification routing and reporting as BookOne Concierge |

---

## 4. The critical correction: door-triggered check-in

### What was asked for

> Guest opens the door → the system checks them in.

### Why it cannot work as stated

**Legal.** Check-in in Italy is not a status flag — it is the point at which guest identity is registered and transmitted to the Questura via Alloggiati Web within 24 hours. A door opening establishes that *a credential was used*. It establishes nothing about identity. Tourist tax accrual and ISTAT reporting have the same dependency.

**Operational.** The lock reports a credential event, not a person. Housekeeping, maintenance, a partner arriving first, or a staff master key all produce the same signal.

**Fiscal.** Check-in in the PMS opens the folio and starts rate and tax posting. Triggering that from an ambiguous physical event produces billing errors that surface at invoicing, when they are expensive to unwind.

### The correct sequence

The door event is the **completion trigger for an already-prepared arrival**, not the check-in itself. Everything legally load-bearing happens before the guest reaches the building.

```
T-48h   Pre-arrival link sent (SMS / WhatsApp / email)
          ↓
T-48h   Guest completes online check-in:
          identity document capture, registration data,
          arrival time, deposit authorisation
          ↓
        Data validated → Alloggiati payload staged (not yet sent)
          ↓
T-24h   Room assigned in PMS · reservation status = READY
          ↓
T-4h    Mobile credential issued via lock vendor API,
          valid from earliest check-in time until departure
          ↓
        Guest arrives, walks past the desk, opens the door
          ↓
        Door event received → arrival CONFIRMED
          ↓
        PMS check-in posted · folio opened · Alloggiati submitted
        · tourist tax accrued · welcome message sent
        · HVAC to comfort · housekeeping notified "occupied"
```

**What the owner wanted:** the guest walks straight to their room without stopping at a desk.
**What they get:** exactly that — and it is compliant, auditable, and does not misfire on a housekeeper's master key.

### Guardrails on the door event

- Only a credential **issued to that reservation** completes the arrival. Staff and master credentials are ignored for this purpose.
- If no pre-check-in was completed, no mobile key is issued and the guest goes to the desk as normal. **The desk path is never removed.**
- A configurable grace window: a door event more than N hours before the reservation's earliest arrival raises an alert rather than completing check-in.
- Manual completion from the console is always available and always overrides.

---

## 5. Architecture

### Position in the stack

This is a new data stream on the existing platform, not a new system. It reuses the canonical PMS model, property tenancy, staff notification routing, and reporting already built for BookOne Concierge.

```
┌──────────────── BookOne Platform (EU) ────────────────┐
│                                                        │
│  Console (Next.js)      Core service (Fastify/TS)      │
│         │                        │                     │
│         └────── Postgres ────────┘                     │
│                    │                                   │
│    ┌───────────────┼──────────────┬─────────────┐      │
│    │               │              │             │      │
│  PMS adapter   Lock adapter   MQTT broker   Voice       │
│  (Ericsoft)    (Salto/AA)     (HiveMQ EU)   (Concierge) │
└─────┼───────────────┼──────────────┼───────────────────┘
      │               │              │
   Ericsoft      Lock system     Property gateway
                 (authoritative)   (Zigbee/Thread/Modbus)
                                        │
                              Presence · TRV · Leak · Window
```

### Components

| Layer | Choice | Notes |
|---|---|---|
| Lock integration | Salto (Space / KS), ASSA ABLOY Hospitality (Vostio / Mobile Access), Dormakaba | Vendor API only. Selection follows the property's installed base |
| Mobile credential | Vendor SDK (BLE, NFC where supported) | Issued into our guest web app or wallet, per vendor capability |
| Presence sensing | **mmWave** presence sensors | Not PIR — PIR reports "empty" for a sleeping or still guest |
| Climate | Smart TRVs, or existing fan-coil controllers via Modbus | Retrofit means wireless; no rewiring |
| Protection | Leak, humidity, window/door contact | Zigbee |
| Gateway | Small industrial PC per property, Zigbee/Thread coordinator | Local buffering; rooms keep working if WAN drops |
| Transport | MQTT over TLS → HiveMQ Cloud (EU) | Per-property credentials, topic-scoped |
| Storage | Postgres (EU), monthly partitions | Time-series store deferred until volume justifies it |

### Failure behaviour — required, not optional

| Failure | Behaviour |
|---|---|
| Our platform unreachable | Locks and rooms operate normally on the vendor system. No guest impact |
| Lock vendor API down | Mobile keys not issued; front desk falls back to physical cards. Alert raised |
| Gateway offline | Sensors buffer locally; HVAC holds last setpoint; backfill on reconnect |
| Guest's phone dead / no BLE | Physical card at the desk. **Always available** |
| Power loss | Locks operate on internal batteries; mechanical override present |

There must never be a state in which a guest cannot enter their room because our software is unavailable.

---

## 6. Data protection and residency

**Residency:** all processing and storage in EU regions. Broker, database, object storage and application hosting on EU-owned providers where practical (HiveMQ, Scaleway/Hetzner, Aiven). A sub-processor register is maintained as a contract annex.

**Presence data.** Stored as a room-level boolean state with timestamp. No movement traces, no dwell-time analytics, no occupancy counts, no behavioural inference. The sensor stream carries `room_id`, never `guest_id`; the join to a guest exists only transiently in application logic and is never persisted.

**Access events.** Retained for security and dispute resolution, default 90 days, then hard-deleted. Guest-linked events are exportable and erasable on request.

**Identity documents** captured at pre-check-in are transmitted for Alloggiati submission and deleted from our systems once submission is acknowledged. We do not become a document archive.

**Explicitly excluded, permanently:** cameras, microphones, audio sensing, any biometric processing, any form of guest behaviour profiling. This is stated in the product documentation and in the guest privacy notice, because the trust cost of ambiguity here is far higher than any feature gained.

**Network:** devices on an isolated VLAN with no route to guest wifi, the PMS network, or the property's admin network. A compromised sensor must not become a path into hotel systems.

---

## 7. Safety, legal and insurance constraints

| Constraint | Requirement |
|---|---|
| Fire code | Mechanical egress and override on every door. Never overridden by software |
| Lock certification | Only certified hotel-grade hardware. We install nothing we have not sourced from a recognised vendor |
| Liability | Contractual cap at fees paid; consequential damages excluded; professional indemnity cover in place before first installation |
| Source of truth | The lock vendor's system remains authoritative for access rights. We reflect state, we do not own it |
| Installation | Performed by a qualified electrician / certified locksmith. We coordinate; we do not fit doors |
| Alloggiati | Submission accuracy is a legal obligation of the property. We provide the mechanism and the audit log; the property remains the responsible party. This must be explicit in the contract |

---

## 8. Phasing

| Phase | Scope | Duration | Gate |
|---|---|---|---|
| **0 — Survey** | Audit installed locks (vendor, model, online vs offline, API availability), PMS lock integration already present, network, thermal capacity | 2 weeks | Lock API access confirmed |
| **1 — Access & arrival** | Lock adapter, mobile credential issuance, door event stream, pre-check-in flow, arrival completion, Alloggiati submission | 8–10 weeks | Guest completes arrival without the desk |
| **2 — Presence** | mmWave sensors, gateway, MQTT ingest, housekeeping status, occupancy dashboard | 4–6 weeks | Housekeeping reports fewer wasted room visits |
| **3 — Comfort & protection** | HVAC setback, leak/window detection, energy reporting | 4–6 weeks | Measured consumption reduction vs baseline |
| **4 — Productise** | Multi-tenant hardening, second lock vendor adapter, installer documentation | 6–8 weeks | Property #2 installed without engineering involvement |

**Critical path:** Phase 0. Most hotels already have electronic locks — the decisive question is whether they are *networked with an API* or *offline data-on-card*. Offline systems cannot issue remote mobile credentials and require a hardware upgrade, which changes the capex by an order of magnitude. Establish this before quoting anything.

Second question for Phase 0: **does Ericsoft already integrate with the installed lock system?** If so, the integration path may run through the PMS rather than direct to the lock vendor, which is cheaper and politically easier.

---

## 9. Indicative costs

### Per property (60 rooms)

**Scenario A — networked locks with API already installed**

| Item | Cost |
|---|---|
| Lock integration (software, no hardware) | — |
| Presence sensors, 60 rooms @ €50–90 | €3,000 – €5,400 |
| Smart TRVs, 60 rooms @ €60–150 | €3,600 – €9,000 |
| Leak / window sensors (selective) | €800 – €2,000 |
| Gateway, networking, VLAN setup | €1,500 – €3,500 |
| Installation and commissioning | €3,000 – €6,000 |
| **Total capex** | **€11,900 – €25,900** |

**Scenario B — offline locks requiring upgrade**

| Item | Cost |
|---|---|
| Networked lock retrofit, 60 doors @ €400–800 | €24,000 – €48,000 |
| Everything in Scenario A | €11,900 – €25,900 |
| **Total capex** | **€35,900 – €73,900** |

Scenario B is a different conversation — closer to a capital project than a software purchase, and it should be led by the lock vendor with us integrating, not the reverse.

### Development

| | |
|---|---|
| Engineering | 8–12 person-months |
| Team | 1 engineer + Nicolas |
| Duration | 5–7 months across phases 1–4 |
| **Cost** | **€80k – €150k** |

Lower than a standalone build because tenancy, notification routing, the canonical PMS model and reporting already exist.

### Commercial model

Capex on hardware and installation, plus **€200–500 per property per month** for the platform. Alternatively, financed into a 36–48 month contract to convert capex into opex, which independent owners generally prefer.

---

## 10. Business case

**For the owner asking:** contactless arrival, no desk queue at 22:00, no lost key cards, revocable credentials, and visibility of which rooms are actually occupied.

**For every hotel after him**, which is what makes this a product rather than a favour:

- **Energy.** Occupancy-driven HVAC setback typically reduces heating and cooling consumption by 15–30%. On current European energy prices this alone can carry the payback.
- **Regulatory.** The recast EPBD (EU 2024/1275) makes building automation mandatory for non-residential buildings — above 290 kW from 2026, dropping to 70 kW by 2030. Most properties in the target segment will be captured by the 70 kW threshold and are not yet aware of it. Verify national transposition per country.
- **Labour.** Housekeeping stops knocking on occupied rooms and stops checking empty ones.
- **Insurance.** Leak detection is a negotiable line item with most commercial property insurers.

**Payback:** model against the property's actual utility bills. Scenario A typically lands at 2–4 years on energy alone, faster with labour and insurance included. Scenario B needs the lock upgrade justified on its own merits before this analysis is meaningful.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Lock vendor denies or gates API access | Blocks Phase 1 entirely | Establish in Phase 0. Fall back to PMS-mediated integration if Ericsoft already integrates the locks |
| Installed locks are offline / data-on-card | Capex ×3, project becomes a capital sale | Phase 0 survey. Quote nothing before it completes |
| Guest cannot enter room due to our failure | Severe — trust and liability | Physical card fallback always available; mechanical override; vendor system authoritative |
| Wrong person granted access | Severe | We never issue credentials outside the vendor's rules; reservation-scoped only; full audit log |
| Alloggiati submitted with bad data | Legal exposure for the property | Validation at pre-check-in; property remains responsible party contractually; audit log retained |
| Presence sensing perceived as surveillance | Reputational, GDPR | Boolean-only storage, published privacy notice, no cameras or microphones ever |
| Hardware becomes our support burden | Margin and founder time | We do not sell hardware directly where avoidable — property procures, we integrate |
| **Focus dilution** | **Existential** | See Section 12 |

---

## 12. Sequencing — the honest constraint

This is the third product request from the hospitality direction, after the PMS proposal and the voice concierge. BookOne Concierge currently has **zero paying properties** and is not built.

Recommended sequencing:

1. **Now:** ship BookOne Concierge to the design partner and two unrelated properties. Nothing else starts.
2. **In parallel, cost-free:** run the Phase 0 survey at this owner's property. Two days of work. It either qualifies the opportunity or kills it before any capital is committed.
3. **Month 6–9, conditional on Concierge revenue:** begin Phase 1.
4. **Never:** build hardware.

The compounding asset across all three requests is identical — *the integration platform between hotel systems and everything else*. Voice is the first data stream, rooms are the second. That is one coherent company. Three concurrent products, with one engineer, is not.

---

## 13. What we need from the owner

**Blocking**
- [ ] Lock system: vendor, model, year, online or offline, existing PMS integration
- [ ] Written confirmation that the lock vendor will grant API access
- [ ] Ericsoft integration request status (shared dependency with BookOne Concierge)
- [ ] Confirmation that pre-arrival online check-in is acceptable to him operationally — the whole arrival flow depends on it
- [ ] Whether he is willing to keep the front desk path permanently available as fallback

**Non-blocking**
- [ ] 24 months of utility bills and installed thermal capacity, for the energy model
- [ ] Property network topology and whether VLAN segmentation is available
- [ ] Room count, floors, construction (masonry affects wireless range materially)
- [ ] Current housekeeping workflow and how room status is communicated today
- [ ] Insurance broker contact, to test the leak-detection premium argument
- [ ] Commercial structure: is he funding this, buying it, or reselling it?

---

## 14. Non-goals

| Non-goal | Why |
|---|---|
| Manufacturing any hardware | Different company, different economics, fatal to focus |
| Becoming the access-control system of record | Safety-critical; vendors have decades of certification we do not |
| In-room panels, tablets, scene control | Capex-heavy, low ROI, guests use their phones |
| Cameras, microphones, biometrics, behaviour analytics | Permanent exclusion. Trust cost exceeds any feature value |
| Building-wide BMS or plant control | Integrator's domain and integrator's liability |
| Removing the front desk | The fallback path is a safety requirement, not a limitation |
| Selling this before Concierge has paying customers | Section 12 |

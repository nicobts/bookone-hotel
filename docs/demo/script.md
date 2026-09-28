# Guest Desk demo — 20-minute script (WP0.7)

One property, one presenter, no terminal during the demo. Every step below is a
feature that exists and was run end to end on 2026-09-27; nothing is mocked on
screen except where the screen itself says so (payments, filing).

## Preparation — operator, five minutes before

1. `pnpm demo:reset` — rebuilds **Hotel Demo Trieste** in about four seconds and
   prints the links below. It touches no other property.
2. Services running: `apps/web`, `apps/api`, `apps/worker`, with
   `OPENROUTER_API_KEY` and the two model ids set (ADR-029). Without a key the
   concierge still works, routing by rules; the model makes the routing wider,
   never the answers different (ADR-022).
3. Open four tabs:
   - **Guest** — the stay link the reset printed (Tobias Weber, arriving tomorrow).
   - **Console** — `/it/demo-trieste/console/today`, logged in as
     `owner@demo.bookone.test`.
   - **Booking** — `/en/book/demo-trieste`.
   - **Specimen** — `docs/demo/assets/specimen-passport-icao.png` (ICAO's fictional
     "UTO" specimen; never a real person's document — ADR-029).

## The run

| # | Minutes | Do | Say | Shows |
|---|---|---|---|---|
| 1 | 0–2 | **Console → Oggi.** | "This is the hotel's morning: arrivals, who is still missing something, what needs a person." | The console is an exception surface |
| 2 | 2–4 | **Booking tab:** pick dates, a room, reach the payment step. | "Direct booking on the hotel's own page. The payment step says it is simulated — no card is charged in the demo." | Booking engine, deposit policy, simulated payment notice |
| 3 | 4–6 | **Guest tab:** open *Come vengono usati i suoi dati*; fill the party. | "Before the guest arrives: who is travelling, in their language. The page says who is responsible for the data and when document photos are deleted." | Pre-arrival capture, privacy notice (draft wording) |
| 4 | 6–8 | **Guest tab:** tick consent, upload the specimen for the lead guest. | "The guest photographs the document. Consent first, recorded once." | Consent, upload to EU storage |
| 5 | 8–10 | **Console → Prenotazioni → the arrival.** Point at *Documento letto: zona a lettura ottica verificata* and the preview. | "The machine-readable zone is read and its check digits verified. This is exactly the record that would be filed — nothing is sent from here." Press **Conferma**. | OCR + MRZ check digits, schedina preview, staff confirmation. **No authority submission** (Phase 1) |
| 6 | 10–12 | **Guest tab → Messages:** "A che ora è la colazione?" | "Answered from the hotel's own words, instantly." | General info from the knowledge base |
| 7 | 12–13 | **Guest:** "Avete una sauna?" | "It does not know — so it says so and hands over to reception. It never invents." | The "non lo so, passo alla reception" moment |
| 8 | 13–15 | **Guest:** "Possiamo fare il check-out alle 13?" then **Console → Approvazioni → Approva.** | "Anything that costs the hotel something waits for a person. The owner approves; the guest gets the confirmation in their language." | Approval gate, decision recorded, reply sent |
| 9 | 15–16 | **Guest:** "Voglio un rimborso." | "Money never goes to the assistant. Straight to a person." | Hard rule: money → T2 |
| 10 | 16–17 | **Guest:** "La camera è sporca, è inaccettabile." Open the conversation in the console. | "Logged with a deadline, the manager told at once. The console shows the clock." | Complaint, SLA, owner alert (email in the demo) |
| 11 | 17–18 | **Console → Assistente:** "Chi non ha ancora mandato i documenti?" | "The owner asks in plain words and gets the answer from their own data. It only reads; it changes nothing." | Owner agent (AG-06), read-only |
| 12 | 18–20 | **Roadmap slide** (`roadmap-slide.md`). | The three asks. | Phase 1 path and the association ask |

## What the demo does not show, and why

- **WhatsApp.** The same concierge answers on WhatsApp once the Business
  Solution Provider is verified; the demo uses the web chat.
- **Real payments.** The payment adapter is a simulator until the Stripe account
  is live; the screen says so.
- **Filing with Alloggiati Web, ISTAT or the comune.** Phase 1. Capture ends at
  staff confirmation, deliberately.
- **Identity verification.** BookOne never asserts identity (ADR-027); the check
  digits prove the document was read correctly, not who holds it.

## Acceptance mapping (plan §4)

| Plan §4 criterion | Where |
|---|---|
| Profiles complete their primary action on webchat, IT and EN | Steps 6–10; the replay set (`evals/wp0.2`) and the live eval |
| Every action in the audit log with actor, tool, input, result, reversibility | Conversation view → *Azioni dell'assistente*; `agent_runs.tool_calls` |
| No money action without human approval, demonstrated live | Steps 8–9 |
| Schedina preview correct from CIE, EU passport, non-EU passport | Step 5 (passport); `mrz.test.ts` covers TD1 (CIE back) and TD3 |
| Handoff reaches the owner ≤ 60 s and the agent stops | Step 10 (email today); "Prendo io" silences the agent |
| Demo from a clean tenant in < 20 min without a terminal | This script; reset ≈ 4 s |
| DPA template and guest privacy notice; notice on first contact | Notice on the stay page (draft, needs counsel); **DPA template: draft for counsel** (`docs/legal/dpa-template.md`) |

Rehearse twice with someone who did not build it (WP0.7 AC), and note every
place they hesitated.

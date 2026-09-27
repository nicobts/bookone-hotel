# WP0.4 — Pre-arrival document capture with schedina preview
Depends on: WP0.1 · Est.: 5–7 days · Can run in parallel with WP0.2/0.3

## Goal
Guest opens a link → photographs document(s) for each guest in the booking → OCR/MRZ extraction → schedina
preview in the inbox marked *pending staff confirmation*. **No submission to any authority.**

## Build
- Capture session: `capture_sessions` (booking_id, token, state: link_sent → documents_received → staff_confirmed, expires_at) and `guest_identity_documents` (session_id, guest_index, doc_type, images (Supabase Storage, encrypted, retention policy), ocr_fields, mrz_valid, confidence).
- Mobile-first capture page (Next.js, next-intl it/en/de/sl): per-guest steps, consent screen with the privacy notice, image quality hints, retry.
- Extraction: vision model on the EU endpoint → structured fields; **MRZ check digits validated in TS** (`mrz.ts`, TD1/TD3); CIE front without MRZ → fields flagged low-confidence for staff.
- Schedina model: the Alloggiati Web field set (tipo alloggiato, date, cognome, nome, sesso, data/luogo nascita, cittadinanza, tipo/numero documento, luogo rilascio) as a typed object with validation; **preview only**.
- Inbox card: per-booking capture status, per-guest extracted fields editable by staff, "Conferma" → `staff_confirmed`.
- Nightly job: reminder to guests whose session is `link_sent` 48h before arrival.

## Touches
New tables above, `app/capture/**`, `src/domain/schedina.ts`, `src/domain/mrz.ts`, inbox capture card, one pg-boss job.
## Must not touch
Anything that calls Alloggiati Web, WebTur or a comune. No biometric matching. No face comparison.

## Acceptance criteria
- [ ] Correct schedina preview from an Italian CIE (front+back), an EU passport, a non-EU passport (fixtures).
- [ ] MRZ check-digit failure marks the document invalid and asks for a retake (test).
- [ ] Images encrypted at rest; retention job deletes images N days after checkout (N in tenant config; test).
- [ ] Privacy notice shown before the first upload; consent stored with timestamp.
- [ ] Owner agent's `list_capture_status` reflects session states.
## Tests
`mrz.ts` unit tests with valid/invalid fixtures; extraction golden tests on fixture images; retention job test.
## Stop and ask
Choice of vision provider if not already configured; any storage of images outside Supabase EU; any field beyond the schedina set.

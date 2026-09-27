# ADR-035 — WhatsApp and SMS go through Twilio, initially

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-029 (storage EU, processing may run outside it), ADR-032 (webhooks), ADR-034 (`apps/api` holds webhooks) · **Supersedes:** nothing
**Amends:** 04 §0 — the WhatsApp BSP decision and the SMS provider are no longer open. The ESP (email) stays open.

## Triggering event

Phase 0 acceptance (plan §4) needs two things:

- every profile working end to end on WhatsApp;
- a handoff that reaches the owner's phone within 60 seconds.

The channel was blocked on choosing a Business Solution Provider (BSP). The
owner already has a Twilio account and approved Twilio as the initial provider
for WhatsApp and SMS on 2026-09-27, with other options to be evaluated later.

## Context

WhatsApp Business messages always pass through Meta's Cloud API, whichever BSP
sends them. The BSP adds its own processing and its own message log. The options
on the table:

- **Twilio.** A Meta-approved BSP, an existing account, and one API for both
  WhatsApp and SMS. Contracted through Twilio Ireland; the DPA carries SCCs and
  Binding Corporate Rules. Messaging is available in the Ireland region (IE1) on
  suitable accounts. The default region is the US.
- **360dialog.** An EU (Berlin) BSP and a thin layer over Cloud API, with no SMS.
- **Meta Cloud API directly.** No BSP fee, no SMS, and more of the onboarding is
  ours to run.

## Decision

1. **Twilio is the provider for WhatsApp and SMS**, behind the existing
   `NotificationProvider` port for outbound messages and a new inbound path in
   `apps/api`. Nothing outside `packages/adapters/src/twilio` knows it is
   Twilio. Swapping the provider means writing another adapter that passes the
   same tests.

2. **Processing outside the EU is a recorded exception, like ADR-029's.**
   - Message content is processed by Meta and possibly by Twilio outside the EU.
   - `registerNotificationProvider` accepts `euProcessing: false` only when the
     provider cites `ADR-035`.
   - The provider must also have a register entry that says so.

3. **Storage stays in the EU in our systems, and is kept short in Twilio's.**
   The thread, the messages and the delivery state live in Supabase EU, as for
   webchat. Twilio's own copy is handled this way:
   - The adapter uses Twilio's EU region when the account supports it
     (`TWILIO_REGION=ie1`).
   - It **deletes each message resource from Twilio** once the message reaches
     a final state: inbound after we store it, outbound after the final status
     callback. Twilio's log therefore holds content only while it is in flight.
   - Meta's own transient retention for delivery is outside our control, and
     the register entry says so.

4. **Webhooks follow ADR-032.**
   - `X-Twilio-Signature` is verified against the exact public URL.
   - Inbound processing is idempotent on the `MessageSid`, recorded in
     `external_refs` (`system = 'twilio'`) so no new table is needed.
   - The routes sit behind the webhook rate limit.

5. **Who a sender is comes from recorded data only.**
   - The number a message arrives *to* selects the property
     (`properties.settings.whatsappNumber` or `smsNumber`).
   - A sender listed in `ownerPhones` reaches the owner agent. It is the only
     path to it, and it existed before this ADR.
   - A sender matching a guest phone on a current stay reaches that stay's
     thread.
   - Anyone else gets a fixed reply that names the booking page. Pre-sale
     threads without a reservation need the thread migration the inventory
     lists, and are not part of this ADR.

## Cost of change / cost of not changing

**If wrong:** the adapter is replaceable. A WhatsApp number can migrate between
BSPs, and 360dialog or Cloud API directly would be an adapter plus a register
entry. Message history lives in our database, not Twilio's.

**If not done:** the Phase 0 acceptance items that name WhatsApp cannot be met.
The owner-phone handoff stays email-only, and the demo shows a webchat where the
pitch says WhatsApp.

## Alternatives rejected

- **360dialog first.** It is an EU provider and cheaper per message. But it has
  no SMS and needs a new account and new onboarding, and the owner already has
  Twilio. It remains the first candidate when this is re-evaluated.
- **Meta Cloud API directly.** It saves the BSP fee but moves template
  management, number onboarding and webhooks for SMS elsewhere onto us, for a
  demo.
- **Keeping Twilio's message log.** It would be convenient for support but is a
  second, non-EU copy of guest conversations for no product need.

## Consequences

- Register entry SP-013 (Twilio, with Meta named as its sub-processor for
  WhatsApp). The guest privacy notice already names processing outside the EU
  for messages.
- New environment variables:
  - `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, both secrets;
  - `TWILIO_REGION`;
  - `TWILIO_WEBHOOK_BASE_URL`, needed because signature checks use the public
    URL.
- Business-initiated WhatsApp messages outside the 24-hour window use
  Meta-approved templates, referenced by Twilio Content SID in configuration.
  Owner alerts are the first case.
- Italian SMS alphanumeric sender IDs need registration. Until one is
  registered, SMS goes from a number.
- Meta's policy allows business-specific assistants on the WhatsApp Business
  Platform, not general-purpose ones. The concierge answers only about the
  property, from tools, which is the allowed kind. Keep the use case described
  that way in the Meta profile.

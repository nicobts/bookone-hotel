# Runbook — WhatsApp and SMS (Twilio, ADR-035)

What is built, how to switch it on for development and for the demo, and what is
still missing before a real property uses it.

## How a message travels

**Inbound**
1. Twilio POSTs to `apps/api` at `/webhooks/twilio/inbound`. The route is
   rate-limited and checks the signature against `TWILIO_WEBHOOK_BASE_URL`.
2. `routeInboundMessage` (`packages/core/src/channels`) resolves the property by
   the number the message was sent *to*. It then checks the channel's feature
   and decides who the sender is:
   - **Owner:** the number is in `settings.ownerPhones`. The `owner.message` job
     runs the owner agent (AG-06), which re-checks the number, and sends the
     answer back.
   - **Guest:** an exact E.164 match on the guest phone of a confirmed stay,
     from 14 days before arrival to 2 days after departure. The message joins
     that stay's thread, which is marked `whatsapp`. `concierge.reply` runs the
     orchestrator as for webchat.
   - **Anyone else:** `channel.unmatched` sends one fixed reply. Nothing is
     stored except the idempotency record.
3. Each Twilio `MessageSid` is recorded in `external_refs`. A redelivered
   webhook is recognised and changes nothing.
4. `channel.purge` deletes the message from Twilio's log once it is stored.

**Outbound**
- `channel.deliver` sends every reply on a WhatsApp/SMS thread that is not yet
  delivered. That covers the concierge's answer, the handover phrase, a staff
  reply from the console, and an approval's outcome.
- It runs right after each concierge turn, and a one-minute `channel.sweep`
  catches the rest.
- Each send is linked in `external_refs`. The status callback
  (`/webhooks/twilio/status`) deletes Twilio's copy once the message reaches a
  final state.
- A permanent refusal (not a WhatsApp user, blocked) is recorded as
  `message.dispatch_failed` and not retried.

**The 24-hour rule.** WhatsApp accepts free text only within 24 hours of the
guest's last message. A reply written later stays pending: the worker logs it
and does not send it. Sending outside the window needs an approved template.
**Not built yet.**

## Development: the Twilio sandbox

1. In the Twilio console, open the WhatsApp sandbox and join it from your phone
   ("join <code>" to the sandbox number).
2. Expose `apps/api` publicly for Twilio's webhooks with a tunnel. This is for
   development only, and the tunnel provider sees webhook traffic, so use the
   sandbox and fictional data, never a real guest.
3. In the sandbox settings:
   - "When a message comes in": `<tunnel>/webhooks/twilio/inbound`, POST;
   - "Status callback": `<tunnel>/webhooks/twilio/status`.
4. In `.env`:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`;
   - `TWILIO_WHATSAPP_FROM` = the sandbox number;
   - `TWILIO_WEBHOOK_BASE_URL` = the tunnel URL, exactly;
   - `DEMO_OWNER_PHONE` and/or `DEMO_GUEST_PHONE` = the phones that joined the
     sandbox.
5. Run `pnpm demo:seed`. It grants `whatsapp` to the demo property only and
   prints which phone plays whom. Then restart `apps/api` and `apps/worker`.

From the guest phone, "A che ora è la colazione?" should come back from the
knowledge base. From the owner phone, "Chi non ha ancora mandato i documenti?"
should come back from the owner agent.

## Before a real property uses it

- [ ] **Meta Business verification**, an approved display name, and a WhatsApp
      sender on Twilio (not the sandbox). The use case is described as
      business-specific guest support: Meta does not allow general-purpose
      assistants.
- [ ] **Region.** Confirm the account can use IE1 for messaging. Then set
      `TWILIO_REGION=ie1` with IE1 credentials and update SP-013's region. If it
      can't, SP-013 says US and the delete-after-final-state behaviour carries
      the weight.
- [ ] **Templates.** The owner's handover alert is built.
      - It goes to every number in `ownerPhones` at the moment of handover,
        through the notification outbox.
      - It uses the Twilio template in `TWILIO_TEMPLATE_ESCALATION_ALERT`,
        with {{1}} who is waiting and {{2}} the link. Submit that template to
        Meta.
      - Without it, free text is sent, which WhatsApp accepts only inside
        24 hours of the owner's last message.
      - Still to do: a template for the pre-arrival invitation.
- [ ] **Italian SMS sender ID** registration, if SMS is to show a name rather
      than a number.
- [ ] **Per-property numbers.** Today one sender per deployment
      (`TWILIO_WHATSAPP_FROM`); the property's `settings.whatsappNumber` must
      match it.
- [ ] Enabling `whatsapp` for a real property is an operator action in
      `apps/admin`, with a reason. It is never done by seed or script.

# Design note — alert contacts (Team screen)

**Surface:** the "Who we page" section of **Team** (`/{locale}/{slug}/console/members`), owner-only.
**Reference (08 §3):** none named. Proposed: the on-call contact lists of
incident-alerting tools (the people and numbers a page goes to, each with a role),
and the "notification recipients" settings of payment dashboards. Public product
documentation only, studied for behaviour.

## 1. Understand

What those lists get right, as behaviour:

- A contact is a **person with a number and a role**, not a bare number. The role
  decides which alert reaches them.
- **Adding someone is a deliberate act** with a confirmation, because the person
  on the other end did not sign up for it.
- **Removing someone is one step** and takes effect immediately, since the usual
  reason is that they left.
- The list says plainly **what each role receives**, so the person managing it does
  not have to know the alerting rules.

## 2. Validate for our buyer

A small independent hotel has an owner, often a family member at the desk, and a
few staff, some of whom never log into the console: a night porter, a seasonal
receptionist. The paging list is therefore not the membership list, and it holds
personal numbers, the owner's own included.

Two obligations follow that an incident tool does not carry in the same way:

- **The hotel is the controller** of these numbers (privacy runbook). It must tell
  each person before listing them (Art. 13), and it must be able to remove them
  itself when they ask or leave (Art. 16, 17).
- **A receptionist has no reason to read the owner's personal number.** The list
  is owner-only, at the database (RLS), not just in the navigation.

## 3. Re-derive and improve

- **One section on the Team page, not a new page.** The people who are paged
  belong beside the people who sign in; a separate page implies a separate
  concept to learn.
- **Two roles, named by what they receive:** *Owner*: guests waiting, the owner
  assistant on WhatsApp, and the last filing reminder. *Staff*: the earlier
  filing reminder. No free-form roles.
- **The Art. 13 confirmation is a required checkbox on the add form**, worded as
  what the owner has done ("I have told this person..."), and its date is stored.
  Contacts carried over from the old settings have no date and are flagged with a
  one-click "Confirm they were told".
- **The number is shown in full only here**, in tabular figures, because the owner
  reads it back to check it. Nowhere else in the console shows these numbers.
- **Removal needs no reason and has no undo.** Re-adding is one form, and a
  confirmation step would only slow down the case that matters: someone left
  today.
- **No test message button.** Sending a message to a number from a settings
  screen is itself a page nobody asked for.

## 4. Deferred

- Per-contact choice of channel (today: the property's first messaging channel,
  WhatsApp then SMS).
- Quiet hours per contact.

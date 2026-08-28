# Contract mirror — Alloggiati responsibility

> **DRAFT FOR COUNSEL. NOT LEGAL TEXT AND NOT YET AGREED WITH ANYONE.**
>
> This states the position the product is built on, in plain language, so that a
> lawyer can turn it into terms rather than reverse-engineer it from code. Every
> sentence below is a claim about who is responsible for what; none of it has
> been reviewed. It must be before a property signs anything (04 §1 Sprint 6).

---

## The position

**The property is the declarant.** Italian law places the obligation to report
accommodated persons to the Questura on the accommodation provider. That does
not move because the provider uses software. BookOne prepares the declaration
from data the guest supplies and transmits it on the property's instruction; the
property remains the party that made it.

This matters in three concrete ways, and the product is built around all three:

**1. The property can always act without us.** Manual submission is available at
all times from the console (E2.3). A property that could only file when our
automation chose to would be a property whose legal compliance depended on our
uptime, and no sensible operator would accept that.

**2. The property can always see what was filed.** `alloggiati_submissions`
holds the exact transmitted payload, its checksum, and the authority's receipt,
and the property reads all of it. When a Questura asks what was declared for a
guest, the owner answers — not us on their behalf.

**3. The property is told when we could not file.** The T-20h alert exists
because a declarant who does not know the declaration failed cannot remedy it.
Twenty hours rather than twenty-four so it is a chance to act rather than a
notice of a breach.

## What BookOne does

- Collects registration data from the guest before arrival, in their language
- Validates it against the registry's requirements and tells the property what
  is missing
- Builds the declaration and transmits it on arrival confirmation
- Retains the receipt as evidence the declaration was made
- Deletes the identity documents once the declaration is acknowledged (E2.4)

## What BookOne does not do

- Assume the property's legal obligation
- Decide whether a guest must be declared
- Retain identity documents beyond acknowledgement
- File anything the property has not enabled

## Open questions for counsel

1. **Credential custody.** If the direct-web-service channel is chosen, we hold
   or transmit the property's own Alloggiati Web credentials. What does that
   require contractually, and does it change our insurance position?
2. **An intermediary as sub-processor.** If a certified intermediary is chosen,
   they process guest personal data. D9 requires an EU processing guarantee, a
   register entry and a DPA. Is anything further required given the data class?
3. **Failure liability.** Where a declaration is late or rejected because of a
   platform failure rather than missing guest data, what is the allocation, and
   what evidence does the property need from us to show it acted?
4. **Retention of the receipt.** How long must the property retain the receipt
   after the documents are destroyed, and does that bind our retention job?
5. **Austria and Slovenia.** The equivalent obligations differ. Does this mirror
   need a per-jurisdiction variant before those markets open?

## Status

Not reviewed. Not agreed. Drafted alongside the Sprint 6 build so that the
legal review has something concrete to correct, which is faster than a review
of an empty page — and so that anyone reading the code can see which
responsibilities it was written to respect.

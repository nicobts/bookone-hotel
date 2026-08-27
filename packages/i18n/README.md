# @bookone/i18n

Locales `it de en sl` (D13, 03-ARCHITECTURE §6). Nothing beyond these four in
V1 — the deflection list in 00-PROJECT-OVERVIEW §6 is explicit about it.

Guest locale comes from the booking choice and is persisted on the reservation.
Property content fields are `*_i18n jsonb` and resolve through the fallback
chain **guest → property default → en**. Every templated notification is
localized; a missing key is a build-time failure, not a runtime English string
in front of an Italian guest.

`next-intl` consumes these catalogues from `apps/web`; the worker uses the same
files for notification templates, so a phrase exists once.

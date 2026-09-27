# WP1.3 — WebTurFVG adapter (regional ISTAT, C59)
Depends on: WP1.1 · Est.: 2 weeks · Blocked on: submission specification from Regione FVG (via the association's letter)

## Build
- Daily arrivals/presences roll-up per structure, including zero-presence days, from confirmed bookings and schedine.
- Transport per the obtained spec (file upload automation or service); if no machine interface exists, generate the exact upload file and automate the portal step behind a feature flag with a manual fallback always available.
- Reconciliation view: what BookOne reported vs. what the portal shows.

## Acceptance criteria
- [ ] 30 consecutive simulated days produce a correct daily series (test against a hand-computed fixture).
- [ ] Zero-presence days are reported.
- [ ] Manual fallback file matches the portal's expected format (validated with a pilot).
## Stop and ask
Any portal automation that could violate the portal's terms; confirm with the Regione contact first.

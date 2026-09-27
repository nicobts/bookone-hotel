# ADR-F3 — ComplianceAdapter and IdentityVerificationAdapter contracts
Status: Accepted · Date: 2026-09-27 · Related: ChannelAdapter, LockAdapter, VoiceRuntime doctrine

## Decision
Same capability-declaration doctrine as the existing adapters.
`ComplianceAdapter` declares: jurisdiction, obligation types, submission transport, evidence type, retry policy,
manual-fallback format. Phase 1 implementations: AlloggiatiWeb (national), WebTurFVG (regional ISTAT),
ImpostaSoggiornoTrieste (municipal rule table + declaration export).
`IdentityVerificationAdapter` declares: mode (staff-assisted video, vendor), consent requirements, evidence produced.
It never returns an identity assertion made by BookOne; a human or a certified vendor asserts, BookOne records.
Every adapter must ship a manual fallback: portal-ready data a staff member can submit by hand in under two minutes.

## Consequences
+ Region expansion = one ComplianceAdapter + one comune rule table.
+ De visu (Phase 3) is a switch, not a rebuild.
− Adapter interfaces are defined in WP1.1 before any authority integration; no shortcuts.

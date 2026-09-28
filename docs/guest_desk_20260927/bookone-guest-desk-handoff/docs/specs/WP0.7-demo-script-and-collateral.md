# WP0.7 — Demo script, roadmap slide, association one-pager (Italian)
Depends on: WP0.2–0.6 · Est.: 2 days

## Deliverables
- `docs/demo/script.md`: 20-minute run on the demo tenant, no terminal: pre-sale → booking link → payment link → pre-arrival link → document capture → schedina preview → general-info → complaint → owner notified → owner agent query → scripted "non lo so, passo alla reception" moment → roadmap.
- `docs/demo/roadmap-slide.md`: Alloggiati Web → WebTur (FVG) → Comune di Trieste; the three asks (5 pilots, letter to the Regione, convenzione structure).
- `docs/demo/one-pager.it.md`: positioning, what it does today, what comes with pilots, data ownership and EU hosting, no AI jargon on the first page.
- `scripts/demo-reset.ts`: returns the demo tenant to the script's starting state in < 30 s.

## Acceptance criteria
- [ ] Script executed end-to-end twice by someone who did not build it, from reset, in under 20 minutes.
- [ ] Every step in the script maps to a green acceptance item in WP0.2–0.6.

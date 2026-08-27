---
name: add-ui-component
description: Use when adding an interface component, adapting a shadcn registry block, or building a console or guest surface. Enforces registry-first sourcing, the locale and property route corrections, four-locale strings, and the reference-implementation note ADR-014 requires.
---

# Add a UI component

Read `docs/conventions/UI_COMPONENTS.md` for the reasoning. This is the order.

## Before a surface: the design note (ADR-014)

A new _surface_ — not a new button — names its reference implementation before
it is built, in a short design note recording the reference, the reasoning, and
what we changed for our buyer. The mapping is in `docs/08 §3`.

The note is both the quality mechanism and the evidence of independent
development, so it is written before the code, not reconstructed after.

**The legal boundary is binding.** References are studied at the level of
_behaviour and rationale_, never _expression_: no code inspection, no asset
reuse, no copied UI or marketing text, no pixel-close imitation, no reuse of
coined or distinctive names. Public materials only.

That applies to competitors. Patterns lifted from our own sibling codebases are
ordinary reuse — but their _vocabulary_ still does not come across: this product
says property, stay, arrival.

## The sequence

**1. Look for it in the registry before writing it.**

```bash
npx shadcn@latest view <name>     # inspect before adding
npx shadcn@latest add <name>      # vendored into the repo, ours to edit
```

Run from `apps/web`, never the repo root — the CLI resolves paths from
`components.json`. A hand-rolled input looks correct in review and drifts from
the theme within months.

**2. Apply the corrections every registry block needs.** Each fails quietly:

- **Route under `src/app/[locale]/`.** Blocks write to `src/app/<route>/`, which
  the proxy never rewrites to — the page is simply unreachable.
- **Console routes go under `[locale]/[property]/`** and every internal link is
  prefixed with the active slug (ADR-016).
- **Links from `@/i18n/navigation`**, never `next/link` — it drops the locale.
- **Strings into `packages/i18n/messages/*.json`, all four locales.** A missing
  key renders as its own path and does not fail the build.

**3. Async controls disable, spin beside the label, and set `aria-busy`.**
Not one of the three — all three. Without the first, a slow connection produces
two bookings for one guest.

**4. Semantic tokens only.** No literal colours. The property is the brand and
overrides these variables per tenant (PRD A1); a literal colour is one a hotel
cannot override.

**5. Check `de`.** German compounds are the widest of the four locales in
practice; a button sized to its Italian label wraps.

## Do not

- Mount `TooltipProvider` or the toaster per page — they belong once in
  `app/[locale]/layout.tsx`, and several registry components assume one above
  them
- Copy a dashboard from another product wholesale. The console is an
  exception-handling surface (D15), not a metrics dashboard — furniture from a
  different product has to be deleted before the real work starts

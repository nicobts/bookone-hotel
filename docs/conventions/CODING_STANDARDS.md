# Coding standards

Conventions, not decisions. Anything here is cheap to change — if it were
expensive, it would be an ADR.

## Comments

The rule that matters most in a repository written largely with AI assistance.

**Write comments that explain why.** A constraint, a failure mode, a rejected
alternative, a non-obvious ordering. These are the highest-value lines in a
file, because they carry what cannot be recovered by reading the code.

```ts
// Touching the user refreshes an expiring session. Do not remove: without a
// call here, server components receive a stale token and log the user out.
await supabase.auth.getUser()
```

**Do not write comments that restate what.** They add reading cost and go stale
silently.

**Comment density should match the surrounding file.** A file with one comment
per twenty lines should not acquire a section with one per three.

## Naming

- Say what a thing is, not what pattern it uses. `reservation`, not
  `reservationManager`.
- **Domain vocabulary is the product's vocabulary.** The hotel calls it a
  property, a stay, an arrival — so do the types. Where a sibling codebase's
  pattern is borrowed, the pattern comes across and its vocabulary does not.
- Booleans read as assertions: `isReflected`, `hasDeposit`.

## TypeScript

- No `any`. An honest `unknown` with a narrowing check beats a lie.
- Types flow one way: Drizzle schema → core types → Hono RPC → web. No
  hand-written duplicates downstream (binding rule 10).
- Prefer inference. Annotate at boundaries — exported values, function
  signatures — not at every local.

## Money, dates and numbers

- **Money is integer cents with an explicit currency**, never a float. The
  schema says `total_cents`, `price_cents`, `fee_cents` for this reason. A
  rounding error in a folio is a credibility problem, not a display bug.
- Percentages are stored as decimals (`0.04`) and formatted at the edge. One
  representation internally, one conversion point.
- **Dates carry their timezone, and the property's timezone is the authority.**
  An arrival date is a hotel-local calendar date, not an instant. Reconciliation
  classifies discrepancies as `rounding | tz | logic` because timezone errors
  are expected and must be distinguishable from real ones.
- A computed figure is never rounded for storage — only for display.

## Errors

- **Fail loudly at startup for missing configuration.** A missing connection
  string stops the process; it does not surface as a confusing query error an
  hour later. See `apps/worker/src/env.ts`.
- User-facing error messages are translated strings, like every other string.
- Never swallow an error silently. If it is genuinely ignorable, the comment
  explains why.

## Files

- One concern per file. A file that needs "and" to describe it is two files.
- Directory names are plural for collections (`components`), singular for
  concepts (`core`).
- **New top-level directories need a reason recorded in an ADR.** The root is
  the most contested namespace in any repository.

## Before saying it works

Run it. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` at minimum, and
the actual feature path if there is one. **Report what was run and what it
printed** — a claim of success without evidence is the most expensive kind of
noise, because someone has to re-verify it anyway.

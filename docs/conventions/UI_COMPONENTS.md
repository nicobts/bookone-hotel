# UI conventions

How this project sources, adapts and themes interface components. The
operational checklist is `.claude/skills/add-ui-component/SKILL.md`; this
document explains the reasoning behind it.

Surfaces also obey **ADR-014**: every surface names a reference implementation
before it is built, and deviating from it needs a wedge-tied reason in the PR.
That ADR governs *what* a screen does. This file governs *how* it is assembled.

## Sourcing: registry first

Components come from a registry and are **vendored into the repo** — our files,
editable, not a dependency we wait on.

| Source | Use for | How |
|---|---|---|
| shadcn registry | Everything general: inputs, dialogs, tables, charts, blocks | `npx shadcn@latest add <name>` |
| `@supabase` registry | Storage, realtime and auth-adjacent widgets | `npx shadcn@latest add @supabase/<name>` |
| Written here | Only what neither provides | Build from registry primitives |

Run the CLI from `apps/web`, never the repo root — it resolves paths from
`components.json`.

**Why registry-first:** a hand-rolled input looks correct in review and drifts
from the theme within months. Registry components share the token set, the dark
mode behaviour and the accessibility work.

## Adapting blocks: the three corrections

Registry blocks assume a plain single-locale, single-tenant app. Every block
needs the same fixes, and skipping any of them fails quietly rather than loudly:

1. **Routes belong under `src/app/[locale]/`.** Blocks write to
   `src/app/<route>/`. The proxy rewrites `/login` → `/it/login`, so a page
   outside the locale segment is simply unreachable.
2. **Console routes belong under `[locale]/[property]/`** (ADR-016) and every
   link built inside them is prefixed with the active slug.
3. **Strings belong in `packages/i18n/messages/*.json` — all four locales, every
   time.** A missing key renders as its own path and does not fail a build, so
   this is caught by looking, not by CI.
4. **Links come from `@/i18n/navigation`.** `next/link` drops the active locale.

Blocks also duplicate markup across variants. Extract on sight, or the next
change becomes two edits and one of them gets missed.

## Interaction state

Any control that triggers async work must, without exception:

- **disable itself while pending** — otherwise a slow connection produces two
  bookings for one guest
- **show a spinner beside its label, not instead of it** — swapping the text for
  a spinner changes the button's width mid-click, which reads as a bug
- **set `aria-busy`**

Password fields use a reveal toggle that is `type="button"` (or it submits the
form), `tabIndex={-1}` (so tab order runs email → password → submit), and
carries a label that changes with state — an icon alone tells a screen reader
nothing.

## Theme and design tokens

Two files, deliberately separated:

| File | Role |
|---|---|
| `src/app/tokens.css` | Base design tokens — the raw palette and scale |
| `src/app/globals.css` | Maps those tokens onto shadcn's semantic variables |

**Never edit a token to make one screen look right.** Put the adjustment in the
mapping layer.

### Neutral base, per-property theming on top

The base palette is deliberately neutral. It is not the brand — **the property
is the brand.** PRD A1 requires per-property theming (logo, colours, photos) on
the booking surface, so a hotel's colours override the same variables the base
theme defines. A literal colour anywhere in a component is a colour a property
cannot override.

- Use semantic classes (`bg-muted`, `text-muted-foreground`, `border`) rather
  than literal ones. `text-gray-500` is invisible in dark mode and has to be
  hunted down later; the token is already correct in both.
- **Every money, date and quantity figure is tabular.** Rates, folios and
  occupancy get compared by eye down a column.
- Radii are restrained. Nothing is a pill except status chips, which read as
  stamps.

### Four locales change layout, not just words

German compounds run long and Slovenian is inflected: a button sized to its
Italian label will wrap in German. Test the console shell in `de` before calling
a layout done — it is the widest of the four in practice.

## Provider placement

`TooltipProvider` and the toaster are mounted once in `app/[locale]/layout.tsx`.
Several registry components — the sidebar among them — assume a tooltip provider
exists above them. Mounting per page means discovering the omission one page at
a time.

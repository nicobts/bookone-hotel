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

**Shared by both consoles.** The vendored components live in `packages/ui`
(`@bookone/ui`) and are used by `apps/web` and `apps/admin` alike: one look, one
place to fix. This follows shadcn's monorepo layout.
- A primitive (button, dialog, table…) goes into `packages/ui`.
- A composition specific to one app (a sidebar's entries, a booking step) stays
  in that app's `src/components`.

Run the CLI from the app you are working in (`apps/web` or `apps/admin`), never
the repo root. Each app's `components.json` sends primitives to
`@bookone/ui/components` and its own blocks to the app.

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

Two components do all three, so nobody writes it by hand:

| Where | Use |
|---|---|
| A `<form action={serverAction}>` in a server component | `PendingButton` from `@bookone/ui/components/pending-button`. It reads the form's status itself (`useFormStatus`), so the page stays a server component. Pass `icon` for a leading icon: the spinner takes its place and the width does not change. With `name`/`value`, only the pressed button spins. |
| A client component with its own transition | `Spinner` from `@bookone/ui/components/spinner`, plus `disabled` and `aria-busy` (see `SubmitButton`, `ExportButton`). |

`Spinner` is the platform's only spinner: a faint track with a moving arc.
Do not reach for lucide's `Loader2` with `animate-spin`; its broken circle wobbles
at 16px. Inside a control whose label already says what is happening, pass
`aria-hidden`.

A server action must not `redirect()` to a file download. The browser downloads
and stays on the page, the navigation never completes, and the button waits
for ever. Return the address and let the client start the download
(`ExportDataButton`).

## Feedback: toasts

The result of an action is a toast (sonner): what happened, in the user's
words. That covers "Approved", "Answer saved", and "That did not go through:
nothing was sent to the guest". The toaster is mounted once per app; see
*Provider placement*.

- **From a server action, flash it.** Almost every mutation here ends in
  `redirect()` or `revalidatePath()`, so no client code is left to call
  `toast()`. Call `flash.success(title, description?)` (or `error`, `info`,
  `warning`) from `@bookone/ui/lib/flash-server` *before* `redirect()`. It sets a
  short-lived cookie, and `FlashToaster` shows it on the next render and deletes
  it. Forms stay plain `<form action>` and keep working without script.
- **From a client component, call `toast()`** from `sonner` directly.
- **Translate on the server.** Use `getTranslations({ locale, namespace })` in
  the action. Strings live under a `toast` key beside the page's own. A test
  checks every `…toast` namespace has the same keys in all four locales.
- **No personal data in a toast.** Say what happened, not who it happened to:
  the flash travels in a cookie.
- **Errors say what to do next**, and stay longer (10s, against 4s for a
  success). A warning that the owner must act on, such as "erasure recorded,
  not yet applied", is a `warning`, which stays 8s. The state it describes must
  also be visible on the page; a toast is never the only record.
- **Inline beats toast for a field.** A validation message about one input
  belongs beside that input (`role="alert"`). The toast is for the outcome of
  the whole action.
- The type shows in the icon's colour on a neutral surface, never as a coloured
  background (globals.css, "Toasts"). Do not pass `richColors`.

## Loading: skeletons

A console route shows `PageSkeleton` (`@bookone/ui/components/page-skeleton`)
from its `loading.tsx` while it renders. The variant is shaped like the page:

- `list`: the default for `console/loading.tsx`;
- `cards`: Today, the report, the agents page;
- `detail`: one arrival, one conversation, one property.

Nothing should jump when the page lands. Use `Skeleton` directly for a region
that loads on its own. It shimmers from the `--skeleton` token and holds still
under reduced motion. The region carries `aria-busy`; the bars are decorative.

Password fields use a reveal toggle that is `type="button"` (or it submits the
form), `tabIndex={-1}` (so tab order runs email → password → submit), and
carries a label that changes with state — an icon alone tells a screen reader
nothing.

## Theme and design tokens

Two files, deliberately separated:

| File | Role |
|---|---|
| `packages/ui/src/styles/tokens.css` | Base design tokens — the raw palette and scale |
| `packages/ui/src/styles/globals.css` | Maps those tokens onto shadcn's semantic variables |

Each app's `src/app/globals.css` only imports the shared one, by relative path.
Tailwind's resolver does not follow pnpm's workspace links on Windows. Anything
truly app-specific goes below that import.

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

`TooltipProvider`, the toaster and `FlashToaster` (inside a `Suspense`) are
mounted once in `app/[locale]/layout.tsx`, and in `apps/admin/src/app/layout.tsx`.
Several registry components — the sidebar among them — assume a tooltip provider
exists above them. Mounting per page means discovering the omission one page at
a time.

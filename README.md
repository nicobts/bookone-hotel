# BookOne Platform — Development Handoff

Guest-journey-first hospitality platform for small independent hotels (IT/AT/SI).
This package contains the complete, internally consistent documentation set to initiate development. **Docs are canonical; code follows docs.**

## Quick start (5 minutes)

```bash
# 1. Extract this zip into an empty folder, then make it a git repo
unzip bookone-handoff.zip -d bookone-platform
cd bookone-platform
git init && git add -A && git commit -m "docs: development handoff v1"

# 2. (Recommended) push to GitHub — enables Claude Code on the web at claude.ai/code
gh repo create bookone-platform --private --source=. --push

# 3. Start Claude Code in this folder (terminal or desktop app)
claude
```

First prompt to paste into Claude Code:

> Read CLAUDE.md fully, then docs/00-PROJECT-OVERVIEW.md and docs/04-IMPLEMENTATION-PLAN.md §6.
> Confirm your understanding of the 10 binding rules and the Sprint 1 day-1 task list, then execute day-1 task 1 only (monorepo scaffold per docs/03-ARCHITECTURE.md §10). Stop for review before task 2.

Work **one task at a time** and review each result. The sprint plan (docs/04) is the backlog; don't ask for "build Sprint 1" in one shot.

## What's in the box

```
CLAUDE.md                  ← Claude Code's entry point: rules, stack, precedence, current phase
README.md                  ← this file
docs/
  00-PROJECT-OVERVIEW.md   ← scope, decision register D1–D21, non-goals
  01-PRD.md                ← product requirements + acceptance criteria (V1 = Rungs 1–3)
  02-USER-STORIES.md       ← 8 epics, 34 stories with AC
  03-ARCHITECTURE.md       ← topology, schema, conventions, repo layout (§10)
  04-IMPLEMENTATION-PLAN.md← 10 sprints, DoD, CI gates, day-1 tasks (§6)
  adr/                     ← 16 decision records, one file each — OVERRIDE anything conflicting
  05-ADRS.md               ← pointer to adr/ (was the single file at handoff)
  06-AI-AGENT-LAYER.md     ← agent roster AG-01…07, agent_runs, autonomy tiers, evals
  07-COMPETITIVE-ANALYSIS.md
  08-STRATEGY-REFERENCE-PLAYBOOK.md
  annexes/                 ← technical context (dual-source annex, voice workstream docs)
  business/                ← proposals & cost references (context only, partly Italian)
```

## The 5 rules a human should remember (full 10 in CLAUDE.md)

1. Platform UUIDs everywhere — external system IDs are references, never keys
2. Every mutation emits a `domain_events` row; RLS on every client-reachable table
3. Agents act only through typed tools, logged in `agent_runs` — never direct DB access
4. **No fiscal-core code** (SDI, corrispettivi, night audit) — gated by decision D11
5. EU residency everywhere; no new service without updating the sub-processor register

## Before shipping (not before coding) — external calendar items

Run these in parallel from week 1 (details: docs/04 §0):
Ericsoft API request · ElevenLabs Enterprise quote (EU residency) · Dograh multi-tenancy check · WhatsApp BSP application · Alloggiati channel decision (blocks Sprint 6) · Stripe + commercialista session · IP counsel pass on ADR-014.

## Environments

`local` (Supabase CLI + MockEricsoftAdapter + Stripe test) → `staging` (Supabase EU, seeded demo property) → `prod` (EU, migrations via CI only).

---
RT Holding Group GmbH · July 2026 · Documentation v1 (frozen at handoff — changes go through docs/adr/)

## Running it locally

```bash
pnpm install
cp .env.example .env          # local Supabase keys are already in the template
pnpm db:start                 # Supabase on 544xx (Docker); realtime excluded
pnpm db:reset                 # replay every migration from zero
pnpm db:seed                  # two properties, two accounts
pnpm dev                      # web on :3000, worker on :8787
```

Seeded accounts, password `devpassword123!` — the seed refuses to run against
anything but a loopback address, because that password is published here.

| Account | Properties | Why it exists |
|---|---|---|
| `owner@bookone.test` | owner of Hotel Sonja, staff at Garni Alpin | Two properties, so the switcher has something to do |
| `staff@bookone.test` | staff at Hotel Sonja only | One property, so the switcher hides itself — and reaching `/de/garni-alpin/…` must 404 |

The asymmetry is the point: a single-property seed cannot show a switcher
working, and cannot show isolation failing when it breaks.

## Gates

```bash
pnpm typecheck && pnpm lint && pnpm test    # static + unit
pnpm test:rls                               # cross-tenant isolation, both access paths
pnpm build
```

# Runbook — backup and restore

**A backup nobody has restored is a hope.** This file records the procedure and
the date it was last actually executed, with what went wrong when it was.

| Drill | Date | Scope | Result |
|---|---|---|---|
| Logical dump → restore, local stack | 2026-08-29 | Domain data, two properties, three stays | **Passed on the third attempt.** Three findings, all below |
| Supabase PITR restore, staging | — | — | **Not yet run.** See "what this drill does not cover" |
| Phase 0 host rebuilt from `infra/vm` | — | Compose host only; no guest data on it | **Not yet run.** Required before any pilot guest data (ADR-033). See "the Phase 0 host" |

---

## What we rely on

**Supabase PITR is the recovery mechanism** (ADR-006 lists it among the things
the managed service buys us). Point-in-time recovery through the provider is
what a real incident uses: it restores the cluster, the extension schemas, the
roles and the auth internals together, which is the part a logical dump does not.

**The logical dump is a second artefact with a different job.** It is the exit
path — ADR-006 says the way out of Supabase is plain Postgres — and it is what
proves, periodically, that the data can leave. It is not the primary restore.

Confusing the two is the mistake this drill exists to prevent, and it is the
mistake the drill itself started by making.

## Taking a logical backup

```bash
supabase db dump --local --role-only -f roles.sql
supabase db dump --local            -f schema.sql
supabase db dump --local --data-only -x 'pgboss.*' -x 'storage.*' -f data.sql
```

Against a real project, swap `--local` for `--linked`.

**Exclude `pgboss.*` and `storage.*`, and neither exclusion is cosmetic** — see
the findings below.

## Restoring domain data into a rebuilt database

This is the exercise the drill runs and the one to use when the *data* is the
problem and the cluster is fine — a bad migration, a bulk delete, a botched
import.

```bash
supabase db reset --local                       # schema from migrations, empty
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f data.sql
```

`--single-transaction` so a partial restore is not a possible outcome.
`ON_ERROR_STOP=1` because psql's default is to keep going after an error, which
turns "the restore failed" into "the restore looked fine and is missing four
tables".

Then check:

```bash
pnpm tsx scripts/retention.mts        # dry run: does the restored data still obey the map?
pnpm test:rls                         # both access paths — and it truncates, so not on live data
```

## What the drill found — 2026-08-29

Three failures, in the order they happened. All three are now in the procedure
above, which is the only reason the procedure is worth anything.

### 1. The dump contains the job queue, and the restore cannot apply it

```
ERROR:  relation "pgboss.queue" does not exist
```

pg-boss creates its own schema at worker boot, not through a migration. So a
dump taken from a running system carries `pgboss.*`, and a restore into a
freshly-migrated database has nowhere to put it.

**The fix is not to create the schema first.** It is to never back the queue up.
The dump held 65 rows of completed job history including live cron schedules;
restoring it would replay work that already ran. Duplicate availability
refreshes are harmless, and duplicate notifications and duplicate Alloggiati
filings are not.

**A restored system starts with an empty queue and the worker rebuilds its
schedules at boot.** That is correct behaviour, not a gap.

### 2. The dump contains `storage.buckets`, which a migration also creates

```
ERROR:  duplicate key value violates unique constraint "buckets_pkey"
DETAIL:  Key (id)=(identity-documents) already exists.
```

The journey migration creates the private `identity-documents` bucket. Replaying
migrations therefore creates the row, and the data-only restore then collides
with it.

The general lesson is larger than one bucket: **a data-only dump restored over a
migrated schema collides with every row the migrations themselves insert.**
Excluding `storage.*` is right here because the bucket is configuration rather
than data, and because the objects inside it are not in a logical dump anyway —
storage is its own backup problem, noted below.

### 3. `supabase db dump` does not produce a standalone restorable schema

Restoring `schema.sql` into a genuinely empty database fails immediately:

```
ERROR:  schema "extensions" does not exist
```

The dump excludes the Supabase-managed schemas it assumes are present. This is
the finding that matters most, because it is the one that would have been
discovered during an incident: **you cannot rebuild a Supabase project from
`supabase db dump` alone.** The recovery path is PITR through the provider; the
logical dump restores *into* a working project.

## What this drill does not cover, and must

Named rather than left implied:

- **PITR itself has never been exercised.** It is the actual recovery mechanism
  and it is the one thing here that has not been tested. It needs a staging
  project, a deliberate destructive change, and a restore to a timestamp before
  it. That is the next drill and it is a GA blocker.
- **Storage objects are not in any of this.** Identity documents live in a
  Supabase Storage bucket with its own backup story, which we have not
  established. The mitigating fact — and it is a real one — is that the
  documents are the shortest-lived data in the system: destroyed on
  acknowledgement of the filing (E2.4). A restore that loses them loses data we
  were required to have already deleted.
- **The auth schema.** The drill restored four users because they were in the
  dump. Whether a real PITR restore rejoins `auth.users` to `property_members`
  cleanly is a thing to verify with the provider's restore, not with pg_dump.
- **Recovery time.** The local restore is instant against three stays and says
  nothing about a real database. RTO and RPO have not been measured and should
  not be quoted until they are.

## The Phase 0 host and the operator trail (WP0.8)

ADR-033 puts `api`, `worker` and `admin` on one EU VM for Phase 0, and adds a
rule: **no pilot guest data on it without working backups and a completed
restore drill.** What that drill has to show, written before it is run:

- **The host holds no state worth restoring.** Guest data is in Supabase; the
  host runs containers from images and reads secrets from Infisical. The drill
  therefore *rebuilds*, it does not restore: `tofu apply` in `infra/vm/tofu`
  (from WSL), then `infisical run -- docker compose -f infra/vm/compose.yaml up -d`
  over the tailnet. Pass criterion: webhooks answer on the public host,
  `admin` answers on the tailnet only, the worker drains its queues, and the
  time from `apply` to healthy is written down — that number is the host's RTO.
- **Nightly snapshots are the fallback, not the plan.** `backups = true` on the
  server gives provider snapshots; restoring one is the second half of the
  drill, to prove it works, not the procedure to use.
- **Two state files live off the host**: Caddy's certificates (re-issued
  automatically, so losing them costs minutes) and Tailscale's node state
  (losing it means re-joining with a new key). Neither is guest data.

**`admin_audit` is append-only, and a restore has to respect that.** The
trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` (migration
`20260927041310_admin_audit_rls.sql`). A logical restore into a fresh database
inserts, which is allowed. A restore procedure that *truncates tables before
loading* — the obvious way to re-run one — fails on this table, deliberately.
Restore into a fresh database; never disable the trigger to make a script pass.
PITR brings the table back with everything else.

**Not built yet** (ADR-031): the daily export of `admin_audit` to immutable
storage. Until it exists, the trail's only copies are the live table and the
provider's backups — which is why the table refuses edits at the database, not
in the application.

## The retention question

This runbook is referenced from `privacy.md` because backups are a retention
problem as much as a resilience one: **a backup older than a retention period
contains data we have declared we no longer hold.**

Supabase PITR has a retention window of its own. Where that window is longer
than our shortest declared period, the honest position — the one to put in the
DPA — is that erasure applies to the live system immediately and to backups as
they age out, which is the standard and defensible reading. It has to be
*written down* rather than assumed, and it is not written down yet: that
sentence belongs in the DPA draft with counsel.

## When you run a drill

Add a row to the table at the top. Date, scope, result, and what went wrong —
especially what went wrong. A drill log with only successes in it is a log
somebody has been editing.

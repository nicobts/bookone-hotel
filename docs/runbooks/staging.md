# Staging

**Project:** `bookone-hotel-staging`, reference `ohjpphsdmtcgdboreofq`. It sits in its own BookOne
Supabase organization, apart from any other client's projects.
**Region:** `eu-west-1` (Ireland), per ADR-040. The web app and the API run beside it: Vercel `dub1`.
**Created:** 2026-09-28. Automatic RLS is on in the project settings, as a second net under our own
migrations.

## The three environments

| | Where | Migrations | Data |
|---|---|---|---|
| **local** | Supabase CLI in Docker | By hand: `supabase migration up`, or `pnpm db:reset` to replay from zero | Dev seed and demo seed. The RLS suite wipes it on every run |
| **staging** | This project | CI, after the CI workflow passes on `main` (`.github/workflows/staging-db.yml`). Or by hand, below | The demo hotel only: `pnpm demo:seed -- --staging` |
| **prod** | Not created yet | Its own workflow with a required reviewer, when the first pilot signs | Real properties |

There is no cloud dev project. Local covers development, and staging is where anything that needs
a public address points: Twilio webhooks and Vercel previews. A cloud dev project, or Supabase
branching per pull request, comes when a second developer or per-branch previews need it.

## Access

- **Credentials** are in `.env.staging` at the repo root, git-ignored and generated on 2026-09-28:
  - the database URLs, through the Supavisor pooler: transaction mode on `6543` for the apps,
    session mode on `5432` for migrations and `psql`;
  - the anon and service-role keys;
  - the staging-only secrets;
  - `DEMO_PASSWORD`.

  None of these is shared with local or production.
- **The CLI** reaches the BookOne organization with `SUPABASE_ACCESS_TOKEN` from `.env`. That is a
  token of the BookOne Supabase account, which keeps the machine's global CLI login for other work
  untouched. Export it for the command:

  ```bash
  export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2-)
  export SUPABASE_DB_PASSWORD=$(grep '^SUPABASE_STAGING_DB_PASSWORD=' .env | cut -d= -f2-)
  npx supabase link --project-ref ohjpphsdmtcgdboreofq
  npx supabase migration list --linked
  ```

- **psql** goes through the session pooler, host `aws-1-eu-west-1.pooler.supabase.com`, port
  `5432`, user `postgres.ohjpphsdmtcgdboreofq`, `sslmode=require`. The direct host is IPv6-only.

## Applying migrations by hand

Normally CI does this. By hand, for example before CI is configured:

```bash
npx supabase db push --linked      # lists what is pending, asks, applies
```

It is forward-only and never resets. Do not run `supabase db reset --linked` against staging. It
drops the demo, the auth users and the evidence, and a reset is never how a migration problem is
fixed (binding rule 9: fix forward).

**Verified on 2026-09-28** after pushing all 29 migrations. Staging matched local on:
- 34 public tables, every one with RLS;
- 59 policies;
- the append-only triggers on `admin_audit` and `compliance_evidence`;
- identical client grants on those two tables.

The query is in the commit that set this up, and it is worth rerunning after any RLS migration.

## Seeding the demo

```bash
pnpm demo:seed -- --staging
```

It loads `.env.staging`, and it refuses unless all of these hold:
- the file says `BOOKONE_ENVIRONMENT=staging`;
- the API URL and the database user both name the staging project;
- `DEMO_PASSWORD` is at least 16 characters.

There is no flag for production. It is re-runnable, and it touches only `demo-trieste`. The demo
accounts are `owner@demo.bookone.test` and `staff@demo.bookone.test`, with the password
`DEMO_PASSWORD` from `.env.staging`. The dev login helper's published password does not work
there. **The RLS suite and `db:seed` (dev) never run against staging.** Both refuse any host that is
not loopback.

## CI setup (once)

In GitHub, create an environment named `staging` holding:

| Kind | Name | Value |
|---|---|---|
| secret | `SUPABASE_ACCESS_TOKEN` | the BookOne account token |
| secret | `SUPABASE_STAGING_DB_PASSWORD` | the database password |
| variable | `SUPABASE_STAGING_PROJECT_REF` | `ohjpphsdmtcgdboreofq` |

Until they exist, the staging workflow fails on its "Configured?" step with a message naming what
is missing. It does not skip silently.

## Not set up yet

- **Auth URLs.** The site URL and redirect URLs are set once the web app has a staging address.
  Until then, sign-in emails would link to the default.
- **SMTP.** Supabase's built-in email is rate-limited, which is fine for a demo. A real sender comes
  with the ESP decision (04 §0).
- **Deploys.** `apps/web` on Vercel `dub1`; `apps/api`, `apps/worker` and `apps/admin` on an
  EU-west host (ADR-033). The worker uses the mock Alloggiati channel there, like everywhere outside
  production.
- **The staff identity project** (SP-009) for `apps/admin`. Staging admin waits for it: production
  refuses the tenant project, and so should staging.

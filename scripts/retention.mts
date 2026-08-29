/**
 * Run the retention sweep by hand (E8.2).
 *
 *   pnpm tsx scripts/retention.mts            # dry run, every property
 *   pnpm tsx scripts/retention.mts --apply    # actually delete
 *   pnpm tsx scripts/retention.mts --apply <propertyId>
 *
 * The dry run is the useful half. It reports what each rule *would* touch
 * without touching it, which is what the backup-restore drill uses to check
 * that a recovered database still enforces its declared periods — and what to
 * run after changing the data map, before finding out at 02:15.
 *
 * Deliberately not the production path. The schedule is. This exists so "run it
 * and see" does not mean waiting until tomorrow morning.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = join(root, '.env')

// The repo-root `.env`, the same way every other script here loads it.
if (existsSync(env)) process.loadEnvFile(env)

const { runRetention } = await import('../packages/core/src/privacy/retention.ts')
const { asService, closeConnection } = await import('../packages/core/src/db/index.ts')
const { properties } = await import('../packages/core/src/db/schema.ts')

const apply = process.argv.includes('--apply')
const only = process.argv.find((argument) => /^[0-9a-f-]{36}$/i.test(argument))

const rows = await asService((db) =>
  db.select({ id: properties.id, slug: properties.slug }).from(properties),
)

const targets = only ? rows.filter((property) => property.id === only) : rows

if (targets.length === 0) {
  console.error(only ? `No property ${only}` : 'No properties')
  process.exit(1)
}

console.log(apply ? 'APPLYING — rows will be deleted\n' : 'Dry run — nothing will change\n')

for (const property of targets) {
  const outcome = await runRetention({ propertyId: property.id, dryRun: !apply })

  console.log(`${property.slug}  (${outcome.total} rows)`)

  for (const result of outcome.results) {
    if (result.error) {
      console.log(`  ✗ ${result.table.padEnd(24)} ${result.error}`)
    } else if (result.affected > 0) {
      console.log(`  · ${result.table.padEnd(24)} ${result.affected} ${result.rule}`)
    }
  }

  console.log()
}

await closeConnection()

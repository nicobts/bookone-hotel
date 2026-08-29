/**
 * Renders the sub-processor register (E8.3).
 *
 *   pnpm register:render   # write docs/legal/sub-processor-register.md
 *   pnpm register:check    # fail if the committed file is stale
 *
 * The document is a build output, not a promise. `register:check` runs in CI
 * beside the schema-drift check and for the same reason: a generated artefact
 * that is only regenerated when somebody remembers is a generated artefact that
 * is wrong, and this one is a disclosure with legal weight.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderRegister } from '../packages/core/src/privacy/subprocessors.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'docs', 'legal', 'sub-processor-register.md')

const rendered = `${renderRegister().trimEnd()}\n`

if (process.argv.includes('--check')) {
  let committed: string

  try {
    committed = readFileSync(target, 'utf8')
  } catch {
    console.error(`Missing ${target}. Run \`pnpm register:render\` and commit the result.`)
    process.exit(1)
  }

  if (committed !== rendered) {
    console.error(
      'docs/legal/sub-processor-register.md is out of date with subprocessors.ts.\n' +
        'Run `pnpm register:render` and commit the result. The register is a disclosure;\n' +
        'a stale one says we send personal data somewhere we do not, or — worse — omits\n' +
        'somewhere we do.',
    )
    process.exit(1)
  }

  console.log('sub-processor register is current')
  process.exit(0)
}

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, rendered, 'utf8')
console.log(`wrote ${target}`)

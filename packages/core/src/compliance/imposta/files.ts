import { readdirSync, readFileSync } from 'node:fs'
import { parseRules, type ComuneRules } from './rules'

const RULES_DIR = new URL('./rules/', import.meta.url)

/**
 * Every comune's rules, from `rules/<ISTAT code>.json`, validated. A file that
 * does not validate stops the process at the first read, not a declaration
 * months later.
 */
export function loadAllRules(): ComuneRules[] {
  return readdirSync(RULES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const rules = parseRules(JSON.parse(readFileSync(new URL(file, RULES_DIR), 'utf8')))
      if (`${rules.comune}.json` !== file) {
        throw new Error(`rules/${file} declares comune ${rules.comune}`)
      }
      return rules
    })
}

/** One comune's rules, or null when it has none: then there is nothing to compute. */
export function rulesFor(comune: string): ComuneRules | null {
  return loadAllRules().find((rules) => rules.comune === comune) ?? null
}

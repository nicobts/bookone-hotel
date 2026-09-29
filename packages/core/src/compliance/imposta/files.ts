import { parseRules, type ComuneRules } from './rules'
import comune999001 from './rules/999001.json'
import comune999002 from './rules/999002.json'

/**
 * Every comune's rules file, imported rather than read from disk: the consoles
 * are bundled, and a bundle has no rules directory to read. Adding a comune is
 * adding its file and its line here; a test fails when a file in `rules/` is
 * not listed, so neither can be forgotten.
 */
export const RULE_FILES: Readonly<Record<string, unknown>> = {
  '999001.json': comune999001,
  '999002.json': comune999002,
}

/**
 * Every comune's rules, validated. A file that does not validate fails the
 * first read, and its test, not a declaration months later.
 */
export function loadAllRules(): ComuneRules[] {
  return Object.entries(RULE_FILES)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, json]) => {
      const rules = parseRules(json)
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

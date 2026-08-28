import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { locales, type Locale } from './index'

/**
 * Catalogue parity.
 *
 * A missing translation key does not fail a build and does not throw at
 * runtime — next-intl renders the key's own path, so `auth.login.submit`
 * appears on the button. In four locales across three surfaces that is found by
 * a guest, in production, in a language nobody on the team reads.
 *
 * This test is the thing that catches it.
 */
function load(locale: Locale): Record<string, unknown> {
  const url = new URL(`../messages/${locale}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

const reference: Locale = 'en'
const referenceKeys = flatten(load(reference)).sort()

describe('message catalogues', () => {
  it('has a catalogue for every supported locale', () => {
    expect(() => locales.map(load)).not.toThrow()
  })

  it.each(locales.filter((locale) => locale !== reference))(
    '%s has exactly the same keys as en',
    (locale) => {
      const keys = flatten(load(locale)).sort()

      expect(keys.filter((key) => !referenceKeys.includes(key))).toEqual([])
      expect(referenceKeys.filter((key) => !keys.includes(key))).toEqual([])
    },
  )

  it.each(locales)('%s has no empty strings', (locale) => {
    const empties: string[] = []

    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        if (value.trim() === '') empties.push(path)
        return
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, path ? `${path}.${key}` : key)
        }
      }
    }

    walk(load(locale), '')
    expect(empties).toEqual([])
  })
})

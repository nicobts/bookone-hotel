import { describe, expect, it } from 'vitest'
import { fallbackLocale, isLocale, locales, resolveLocale } from './index'

describe('locales', () => {
  it('supports exactly the four V1 locales', () => {
    expect(locales).toEqual(['it', 'de', 'en', 'sl'])
  })

  it('recognises supported locales and rejects everything else', () => {
    expect(isLocale('sl')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})

describe('resolveLocale', () => {
  it('prefers the guest locale', () => {
    expect(resolveLocale('de', 'it')).toBe('de')
  })

  it('falls back to the property default when the guest locale is unusable', () => {
    expect(resolveLocale('fr', 'it')).toBe('it')
    expect(resolveLocale(undefined, 'sl')).toBe('sl')
  })

  it('falls back to en when neither input is a supported locale', () => {
    expect(resolveLocale('fr', 'pt')).toBe(fallbackLocale)
    expect(resolveLocale()).toBe('en')
  })
})

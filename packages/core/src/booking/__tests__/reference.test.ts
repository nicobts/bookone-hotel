import { describe, expect, it } from 'vitest'
import { generateReference, isReference, normaliseReference } from '../reference'

describe('generateReference', () => {
  it('produces a reference of the documented shape', () => {
    expect(generateReference()).toMatch(/^BO-[0-9A-Z]{6}$/)
  })

  it('never uses a character that gets misheard on the phone', () => {
    // 0/O, 1/I/L and U are all absent from the generated part. This is the
    // whole reason the alphabet is hand-picked: the string exists to be read
    // aloud to a receptionist.
    //
    // The prefix is stripped first — `BO-` contains an O by design, and it is
    // the one part of the string nobody has to spell out.
    const bodies = Array.from({ length: 500 }, () => generateReference().slice(3)).join('')

    expect(bodies).not.toMatch(/[01ILOU]/)
  })

  it('does not repeat within a realistic property volume', () => {
    // 30^6 is ~729 million, so a collision here would mean the generator is not
    // actually random — which is the failure worth catching. Real collisions are
    // handled by the unique constraint, per property.
    const references = new Set(Array.from({ length: 5000 }, generateReference))

    expect(references.size).toBe(5000)
  })
})

describe('normaliseReference', () => {
  it('accepts what a guest actually types', () => {
    expect(normaliseReference('bo-7qk2m9')).toBe('BO-7QK2M9')
    expect(normaliseReference('7QK2M9')).toBe('BO-7QK2M9')
    expect(normaliseReference('  BO 7QK2 M9 ')).toBe('BO-7QK2M9')
  })

  it('does not repair confusable characters into someone else’s booking', () => {
    // `O` could have been meant as `Q`, `D` or `0`. Guessing would look up a
    // different reservation and report it as theirs; failing to match sends them
    // to a person, which is the correct outcome for an ambiguous input.
    expect(isReference(normaliseReference('BO-7QK2M0'))).toBe(false)
  })
})

describe('isReference', () => {
  it.each([
    ['BO-7QK2M9', true],
    ['BO-7QK2M', false],
    ['BO-7QK2M99', false],
    ['XX-7QK2M9', false],
    ['BO-7QK2MO', false],
    ['', false],
  ])('%s -> %s', (value, expected) => {
    expect(isReference(value)).toBe(expected)
  })
})

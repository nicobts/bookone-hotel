import { randomInt } from 'node:crypto'

/**
 * The booking reference (E1.2).
 *
 * Never a key — the UUID is the key (binding rule 1). This exists because
 * "my booking is 3f2a8c14-…" is not a sentence a human says, and the guest, the
 * confirmation email and whoever answers the phone all need one short string
 * they can agree on.
 *
 * Everything about the shape below is about that phone call.
 */

/**
 * Crockford's base32, minus the letter U.
 *
 * The excluded characters are the ones that get misheard or mistyped:
 * `0`/`O`, `1`/`I`/`L`, and `U` (which Crockford drops to avoid accidental
 * obscenities — a real consideration for a string a hotel prints and reads
 * aloud). What remains is unambiguous in every one of our four languages when
 * spelled out over a bad line.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

const LENGTH = 6

export const REFERENCE_PREFIX = 'BO-'

/** `BO-7QK2M9`. Grouped by the hyphen so it survives being read aloud. */
export function generateReference(): string {
  let body = ''

  for (let i = 0; i < LENGTH; i += 1) {
    // `randomInt`, not `Math.random`: this string identifies a booking, and a
    // predictable one lets a stranger guess at other people's references. It is
    // not a secret — but it should not be a sequence either.
    body += ALPHABET[randomInt(ALPHABET.length)]
  }

  return `${REFERENCE_PREFIX}${body}`
}

/**
 * Normalises what a guest typed or read out: case, spacing, and the prefix they
 * may or may not have included.
 *
 * Deliberately does **not** repair confusable characters. `0`, `1`, `I`, `L`,
 * `O` and `U` are all absent from the alphabet, so a typed `O` could have been
 * meant as `Q`, `D` or `0` — and silently choosing one would look up somebody
 * else's booking. The ambiguity is already prevented at generation; repairing
 * it here would only reintroduce it as a wrong answer instead of no answer.
 */
export function normaliseReference(input: string): string {
  const body = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^BO/, '')

  return `${REFERENCE_PREFIX}${body}`
}

const PATTERN = new RegExp(`^${REFERENCE_PREFIX}[${ALPHABET}]{${LENGTH}}$`)

export function isReference(value: string): boolean {
  return PATTERN.test(value)
}

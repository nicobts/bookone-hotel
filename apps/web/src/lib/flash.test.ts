import { describe, expect, it } from 'vitest'
import { decodeFlashes, encodeFlashes, type Flash } from '@bookone/ui/lib/flash'
import it_ from '@bookone/i18n/messages/it.json'
import en from '@bookone/i18n/messages/en.json'
import de from '@bookone/i18n/messages/de.json'
import sl from '@bookone/i18n/messages/sl.json'

const flash = (over: Partial<Flash> = {}): Flash => ({
  id: 'a',
  kind: 'success',
  title: 'Approvato',
  ...over,
})

describe('flash codec', () => {
  it('round-trips a queue', () => {
    const queue = [flash(), flash({ id: 'b', kind: 'error', title: 'No', description: 'Why' })]
    expect(decodeFlashes(encodeFlashes(queue))).toEqual(queue)
  })

  it('keeps the last three, so the cookie stays small', () => {
    const queue = ['1', '2', '3', '4'].map((id) => flash({ id }))
    expect(decodeFlashes(encodeFlashes(queue)).map((f) => f.id)).toEqual(['2', '3', '4'])
  })

  it('caps long text', () => {
    const [decoded] = decodeFlashes(
      encodeFlashes([flash({ title: 'x'.repeat(500), description: 'y'.repeat(900) })]),
    )
    expect(decoded?.title.length).toBe(160)
    expect(decoded?.description?.length).toBe(320)
  })

  it('decodes anything malformed to nothing rather than breaking the page', () => {
    expect(decodeFlashes(undefined)).toEqual([])
    expect(decodeFlashes('not json')).toEqual([])
    expect(decodeFlashes('{"id":"a"}')).toEqual([])
    expect(
      decodeFlashes(
        JSON.stringify([
          { id: 'a', kind: 'shout', title: 'x' },
          { id: 'b', kind: 'info', title: '' },
          { id: 1, kind: 'info', title: 'x' },
          { id: 'ok', kind: 'info', title: 'kept' },
        ]),
      ),
    ).toEqual([{ id: 'ok', kind: 'info', title: 'kept' }])
  })
})

/** Every toast the actions flash is translated in all four languages. */
describe('toast strings', () => {
  const locales = { it: it_, en, de, sl } as Record<string, Record<string, unknown>>
  const paths = [
    'console.approvals.toast',
    'console.arrival.toast',
    'console.conversations.toast',
    'console.exceptions.toast',
    'console.knowledge.toast',
    'console.privacy.toast',
    'console.report.toast',
    'stay.toast',
  ]

  const keys = (node: unknown, prefix = ''): string[] =>
    node && typeof node === 'object'
      ? Object.entries(node).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)]

  const at = (root: unknown, path: string) =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], root)

  it.each(paths)('%s has the same keys in it, en, de and sl', (path) => {
    const reference = keys(at(locales.it, path)).sort()
    expect(reference.length).toBeGreaterThan(0)
    for (const locale of ['en', 'de', 'sl']) {
      expect(keys(at(locales[locale], path)).sort(), locale).toEqual(reference)
    }
  })

  it('has the toaster labels in every language', () => {
    for (const messages of Object.values(locales)) {
      const common = messages.common as Record<string, string>
      expect(common.notifications && common.close && common.thinking).toBeTruthy()
    }
  })
})

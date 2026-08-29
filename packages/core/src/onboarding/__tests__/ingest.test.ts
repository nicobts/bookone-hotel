import { describe, expect, it } from 'vitest'
import { extractDrafts, textify, topicFor } from '../ingest'

/**
 * Turning a property's website into drafts (AG-03).
 *
 * Every one of these produces something a person reviews before a guest can
 * see it, so the bar is not accuracy — it is **not wasting the reviewer's
 * attention**. A draft whose answer is "Read more" costs more to reject than
 * the article would have cost to write, and enough of those and the owner stops
 * opening the editor.
 *
 * So the tests come in pairs: something worth drafting, and the adjacent thing
 * that must not become one.
 */

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`

describe('textify', () => {
  it('drops scripts and styles rather than reading them as prose', () => {
    const text = textify('<style>.a{color:red}</style><p>Breakfast is served daily.</p>')

    expect(text).not.toContain('color')
    expect(text).toContain('Breakfast is served daily.')
  })

  it('keeps block boundaries so paragraphs do not run together', () => {
    expect(textify('<p>One</p><p>Two</p>')).toBe('One\nTwo')
  })

  it('decodes the entities a marketing page actually contains', () => {
    expect(textify('<p>Bed&nbsp;&amp; breakfast &quot;Sonja&quot;</p>')).toBe(
      'Bed & breakfast "Sonja"',
    )
  })
})

describe('topicFor', () => {
  it('recognises a subject in any of the four languages', () => {
    expect(topicFor('Breakfast')).toBe('breakfast')
    expect(topicFor('La colazione')).toBe('breakfast')
    expect(topicFor('Frühstück im Hotel')).toBe('breakfast')
    expect(topicFor('Zajtrk')).toBe('breakfast')
  })

  it('returns null for a heading about nothing we can answer', () => {
    // The pair. A site's "Our story" and "Gallery" must not become knowledge
    // articles — the concierge would then answer a factual question with
    // marketing prose.
    expect(topicFor('Our story')).toBeNull()
    expect(topicFor('Gallery')).toBeNull()
    expect(topicFor('Contact')).toBeNull()
  })
})

describe('extractDrafts', () => {
  const html = page(`
    <h1>Hotel Sonja</h1>
    <p>Welcome to our family-run hotel in the mountains, open since 1962.</p>
    <h2>Breakfast</h2>
    <p>Breakfast is served from 07:30 to 10:00 in the dining room on the ground floor.</p>
    <h2>Parking</h2>
    <p>There are four free parking spaces behind the building, available to all guests.</p>
    <h2>Gallery</h2>
    <p>Photographs of our rooms and of the valley in every season are shown below.</p>
  `)

  const drafts = () => extractDrafts({ html, url: 'https://example.test/', locale: 'en' })

  it('drafts the subjects a guest asks about', () => {
    expect(drafts().map((draft) => draft.topic)).toEqual(['breakfast', 'parking'])
  })

  it('does not draft a heading it cannot classify', () => {
    // "Gallery" has a long enough paragraph under it and is still skipped. The
    // filter is the topic, not the prose.
    expect(drafts().map((draft) => draft.topic)).not.toContain('gallery')
  })

  it('files the answer under the language it was told, never a guessed one', () => {
    const italian = extractDrafts({ html, url: 'https://example.test/', locale: 'it' })

    /*
     * The locale comes from the caller. Sniffing it would eventually file an
     * Italian answer under `de`, and the concierge would then read it to a
     * German guest as the property's own words — a generated guest-facing fact
     * arriving through the back door (binding rule 7).
     */
    expect(Object.keys(italian[0]!.answers)).toEqual(['it'])
  })

  it('keeps the heading as a phrasing, because it is how the property words it', () => {
    expect(drafts()[0]!.questionVariants).toEqual(['breakfast'])
  })

  it('records where it came from, so a reviewer can check it', () => {
    expect(drafts()[0]!.source).toEqual({ heading: 'Breakfast', url: 'https://example.test/' })
  })

  it('skips a section whose body is too short to be an answer', () => {
    // Navigation, buttons and captions all survive `textify` as three-word
    // fragments. A draft answering "Read more" is worse than no draft.
    const thin = extractDrafts({
      html: page('<h2>Parking</h2><p>Read more</p>'),
      url: 'https://example.test/',
      locale: 'en',
    })

    expect(thin).toEqual([])
  })

  it('drafts one article per topic however often the site mentions it', () => {
    const repeated = extractDrafts({
      html: page(`
        <h2>Breakfast</h2>
        <p>Breakfast is served from 07:30 to 10:00 in the dining room every morning.</p>
        <h2>Breakfast times</h2>
        <p>Our breakfast buffet runs from half past seven until ten o'clock daily.</p>
      `),
      url: 'https://example.test/',
      locale: 'en',
    })

    // Four near-identical drafts to review is how an owner learns to close this
    // page without reading it.
    expect(repeated).toHaveLength(1)
  })

  it('stops at the cap rather than drafting a whole site', () => {
    const many = extractDrafts({
      html: page(
        ['Breakfast', 'Parking', 'Wifi', 'Check-in', 'Check-out']
          .map(
            (h) =>
              `<h2>${h}</h2><p>${'A sentence long enough to survive the filter. '.repeat(2)}</p>`,
          )
          .join(''),
      ),
      url: 'https://example.test/',
      locale: 'en',
      maxDrafts: 2,
    })

    expect(many).toHaveLength(2)
  })

  it('returns nothing for a page with no headings at all', () => {
    expect(
      extractDrafts({ html: page('<p>Just prose.</p>'), url: 'https://x.test/', locale: 'en' }),
    ).toEqual([])
  })
})

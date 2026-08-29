import { describe, expect, it } from 'vitest'
import {
  answerFor,
  matchArticles,
  MATCH_THRESHOLD,
  scoreArticle,
  tokenise,
  type KbArticleLike,
} from '../kb'

/**
 * The knowledge-base matcher (E3.2).
 *
 * These tests pin the *behaviour* — what gets answered and what does not — and
 * deliberately not the scoring formula. The formula will be tuned, and a test
 * asserting `score === 0.49` would turn every tuning into a test edit, which is
 * how a suite stops being evidence and becomes paperwork.
 *
 * The one number that is asserted directly is the threshold's effect, because
 * that is the product decision: where the line sits between answering and
 * fetching a person.
 */

const article = (overrides: Partial<KbArticleLike> = {}): KbArticleLike => ({
  id: 'kb-1',
  topic: 'breakfast',
  questionVariants: ['what time is breakfast'],
  answers: { en: 'Breakfast is 07:30 to 10:00.', it: 'La colazione e dalle 07:30 alle 10:00.' },
  version: 1,
  ...overrides,
})

describe('tokenise', () => {
  it('drops accents so a typed umlaut still matches a plain variant', () => {
    expect(tokenise('Frühstück')).toEqual(['fruhstuck'])
  })

  it('drops words that carry no meaning in any of the four locales', () => {
    expect(tokenise('what is the breakfast')).toEqual(['breakfast'])
  })

  it('keeps negations', () => {
    // "non" and "not" invert a question. A stop list long enough to remove them
    // turns "is breakfast not included" into its opposite, which is the reason
    // the list is deliberately short.
    expect(tokenise('breakfast not included')).toContain('not')
    expect(tokenise('colazione non inclusa')).toContain('non')
  })

  it('drops one-character noise rather than scoring on it', () => {
    expect(tokenise('a b breakfast')).toEqual(['breakfast'])
  })
})

describe('scoreArticle', () => {
  it('scores nothing for a question with no words in common', () => {
    expect(scoreArticle(article(), tokenise('can I bring my dog'))).toBe(0)
  })

  it('scores a verbose question the same as a terse one', () => {
    /*
     * The case that decides whether this is usable at all.
     *
     * A guest writes a sentence with pleasantries in it. Scoring against the
     * *question's* length would punish politeness and escalate the most common
     * real message shape, so the denominator is the stored phrasing.
     */
    const terse = scoreArticle(article(), tokenise('what time is breakfast'))
    const verbose = scoreArticle(
      article(),
      tokenise('hello, sorry to bother you, what time is breakfast in the morning please?'),
    )

    expect(terse).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
    expect(verbose).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
  })

  it('takes the best variant rather than the average of them', () => {
    // An owner who lists ten phrasings, nine of them for other wordings, must
    // not score worse than one who listed a single perfect phrasing.
    const thorough = article({
      questionVariants: [
        'what time is breakfast',
        'is the sauna open',
        'do you have a garage',
        'how do I get to the station',
      ],
    })

    expect(scoreArticle(thorough, tokenise('what time is breakfast'))).toBeGreaterThanOrEqual(
      MATCH_THRESHOLD,
    )
  })

  it('counts the topic as a phrasing of its own', () => {
    const bare = article({ questionVariants: [] })

    expect(scoreArticle(bare, tokenise('breakfast'))).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
  })

  it('ignores a variant that is not a string', () => {
    // `question_variants` is jsonb and a bad seed or an editor bug can put a
    // number in it. That is a row to skip, not a crash on a guest's message.
    const messy = article({ questionVariants: ['what time is breakfast', 42, null] })

    expect(() => scoreArticle(messy, tokenise('breakfast'))).not.toThrow()
  })
})

describe('answerFor', () => {
  it('returns the answer stored for that locale', () => {
    expect(answerFor(article(), 'it')).toContain('colazione')
  })

  it('returns null for a locale the property has not written', () => {
    // Not a fallback and not a translation. Both would put a sentence about a
    // real business in front of a guest that nobody at that business has read
    // in that language (binding rule 7).
    expect(answerFor(article(), 'sl')).toBeNull()
  })

  it('treats a blank answer as no answer', () => {
    expect(answerFor(article({ answers: { en: '   ' } }), 'en')).toBeNull()
  })

  it('survives a malformed answers column', () => {
    expect(answerFor(article({ answers: 'not an object' }), 'en')).toBeNull()
    expect(answerFor(article({ answers: null }), 'en')).toBeNull()
  })
})

describe('matchArticles', () => {
  const kb = [
    article(),
    article({
      id: 'kb-2',
      topic: 'parking',
      questionVariants: ['where can I park'],
      answers: { en: 'Four spaces behind the building.' },
    }),
  ]

  it('picks the article the question is actually about', () => {
    expect(matchArticles(kb, 'where can I park', 'en')?.topic).toBe('parking')
  })

  it('returns null rather than the nearest article when nothing is close', () => {
    expect(matchArticles(kb, 'can I bring my dog', 'en')).toBeNull()
  })

  it('skips an article that matches but has nothing to say in this language', () => {
    // Scores well, has no Slovenian answer, and must not fall through to the
    // second-best article either — a guest asking about parking does not want
    // breakfast hours because the parking answer was missing.
    expect(matchArticles(kb, 'where can I park', 'sl')).toBeNull()
  })

  it('carries the article id and version, so a reply can be traced to what it quoted', () => {
    const found = matchArticles(kb, 'what time is breakfast', 'en')

    expect(found?.articleId).toBe('kb-1')
    expect(found?.version).toBe(1)
  })

  it('returns null for an empty question rather than the first article', () => {
    expect(matchArticles(kb, '', 'en')).toBeNull()
    expect(matchArticles(kb, '   ?  ', 'en')).toBeNull()
  })
})

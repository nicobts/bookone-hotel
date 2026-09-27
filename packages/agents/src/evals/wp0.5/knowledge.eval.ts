import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchArticles, type KbArticleLike } from '@bookone/core/concierge'

/**
 * WP0.5 golden set — the demo property's knowledge base.
 *
 * Reads `content/demo/kb.json`, the same file `scripts/seed-demo.mts` loads,
 * so this tests exactly what the demo serves. Twenty questions, worded unlike
 * the stored variants, must reach the right article; the adjacent ones below
 * must reach nothing, because the property never wrote an answer for them and
 * a near miss relayed as an answer is the failure that costs a property most.
 */
const file = new URL('../../../../../content/demo/kb.json', import.meta.url)
const { articles } = JSON.parse(readFileSync(file, 'utf8')) as {
  articles: { topic: string; questionVariants: string[]; answers: Record<string, string> }[]
}

const kb: KbArticleLike[] = articles.map((article, index) => ({
  id: `demo-${index}`,
  topic: article.topic,
  questionVariants: article.questionVariants,
  answers: article.answers,
  version: 1,
}))

const golden: [string, string, string][] = [
  ['en', 'What time does breakfast start?', 'breakfast'],
  ['it', 'A che ora servite la colazione?', 'breakfast'],
  ['en', 'When can we check in to our room?', 'checkin'],
  ['it', 'Da che ora si può fare il check in?', 'checkin'],
  ['en', 'By what time is checkout?', 'checkout'],
  ['it', 'A che ora bisogna fare il check out?', 'checkout'],
  ['en', 'Where do I park the car?', 'parking'],
  ['it', 'Dove parcheggio la macchina?', 'parking'],
  ['en', 'What is the password for the wifi?', 'wifi'],
  ['it', 'Mi dà la password del wifi?', 'wifi'],
  ['en', 'Can we bring our dog?', 'pets'],
  ['it', 'Possiamo portare il nostro cane?', 'pets'],
  ['en', 'How much is the tourist tax?', 'city-tax'],
  ['it', 'Quanto costa la tassa di soggiorno?', 'city-tax'],
  ['en', 'How far is the train station?', 'station'],
  ['it', 'Quanto dista la stazione dei treni?', 'station'],
  ['en', 'How do we get here from the airport?', 'airport'],
  ['it', "Come arriviamo dall'aeroporto?", 'airport'],
  ['en', 'Is Miramare castle worth visiting?', 'miramare'],
  ['it', 'Dove si può fare il bagno qui vicino?', 'swimming'],
  // Found by the negative below on its first run: without an article of its
  // own, a pool question matched the seafront answer. The fix was content —
  // the property saying it has no pool — not a looser or stricter matcher.
  ['en', 'Is the swimming pool heated?', 'pool'],
]

describe('WP0.5 · the demo knowledge base', () => {
  it('has an Italian and an English answer for every article', () => {
    for (const article of articles) {
      expect(article.answers.it, article.topic).toBeTruthy()
      expect(article.answers.en, article.topic).toBeTruthy()
    }
  })

  it.each(golden)('[%s] %s → %s', (locale, question, topic) => {
    expect(matchArticles(kb, question, locale)?.topic ?? null).toBe(topic)
  })

  it.each([
    ['en', 'Do you have a spa with a sauna?'],
    ['en', 'Can I get a discount for a week?'],
    ['it', 'Avete una sauna?'],
    ['en', 'Is there a gym in the hotel?'],
  ])('[%s] %s → no answer; a person gets it', (locale, question) => {
    expect(matchArticles(kb, question, locale)).toBeNull()
  })
})

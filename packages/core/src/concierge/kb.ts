import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { kbArticles } from '../db/schema'

/**
 * Looking an answer up in the property's own words (E3.2).
 *
 * This module is the reason the concierge is allowed to say anything at all.
 * Binding rule 7 forbids a generated guest-facing fact; what is left is a
 * stored one, written or approved by the property, returned verbatim. The
 * matcher decides *which* stored answer applies. It never composes one.
 *
 * ## Why lexical matching rather than embeddings
 *
 * Three reasons, in order of weight.
 *
 * **It is inspectable.** An owner can read `question_variants` and see exactly
 * why their property answered the way it did. "The vector was close" is not an
 * explanation anybody can act on, and when the answer is wrong the owner is the
 * one who has to fix it.
 *
 * **A stored phrasing is evidence a human expected the question.** That is a
 * stronger signal than similarity, because it carries intent. An embedding will
 * cheerfully rank "can I park here" against an article about the pool.
 *
 * **The corpus is tiny.** A ten-room property has perhaps twenty articles. The
 * regime where embeddings earn their keep is thousands of documents, and the
 * cost of being wrong here is a guest being told something false about a
 * business, which is precisely the failure this whole design is arranged
 * around.
 *
 * When the corpus grows — Sprint 9's AG-03 ingests a whole website — this is
 * the module that changes, and the tests below are what it has to keep passing.
 */

export interface KbMatch {
  articleId: string
  topic: string
  /** The stored answer for the asked locale, verbatim. Never rewritten. */
  answer: string
  version: number
  /** 0–1. Reported so a run can record why it answered, and the audit can read it. */
  score: number
}

/**
 * How close a question must come before we answer it.
 *
 * Set deliberately high. The cost matrix here is lopsided: an escalation costs
 * a property one staff minute, and a confident wrong answer costs them an
 * argument at the desk about something their software said. The eval set scores
 * it that way too.
 */
export const MATCH_THRESHOLD = 0.5

/**
 * Words carrying no discriminating power in any of our four locales.
 *
 * Deliberately short. A long stop list starts removing words that matter — "no"
 * and "not" invert a question, and dropping "non" from Italian turns "is
 * breakfast not included" into its opposite.
 */
const STOP_WORDS = new Set([
  // en
  'the',
  'a',
  'an',
  'is',
  'are',
  'do',
  'does',
  'i',
  'we',
  'you',
  'my',
  'our',
  'to',
  'of',
  'for',
  'at',
  'in',
  'on',
  'can',
  'what',
  'when',
  'where',
  'how',
  // it
  'il',
  'lo',
  'la',
  'i',
  'gli',
  'le',
  'un',
  'una',
  'e',
  'di',
  'da',
  'del',
  'della',
  'per',
  'con',
  'che',
  'come',
  'dove',
  'quando',
  'posso',
  'ce',
  // de
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'und',
  'ist',
  'sind',
  'ich',
  'wir',
  'wie',
  'wo',
  'wann',
  'kann',
  'zu',
  'im',
  'am',
  'fur',
  // sl
  'je',
  'so',
  'in',
  'na',
  'za',
  'kje',
  'kdaj',
  'kako',
  'lahko',
  'ali',
])

/**
 * Fold a question into comparable tokens.
 *
 * Accents are stripped for the same reason the Alloggiati builder strips them:
 * a guest typing "colazione" and one typing "colaziòne" are asking the same
 * thing, and a matcher that disagrees is a matcher that escalates for a typo.
 */
export function tokenise(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

export interface KbArticleLike {
  id: string
  topic: string
  questionVariants: unknown
  answers: unknown
  version: number
}

/**
 * Score one article against a question. Pure, so it is tested without a database.
 *
 * The score is the best any single stored phrasing achieves, not an average
 * across all of them: an article with one exactly-right variant and nine
 * unrelated ones is still exactly right, and averaging would punish an owner
 * for being thorough.
 */
export function scoreArticle(article: KbArticleLike, questionTokens: string[]): number {
  if (questionTokens.length === 0) return 0

  const variants = Array.isArray(article.questionVariants)
    ? article.questionVariants.filter((v): v is string => typeof v === 'string')
    : []

  // The topic itself counts as a phrasing. A guest who types "parking" should
  // reach the parking article whether or not somebody thought to list that
  // exact word among the variants.
  const candidates = [...variants, article.topic]
  const asked = new Set(questionTokens)

  let best = 0

  for (const candidate of candidates) {
    const tokens = tokenise(candidate)
    if (tokens.length === 0) continue

    const overlap = tokens.filter((token) => asked.has(token)).length
    if (overlap === 0) continue

    /*
     * Scored against the *stored* phrasing rather than the question.
     *
     * A guest writes "hi, sorry to bother you, what time is breakfast served in
     * the morning?" — eight useful tokens for a two-token article. Dividing by
     * the question's length would score that 0.25 and escalate it. Dividing by
     * the stored phrasing asks the right question: did this article's words
     * turn up? Both matter, so the question's coverage is kept as a small
     * bonus rather than as the denominator.
     */
    const coverage = overlap / tokens.length
    const bonus = overlap / asked.size
    best = Math.max(best, coverage * 0.85 + bonus * 0.15)
  }

  return best
}

/** The stored answer for this locale, or null. A missing locale is a missing answer. */
export function answerFor(article: KbArticleLike, locale: string): string | null {
  if (typeof article.answers !== 'object' || article.answers === null) return null

  const answers = article.answers as Record<string, unknown>
  const answer = answers[locale]

  /*
   * No fallback to the property's default language, and no translation.
   *
   * Both are tempting and both are the same mistake: handing a guest a sentence
   * about this business that nobody at this business has read in the language
   * the guest will read it in. A missing locale escalates to a human who can
   * actually answer — see docs/design-notes/stay-messaging.md §2.
   */
  return typeof answer === 'string' && answer.trim().length > 0 ? answer : null
}

/** Best match for a question, or null when nothing clears the threshold. */
export function matchArticles(
  articles: KbArticleLike[],
  question: string,
  locale: string,
): KbMatch | null {
  const tokens = tokenise(question)

  let best: KbMatch | null = null

  for (const article of articles) {
    const score = scoreArticle(article, tokens)
    if (score < MATCH_THRESHOLD) continue

    const answer = answerFor(article, locale)
    // Scored well but has nothing to say in this language. Skipped rather than
    // substituted, which is the whole point of `answerFor`.
    if (!answer) continue

    if (!best || score > best.score) {
      best = {
        articleId: article.id,
        topic: article.topic,
        answer,
        version: article.version,
        score,
      }
    }
  }

  return best
}

/**
 * Load a property's published articles.
 *
 * `asService`, because the concierge runs in the worker with no session, and
 * scoped by `property_id` explicitly anyway (ADR-007, binding rule 3).
 */
export async function loadArticles(propertyId: string): Promise<KbArticleLike[]> {
  return asService((db) =>
    db
      .select({
        id: kbArticles.id,
        topic: kbArticles.topic,
        questionVariants: kbArticles.questionVariants,
        answers: kbArticles.answers,
        version: kbArticles.version,
      })
      .from(kbArticles)
      .where(and(eq(kbArticles.propertyId, propertyId), eq(kbArticles.published, true))),
  )
}

/** Load, then match. What the `search_kb` tool calls. */
export async function searchKb(
  propertyId: string,
  question: string,
  locale: string,
): Promise<KbMatch | null> {
  return matchArticles(await loadArticles(propertyId), question, locale)
}

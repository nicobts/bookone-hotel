import { and, asc, eq, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { kbArticles } from '../db/schema'
import { emit } from '../events'
import { type Actor } from '../events/actor'

/**
 * Editing the property's own answers (E5.3).
 *
 * The concierge answers from `kb_articles` or it escalates (binding rule 7), so
 * this module is the whole of what a property can teach it. Sprint 7 shipped
 * the reading side and said the authoring UI was Sprint 9; this is that.
 *
 * ## Every edit bumps the version
 *
 * The tool-boundary audit and any dispute about what a guest was told both rest
 * on the same claim — "the property wrote this answer". That is only a defence
 * if the article can be shown *as it stood*, and the version is what makes the
 * `agent_runs` record point at something specific.
 *
 * The version is bumped in SQL rather than read-then-written, so two people
 * editing the same article cannot both write version 4.
 *
 * ## Live immediately
 *
 * E5.3 asks for ≤60s. There is no cache between this and `searchKb`, so the
 * next question gets the new answer. Worth stating because the obvious
 * optimisation later — caching a property's articles in the worker — would
 * quietly break an acceptance criterion nobody would re-test.
 */

export interface KbArticleInput {
  propertyId: string
  topic: string
  /** Phrasings a guest might use. Stored as given; matching is lexical. */
  questionVariants: string[]
  /** `{ it: "…", de: "…" }`. A locale absent here is absent to the concierge. */
  answers: Record<string, string>
  published?: boolean
  actor: Actor
}

export interface KbArticleRow {
  id: string
  topic: string
  questionVariants: string[]
  answers: Record<string, string>
  version: number
  published: boolean
  updatedAt: Date
}

export class KbRejected extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'KbRejected'
  }
}

/** Every article, published or not. Drafts are visible here and nowhere else. */
export async function listArticles(propertyId: string): Promise<KbArticleRow[]> {
  const rows = await asService((db) =>
    db
      .select({
        id: kbArticles.id,
        topic: kbArticles.topic,
        questionVariants: kbArticles.questionVariants,
        answers: kbArticles.answers,
        version: kbArticles.version,
        published: kbArticles.published,
        updatedAt: kbArticles.updatedAt,
      })
      .from(kbArticles)
      .where(eq(kbArticles.propertyId, propertyId))
      /*
       * Drafts first, then by topic.
       *
       * AG-03 writes drafts, and a draft is the only row on this screen that
       * needs a decision. Sorting them to the top is what makes the editor
       * double as the review surface instead of needing a second inbox
       * (design-notes/onboarding.md §4H).
       */
      .orderBy(asc(kbArticles.published), asc(kbArticles.topic)),
  )

  return rows.map((row) => ({
    ...row,
    questionVariants: Array.isArray(row.questionVariants)
      ? row.questionVariants.filter((v): v is string => typeof v === 'string')
      : [],
    answers:
      typeof row.answers === 'object' && row.answers !== null
        ? (row.answers as Record<string, string>)
        : {},
  }))
}

/**
 * Create or replace one topic.
 *
 * Upsert on `(property_id, topic)` because the topic *is* the identity of the
 * article — an owner editing "breakfast" means the breakfast answer, not a
 * second row with the same name that the matcher would then have to choose
 * between.
 */
export async function saveArticle(input: KbArticleInput): Promise<{ id: string; version: number }> {
  const topic = input.topic.trim().toLowerCase()

  if (!topic) throw new KbRejected('a topic is required')
  if (topic.length > 60) throw new KbRejected('a topic should be a word or two')

  const variants = input.questionVariants
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0)
    .slice(0, 40)

  /*
   * Blank answers are dropped rather than stored.
   *
   * The form posts a box per language and most of them will be empty. Storing
   * `{ de: "" }` would make `answerFor` return null anyway — but it would also
   * make the editor show German as *present and empty*, which reads as an
   * answer somebody deleted rather than one nobody has written.
   */
  const answers = Object.fromEntries(
    Object.entries(input.answers)
      .map(([locale, text]) => [locale, text.trim()] as const)
      .filter(([, text]) => text.length > 0),
  )

  if (Object.keys(answers).length === 0) {
    throw new KbRejected('an article needs an answer in at least one language')
  }

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(kbArticles)
        .values({
          propertyId: input.propertyId,
          topic,
          questionVariants: variants,
          answers,
          published: input.published ?? true,
        })
        .onConflictDoUpdate({
          target: [kbArticles.propertyId, kbArticles.topic],
          set: {
            questionVariants: variants,
            answers,
            published: input.published ?? true,
            // Bumped in SQL, not read-then-written: two people editing the same
            // article must not both produce version 4.
            version: sql`${kbArticles.version} + 1`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: kbArticles.id, version: kbArticles.version })

      if (!row) throw new KbRejected('article insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'kb_article',
        entityId: row.id,
        eventType: 'knowledge.saved',
        origin: 'platform',
        actor: input.actor,
        payload: {
          topic,
          version: row.version,
          locales: Object.keys(answers),
          published: input.published ?? true,
        },
      })

      return { id: row.id, version: row.version }
    }),
  )
}

/**
 * Take an article out of service, or put it back (E5.3).
 *
 * Unpublishing rather than deleting. An article the concierge has already
 * quoted is evidence of what a guest was told, and there is no delete policy on
 * the table for the same reason.
 */
export async function setPublished(input: {
  propertyId: string
  articleId: string
  published: boolean
  actor: Actor
}): Promise<boolean> {
  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(kbArticles)
        .set({
          published: input.published,
          version: sql`${kbArticles.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(kbArticles.id, input.articleId), eq(kbArticles.propertyId, input.propertyId)))
        .returning({ id: kbArticles.id, topic: kbArticles.topic })

      if (!row) return false

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'kb_article',
        entityId: row.id,
        eventType: input.published ? 'knowledge.published' : 'knowledge.unpublished',
        origin: 'platform',
        actor: input.actor,
        payload: { topic: row.topic },
      })

      return true
    }),
  )
}

/**
 * Which of a property's languages an article does not answer in.
 *
 * Shown in the editor as a prompt, and it is the whole reason all four boxes
 * sit on one screen: an empty German box next to a filled Italian one is a
 * question somebody can answer, where a separate German screen is a place
 * nobody goes (design-notes/onboarding.md §4D).
 */
export function missingLocales(
  article: { answers: Record<string, string> },
  languages: string[],
): string[] {
  return languages.filter((locale) => {
    const answer = article.answers[locale]
    return typeof answer !== 'string' || answer.trim().length === 0
  })
}

/**
 * Write AG-03's extraction as drafts (06 §2).
 *
 * Every article lands `published: false`, which `searchKb` refuses to quote —
 * no guest can be told anything the extractor produced until a person has read
 * it and pressed publish.
 *
 * Skips topics that already exist, in either state. An owner who has written
 * their own breakfast answer should not find it replaced by one scraped off
 * their website, and a draft they already declined should not reappear every
 * time the job runs.
 */
export async function saveDrafts(input: {
  propertyId: string
  drafts: {
    topic: string
    questionVariants: string[]
    answers: Record<string, string>
    source: { heading: string; url: string }
  }[]
  actor: Actor
}): Promise<{ written: number; skipped: number }> {
  const existing = new Set((await listArticles(input.propertyId)).map((row) => row.topic))

  let written = 0
  let skipped = 0

  for (const draft of input.drafts) {
    if (existing.has(draft.topic)) {
      skipped += 1
      continue
    }

    try {
      await saveArticle({
        propertyId: input.propertyId,
        topic: draft.topic,
        questionVariants: draft.questionVariants,
        answers: draft.answers,
        published: false,
        actor: input.actor,
      })
      written += 1
    } catch (error) {
      // A draft the validator refuses — no answer text, an absurd topic — is
      // skipped rather than aborting the run. The rest of a scrape is still
      // worth having.
      if (error instanceof KbRejected) {
        skipped += 1
        continue
      }
      throw error
    }
  }

  return { written, skipped }
}

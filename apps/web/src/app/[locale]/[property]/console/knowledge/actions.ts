'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { KbRejected, saveArticle, setPublished } from '@bookone/core/onboarding'
import { requireOwner } from '@/lib/auth/current-property'

/**
 * Editing the property's own answers (E5.3).
 *
 * `requireOwner`, and repeated in each action rather than inherited from the
 * page: an action is its own request, and the form that posts to it is a string
 * in somebody's browser.
 *
 * Owner rather than member, which is a judgement worth stating. The KB is the
 * whole of what the concierge may say to guests (binding rule 7), so an edit
 * here changes what the business tells people — nearer to changing the
 * cancellation policy than to ticking off a task.
 */

interface Context {
  locale: string
  slug: string
}

/** The languages an answer can be written in. Kept in step with next-intl's routing. */
const LOCALES = ['it', 'de', 'en', 'sl'] as const

/**
 * Returns void, and reports failure through the URL.
 *
 * A form `action` must return void or a promise of it, so a rejection cannot
 * come back as a value without making this a client component and threading
 * `useActionState` through it. The failures here are short and few — an empty
 * topic, no answer in any language — so a redirect carrying the reason is the
 * honest amount of machinery, and it survives a page without JavaScript.
 */
export async function save(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)

  const answers: Record<string, string> = {}
  for (const locale of LOCALES) {
    answers[locale] = String(formData.get(`answer-${locale}`) ?? '')
  }

  /*
   * One phrasing per line.
   *
   * A textarea rather than a tag input, because the thing being entered is
   * sentences — "what time is breakfast", "when is breakfast served" — and a
   * chip UI for sentences is a chip UI nobody can read back.
   */
  const questionVariants = String(formData.get('variants') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  try {
    const { version } = await saveArticle({
      propertyId: property.id,
      topic: String(formData.get('topic') ?? ''),
      questionVariants,
      answers,
      // Saving a draft publishes it. AG-03's drafts arrive unpublished and the
      // owner reviewing one is deciding to stand behind it, which is the same
      // act as writing it themselves.
      published: formData.get('published') !== 'false',
      actor: { kind: 'user', userId: user.id },
    })

    void version
  } catch (error) {
    if (error instanceof KbRejected) {
      revalidatePath(`/${context.locale}/${context.slug}/console/knowledge`)
      redirect(
        `/${context.locale}/${context.slug}/console/knowledge?error=${encodeURIComponent(error.message)}`,
      )
    }
    throw error
  }

  revalidatePath(`/${context.locale}/${context.slug}/console/knowledge`)
}

/**
 * Take an answer out of service, or put it back.
 *
 * Never a delete. An article the concierge has already quoted is evidence of
 * what a guest was told, and the table has no delete policy for the same reason.
 */
export async function togglePublished(
  context: Context & { articleId: string; published: boolean },
): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)

  await setPublished({
    propertyId: property.id,
    articleId: context.articleId,
    published: context.published,
    actor: { kind: 'user', userId: user.id },
  })

  revalidatePath(`/${context.locale}/${context.slug}/console/knowledge`)
}

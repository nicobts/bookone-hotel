'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
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

/** Core's refusals, as the keys the owner reads them under. */
const REASONS: Record<string, string> = {
  'a topic is required': 'topicRequired',
  'a topic should be a word or two': 'topicTooLong',
  'an article needs an answer in at least one language': 'answerRequired',
}

function toasts(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'console.knowledge.toast' })
}

/**
 * Returns void, and reports the outcome as a flash toast.
 *
 * A form `action` must return void or a promise of it, so a rejection cannot
 * come back as a value without making this a client component and threading
 * `useActionState` through it. The failures here are short and few — an empty
 * topic, no answer in any language — so a translated flash is the honest
 * amount of machinery, and the form keeps working without JavaScript.
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

  const published = formData.get('published') !== 'false'

  try {
    const { version } = await saveArticle({
      propertyId: property.id,
      topic: String(formData.get('topic') ?? ''),
      questionVariants,
      answers,
      // Saving a draft publishes it. AG-03's drafts arrive unpublished and the
      // owner reviewing one is deciding to stand behind it, which is the same
      // act as writing it themselves.
      published,
      actor: { kind: 'user', userId: user.id },
    })

    void version
  } catch (error) {
    if (error instanceof KbRejected) {
      const t = await toasts(context)
      await flash.error(t('notSaved'), t(`reasons.${REASONS[error.message] ?? 'other'}`))
      revalidatePath(`/${context.locale}/${context.slug}/console/knowledge`)
      redirect(`/${context.locale}/${context.slug}/console/knowledge`)
    }
    throw error
  }

  const t = await toasts(context)
  if (published) await flash.success(t('saved'), t('savedDescription'))
  else await flash.success(t('savedDraft'))
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

  const t = await toasts(context)
  if (context.published) await flash.success(t('published'), t('publishedDescription'))
  else await flash.success(t('unpublished'), t('unpublishedDescription'))
  revalidatePath(`/${context.locale}/${context.slug}/console/knowledge`)
}

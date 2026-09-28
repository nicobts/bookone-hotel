'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
import {
  appendStaffMessage,
  handBackThread,
  reverseAction,
  takeOverThread,
} from '@bookone/core/concierge'
import { requireFeature } from '@/lib/auth/current-property'

/**
 * The three things a person does with a conversation (E3.3).
 *
 * All of them resolve the property through `requireFeature` (ADR-019), which resolves it
 * *through the signed-in user's memberships* — so a thread id pasted from
 * another property cannot be acted on: the property behind it never resolves
 * for this person, and every core call is scoped to that property anyway.
 *
 * These write through core rather than through the worker, unlike the arrival
 * actions. The difference is what the action *is*: taking a thread over is a
 * state change the person is looking at when they make it, and it enqueues
 * nothing. Routing it through a queue would add a round trip and a window in
 * which the button has been pressed and the screen still says nobody has it.
 *
 * Each outcome is flashed as a toast (`@bookone/ui/lib/flash`).
 */

interface Context {
  locale: string
  slug: string
  threadId: string
}

function toasts(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'console.conversations.toast' })
}

function revalidate(context: Context): void {
  revalidatePath(`/${context.locale}/${context.slug}/console/conversations/${context.threadId}`)
  revalidatePath(`/${context.locale}/${context.slug}/console/conversations`)
}

/** One tap: this is mine now. */
export async function takeOver(context: Context): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'inbox')

  await takeOverThread({
    propertyId: property.id,
    threadId: context.threadId,
    userId: user.id,
  })

  const t = await toasts(context)
  await flash.success(t('takenOver'), t('takenOverDescription'))
  revalidate(context)
}

/**
 * One tap: not mine after all.
 *
 * Returns the thread to the unowned queue rather than to the concierge. The
 * agent escalated it once already; handing it back to be escalated again is a
 * loop with a guest at the bottom of it.
 */
export async function handBack(context: Context): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'inbox')

  await handBackThread({
    propertyId: property.id,
    threadId: context.threadId,
    userId: user.id,
  })

  const t = await toasts(context)
  await flash.success(t('handedBack'), t('handedBackDescription'))
  revalidate(context)
}

/**
 * Answer the guest.
 *
 * Writes the message as *this person* — the database enforces it, since the
 * insert policy requires `author = 'staff'` and `author_user_id = auth.uid()`.
 * Answering also takes the thread: somebody who replies has picked it up
 * whether or not they pressed the button first.
 */
export async function reply(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'inbox')

  const body = String(formData.get('body') ?? '').trim()
  if (!body) return

  await appendStaffMessage({
    propertyId: property.id,
    threadId: context.threadId,
    userId: user.id,
    body,
  })

  await flash.success((await toasts(context))('sent'))
  revalidate(context)
}

/**
 * Undo one of the concierge's actions (WP0.6 "Annulla"). Core refuses unless a
 * real reversal exists; the reversal is its own event, linked to the run.
 */
export async function undoAction(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'inbox')

  const outcome = await reverseAction({
    propertyId: property.id,
    runId: String(formData.get('runId') ?? ''),
    callIndex: Number(formData.get('callIndex')),
    userId: user.id,
  })

  const t = await toasts(context)
  if (outcome.status === 'reversed') await flash.success(t('undone'))
  else await flash.error(t('notUndone'), t('notUndoneDescription'))
  revalidate(context)
}

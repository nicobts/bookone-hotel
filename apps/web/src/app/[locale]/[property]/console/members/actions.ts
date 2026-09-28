'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
import { addContact, confirmContactInformed, removeContact } from '@bookone/core/contacts'
import { requireOwner } from '@/lib/auth/current-property'

/**
 * The people a property pages (design-notes/alert-contacts.md).
 *
 * `requireOwner` in every action, not inherited from the page: an action is
 * its own request. The database says the same thing again — `property_contacts`
 * is owner-only under RLS, and every call here runs as the signed-in user.
 */

interface Context {
  locale: string
  slug: string
}

function strings(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'console.contacts' })
}

function back(context: Context): never {
  revalidatePath(`/${context.locale}/${context.slug}/console/members`)
  redirect(`/${context.slug}/console/members`)
}

export async function addContactAction(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  const t = await strings(context)

  const result = await addContact(user.id, property.id, {
    role: String(formData.get('role') ?? ''),
    name: String(formData.get('name') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    informed: formData.get('informed') === 'on',
  })

  switch (result.status) {
    case 'added':
      await flash.success(t('toast.added'))
      break
    case 'invalid-phone':
      await flash.error(t('error.phone'))
      break
    case 'invalid-name':
      await flash.error(t('error.name'))
      break
    case 'not-informed':
      await flash.error(t('error.informed'))
      break
    case 'duplicate':
      await flash.error(t('error.duplicate'))
      break
    case 'invalid-role':
    case 'forbidden':
      await flash.error(t('error.generic'))
      break
  }
  back(context)
}

export async function removeContactAction(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  const t = await strings(context)

  const removed = await removeContact(user.id, property.id, String(formData.get('id') ?? ''))
  if (removed) await flash.success(t('toast.removed'))
  else await flash.error(t('error.generic'))
  back(context)
}

export async function confirmInformedAction(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  const t = await strings(context)

  const confirmed = await confirmContactInformed(
    user.id,
    property.id,
    String(formData.get('id') ?? ''),
  )
  if (confirmed) await flash.success(t('toast.confirmed'))
  else await flash.error(t('error.generic'))
  back(context)
}

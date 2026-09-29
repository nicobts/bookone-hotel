'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
import { getObligationForMember, localDate, recordManualFiling } from '@bookone/core/compliance'
import { requireCompliance } from '@/lib/compliance/access'
import { deleteComplianceReceipt, storeComplianceReceipt } from '@/lib/storage'

type Context = { locale: string; slug: string; obligationId: string }

/**
 * A person filed by hand and records it (WP1.6): the portal's protocol number,
 * the day it was filed, and optionally the receipt file.
 *
 * Any member may record it — filing is desk work, and the receptionist who
 * uploaded to the portal is the one holding the receipt. The checks, in
 * order: membership and a compliance module (`requireCompliance`), the
 * obligation read under the member's session, and its own adapter's feature.
 * Core then refuses an obligation that is not the property's, already
 * acknowledged, or with the authority awaiting an answer.
 *
 * The file is stored before the record, because the record carries its hash;
 * if the record is then refused, the file is removed again.
 */
export async function recordManualFilingAction(context: Context, formData: FormData) {
  const { user, property, adapterIds } = await requireCompliance(context.locale, context.slug)
  const obligation = await getObligationForMember(user.id, property.id, context.obligationId)
  if (!obligation || !adapterIds.includes(obligation.adapterId)) notFound()

  const t = await getTranslations({
    locale: context.locale,
    namespace: 'console.compliance.toast',
  })
  const page = `/${context.locale}/${context.slug}/console/compliance/${context.obligationId}`

  const protocol = String(formData.get('protocol') ?? '').trim()
  const filedOn = String(formData.get('filedOn') ?? '')
  const today = localDate(new Date(), property.timezone)
  if (!protocol || protocol.length > 64) {
    await flash.error(t('invalid'), t('protocolRequired'))
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn) || filedOn > today) {
    await flash.error(t('invalid'), t('dateInvalid'))
    return
  }

  const file = formData.get('receipt')
  let attachment:
    { path: string; contentType: string; sizeBytes: number; sha256: string } | undefined
  if (file instanceof File && file.size > 0) {
    const stored = await storeComplianceReceipt({
      propertyId: property.id,
      obligationId: obligation.id,
      file,
    })
    if (stored.status === 'rejected') {
      await flash.error(t('fileRefused'), t(`file.${stored.reason}`))
      return
    }
    if (stored.status === 'failed') {
      await flash.error(t('fileFailed'), t('fileFailedDescription'))
      return
    }
    attachment = {
      path: stored.path,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
    }
  }

  const outcome = await recordManualFiling({
    propertyId: property.id,
    obligationId: obligation.id,
    userId: user.id,
    receipt: { protocol, filedOn },
    attachment,
  })

  if (outcome.status === 'rejected') {
    if (attachment) await deleteComplianceReceipt(attachment.path)
    await flash.error(t('refused'), t('refusedDescription'))
  } else {
    await flash.success(t('recorded'), t('recordedDescription'))
  }

  revalidatePath(page)
  revalidatePath(`/${context.locale}/${context.slug}/console/compliance`)
}

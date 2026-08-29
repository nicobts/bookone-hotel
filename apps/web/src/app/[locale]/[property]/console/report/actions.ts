'use server'

import { revalidatePath } from 'next/cache'
import { buildReport, csvFilename, issueReport, raiseDispute, toCsv } from '@bookone/core/billing'
import { getTranslations } from 'next-intl/server'
import { requireProperty } from '@/lib/auth/current-property'

/**
 * The three things an owner does with a statement (E5.4).
 *
 * Each resolves the property through `requireProperty`, which resolves it via
 * the signed-in user's memberships — a period or a fee id pasted from another
 * property never resolves for this person, and every core call is scoped to
 * that property anyway.
 */

interface Context {
  locale: string
  slug: string
  periodStart: string
}

/**
 * Freeze the period.
 *
 * Owner or staff: this is not an administrative act on the property, it is
 * accepting a statement, and the person who reconciles the numbers at a small
 * hotel is frequently not the person whose name is on the company.
 */
export async function issue(context: Context): Promise<void> {
  const { user, property } = await requireProperty(context.locale, context.slug)

  await issueReport({
    propertyId: property.id,
    periodStart: context.periodStart,
    actor: { kind: 'user', userId: user.id },
  })

  revalidatePath(`/${context.locale}/${context.slug}/console/report`)
}

/**
 * Disagree with a line (E5.4, D14).
 *
 * The credit is applied when this returns. There is no adjudication step and no
 * queue — D14 resolves disputes in the owner's favour, and a version of that
 * which routes through us first is a different policy wearing the same words.
 */
export async function dispute(
  context: Context & { feeEventId: string },
  formData: FormData,
): Promise<void> {
  const { user, property } = await requireProperty(context.locale, context.slug)

  const reason = String(formData.get('reason') ?? '').trim()

  await raiseDispute({
    propertyId: property.id,
    feeEventId: context.feeEventId,
    userId: user.id,
    ...(reason ? { reason } : {}),
  })

  revalidatePath(`/${context.locale}/${context.slug}/console/report`)
}

/**
 * The statement as a file (E5.4: export CSV).
 *
 * Built on the server and returned as text, which the client turns into a
 * download. Not a route handler: the report is per-property and per-period and
 * already behind `requireProperty` here, and a GET endpoint would need the same
 * membership check written a second time.
 */
export async function exportCsv(
  context: Context,
): Promise<{ filename: string; content: string } | null> {
  const { user, property } = await requireProperty(context.locale, context.slug)
  void user

  const report = await buildReport({ propertyId: property.id, periodStart: context.periodStart })
  if (!report) return null

  const t = await getTranslations({ locale: context.locale, namespace: 'console.report' })

  return {
    filename: csvFilename(report),
    content: toCsv(report, {
      // The file says what it is not. It will be forwarded to a commercialista,
      // and a document with amounts on it and no such line invites exactly the
      // wrong assumption (D11, binding rule 6).
      disclaimer: t('export.disclaimer'),
      headers: {
        section: t('export.headers.section'),
        reference: t('export.headers.reference'),
        guest: t('export.headers.guest'),
        arrival: t('export.headers.arrival'),
        departure: t('export.headers.departure'),
        basis: t('export.headers.basis'),
        rate: t('export.headers.rate'),
        fee: t('export.headers.fee'),
        credit: t('export.headers.credit'),
        net: t('export.headers.net'),
        evidence: t('export.headers.evidence'),
      },
      sections: {
        subscription: t('sections.subscription'),
        direct_booking: t('sections.direct'),
        ai_attributed: t('sections.attributed'),
      },
      total: t('total'),
      perRoom: t('perRoomLabel'),
    }),
  }
}

'use server'

import {
  AdminRefused,
  adminSetAgentPaused,
  adminSetFeature,
  startTenantView,
} from '@bookone/core/admin'
import { FEATURES, type Feature } from '@bookone/core/onboarding'
import { flash } from '@bookone/ui/lib/flash-server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { logger } from '@/lib/logger'
import { requireAdmin, requireStaff } from '@/lib/staff'

export interface ActionState {
  error: string | null
  done: boolean
}

/**
 * The console's admin API (ADR-031): server actions, each one staff
 * authentication → role check → `withAdminAudit` in core. Next checks the
 * Origin of every server action, which is the CSRF half; the reason field is
 * required here and again in core, so a crafted request cannot skip it.
 *
 * Outcomes are flashed as toasts (`@bookone/ui/lib/flash`); a refusal is also
 * returned, so the form can keep its input for a second try.
 */
async function refusal(error: unknown): Promise<ActionState> {
  if (error instanceof AdminRefused) return refused(error.message)
  throw error
}

async function refused(message: string): Promise<ActionState> {
  await flash.error('Change refused', message)
  return { error: message, done: false }
}

const AUDITED = 'Recorded in the audit log with your reason.'

export async function setFeature(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireAdmin()
  const propertyId = String(form.get('propertyId') ?? '')
  const feature = String(form.get('feature') ?? '')
  const enabled = form.get('enabled') === 'true'
  const reason = String(form.get('reason') ?? '')

  if (!(FEATURES as readonly string[]).includes(feature)) {
    return refused('Unknown feature.')
  }

  try {
    await adminSetFeature(staff, { propertyId, feature: feature as Feature, enabled, reason })
  } catch (error) {
    return refusal(error)
  }

  logger.info(
    { action: enabled ? 'feature.grant' : 'feature.revoke', propertyId, feature },
    'admin change',
  )
  await flash.success(`${feature} ${enabled ? 'enabled' : 'disabled'}`, AUDITED)
  revalidatePath(`/properties/${propertyId}`)
  return { error: null, done: true }
}

export async function setAgentPaused(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireAdmin()
  const propertyId = String(form.get('propertyId') ?? '')
  const paused = form.get('paused') === 'true'
  const reason = String(form.get('reason') ?? '')

  try {
    await adminSetAgentPaused(staff, { propertyId, paused, reason })
  } catch (error) {
    return refusal(error)
  }

  logger.info({ action: paused ? 'agent.pause' : 'agent.resume', propertyId }, 'admin change')
  await flash.success(paused ? 'Concierge paused' : 'Concierge resumed', AUDITED)
  revalidatePath(`/properties/${propertyId}`)
  revalidatePath('/')
  return { error: null, done: true }
}

/** View-as-tenant: any staff role, with a reason; the audit row is the grant (ADR-031). */
export async function viewAsTenant(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff()
  const propertyId = String(form.get('propertyId') ?? '')
  const reason = String(form.get('reason') ?? '')

  try {
    await startTenantView(staff, { propertyId, reason })
  } catch (error) {
    return refusal(error)
  }

  logger.info({ action: 'tenant.view', propertyId }, 'admin view')
  await flash.info(
    'Viewing as the property for 30 minutes',
    'The owner sees this visit, and your reason, in their settings.',
  )
  redirect(`/properties/${propertyId}/view`)
}

'use server'

import {
  AdminRefused,
  adminSetAgentPaused,
  adminSetFeature,
  startTenantView,
} from '@bookone/core/admin'
import { FEATURES, type Feature } from '@bookone/core/onboarding'
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
 */
function refusal(error: unknown): ActionState {
  if (error instanceof AdminRefused) return { error: error.message, done: false }
  throw error
}

export async function setFeature(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireAdmin()
  const propertyId = String(form.get('propertyId') ?? '')
  const feature = String(form.get('feature') ?? '')
  const enabled = form.get('enabled') === 'true'
  const reason = String(form.get('reason') ?? '')

  if (!(FEATURES as readonly string[]).includes(feature)) {
    return { error: 'Unknown feature.', done: false }
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
  redirect(`/properties/${propertyId}/view`)
}

import { and, count, eq, isNull } from 'drizzle-orm'
import { asService } from '../db/session'
import { kbArticles, properties, rateSnapshots, roomTypes, subscriptions } from '../db/schema'
import { readBookingPolicy } from '../policy'
import { readContactEmail } from '../booking/request'

/**
 * The property setup checklist (E7.1).
 *
 * ## It is derived, never stored
 *
 * There is no `setup_completed` column and no progress table. An item is done
 * when the thing it describes **exists** — a `room_types` row, a contact address
 * in settings, a published KB article.
 *
 * A stored flag is a second source of truth, and it drifts the first time
 * somebody changes a setting through another path. The failure is specific and
 * bad: a new owner is told to do something they have already done, on the one
 * screen whose entire job is telling them what is left.
 *
 * ## Nothing is gated on completion
 *
 * `blocking` marks the items a property genuinely cannot transact without, and
 * they are the ones a booking would fail on anyway. Everything else improves
 * the result and blocks nothing. A checklist that presents theming as equally
 * required as room types is a checklist abandoned at the tourist-tax table
 * (design-notes/onboarding.md §4A).
 */

export type ChecklistKey =
  | 'identity'
  | 'rooms'
  | 'availability'
  | 'contact'
  | 'theming'
  | 'policy'
  | 'knowledge'
  | 'subscription'
  | 'payments'

export interface ChecklistItem {
  key: ChecklistKey
  done: boolean
  /** True when the property cannot take a booking without it. */
  blocking: boolean
  /**
   * True when nothing an owner does can complete it.
   *
   * Payments is the only one today: no provider is connected (ADR-010, 04 §0
   * item 6). It is on the list rather than hidden, because an owner who
   * discovers at go-live that payments were never configured has been misled by
   * an absence.
   */
  blockedOnUs: boolean
  /** A number the item shows beside itself, when it has one — rooms, articles. */
  detail?: number
}

export interface Checklist {
  propertyId: string
  items: ChecklistItem[]
  /** Done over total, excluding what only we can do. */
  done: number
  total: number
  /** Whether the property can take a booking at all. */
  canTransact: boolean
}

export async function buildChecklist(propertyId: string): Promise<Checklist | null> {
  return asService(async (db) => {
    const [property] = await db
      .select({
        name: properties.name,
        languages: properties.languages,
        timezone: properties.timezone,
        settings: properties.settings,
      })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1)

    if (!property) return null

    const [rooms] = await db
      .select({ n: count() })
      .from(roomTypes)
      .where(eq(roomTypes.propertyId, propertyId))

    const [snapshots] = await db
      .select({ n: count() })
      .from(rateSnapshots)
      .where(eq(rateSnapshots.propertyId, propertyId))

    const [articles] = await db
      .select({ n: count() })
      .from(kbArticles)
      .where(and(eq(kbArticles.propertyId, propertyId), eq(kbArticles.published, true)))

    const [subscription] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.propertyId, propertyId), isNull(subscriptions.endedAt)))
      .limit(1)

    const settings = (
      typeof property.settings === 'object' && property.settings !== null ? property.settings : {}
    ) as Record<string, unknown>

    const theme = (
      typeof settings.theme === 'object' && settings.theme !== null ? settings.theme : {}
    ) as Record<string, unknown>

    const policy = readBookingPolicy(property.settings)

    const items: ChecklistItem[] = [
      {
        key: 'identity',
        // A seeded property always has these, so this is close to always done —
        // and it stays on the list because it is the first thing a new owner
        // looks for, and a checklist whose first item is invisible reads as
        // starting halfway through.
        done:
          property.name.trim().length > 0 &&
          Array.isArray(property.languages) &&
          property.languages.length > 0 &&
          property.timezone.trim().length > 0,
        blocking: true,
        blockedOnUs: false,
      },
      {
        key: 'rooms',
        done: (rooms?.n ?? 0) > 0,
        blocking: true,
        blockedOnUs: false,
        detail: rooms?.n ?? 0,
      },
      {
        key: 'availability',
        /*
         * Not a setting — evidence that the sync engine has run.
         *
         * A property with room types and no snapshots looks configured and
         * cannot be booked: the surface degrades to the request form, which is
         * correct behaviour and a mystery to whoever set it up. Naming it here
         * turns a silent failure into an item.
         */
        done: (snapshots?.n ?? 0) > 0,
        blocking: true,
        blockedOnUs: false,
        detail: snapshots?.n ?? 0,
      },
      {
        key: 'contact',
        done: readContactEmail(property.settings) !== null,
        // Blocking, and not obviously so. Without it the property cannot
        // receive a booking request, an escalation alert or an invoice request
        // — three paths that fail silently and separately.
        blocking: true,
        blockedOnUs: false,
      },
      {
        key: 'theming',
        done: typeof theme.primary === 'string' && theme.primary.length > 0,
        blocking: false,
        blockedOnUs: false,
      },
      {
        key: 'policy',
        // A property that takes no deposit and has no cancellation windows is a
        // legitimate configuration, so "done" means somebody *decided*: a
        // deposit mode other than the default, or at least one window.
        done: policy.deposit.mode !== 'none' || policy.cancellation.length > 0,
        blocking: false,
        blockedOnUs: false,
      },
      {
        key: 'knowledge',
        done: (articles?.n ?? 0) > 0,
        blocking: false,
        blockedOnUs: false,
        detail: articles?.n ?? 0,
      },
      {
        key: 'subscription',
        done: Boolean(subscription),
        blocking: false,
        blockedOnUs: true,
      },
      {
        key: 'payments',
        // ADR-010. Nothing an owner does completes this, and saying so is the
        // point of the item.
        done: false,
        blocking: false,
        blockedOnUs: true,
      },
    ]

    const ours = items.filter((item) => !item.blockedOnUs)

    return {
      propertyId,
      items,
      done: ours.filter((item) => item.done).length,
      total: ours.length,
      canTransact: items.filter((item) => item.blocking).every((item) => item.done),
    }
  })
}

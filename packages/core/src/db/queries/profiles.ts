import { eq } from 'drizzle-orm'
import { withUser } from '../session'
import { profiles } from '../schema'

export interface Profile {
  userId: string
  fullName: string | null
  locale: string
  theme: string
  defaultPropertyId: string | null
}

/**
 * This person's profile row.
 *
 * Created by a trigger when the auth user is created, so it always exists —
 * the null return covers the window between an auth user appearing and the
 * trigger committing, not a design where profiles are optional.
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        locale: profiles.locale,
        theme: profiles.theme,
        defaultPropertyId: profiles.defaultPropertyId,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1),
  )

  return rows[0] ?? null
}

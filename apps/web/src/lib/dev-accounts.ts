import 'server-only'
import type { DevAccount } from '@bookone/ui/components/dev-login-helper'

/*
 * DEV-LOGIN-HELPER — development only, temporary. Delete before GA.
 * The accounts `pnpm db:seed` and `pnpm demo:seed` create. Server-only, and
 * handed to the page only in development, so they never reach a client bundle.
 */
const PASSWORD = 'devpassword123!'

export const devAccounts: DevAccount[] | null =
  process.env.NODE_ENV === 'development'
    ? [
        {
          label: 'Demo owner · Hotel Demo Trieste',
          email: 'owner@demo.bookone.test',
          password: PASSWORD,
        },
        {
          label: 'Demo staff · Hotel Demo Trieste',
          email: 'staff@demo.bookone.test',
          password: PASSWORD,
        },
        {
          label: 'Owner · Hotel Sonja (staff at Garni Alpin)',
          email: 'owner@bookone.test',
          password: PASSWORD,
        },
        { label: 'Staff · Hotel Sonja', email: 'staff@bookone.test', password: PASSWORD },
      ]
    : null

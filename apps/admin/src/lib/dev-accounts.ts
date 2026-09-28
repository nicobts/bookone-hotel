import 'server-only'
import type { DevAccount } from '@bookone/ui/components/dev-login-helper'

/*
 * DEV-LOGIN-HELPER — development only, temporary. Delete before GA.
 * The operator accounts `pnpm db:seed` creates. Server-only, and handed to the
 * page only in development, so they never reach a client bundle.
 */
const PASSWORD = 'devpassword123!'

export const devAccounts: DevAccount[] | null =
  process.env.NODE_ENV === 'development'
    ? [
        { label: 'Operator · admin', email: 'ops@bookone.test', password: PASSWORD },
        {
          label: 'Operator · support (read-only)',
          email: 'support@bookone.test',
          password: PASSWORD,
        },
        {
          label: 'Hotel owner (refused: no staff role)',
          email: 'owner@bookone.test',
          password: PASSWORD,
        },
      ]
    : null

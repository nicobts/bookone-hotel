import { describe, expect, it } from 'vitest'
import { admit, clientIp, configurationProblem, staffRoleOf } from './policy'

const env = {
  url: 'https://staff.supabase.co',
  anonKey: 'anon',
  tenantUrl: 'https://tenant.supabase.co',
  production: true,
}

describe('configurationProblem', () => {
  it('accepts a separate https staff project in production', () => {
    expect(configurationProblem(env)).toBeNull()
  })

  it('refuses the tenant project as the staff project in production', () => {
    expect(configurationProblem({ ...env, url: 'https://tenant.supabase.co/' })).toMatch(
      /tenant project/,
    )
  })

  it('allows the shared local project in development', () => {
    expect(
      configurationProblem({
        ...env,
        url: 'http://127.0.0.1:54421',
        tenantUrl: 'http://127.0.0.1:54421',
        production: false,
      }),
    ).toBeNull()
  })

  it('refuses missing configuration', () => {
    expect(configurationProblem({ ...env, anonKey: '' })).toMatch(/not set/)
  })
})

describe('staffRoleOf', () => {
  it('reads only known roles', () => {
    expect(staffRoleOf({ staff_role: 'admin' })).toBe('admin')
    expect(staffRoleOf({ staff_role: 'support' })).toBe('support')
    expect(staffRoleOf({ staff_role: 'owner' })).toBeNull()
    expect(staffRoleOf({})).toBeNull()
    expect(staffRoleOf(null)).toBeNull()
  })
})

describe('admit', () => {
  it('refuses an account without a staff role', () => {
    expect(admit({ appMetadata: {}, aal: 'aal2', production: true })).toEqual({ status: 'no-role' })
  })

  it('requires MFA in production', () => {
    expect(admit({ appMetadata: { staff_role: 'admin' }, aal: 'aal1', production: true })).toEqual({
      status: 'mfa-required',
    })
    expect(admit({ appMetadata: { staff_role: 'admin' }, aal: 'aal2', production: true })).toEqual({
      status: 'admitted',
      role: 'admin',
    })
  })

  it('does not require MFA locally', () => {
    expect(
      admit({ appMetadata: { staff_role: 'support' }, aal: 'aal1', production: false }),
    ).toEqual({ status: 'admitted', role: 'support' })
  })
})

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    expect(clientIp('100.64.0.7, 10.0.0.1', null)).toBe('100.64.0.7')
    expect(clientIp(null, '100.64.0.8')).toBe('100.64.0.8')
    expect(clientIp(null, null)).toBeNull()
  })
})

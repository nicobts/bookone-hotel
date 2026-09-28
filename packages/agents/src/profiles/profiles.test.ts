import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AG_01, grantsTool } from '../registry'
import { loadProfiles, PROFILE_SOURCES, ProfileError, profileToolNames } from './index'

/** The Guest Desk profiles as data (ADR-021, WP0.2). */
const dir = fileURLToPath(new URL('.', import.meta.url))
const valid = PROFILE_SOURCES['general-info.json'] as Record<string, unknown>

describe('the profile files', () => {
  it('lists every *.json in the directory — none is silently left out of the bundle', () => {
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
    expect(Object.keys(PROFILE_SOURCES).sort()).toEqual(files)
  })

  it('loads all eight and validates them', () => {
    expect([...loadProfiles().keys()].sort()).toEqual([
      'booking-support',
      'checkout',
      'complaints',
      'general-info',
      'owner-backoffice',
      'payments',
      'pre-arrival',
      'pre-sale',
    ])
  })

  it('keeps the owner agent out of guest reach', () => {
    expect(loadProfiles().get('owner-backoffice')?.guestFacing).toBe(false)
  })

  it('never lets a model run a money-shaped tool without a person', () => {
    const profiles = loadProfiles()
    expect(profiles.get('booking-support')?.approvalRequired).toContain('cancel_booking')
    expect(profiles.get('payments')?.approvalRequired).toContain('create_payment_link')
    expect(profiles.get('checkout')?.approvalRequired).toContain('request_late_checkout')
  })

  it("is covered by AG-01's grant — the outer fence contains every inner one", () => {
    for (const tool of profileToolNames()) expect(grantsTool(AG_01, tool)).toBe(true)
  })
})

describe('a malformed profile fails boot with a clear error', () => {
  const load =
    (patch: Record<string, unknown>, file = 'general-info.json') =>
    () =>
      loadProfiles({ [file]: { ...valid, ...patch } })

  it.each([
    [
      'a tool that does not exist',
      { tools: ['search_knowledge', 'launch_rocket'] },
      /launch_rocket/,
    ],
    [
      'an approval for a tool it does not list',
      { approvalRequired: ['cancel_booking'] },
      /cancel_booking/,
    ],
    ['a primary action it does not list', { primaryAction: 'cancel_booking' }, /primary action/],
    ['a prompt that does not exist', { prompt: 'no-such-prompt' }, /no-such-prompt/],
    ['an unknown field', { temperature: 2 }, /temperature/],
    ['too many steps', { maxSteps: 50 }, /maxSteps/],
  ])('%s', (_label, patch, message) => {
    expect(load(patch)).toThrow(ProfileError)
    expect(load(patch)).toThrow(message)
  })

  it('a file whose name does not match its id', () => {
    expect(load({}, 'renamed.json')).toThrow(/does not match id/)
  })
})

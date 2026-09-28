import { describe, expect, it } from 'vitest'
import { applyHardRules } from './hard-rules'

/**
 * Hard rules (ADR-021). Asserted in pairs, as the AG-01 eval set is: a phrase
 * that must trip a rule, and an adjacent one that must not — a rule that fires
 * on "where is the emergency exit" silences the agent for no reason.
 */
const rule = (message: string) => applyHardRules({ message, previousUnknown: false })?.rule ?? null

describe('emergency', () => {
  it.each([
    'There is a fire in the corridor',
    'I smell gas in the room',
    'my husband cant breathe',
    'C’è una fuga di gas in camera',
    'Mio padre è svenuto',
    'Es brennt im Keller!',
    'Wir brauchen einen Notarzt',
    'V sobi je požar',
  ])('fires on %j and stops the agent', (message) => {
    expect(applyHardRules({ message, previousUnknown: false })).toEqual({
      rule: 'emergency',
      tier: 'T3',
      stop: true,
    })
  })

  it.each([
    'Where is the emergency exit?',
    'Can I smoke on the balcony?',
    'Is there a fire pit in the garden?',
    'What brand of coffee do you serve?',
    'My key card does not work',
    'Nujno potrebujem brisačo',
    'Fireplace in the lounge?',
  ])('does not fire on %j', (message) => {
    expect(rule(message)).not.toBe('emergency')
  })
})

describe('money', () => {
  it.each([
    'I want a refund',
    'voglio un rimborso',
    'Ich möchte eine Rückerstattung',
    'Želim vračilo',
    'Can I get a discount for next time?',
    'You charged me twice',
  ])('never lets %j reach T1', (message) => {
    expect(applyHardRules({ message, previousUnknown: false })).toMatchObject({
      rule: 'money',
      tier: 'T2',
    })
  })

  it.each(['How do I pay the deposit?', 'Is breakfast included in the price?'])(
    'leaves an ordinary payment question %j to the profiles',
    (message) => {
      expect(rule(message)).toBeNull()
    },
  )
})

describe('identity and legal', () => {
  it.each([
    'Is my passport valid for check-in?',
    'Sono registrato in questura?',
    'I will call my lawyer',
    'Ist das legal?',
  ])('sends %j to a person', (message) => {
    expect(rule(message)).toBe('identity')
  })
})

describe('order and the model', () => {
  it('puts an emergency above a refund in the same message', () => {
    expect(rule('There is a fire and I want a refund')).toBe('emergency')
  })

  it('lets a model add a rule the words missed', () => {
    expect(
      applyHardRules({
        message: 'the room is filling with something',
        previousUnknown: false,
        modelFlags: { emergency: true },
      })?.rule,
    ).toBe('emergency')
  })

  it('never lets a model remove one', () => {
    expect(
      applyHardRules({
        message: 'I want a refund',
        previousUnknown: false,
        modelFlags: { money: false },
      })?.rule,
    ).toBe('money')
  })
})

describe('unknown twice', () => {
  it('fires only when this turn and the last were both unknown', () => {
    expect(applyHardRules({ message: 'x', previousUnknown: true, unknownNow: true })?.rule).toBe(
      'unknown_twice',
    )
    expect(applyHardRules({ message: 'x', previousUnknown: true, unknownNow: false })).toBeNull()
    expect(applyHardRules({ message: 'x', previousUnknown: false, unknownNow: true })).toBeNull()
  })
})

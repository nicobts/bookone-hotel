import { describe, expect, it } from 'vitest'
import type { LlmProvider, LlmResponse } from '@bookone/core/llm'
import { route, routeByRules } from './route'

const stay = { hasBooking: true, previousProfile: null }

function provider(answer: Partial<LlmResponse> | Error): LlmProvider {
  return {
    name: 'fake',
    residency: {
      euProcessing: true,
      region: 'test',
      subProcessorRegisterEntry: 'SP-006',
      verifiedAt: '2026-09-27',
    },
    complete: async () => {
      if (answer instanceof Error) throw answer
      return {
        text: '',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
        model: 'fake-small',
        stopReason: 'tool_use',
        ...answer,
      }
    },
  }
}

describe('routing by rules', () => {
  it.each([
    ['I want to change the dates of my booking', 'booking-support'],
    ['Vorrei cambiare le date della mia prenotazione', 'booking-support'],
    ['How can I pay the deposit?', 'payments'],
    ['Come posso pagare la caparra?', 'payments'],
    ['We will arrive at 22:00', 'pre-arrival'],
    ['Arriveremo verso le 21', 'pre-arrival'],
    ['Can we have a late checkout?', 'checkout'],
    ['Mi serve la fattura', 'checkout'],
    ['The bathroom is dirty, this is unacceptable', 'complaints'],
    ['La camera è sporca, sono deluso', 'complaints'],
  ])('%j → %s', (message, expected) => {
    expect(routeByRules(message, stay).target).toBe(expected)
  })

  it('sends a request for a thing to the task path, as AG-01 always did', () => {
    expect(routeByRules('Could we have two more towels?', stay).target).toBe('request')
  })

  it('offers pre-sale only to a guest with no booking', () => {
    const message = 'Do you have a room for two adults in March?'
    expect(routeByRules(message, { hasBooking: false, previousProfile: null }).target).toBe(
      'pre-sale',
    )
    expect(routeByRules(message, stay).target).not.toBe('pre-sale')
  })

  it('stays with the thread profile when a turn names none', () => {
    expect(
      routeByRules('and for two adults?', { hasBooking: true, previousProfile: 'booking-support' }),
    ).toMatchObject({ target: 'booking-support', source: 'sticky', unknown: false })
  })

  it('defaults to general-info, marked unknown, when nothing matched', () => {
    expect(routeByRules('what time is breakfast?', stay)).toMatchObject({
      target: 'general-info',
      unknown: true,
      source: 'default',
    })
  })
})

describe('routing with a model', () => {
  it("takes the model's profile and flags", async () => {
    const routed = await route(
      'something about my stay',
      stay,
      provider({
        toolCalls: [
          {
            name: 'route',
            input: { profile: 'checkout', emergency: false, money: true, identity: false },
          },
        ],
      }),
    )
    expect(routed).toMatchObject({
      target: 'checkout',
      source: 'model',
      modelFlags: { money: true },
      model: 'fake-small',
    })
  })

  it('never lets the model route to a profile outside the closed list', () => {
    return route(
      'what time is breakfast?',
      stay,
      provider({ toolCalls: [{ name: 'route', input: { profile: 'owner-backoffice' } }] }),
    ).then((routed) => expect(routed.target).toBe('general-info'))
  })

  it('degrades to the rules when the model fails — the guest still gets an answer', async () => {
    const routed = await route('Can we have a late checkout?', stay, provider(new Error('timeout')))
    expect(routed).toMatchObject({ target: 'checkout', source: 'rules' })
  })
})

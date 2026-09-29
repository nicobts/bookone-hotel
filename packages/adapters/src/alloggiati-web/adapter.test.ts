import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AlloggiatiError,
  buildPayload,
  createResolver,
  loadCodeTables,
  resolveParty,
  type CodeResolver,
  type CodeTables,
  type GuestDetails,
} from '@bookone/core/alloggiati'
import { describeAlloggiatiContract } from '../alloggiati/contract'
import { AlloggiatiWebAdapter, SimulatorCredentialSource } from './adapter'
import { startAlloggiatiSimulator, type AlloggiatiSimulator } from './simulator'

/**
 * Alloggiati Web against the local simulator (WP1.2). Nothing here reaches the
 * authority: the simulator listens on 127.0.0.1, and the adapter refuses any
 * other host.
 */
const TABLES = fileURLToPath(new URL('../../../../content/alloggiati/synthetic', import.meta.url))
const CREDENTIALS = { username: 'TS000001', password: 'simulator', wsKey: 'SIMKEY' }
const STAY = { arrivalDate: '2026-10-01', departureDate: '2026-10-03' }

const italian: GuestDetails = {
  surname: 'Rossi',
  givenName: 'Maria',
  sex: 'f',
  birthDate: '1980-04-12',
  birthCountryCode: 'IT',
  citizenshipCode: 'IT',
  birthPlaceCode: 'Trieste',
  documentType: 'idCard',
  documentNumber: 'CA00000AA',
  documentIssuerCode: 'Trieste',
}
const french: GuestDetails = {
  surname: 'Dupont',
  givenName: 'Léa',
  sex: 'f',
  birthDate: '1990-07-01',
  birthCountryCode: 'FR',
  citizenshipCode: 'FR',
  documentType: 'passport',
  documentNumber: '19FR00000',
  documentIssuerCode: 'FR',
}
const japanese: GuestDetails = {
  surname: 'Tanaka',
  givenName: 'Kenji',
  sex: 'm',
  birthDate: '1975-02-20',
  birthCountryCode: 'JP',
  citizenshipCode: 'JP',
  documentType: 'passport',
  documentNumber: 'TZ0000000',
  documentIssuerCode: 'JP',
}

let tables: CodeTables
let codes: CodeResolver
let simulator: AlloggiatiSimulator

function file(party: GuestDetails[]): string {
  const resolved = resolveParty(party, STAY, codes)
  expect(resolved.issues).toEqual([])
  return buildPayload(resolved.party, STAY)
}

function adapter(options: { timeoutMs?: number } = {}) {
  return new AlloggiatiWebAdapter({
    endpoint: simulator.url,
    environment: 'simulator',
    credentials: new SimulatorCredentialSource(CREDENTIALS),
    codes,
    ...options,
  })
}

beforeAll(async () => {
  tables = await loadCodeTables(TABLES)
  codes = createResolver(tables)
  simulator = await startAlloggiatiSimulator({ tables, credentials: CREDENTIALS })
})

afterAll(async () => {
  await simulator.close()
})

beforeEach(() => {
  simulator.outage(0)
  simulator.acceptCredentials()
})

describeAlloggiatiContract('AlloggiatiWebAdapter (simulator)', () => adapter(), {
  validPayload: () => file([italian, french]),
})

describe('Alloggiati Web, on the simulator', () => {
  it('files the three fixture guests and acknowledges them at once', async () => {
    // CIE (Italian identity card), an EU passport, a non-EU passport.
    const result = await adapter().submit({
      propertyId: 'p1',
      reservationId: 'r1',
      payload: file([italian, french, japanese]),
      guestCount: 3,
    })
    expect(result.reference).toMatch(/^AW-\d{8}-[0-9a-f]{12}$/)
    expect(result.receipt).toMatchObject({ lines: 3, simulated: true, environment: 'simulator' })
    // The receipt outlives the payload, so it names nobody.
    expect(JSON.stringify(result.receipt)).not.toMatch(/ROSSI|DUPONT|TANAKA/)

    const day = new Date().toISOString().slice(0, 10)
    expect(simulator.filed(CREDENTIALS.username, day).length).toBeGreaterThanOrEqual(3)
  })

  it('refuses a line the registry would refuse, naming the guest and the field, and files none of the party', async () => {
    const lines = file([italian, french]).split('\r\n')
    // A citizenship code no table has: what a hand-edited file would carry.
    const bad = lines[1]!.replace('SYN100002', 'SYN999999')
    const before = simulator.filed(CREDENTIALS.username, new Date().toISOString().slice(0, 10))

    const error = await adapter()
      .submit({
        propertyId: 'p1',
        reservationId: 'r2',
        payload: [lines[0], bad].join('\r\n'),
        guestCount: 2,
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AlloggiatiError)
    expect(error).toMatchObject({ code: 'rejected', retryable: false })
    expect((error as Error).message).toMatch(/Guest 2: .*SYN999999/)
    expect(simulator.filed(CREDENTIALS.username, new Date().toISOString().slice(0, 10))).toEqual(
      before,
    )
  })

  it('reports an outage as worth retrying', async () => {
    simulator.outage(1)
    await expect(
      adapter().submit({
        propertyId: 'p1',
        reservationId: 'r3',
        payload: file([french]),
        guestCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('reports refused credentials as not worth retrying', async () => {
    simulator.refuseCredentials()
    await expect(
      adapter().submit({
        propertyId: 'p2',
        reservationId: 'r4',
        payload: file([french]),
        guestCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized', retryable: false })
  })

  it('never retries a send that timed out: it may have been filed', async () => {
    let calls = 0
    const hanging = new AlloggiatiWebAdapter({
      endpoint: simulator.url,
      environment: 'simulator',
      credentials: new SimulatorCredentialSource(CREDENTIALS),
      codes,
      timeoutMs: 200,
      // Token and Test answer; Send never does.
      fetch: async (url, init) => {
        calls += 1
        if (String(init?.body).includes('<Send ')) {
          await new Promise((_resolve, reject) =>
            (init!.signal as AbortSignal).addEventListener('abort', () =>
              reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
            ),
          )
        }
        return fetch(url, init)
      },
    })

    await expect(
      hanging.submit({
        propertyId: 'p3',
        reservationId: 'r5',
        payload: file([french]),
        guestCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'unavailable', retryable: false })
    expect(calls).toBe(3)
  })

  it('tells whether the service holds a receipt for a day', async () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(await adapter().dailyReceipt({ propertyId: 'p1', day: today })).toEqual({
      available: true,
    })
    expect(await adapter().dailyReceipt({ propertyId: 'p1', day: '2020-01-01' })).toEqual({
      available: false,
    })
  })

  it('refuses to point anywhere but this machine', () => {
    expect(
      () =>
        new AlloggiatiWebAdapter({
          endpoint: 'https://alloggiatiweb.poliziadistato.it/service/service.asmx',
          environment: 'simulator',
          credentials: new SimulatorCredentialSource(CREDENTIALS),
          codes,
        }),
    ).toThrow(/must be local/)
  })
})

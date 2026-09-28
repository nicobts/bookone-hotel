import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createAlloggiatiAdapter } from './alloggiati'

/** Which Alloggiati channel the worker files through (WP1.2). Both are simulated. */
const TABLES = fileURLToPath(new URL('../../../content/alloggiati/synthetic', import.meta.url))
const SIMULATOR = {
  ALLOGGIATI_SIMULATOR_USERNAME: 'TS000001',
  ALLOGGIATI_SIMULATOR_PASSWORD: 'simulator',
  ALLOGGIATI_SIMULATOR_WSKEY: 'SIMKEY',
}

describe('the Alloggiati channel', () => {
  it('is the mock unless told otherwise', async () => {
    const adapter = await createAlloggiatiAdapter({ ALLOGGIATI_CHANNEL: 'mock', ...SIMULATOR })
    expect(adapter).toMatchObject({ channel: 'mock', simulated: true })
    expect(adapter.codes).toBeUndefined()
  })

  it('is the Alloggiati Web adapter on the local simulator, with the code tables', async () => {
    const adapter = await createAlloggiatiAdapter({
      ALLOGGIATI_CHANNEL: 'simulator',
      ALLOGGIATI_ENDPOINT: 'http://127.0.0.1:54480/service/service.asmx',
      ALLOGGIATI_TABLES_DIR: TABLES,
      ...SIMULATOR,
    })
    expect(adapter).toMatchObject({ channel: 'alloggiati-web', simulated: true })
    expect(adapter.codes?.source).toBe('synthetic')
  })

  it('refuses the simulator without an endpoint and tables', async () => {
    await expect(
      createAlloggiatiAdapter({ ALLOGGIATI_CHANNEL: 'simulator', ...SIMULATOR }),
    ).rejects.toThrow(/needs ALLOGGIATI_ENDPOINT and ALLOGGIATI_TABLES_DIR/)
  })

  it('refuses any host but this machine', async () => {
    await expect(
      createAlloggiatiAdapter({
        ALLOGGIATI_CHANNEL: 'simulator',
        ALLOGGIATI_ENDPOINT: 'https://alloggiatiweb.poliziadistato.it/service/service.asmx',
        ALLOGGIATI_TABLES_DIR: TABLES,
        ...SIMULATOR,
      }),
    ).rejects.toThrow(/must be local/)
  })
})

import { MockAlloggiatiAdapter } from '@bookone/adapters/mock-alloggiati'
import { AlloggiatiWebAdapter, SimulatorCredentialSource } from '@bookone/adapters/alloggiati-web'
import { createResolver, loadCodeTables, type AlloggiatiAdapter } from '@bookone/core/alloggiati'
import type { Env } from './env'

/**
 * The Alloggiati channel this worker files through (WP1.2).
 *
 * Both choices are simulated, and the production guard in `index.ts` refuses
 * to boot on either: nothing here files with the Questura.
 */
export async function createAlloggiatiAdapter(
  env: Pick<
    Env,
    | 'ALLOGGIATI_CHANNEL'
    | 'ALLOGGIATI_ENDPOINT'
    | 'ALLOGGIATI_TABLES_DIR'
    | 'ALLOGGIATI_SIMULATOR_USERNAME'
    | 'ALLOGGIATI_SIMULATOR_PASSWORD'
    | 'ALLOGGIATI_SIMULATOR_WSKEY'
  >,
): Promise<AlloggiatiAdapter> {
  if (env.ALLOGGIATI_CHANNEL === 'mock') return new MockAlloggiatiAdapter()

  if (!env.ALLOGGIATI_ENDPOINT || !env.ALLOGGIATI_TABLES_DIR) {
    throw new Error(
      'ALLOGGIATI_CHANNEL=simulator needs ALLOGGIATI_ENDPOINT and ALLOGGIATI_TABLES_DIR',
    )
  }
  return new AlloggiatiWebAdapter({
    endpoint: env.ALLOGGIATI_ENDPOINT,
    environment: 'simulator',
    credentials: new SimulatorCredentialSource({
      username: env.ALLOGGIATI_SIMULATOR_USERNAME,
      password: env.ALLOGGIATI_SIMULATOR_PASSWORD,
      wsKey: env.ALLOGGIATI_SIMULATOR_WSKEY,
    }),
    codes: createResolver(await loadCodeTables(env.ALLOGGIATI_TABLES_DIR)),
  })
}

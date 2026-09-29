/**
 * The Alloggiati Web simulator, for local development (WP1.2).
 *
 *   pnpm alloggiati:simulator            # on 127.0.0.1:54480
 *
 * Then point the worker at it:
 *
 *   ALLOGGIATI_CHANNEL=simulator
 *   ALLOGGIATI_ENDPOINT=http://127.0.0.1:54480/service/service.asmx
 *   ALLOGGIATI_TABLES_DIR=content/alloggiati/synthetic
 *
 * Files nothing and talks to nobody: it listens on the loopback interface and
 * checks each line against the synthetic code tables. Type `down 3` to make
 * the next three calls fail (the outage drill), `refuse` / `accept` to toggle
 * the credentials, `quit` to stop.
 */
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { startAlloggiatiSimulator } from '../packages/adapters/src/alloggiati-web/simulator'
import { loadCodeTables } from '../packages/core/src/alloggiati/codes'

const tablesDir =
  process.env.ALLOGGIATI_TABLES_DIR ??
  fileURLToPath(new URL('../content/alloggiati/synthetic', import.meta.url))
const tables = await loadCodeTables(tablesDir)

const simulator = await startAlloggiatiSimulator({
  tables,
  port: Number(process.env.ALLOGGIATI_SIMULATOR_PORT ?? 54480),
  credentials: {
    username: process.env.ALLOGGIATI_SIMULATOR_USERNAME ?? 'TS000001',
    password: process.env.ALLOGGIATI_SIMULATOR_PASSWORD ?? 'simulator',
    wsKey: process.env.ALLOGGIATI_SIMULATOR_WSKEY ?? 'SIMKEY',
  },
})

console.log(`Alloggiati Web simulator on ${simulator.url} (${tables.source} tables)`)
console.log('Commands: down <n> · refuse · accept · quit')

const input = createInterface({ input: process.stdin })
input.on('line', async (line) => {
  const [command, argument] = line.trim().split(/\s+/)
  if (command === 'down') {
    simulator.outage(Number(argument ?? 1))
    console.log(`the next ${argument ?? 1} calls answer 503`)
  } else if (command === 'refuse') {
    simulator.refuseCredentials()
    console.log('credentials refused')
  } else if (command === 'accept') {
    simulator.acceptCredentials()
    console.log('credentials accepted')
  } else if (command === 'quit') {
    await simulator.close()
    process.exit(0)
  }
})

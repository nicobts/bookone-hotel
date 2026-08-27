# BookOne Rooms — Allegato tecnico

**Architettura hardware-agnostica e modello dei connettori**

| | |
|---|---|
| A cura di | RT Holding Group GmbH (Austria) |
| Documento principale | BookOne Rooms — Definizione di progetto |
| Destinatari | Direzione tecnica, valutazione fornitori |
| Stato | Bozza di lavoro |
| Data | Luglio 2026 |

---

## 1. Principio architetturale

Il sistema è costruito attorno a un **modello di dominio canonico** che descrive accessi, presenza e ambiente in termini indipendenti da qualunque produttore. Nessun componente applicativo conosce Salto, ASSA ABLOY o Dormakaba: conosce il concetto di *diritto di accesso*, *credenziale* ed *evento porta*.

L'adattamento al mondo reale avviene esclusivamente in uno strato periferico di **connettori dedicati per produttore o modello**, che traducono le API proprietarie nel modello canonico e viceversa.

```
        ┌─────────────────────────────────────────────┐
        │           Logica applicativa                │
        │  arrivo · pulizie · clima · notifiche       │
        │        (non conosce alcun produttore)       │
        └──────────────────┬──────────────────────────┘
                           │  modello canonico
        ┌──────────────────┴──────────────────────────┐
        │        Strato di astrazione (porte)          │
        │   LockAdapter · DeviceAdapter · PmsAdapter   │
        └───┬──────────┬──────────┬──────────┬─────────┘
            │          │          │          │
        ┌───┴───┐  ┌───┴───┐  ┌───┴───┐  ┌───┴────┐
        │ Salto │  │ ASSA  │  │ Dorma │  │ altri  │
        │       │  │ ABLOY │  │ kaba  │  │        │
        └───────┘  └───────┘  └───────┘  └────────┘
              connettori — l'unica parte che cambia
```

**Conseguenza pratica:** cambiare produttore di serrature, o gestire strutture diverse con sistemi diversi, comporta la scrittura di un nuovo connettore. Non comporta alcuna modifica alla logica di prodotto, al cruscotto o alla base dati.

---

## 2. Perché serve un livello di capacità

Il punto delicato dell'astrazione non è tradurre le API: è che **i produttori non offrono le stesse funzionalità**. Alcuni sistemi non emettono codici numerici, altri non notificano gli eventi porta in tempo reale ma richiedono interrogazione periodica, altri ancora sono offline e scrivono i diritti sulla tessera.

Un'astrazione che ignorasse queste differenze produrrebbe un sistema che promette funzioni non erogabili. Ogni connettore dichiara quindi esplicitamente le proprie capacità, e la logica applicativa si adatta di conseguenza.

```ts
interface LockCapabilities {
  mobileKey: boolean          // credenziale su smartphone (BLE / NFC)
  pinCode: boolean            // codice numerico su tastierino
  physicalCard: boolean       // tessera
  realtimeDoorEvents: boolean // notifica push vs interrogazione periodica
  remoteRevoke: boolean       // revoca immediata a distanza
  offlineDataOnCard: boolean  // sistema offline, diritti scritti su tessera
  batteryReporting: boolean   // stato batteria serratura
  maxPinLength: number
  eventLatencySeconds: number // latenza attesa dell'evento porta
}
```

**Degradazione controllata.** Se `pinCode` è `false`, l'interfaccia non offre il codice numerico e il completamento arrivo passa dagli altri metodi. Se `realtimeDoorEvents` è `false`, il sistema attiva l'interrogazione periodica e la funzione di completamento automatico dell'arrivo viene dichiarata con la latenza reale, non con quella ideale. Se `offlineDataOnCard` è `true`, la chiave digitale non è offerta affatto.

Il comportamento del prodotto è quindi sempre coerente con ciò che l'impianto può realmente fare — e la differenza è visibile in fase di analisi preliminare, non a installazione avvenuta.

---

## 3. Modello di dominio canonico

### 3.1 Entità di accesso

```ts
// Il diritto di accesso: concetto astratto, indipendente dal metodo
interface AccessGrant {
  id: string
  propertyId: string
  reservationId: string
  roomId: string
  validFrom: Date
  validUntil: Date
  requestedMethods: AccessMethod[]  // ciò che si desidera
  issuedCredentials: Credential[]   // ciò che il sistema ha potuto emettere
  status: 'pending' | 'active' | 'revoked' | 'expired'
}

type AccessMethod = 'mobile' | 'pin' | 'card'

interface Credential {
  method: AccessMethod
  externalRef: string        // identificativo nel sistema del produttore
  secretRef?: string         // riferimento cifrato, mai il valore in chiaro
  issuedAt: Date
  revokedAt?: Date
}

interface DoorEvent {
  propertyId: string
  roomId: string
  occurredAt: Date
  method: AccessMethod | 'master' | 'mechanical' | 'unknown'
  credentialRef?: string
  outcome: 'granted' | 'denied' | 'error'
  source: 'webhook' | 'poll'   // provenienza, per valutare l'affidabilità
}
```

**Nota sul campo `method` degli eventi porta.** È la discriminante che consente di ignorare le aperture con chiave di servizio ai fini del completamento dell'arrivo (sezione 4.4 del documento principale). I produttori codificano questa informazione in modo diverso: la normalizzazione avviene nel connettore.

### 3.2 Telemetria ambientale

```ts
interface Measurement {
  propertyId: string
  roomId: string
  deviceId: string
  metric: 'presence' | 'temperature' | 'humidity' | 'setpoint'
        | 'window' | 'leak' | 'energy' | 'battery' | 'rssi'
  value: number | boolean
  unit?: string
  observedAt: Date
  quality: 'ok' | 'stale' | 'estimated'
}
```

Un'unica struttura per tutti i sensori, di qualunque produttore e protocollo. La differenza tra un sensore Zigbee e un fan-coil interrogato via Modbus si esaurisce nel gateway.

---

## 4. Interfacce dei connettori

### 4.1 Serrature

```ts
interface LockAdapter {
  readonly vendor: string
  readonly capabilities: LockCapabilities

  issueGrant(grant: AccessGrant): Promise<IssuedCredentials>
  revokeGrant(grantId: string): Promise<void>
  extendGrant(grantId: string, until: Date): Promise<void>

  // per produttori con notifica push
  onDoorEvent?(handler: (e: DoorEvent) => void): void

  // per produttori senza notifica push
  fetchDoorEvents?(since: Date): Promise<DoorEvent[]>

  listDevices(): Promise<LockDevice[]>
  healthCheck(): Promise<AdapterHealth>
}
```

Il connettore espone **almeno uno** tra `onDoorEvent` e `fetchDoorEvents`. Lo strato superiore non distingue: riceve eventi da un flusso unico, già normalizzato e deduplicato.

### 4.2 Dispositivi e sensori

```ts
interface DeviceAdapter {
  readonly protocol: 'zigbee' | 'modbus' | 'thread' | 'http'
  readonly capabilities: DeviceCapabilities

  subscribe(handler: (m: Measurement) => void): void
  setSetpoint(roomId: string, celsius: number): Promise<void>
  listDevices(): Promise<Device[]>
  healthCheck(): Promise<AdapterHealth>
}
```

### 4.3 Gestionale

Interfaccia già definita nel progetto BookOne Concierge, riutilizzata senza modifiche:

```ts
interface PmsAdapter {
  getReservation(q: ReservationQuery): Promise<Reservation | null>
  getRoomAssignment(reservationId: string): Promise<RoomAssignment | null>
  postCheckIn(reservationId: string, at: Date): Promise<void>
  healthCheck(): Promise<AdapterHealth>
}
```

**Punto rilevante:** il connettore Ericsoft è condiviso tra il concierge telefonico e il progetto camere. Viene scritto una volta sola.

---

## 5. Schema di messaggistica

Tutti i dispositivi convergono su una struttura di argomenti MQTT uniforme, indipendente dal protocollo di origine.

```
bookone/{propertyId}/telemetry/{roomId}/{metric}     ← dal gateway
bookone/{propertyId}/command/{roomId}/{action}       → verso il gateway
bookone/{propertyId}/lock/{roomId}/event             ← eventi porta
bookone/{propertyId}/gateway/status                  ← stato di salute
```

Il gateway di struttura è responsabile della traduzione: parla Zigbee, Modbus o HTTP verso i dispositivi, e pubblica esclusivamente nel formato canonico verso la piattaforma. È inoltre il punto in cui avviene la bufferizzazione locale in caso di assenza di connettività.

---

## 6. Motore delle automazioni

Le automazioni sono definite come regole sul flusso di eventi, senza alcun riferimento a produttori o modelli:

| Evento | Condizioni | Azione |
|---|---|---|
| `DoorEvent(method ≠ master)` | prenotazione con arrivo predisposto | completamento arrivo, check-in a gestionale, invio Alloggiati |
| `Presence(false)` per N minuti | camera occupata | clima in regime ridotto |
| `Presence(true)` | camera occupata | clima in comfort |
| `Reservation.checkout` | — | clima in regime profondo, revoca credenziali, camera da pulire |
| `Reservation.assigned` + T-4h | check-in online completato | emissione credenziali |
| `Leak(true)` | — | notifica immediata al personale, priorità alta |
| `Window(open)` + `Setpoint attivo` | — | sospensione climatizzazione, segnalazione |

Le regole sono configurabili per struttura. L'aggiunta di una nuova automazione non richiede modifiche ai connettori.

---

## 7. Stack tecnologico

| Livello | Tecnologia | Motivazione |
|---|---|---|
| Cruscotto | Next.js, shadcn/ui, Tailwind, next-intl | Coerente con lo stack già in uso |
| Servizi applicativi | Fastify + TypeScript, processo persistente | Tipi condivisi con il frontend; non serverless, per via delle connessioni persistenti |
| Base dati | PostgreSQL (regione UE) + Drizzle | Partizionamento mensile per la telemetria |
| Serie temporali | Partizionamento nativo, TimescaleDB solo se necessario | A 60 camere il volume non giustifica un archivio dedicato |
| Coda e cache | Redis + BullMQ | Interrogazioni periodiche, ritentativi, notifiche |
| Messaggistica | HiveMQ Cloud (UE) o EMQX | Broker MQTT con residenza dati UE |
| Gateway | Unità dedicata per struttura, runtime containerizzato | Bufferizzazione locale, aggiornamento remoto |
| Osservabilità | Log strutturati + metriche per connettore | Stato di salute per produttore, non aggregato |

Lo stack è deliberatamente identico a quello del concierge telefonico: **un solo linguaggio, una sola base dati, un solo modello di deployment.**

---

## 8. Costo di un nuovo connettore

| Voce | Stima |
|---|---|
| Autorizzazione e accesso all'ambiente di prova del produttore | 2–5 mesi (tempo di attesa, non di lavoro) |
| Sviluppo e normalizzazione | 3–6 settimane |
| Test di conformità e collaudo su impianto reale | 1–2 settimane |
| **Costo indicativo** | **€25.000 – €60.000** |
| **Manutenzione annua** | **€8.000 – €15.000 per connettore** |

**La manutenzione è la voce che va tenuta presente.** Le API dei produttori cambiano, i campi vengono deprecati, le credenziali ruotano. Con sei connettori attivi si tratta di €50.000–90.000 all'anno di attività che non produce nuove funzionalità.

Ne deriva una regola operativa: **nessun connettore viene sviluppato in via speculativa.** Si sviluppa quando esistono strutture che lo richiedono, non in previsione di una domanda ipotetica.

---

## 9. Suite di conformità

Ogni connettore, prima di essere considerato utilizzabile in produzione, deve superare la medesima batteria di test:

- Emissione di credenziale per ciascun metodo dichiarato nelle capacità
- Revoca e verifica dell'effettiva inefficacia della credenziale
- Corretta classificazione di un evento porta con chiave di servizio
- Comportamento in caso di indisponibilità delle API del produttore
- Deduplicazione degli eventi in modalità interrogazione periodica
- Coerenza dei fusi orari e degli orari di validità
- Gestione della scadenza naturale del diritto di accesso

La suite è unica e indipendente dal produttore. È ciò che rende il costo del secondo connettore prevedibile, e ciò che impedisce che ogni nuova integrazione introduca comportamenti diversi.

---

## 10. Sintesi

L'impostazione risponde direttamente all'osservazione da cui nasce questo allegato: **l'unica parte che cambia al variare della serratura è il connettore.**

Il modello di dominio, la logica di arrivo, le automazioni, il cruscotto, la base dati e la reportistica restano invariati. Un nuovo produttore comporta un'attività circoscritta, quantificabile in anticipo e verificabile con una suite di test già esistente.

Questa è anche la ragione per cui il progetto ha valore oltre la singola struttura: **lo strato di integrazione tra sistemi alberghieri e dispositivi è l'asset che si accumula nel tempo**, mentre le singole funzionalità sono replicabili.

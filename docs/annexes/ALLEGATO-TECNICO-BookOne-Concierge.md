# BookOne Concierge — Allegato tecnico

**Architettura agnostica rispetto al fornitore e modello dei connettori**

| | |
|---|---|
| A cura di | RT Holding Group GmbH (Austria) |
| Documento principale | PRD — BookOne Concierge (sezione 9) |
| Documento parallelo | BookOne Rooms — Allegato tecnico |
| Destinatari | Direzione tecnica, valutazione fornitori |
| Stato | Bozza di lavoro |
| Data | Luglio 2026 |

---

## 1. Principio architetturale

Il sistema segue la stessa impostazione dell'allegato BookOne Rooms: **un modello di dominio canonico al centro, fornitori confinati in uno strato periferico di connettori.**

La differenza è che qui i fornitori da isolare sono tre, non uno:

| Strato | Cosa cambia | Perché isolarlo |
|---|---|---|
| **Motore vocale** | ElevenLabs, LiveKit, Vapi, Pipecat | Il settore è cambiato due volte in quattro mesi. Va presupposta la sostituzione |
| **Modello linguistico** | Gemini Live, GPT Realtime, catena STT+LLM+TTS | Disponibilità in UE, prezzo e qualità dialettale variano nel tempo |
| **Telefonia** | Twilio, Telnyx | Costi di terminazione UE e affidabilità del trasferimento |

```
        ┌─────────────────────────────────────────────┐
        │           Logica applicativa                │
        │  conoscenza · strumenti · escalation ·      │
        │  ticket · reportistica                      │
        │        (non conosce alcun fornitore)        │
        └──────────────────┬──────────────────────────┘
                           │  modello canonico
        ┌──────────────────┴──────────────────────────┐
        │        Strato di astrazione (porte)          │
        │  VoiceRuntime · PmsAdapter · TelephonyAdapter│
        └───┬──────────┬──────────┬──────────┬─────────┘
            │          │          │          │
        ┌───┴────┐ ┌───┴────┐ ┌───┴────┐ ┌───┴────┐
        │Eleven  │ │LiveKit │ │Ericsoft│ │ Twilio │
        │Labs    │ │        │ │        │ │        │
        └────────┘ └────────┘ └────────┘ └────────┘
              connettori — l'unica parte che cambia
```

**Il connettore Ericsoft è condiviso con il progetto camere.** È scritto una volta sola e serve entrambi i prodotti: è la ragione concreta per cui i due progetti condividono lo stesso modello canonico.

---

## 2. Il vincolo che determina l'architettura

**Next.js non può ospitare il motore vocale.** La semantica richiesta/risposta di un ambiente serverless è incompatibile con un flusso audio bidirezionale persistente della durata di una telefonata.

Il sistema è quindi composto da **due deployment distinti che condividono una sola base dati**:

| Deployment | Contenuto | Esecuzione |
|---|---|---|
| Cruscotto | Next.js — registro chiamate, editor conoscenza, configurazione, report | Serverless, regione UE |
| Servizi applicativi | Fastify — webhook strumenti, connettori, code, notifiche | **Processo persistente, mai serverless** |

I servizi applicativi non possono essere serverless perché la cache disponibilità, l'interrogazione periodica del gestionale e le code di notifica richiedono stato persistente e connessioni già stabilite.

---

## 3. Perché TypeScript sul backend

L'ecosistema dell'AI vocale è prevalentemente Python, il che normalmente indicherebbe Python. Qui non vale, per una ragione precisa: **nella fase iniziale il motore vocale è gestito dal fornitore.** ElevenLabs esegue il ciclo audio nei propri processi e richiama i nostri strumenti via HTTPS. Il nostro backend gestisce quindi soltanto webhook richiesta/risposta e attività in background.

Ne consegue: un solo linguaggio, tipi condivisi tra cruscotto e servizi, nessuna necessità di Python fino all'eventuale internalizzazione del motore vocale — momento in cui potrà essere un servizio separato, senza toccare il resto.

---

## 4. Astrazione del motore vocale

```ts
interface VoiceRuntime {
  readonly provider: string
  readonly capabilities: VoiceCapabilities

  createAgent(config: PropertyAgentConfig): Promise<AgentHandle>
  updateAgent(id: string, config: Partial<PropertyAgentConfig>): Promise<void>
  deleteAgent(id: string): Promise<void>

  onToolCall(handler: ToolCallHandler): void
  onCallStarted(handler: CallStartedHandler): void
  onCallEnded(handler: CallEndedHandler): void

  healthCheck(): Promise<AdapterHealth>
}
```

Come per le serrature, il connettore dichiara le proprie capacità, perché i fornitori non offrono le stesse funzioni:

```ts
interface VoiceCapabilities {
  speechToSpeech: boolean       // audio→audio diretto
  cascaded: boolean             // STT + LLM + TTS separati
  euDataResidency: boolean      // residenza dati UE disponibile
  zeroRetention: boolean        // nessuna conservazione lato fornitore
  languages: string[]
  supportsBargeIn: boolean      // interruzione da parte del chiamante
  supportsWarmTransfer: boolean // trasferimento con presentazione
  transcriptInRealtime: boolean // trascrizione durante la chiamata
  medianFirstAudioMs: number
}
```

**Degradazione controllata.** Se `euDataResidency` è falso il fornitore non è utilizzabile in produzione, indipendentemente dalla qualità. Se `supportsWarmTransfer` è falso il trasferimento avviene senza presentazione e l'ospite ripete la richiesta all'operatore. Se `transcriptInRealtime` è falso, la verifica automatica sui limiti degli strumenti (sezione 6) avviene solo a fine chiamata anziché durante.

---

## 5. Cascata o audio diretto: decisione condizionata

Sono due architetture alternative per la conversazione:

**Cascata** — quattro stadi separati, con testo tra l'uno e l'altro:
```
audio → STT → [TESTO] → LLM → [TESTO] → TTS → audio
```

**Audio diretto (speech-to-speech)** — un unico modello:
```
audio → [modello] → audio
```

| | Cascata | Audio diretto |
|---|---|---|
| Latenza | Superiore (~900–1200 ms) | Inferiore (~500–800 ms) |
| Naturalezza dei turni | Buona | Migliore |
| Controllo prima del parlato | **Possibile** — il testo esiste prima di essere pronunciato | Non possibile |
| Residenza UE | Ogni componente ha il proprio endpoint UE, sostituibile singolarmente | Vincolata alla disponibilità UE di un solo fornitore |
| Costo al minuto | Superiore | Inferiore |

**La residenza dei dati in UE è un requisito non negoziabile del progetto, e questo condiziona la scelta.** Con la cascata si punta ciascun componente al proprio endpoint europeo in modo indipendente e se ne sostituisce uno senza toccare gli altri. Con l'audio diretto si dipende dalla disponibilità europea di un singolo modello di un singolo fornitore — e i modelli più recenti raggiungono gli endpoint UE con ritardo rispetto alla disponibilità generale.

**Impostazione adottata:** l'astrazione supporta entrambe. La scelta viene fatta a valle della prova comparativa (sezione 10), con la residenza UE come filtro preliminare e non come criterio secondario. Si valuta cioè soltanto ciò che è effettivamente installabile in Europa oggi.

---

## 6. Limiti rigidi sugli strumenti

È il punto di maggiore rilevanza commerciale dell'intera architettura.

**Il rischio.** Il modello genera una frase plausibile — *"sì, abbiamo una matrimoniale superior a 180 euro con colazione"* — senza avere interrogato il gestionale. L'ospite ritiene di avere un prezzo. La struttura deve onorarlo o iniziare il rapporto con una discussione. Non è un difetto tecnico: è una responsabilità commerciale.

**Le tre regole.**

**1. I fatti provengono esclusivamente dagli strumenti.** Il prompt di sistema vieta esplicitamente di enunciare prezzi, date, disponibilità o dettagli di prenotazione non ottenuti da una chiamata a strumento nella conversazione in corso. In assenza del dato, le uniche risposte ammesse sono l'interrogazione dello strumento o l'escalation.

**2. Gli strumenti restituiscono frasi, non solo dati.** La superficie di generazione va ristretta il più possibile:

```ts
// da evitare — il modello deve comporre la frase
{ available: true, rate: 180, roomType: "superior_double" }

// corretto — il modello riferisce una frase già formata
{
  available: true,
  phrase: "Sì, per venerdì abbiamo disponibilità.
           Le faccio richiamare dal ricevimento per la tariffa.",
  data: { /* per il registro, non per la generazione */ }
}
```

**3. Verifica continua sul registro.** Ogni chiamata è comunque trascritta. Un controllo automatico segnala qualunque turno che citi un prezzo o una disponibilità senza una precedente chiamata a strumento. È una metrica monitorata con soglia, non una verifica una tantum.

**Se la verifica dovesse attivarsi in produzione**, il percorso transazionale viene riportato su architettura a cascata, dove il vincolo è imponibile in modo meccanico anziché disciplinare.

---

## 7. Contratti degli strumenti

```ts
get_availability(dateFrom, dateTo, guests, roomType?)
  → { available: boolean, phrase: string, data: {...} }

get_reservation(surname, arrivalDate)
  → { found: boolean, phrase: string, data?: {...} }

get_property_info(topic)
  → { phrase: string }

create_callback_ticket(intent, contact, language, notes)
  → { ticketId: string, phrase: string }

transfer_to_human(reason, summary)
  → { transferred: boolean, phrase: string }
```

Superficie deliberatamente ridotta. Ogni strumento restituisce `phrase`: è ciò che il modello riferisce.

**Nella prima versione tutti gli strumenti sono in sola lettura.** Nessuna prenotazione, nessun addebito, nessuna cancellazione. La capacità transazionale introduce una classe di responsabilità che richiede volumi e coperture assicurative non ancora presenti.

---

## 8. Bilancio della latenza

| Stadio | Obiettivo |
|---|---|
| Rete e telefonia | 50–100 ms |
| Rilevazione fine turno (VAD) | 150–300 ms ← **la leva maggiore** |
| Primo token del modello | 200–400 ms |
| Primo audio sintetizzato | 75–150 ms |
| Buffer di riproduzione | 50–100 ms |
| **Totale** | **< 1000 ms** |

Sotto il secondo la conversazione risulta attenta; oltre i due secondi il chiamante si sovrappone o ritiene caduta la linea.

**Tre accorgimenti che incidono più della scelta del modello:**

- **Taratura della fine turno.** I valori predefiniti sono impostati per la dettatura, non per la conversazione. Vale da solo circa 200 ms.
- **Frase di attesa anticipata.** All'attivazione di uno strumento si pronuncia immediatamente *"verifico subito"*. Recupera circa 1,5 secondi di budget reale e suona naturale.
- **Precaricamento allo squillo.** L'identificativo del chiamante attiva la ricerca dell'ospite e della prenotazione **prima** della risposta. Questa interrogazione non deve mai avvenire durante la conversazione.

**La cache disponibilità è aggiornata in background ogni 2–5 minuti.** Non viene mai interrogato il gestionale in tempo reale durante una chiamata: è la causa più frequente di sistemi che sembrano guasti.

---

## 9. Motore di escalation

Il punto in cui questi sistemi falliscono più spesso in esercizio.

**Condizioni di trasferimento**

| Condizione | Valutata da |
|---|---|
| Richiesta esplicita di un operatore | Modello |
| Due turni consecutivi a bassa confidenza | Sistema |
| Intento transazionale (prenotare, annullare, addebitare) | Modello |
| Frustrazione rilevata | Modello |
| **Parole chiave di emergenza** | **Classificatore deterministico, in parallelo** |

**L'ultima riga è architetturalmente diversa dalle altre.** Incendio, ambulanza, ospite chiuso fuori alle due di notte: il riconoscimento avviene tramite un classificatore che opera in parallelo al modello e ne prescinde. Interrompe la conversazione indipendentemente da ciò che il modello sta elaborando. **Una decisione di questo tipo non viene mai delegata a un modello linguistico.**

**Comportamento**

- **Operatore disponibile** → trasferimento con presentazione (SIP REFER), con sintesi di una riga sussurrata all'operatore prima di collegare l'ospite
- **Nessun operatore disponibile** → ticket di richiamo strutturato, conferma all'ospite via SMS o WhatsApp, notifica prioritaria al personale

**Il secondo percorso va progettato con la stessa cura del primo.** Per un servizio attivo fuori orario è il caso più frequente, non l'eccezione.

---

## 10. Stack tecnologico

| Livello | Tecnologia | Motivazione |
|---|---|---|
| Cruscotto | Next.js, shadcn/ui, Tailwind, next-intl | Coerente con lo stack in uso |
| Servizi applicativi | Fastify + TypeScript, processo persistente | Tipi condivisi; mai serverless |
| Motore vocale | ElevenLabs Agents → eventuale LiveKit internalizzato | Avvio rapido, poi controllo su margine e latenza |
| Telefonia | Twilio Elastic SIP (valutare Telnyx per costi UE) | Numerazioni locali IT/AT/SI, trasferimento SIP REFER |
| Modello | Da definire con prova comparativa, filtro residenza UE | Vedi sezione 5 |
| Base dati | PostgreSQL (regione UE) + Drizzle | Strutture, conoscenza, chiamate, ticket |
| Coda e cache | Redis + BullMQ | Cache disponibilità, sincronizzazioni, notifiche |
| Archiviazione audio | Object storage compatibile S3, regione UE | Conservazione a scadenza |
| Osservabilità | Langfuse (UE) + log strutturati | Tracce chiamata, costo modello, latenza per stadio |

**Identico allo stack del progetto camere.** Un solo linguaggio, una sola base dati, un solo modello di deployment, connettori condivisi.

---

## 11. Base di conoscenza: perché non serve RAG

La conoscenza di una struttura ammonta a 100–300 informazioni: orari colazione, parcheggio, animali ammessi, orari check-in, spa, navetta, politiche di cancellazione, wifi.

**Rientra interamente nel contesto del modello.** Un sistema di recupero documentale aggiungerebbe 100–300 ms di latenza e una modalità di guasto ulteriore, senza alcun beneficio a questa dimensione.

Struttura adottata: file YAML versionato per struttura, con editor utilizzabile direttamente dall'albergo. È anche un elemento di fidelizzazione: una base di conoscenza curata dal cliente è una base che non desidera ricostruire altrove.

Il recupero documentale è previsto solo per la conoscenza del territorio — ristoranti, impianti, trasporti — che è effettivamente estesa e mutevole. **Con corpus curato, mai con ricerca web libera:** un concierge che inventa gli orari di un ristorante è peggio di uno che offre un richiamo.

---

## 12. Multi-struttura

Ogni entità è vincolata a `propertyId`. Per ciascuna struttura sono configurabili in modo indipendente: voce, insieme di lingue, base di conoscenza, orari e regole di inoltro, credenziali del gestionale, instradamento delle escalation, politica di conservazione.

**L'onboarding di una nuova struttura non comporta alcuna modifica al codice.** È il criterio di verifica del passaggio alla fase di commercializzazione.

---

## 13. Registro chiamate e conformità

Ogni chiamata produce un registro completo: trascrizione, audio, chiamate a strumento effettuate, latenza per stadio, motivo di escalation, esito, marca temporale della dichiarazione di sistema automatico.

Questo registro assolve contemporaneamente tre funzioni:

1. **Conformità** — tracciabilità ai fini del regolamento europeo sull'intelligenza artificiale e della normativa sui dati personali
2. **Verifica dei limiti sugli strumenti** — controllo automatico descritto alla sezione 6
3. **Reportistica economica** — il rapporto mensile per la struttura deriva interamente da qui

**Criterio adottato:** se un indicatore non è calcolabile dal registro chiamate, non è un indicatore. Nessuna strumentazione parallela.

---

## 14. Economia al minuto

Ordini di grandezza indicativi:

| Voce | Costo al minuto |
|---|---|
| Riconoscimento vocale | ~€0,005 |
| Modello linguistico | ~€0,010 |
| **Sintesi vocale** | **€0,045 – €0,090** |
| Telefonia | ~€0,015 |
| **Totale** | **€0,11 – €0,14** |

**La sintesi vocale rappresenta il 60–70% del costo variabile.** È il primo elemento su cui intervenire in fase di crescita, ed è la ragione concreta per cui il fornitore vocale deve restare sostituibile.

**Conseguenza commerciale:** non è sostenibile una tariffa forfettaria illimitata. Il modello corretto è canone mensile per struttura con pacchetto di minuti inclusi ed eccedenza tariffata.

---

## 15. Prova comparativa preliminare

Da eseguire **prima** di qualunque sviluppo, e da non sostituire con benchmark pubblicati.

1. Raccolta di **30–50 registrazioni reali** dal centralino della struttura, privilegiando le chiamate difficili
2. Esecuzione dei candidati sul medesimo audio, con **residenza UE come filtro preliminare**
3. Valutazione su quattro parametri: accuratezza su nomi e date, correttezza delle chiamate a strumento, latenza al primo audio, gestione dell'interruzione
4. Verifica diretta delle condizioni economiche presso ciascun fornitore

**Le condizioni acustiche di questo mercato sono atipiche** — tedesco altoatesino, chiamanti anziani su linea mobile disturbata, sloveno — ed è esattamente dove i fornitori si differenziano. È anche il motivo per cui un prodotto costruito per questo territorio può superare un concorrente internazionale.

---

## 16. Sintesi

L'impostazione è identica a quella dell'allegato BookOne Rooms: **il modello canonico al centro, i fornitori confinati nei connettori.**

Le differenze rispetto al progetto camere sono tre: i fornitori da isolare sono tre anziché uno, il vincolo di residenza UE condiziona direttamente la scelta architetturale della conversazione, e il rischio principale non è tecnico ma commerciale — un prezzo inventato dal modello ha conseguenze immediate sul rapporto con l'ospite.

Il connettore Ericsoft, il modello di multi-struttura, l'instradamento delle notifiche e la reportistica sono condivisi tra i due prodotti. **È questo che rende il secondo prodotto sensibilmente meno costoso del primo**, ed è la ragione per cui i due progetti vanno costruiti sulla stessa piattaforma anziché come sistemi separati.

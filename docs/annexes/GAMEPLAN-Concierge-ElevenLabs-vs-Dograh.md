# BookOne Concierge — Due piani di attuazione a confronto

**Percorso A: ElevenLabs Agents (gestito) · Percorso B: Dograh (self-hosted)**

| | |
|---|---|
| A cura di | RT Holding Group GmbH (Austria) |
| Documenti correlati | PRD — BookOne Concierge · Allegato tecnico Concierge |
| Destinatari | Direzione tecnica |
| Stato | Bozza di lavoro |
| Data | Luglio 2026 |

---

## 1. Premessa: cosa distingue realmente i due percorsi

Il confronto viene spesso impostato come "quale piattaforma è migliore". È l'inquadramento sbagliato e porta a decisioni scorrette.

**Circa il 70% del lavoro è identico nei due percorsi.** Endpoint degli strumenti, connettore Ericsoft, base di conoscenza, motore di escalation, ticket di richiamo, cruscotto, multi-struttura, reportistica: tutto questo si costruisce allo stesso modo, con lo stesso codice, indipendentemente da chi esegue il ciclo audio.

Ciò che effettivamente cambia è **chi gestisce il motore vocale e chi porta l'onere operativo**:

| | Percorso A — ElevenLabs | Percorso B — Dograh |
|---|---|---|
| Ciclo audio | Sui server del fornitore | Sui tuoi server |
| Turnazione, VAD, interruzioni | Del fornitore | Configurazione tua |
| Scelta di STT/TTS/LLM | Limitata al catalogo | Libera (BYOK) |
| Residenza dati UE | Disponibile su piano Enterprise | Conseguenza del deployment |
| Aggiornamenti e monitoraggio | Del fornitore | **Tuoi, per sempre** |
| Margine al minuto | Ridotto dal ricarico | Massimo |

La decisione si riduce quindi a una domanda sola: **quanto vale, oggi, non dover gestire infrastruttura?**

---

## 2. Il lavoro comune ai due percorsi

Da costruire in ogni caso. Va fatto per primo, perché è indipendente dalla decisione e la rende reversibile.

| Componente | Effort | Note |
|---|---|---|
| Endpoint strumenti + schema `phrase` | 1 settimana | Contratti già definiti nell'allegato tecnico |
| Struttura base di conoscenza + editor | 1,5 settimane | YAML versionato per struttura |
| Motore di escalation | 1 settimana | Regole di trasferimento e ticket |
| **Classificatore di emergenza** | 0,5 settimane | Deterministico, in parallelo al modello |
| Ticket di richiamo + notifiche | 1 settimana | WhatsApp / email al personale |
| Modello multi-struttura | 1 settimana | Configurazione per `propertyId` |
| Registro chiamate + cruscotto | 2 settimane | Next.js |
| Reportistica economica | 1 settimana | Deriva interamente dal registro |
| **Connettore Ericsoft** | **3–4 settimane** | **Bloccato dall'autorizzazione API** |
| **Totale comune** | **12–13 settimane** | |

**Vincolo di calendario indipendente da entrambi i percorsi:** l'autorizzazione alle API Ericsoft richiede 2–5 mesi e va richiesta dalla struttura in quanto titolare della licenza. Va avviata nella prima settimana, qualunque sia la decisione.

---

## 3. Percorso A — ElevenLabs Agents

### 3.1 Lavoro specifico

| Attività | Effort |
|---|---|
| Provisioning agenti via API (uno per struttura) | 3–4 giorni |
| Verifica firma webhook, mappatura eventi | 3–4 giorni |
| Configurazione telefonia tramite integrazione nativa | 2–3 giorni |
| Taratura VAD e prompt sui parametri disponibili | 3–4 giorni |
| **Totale specifico** | **~2 settimane** |

### 3.2 Cronoprogramma

| Settimana | Attività | Esito |
|---|---|---|
| 1 | Richiesta API Ericsoft · **Richiesta preventivo Enterprise per residenza UE** · raccolta 30–50 registrazioni reali | Vincoli noti |
| 2 | Prototipo con agente gestito, conoscenza nel contesto, senza gestionale | Risponde al telefono |
| 3–4 | Endpoint strumenti, escalation, classificatore emergenza, ticket | Trasferimento e richiami funzionanti |
| 5–6 | Deviazione condizionata sul centralino della struttura, esercizio fuori orario | **Prima chiamata reale gestita** |
| 7–10 | Cruscotto, editor conoscenza, multi-struttura, reportistica | Struttura autonoma |
| 11–14 | Connettore Ericsoft (se autorizzato), cache disponibilità, precaricamento | Disponibilità e prenotazioni |
| 15–16 | Taratura multilingue su audio reale, collaudo, DPA | **Vendibile a terzi** |

**Prima chiamata reale: settimana 5–6.**

### 3.3 Rischi specifici

| Rischio | Impatto | Mitigazione |
|---|---|---|
| **Residenza UE solo su Enterprise** | Può rendere il percorso insostenibile alla singola struttura | Preventivo in settimana 1, prima di scrivere codice |
| Ricarico al minuto comprime il margine | Riduce la marginalità a regime | Modellare il punto di pareggio (sezione 5) |
| Vincolo al catalogo modelli del fornitore | Alcuni modelli non disponibili con residenza UE attiva | Verificare quali modelli restano utilizzabili |
| Modifiche unilaterali a prezzi o condizioni | Margine e continuità | Interfaccia `VoiceRuntime`, migrazione come connettore |
| Visibilità limitata sui guasti | Diagnosi più lenta | Registro chiamate proprio, indipendente dal fornitore |

### 3.4 Costi

| Voce | Importo |
|---|---|
| Sviluppo (14–16 settimane, 1 persona) | €28.000 – €38.000 |
| Piano Enterprise per residenza UE | **Da quantificare — variabile critica** |
| Costo al minuto (con ricarico) | €0,11 – €0,18 |
| Infrastruttura (cruscotto, servizi, base dati) | €150 – €400 / mese |
| Onere operativo ricorrente | Trascurabile |

---

## 4. Percorso B — Dograh

### 4.1 Lavoro specifico

| Attività | Effort |
|---|---|
| Deployment Docker, TLS, backup, monitoraggio | 1,5–2 settimane |
| Collegamento provider STT/TTS/LLM a endpoint UE | 1 settimana |
| Configurazione trunk SIP e numerazioni | 1 settimana |
| **Verifica e realizzazione multi-struttura** | **1–2 settimane — incognita** |
| Definizione flussi nel workflow builder | 0,5–1 settimana |
| **Totale specifico** | **5–7 settimane** |

### 4.2 Cronoprogramma

| Settimana | Attività | Esito |
|---|---|---|
| 1 | Richiesta API Ericsoft · **prova Docker in locale** · raccolta registrazioni | Fattibilità verificata |
| 2 | **Verifica multi-struttura: istanza unica o istanza per struttura?** | Decisione architetturale |
| 3–4 | Deployment su Hetzner/Scaleway UE, TLS, backup, monitoraggio | Infrastruttura operativa |
| 5–6 | Collegamento STT/TTS/LLM a endpoint UE, trunk SIP, primo flusso | Risponde al telefono |
| 7–8 | Endpoint strumenti, escalation, classificatore emergenza, ticket | Trasferimento e richiami |
| 9–10 | Deviazione condizionata, esercizio fuori orario | **Prima chiamata reale gestita** |
| 11–14 | Cruscotto, editor conoscenza, multi-struttura, reportistica | Struttura autonoma |
| 15–18 | Connettore Ericsoft, cache, precaricamento | Disponibilità e prenotazioni |
| 19–21 | Taratura multilingue, collaudo, procedure operative | **Vendibile a terzi** |

**Prima chiamata reale: settimana 9–10** — quattro settimane dopo il percorso A.

### 4.3 Rischi specifici

| Rischio | Impatto | Mitigazione |
|---|---|---|
| **Multi-struttura non nativa** | Potrebbe richiedere un'istanza per struttura: costi e gestione moltiplicati | **Verificare in settimana 2, prima di ogni altra cosa** |
| **Progetto giovane** | Modifiche non retrocompatibili, difetti in produzione | Bloccare la versione, aggiornare solo dopo collaudo |
| Sostituzione LLM ancora in beta | Vincolo sulla scelta del modello | Verificare quali combinazioni sono stabili |
| **Onere operativo permanente** | Sottrae tempo al prodotto | Quantificato: ~0,5 giornate/settimana |
| Guasto notturno senza fornitore a cui rivolgersi | Il servizio risponde al telefono di un albergo | Fallback automatico al centralino, procedura documentata |
| Comunità e supporto limitati | Tempi di risoluzione più lunghi | Valutare il piano cloud gestito come rete di sicurezza |

### 4.4 Costi

| Voce | Importo |
|---|---|
| Sviluppo (19–21 settimane, 1 persona) | €38.000 – €52.000 |
| Licenza | €0 (BSD 2-Clause) |
| Costo al minuto (diretto, senza ricarico) | €0,08 – €0,12 |
| Infrastruttura (calcolo, GPU se modelli locali) | €300 – €900 / mese |
| **Onere operativo ricorrente** | **~€1.000 / mese equivalente** |

---

## 5. Il punto di pareggio economico

È il calcolo che rende la decisione oggettiva anziché di preferenza.

**Ipotesi:** una struttura riceve indicativamente 400–800 minuti al mese di chiamate fuori orario e in eccedenza. Il ricarico di una piattaforma gestita si colloca attorno a €0,04–0,06 al minuto.

| Strutture | Minuti/mese | Risparmio con self-hosting | Costo operativo | Saldo |
|---|---|---|---|---|
| 3 | 1.800 | ~€90 | €1.000 | **−€910** |
| 10 | 6.000 | ~€300 | €1.000 | **−€700** |
| 25 | 15.000 | ~€750 | €1.000 | **−€250** |
| 40 | 24.000 | ~€1.200 | €1.000 | **+€200** |
| 60 | 36.000 | ~€1.800 | €1.100 | **+€700** |

**Il self-hosting diventa economicamente conveniente attorno alle 40 strutture.** Sotto quella soglia si paga in tempo più di quanto si risparmi in margine — e il tempo, con una persona sola, è la risorsa più scarsa.

*Valori indicativi. Il volume reale di chiamate della struttura è da rilevare dal centralino, ed è il primo dato da raccogliere.*

---

## 6. Confronto sintetico

| | **Percorso A — ElevenLabs** | **Percorso B — Dograh** |
|---|---|---|
| Prima chiamata reale | **Settimana 5–6** | Settimana 9–10 |
| Vendibile a terzi | Settimana 15–16 | Settimana 19–21 |
| Effort totale | 14–16 settimane | 19–21 settimane |
| Costo di sviluppo | €28k – €38k | €38k – €52k |
| Residenza UE | **Da negoziare (Enterprise)** | **Per costruzione** |
| Margine al minuto | Ridotto | Massimo |
| Onere operativo | Nullo | ~0,5 gg/settimana, permanente |
| Rischio tecnico | Basso | **Medio-alto (progetto giovane)** |
| Rischio commerciale | Dipendenza da fornitore | Autonomia |
| Conveniente da | Subito | **~40 strutture** |

---

## 7. Le due verifiche che decidono

Nessuna delle due richiede più di una settimana, ed entrambe vanno completate prima di scegliere.

### Verifica 1 — Preventivo Enterprise ElevenLabs

La residenza dati UE è disponibile solo sul piano Enterprise. **Se il costo non è sostenibile ripartito su 3–5 strutture, il percorso A non è percorribile** e la decisione è già presa.

Da chiedere esplicitamente: costo di ingresso, minimo contrattuale, quali modelli restano disponibili con la residenza UE attiva, condizioni di conservazione dei dati, elenco dei sub-responsabili.

### Verifica 2 — Multi-struttura in Dograh

**È il rischio maggiore del percorso B e va affrontato per primo, non per ultimo.**

La domanda precisa: un'installazione singola può gestire più strutture con conoscenza, voce, numerazioni e configurazioni separate, oppure serve un'istanza per struttura?

Se la risposta è "un'istanza per struttura", i costi infrastrutturali e l'onere gestionale si moltiplicano per il numero di clienti, e il percorso B diventa insostenibile come prodotto commerciale — pur restando valido per un'installazione singola.

È verificabile in un pomeriggio con Docker in locale. Va fatto subito.

---

## 8. Raccomandazione

**Costruire prima il lavoro comune, decidere dopo.**

Le 12–13 settimane della sezione 2 sono identiche nei due percorsi e producono il 70% del prodotto. L'interfaccia `VoiceRuntime` dell'allegato tecnico rende la scelta del motore vocale un connettore, non un vincolo architetturale.

**Sequenza consigliata:**

1. **Settimana 1** — Richiesta API Ericsoft · richiesta preventivo Enterprise · prova Dograh in locale con verifica multi-struttura · raccolta registrazioni reali
2. **Settimana 2** — Decisione sul percorso, sulla base di due dati concreti anziché di preferenze
3. **Settimane 2–14** — Lavoro comune, con il motore vocale scelto per la fase di avvio
4. **Rivalutazione a 30–40 strutture** — a quel punto il self-hosting ha una giustificazione economica e le risorse per sostenerlo

**In assenza di sorprese sul preventivo Enterprise, il percorso A è quello corretto per iniziare.** Non perché sia tecnicamente superiore, ma perché quattro settimane di anticipo sulla prima chiamata reale e l'assenza di onere operativo valgono, oggi, più del margine al minuto su tre strutture.

**Se il preventivo Enterprise risulta insostenibile, Dograh diventa il candidato principale per la fase di avvio** — non per la fase di crescita. In tal caso va messo in conto: quattro settimane in più, un rischio tecnico superiore, e una procedura documentata per il guasto notturno, perché non ci sarà un fornitore a cui rivolgersi alle tre del mattino.

---

## 9. Ciò che non cambia in nessuno dei due percorsi

- Il **classificatore di emergenza** è deterministico e opera in parallelo al modello. Nessuna piattaforma lo fornisce: si costruisce.
- I **limiti rigidi sugli strumenti** sono disciplina di progettazione, non funzionalità acquistabile.
- La **prova comparativa su audio reale** va eseguita comunque: 30–50 registrazioni dal centralino della struttura, con la residenza UE come filtro preliminare.
- Il **connettore Ericsoft** è indipendente dal motore vocale ed è condiviso con il progetto camere.
- L'**autorizzazione API di Ericsoft** è il vincolo di calendario più lungo e va avviata in settimana 1.
- La **deviazione condizionata** resta il punto di ingresso: non si prende mai il numero principale della struttura.

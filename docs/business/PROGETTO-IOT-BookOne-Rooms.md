# BookOne Rooms — Definizione di progetto

**Piattaforma integrata di gestione camere, accessi e arrivo contactless**

| | |
|---|---|
| A cura di | RT Holding Group GmbH (Austria) |
| Destinatario | Hotel Sonja |
| Stato | **Bozza preliminare — documento di discussione** |
| Data | Luglio 2026 |
| Documento correlato | Proposta preliminare Hotel Sonja — Sezione 6, Fasi 2 e 3 |

> **Nota sullo stato del documento.** Questa è una definizione di progetto a scopo di inquadramento, non un preventivo. Gli importi indicati sono ordini di grandezza destinati a rendere confrontabili gli scenari. La quantificazione definitiva è possibile solo al termine della Fase 0 (analisi preliminare), descritta alla sezione 8.

---

## 1. Sintesi

Il progetto realizza una piattaforma integrata per la gestione delle camere che risponde a tre esigenze espresse dalla proprietà:

1. **Rilevazione dell'occupazione** delle camere
2. **Controllo degli accessi** e apertura porte da smartphone
3. **Avvio automatico del check-in** all'apertura della porta da parte dell'ospite

A queste si aggiungono due aree che comportano un ritorno economico diretto e che raccomandiamo di includere, poiché il costo marginale è contenuto una volta realizzata l'infrastruttura di base: **gestione climatica basata sull'occupazione** e **rilevazione di perdite e anomalie**.

**Due precisazioni preliminari, importanti.**

La terza esigenza — l'avvio del check-in dall'apertura della porta — va realizzata con una sequenza diversa da quella descritta letteralmente, per ragioni di conformità normativa. La sezione 4 illustra la soluzione corretta, che produce **esattamente l'esperienza desiderata per l'ospite** ma in forma legalmente sostenibile.

Il progetto è **indipendente dal progetto di piattaforma gestionale** discusso separatamente. Si integra con i sistemi già in uso presso la struttura, incluso il gestionale Ericsoft, e non richiede la sostituzione di alcun sistema esistente. Può quindi procedere con tempi, perimetro e budget propri.

---

## 2. Obiettivi del progetto

| # | Obiettivo | Indicatore di successo |
|---|---|---|
| O1 | L'ospite raggiunge la camera senza passare dal ricevimento | ≥ 60% degli arrivi completati senza intervento del personale |
| O2 | Il check-in è registrato correttamente e nei termini di legge | 100% delle comunicazioni Alloggiati entro 24 ore, con tracciabilità |
| O3 | Le pulizie conoscono lo stato reale delle camere | Riduzione misurabile degli accessi a camere occupate |
| O4 | Riduzione dei consumi energetici | −15% / −30% su riscaldamento e climatizzazione rispetto al periodo di riferimento |
| O5 | Prevenzione dei danni da perdite d'acqua | Rilevazione e notifica entro 5 minuti dall'evento |
| O6 | Nessun peggioramento dell'esperienza dell'ospite in caso di guasto | Il percorso tradizionale con tessera fisica resta sempre disponibile |
| O7 | L'ospite accede alla camera anche senza smartphone | Tre metodi di accesso attivi in parallelo su ogni prenotazione |

---

## 3. Perimetro

### 3.1 Flussi di lavoro

Il progetto si articola in tre flussi principali e due complementari.

| Flusso | Contenuto | Priorità |
|---|---|---|
| **A — Presenza** | Rilevazione occupazione camere, nel rispetto della privacy | Primaria |
| **B — Accessi** | Chiave digitale, ciclo di vita delle credenziali, eventi porta | Primaria |
| **C — Arrivo** | Check-in online pre-arrivo → chiave digitale → evento porta completa l'arrivo | Primaria |
| D — Comfort | Climatizzazione guidata dall'occupazione | Complementare |
| E — Protezione | Rilevazione perdite, umidità, finestre aperte | Complementare |

### 3.2 Cosa è incluso

- Integrazione con il sistema di serrature installato presso la struttura
- **Accesso alla camera con metodi multipli e ridondanti**: chiave digitale su smartphone, codice numerico personale, tessera fisica (vedi sezione 3.4)
- Emissione e revoca di credenziali digitali, collegate alla prenotazione
- Ricezione e gestione degli eventi di apertura porta
- Portale di check-in online pre-arrivo, multilingue, con acquisizione documenti
- Invio automatico della comunicazione Alloggiati Web
- Sensori di presenza in camera, con logica di occupazione
- Termostati o interfacciamento con i fan-coil esistenti
- Sensori di perdita acqua, umidità, contatti finestra
- Gateway di raccolta dati per struttura, con funzionamento anche in assenza di connettività
- Cruscotto di gestione per la direzione e per il personale
- Notifiche al personale su canali già in uso (WhatsApp, email)
- Reportistica su occupazione, consumi e risparmio conseguito
- Integrazione con il gestionale Ericsoft per stato prenotazioni e assegnazione camere

### 3.3 Cosa è escluso

| Escluso | Motivazione |
|---|---|
| Produzione di hardware proprietario | Attività industriale a sé stante, con certificazioni, magazzino e logistica di sostituzione. Integriamo dispositivi di produttori affermati |
| Sostituzione del gestionale | Ericsoft resta il sistema di riferimento per prenotazioni, conti e adempimenti fiscali |
| Pannelli o tablet in camera | Investimento elevato e ritorno modesto: l'ospite utilizza il proprio smartphone |
| Telecamere, microfoni, sensori audio | **Esclusione permanente.** Il costo in termini di fiducia dell'ospite eccede qualunque beneficio funzionale |
| Analisi comportamentale degli ospiti | Come sopra. La presenza è rilevata come stato, non come tracciato |
| Controllo della centrale termica dell'edificio | Competenza e responsabilità del termotecnico e dell'installatore impiantistico |
| Interventi murari o rifacimento cablaggi | Il progetto è concepito come retrofit: tutti i dispositivi sono wireless |
| Eliminazione del ricevimento | Il percorso tradizionale è un requisito di sicurezza, non un limite |

### 3.4 Metodi di accesso alla camera

**Requisito fondamentale del progetto: l'ospite deve poter accedere alla propria camera anche senza smartphone**, per qualunque motivo — batteria scarica, telefono smarrito, Bluetooth disattivato, dispositivo non compatibile, ospite che semplicemente preferisce non installare nulla.

Il sistema prevede quindi **tre metodi di accesso paralleli e sempre attivi contemporaneamente**, tutti collegati alla stessa prenotazione e tutti revocabili singolarmente.

| Metodo | Funzionamento | Disponibilità |
|---|---|---|
| **Chiave digitale su smartphone** | Bluetooth o NFC, tramite app web o wallet del telefono | Metodo principale, per chi lo desidera |
| **Codice numerico personale** | Codice di 4–8 cifre digitato sul tastierino della serratura, valido per la durata del soggiorno | **Alternativa autonoma: non richiede alcun dispositivo** |
| **Tessera fisica** | Tessera tradizionale, emessa al ricevimento | Sempre disponibile, senza necessità di preavviso |

### Come viene consegnato il codice numerico

Il codice è generato al momento dell'emissione della credenziale e viene comunicato all'ospite **su più canali**, così che sia recuperabile anche in assenza del telefono:

- Nel messaggio di conferma pre-arrivo (SMS, WhatsApp, email)
- Nella pagina web del check-in online, stampabile
- Su richiesta al ricevimento, previa verifica dell'identità
- Nel messaggio di benvenuto inviato al completamento dell'arrivo

L'ospite che arriva con il telefono scarico **conosce già il proprio codice** perché lo ha ricevuto prima di partire, e può accedere alla camera senza alcun passaggio intermedio.

### Regole di sicurezza sui codici

- Codice diverso per ogni prenotazione, mai riutilizzato tra soggiorni
- Validità limitata alla finestra temporale del soggiorno, dall'orario minimo di arrivo alla partenza
- Revoca immediata al check-out o in caso di segnalazione da parte dell'ospite
- Numero massimo di tentativi errati, con blocco temporaneo e segnalazione al personale
- Registrazione dell'evento con indicazione del metodo utilizzato, per la tracciabilità
- Il codice non consente il completamento automatico dell'arrivo se il check-in online non è stato effettuato: in tal caso l'ospite passa comunque dal ricevimento

### Prerequisito tecnico

L'accesso tramite codice richiede che le serrature installate dispongano di **tastierino numerico**. Non tutti i modelli ne sono dotati. La verifica rientra nella Fase 0 (sezione 8) ed è determinante: in assenza di tastierino, il metodo alternativo allo smartphone resta la sola tessera fisica, con conseguente necessità di passaggio al ricevimento.

Qualora le serrature attuali risultino prive di tastierino e la proprietà consideri prioritario l'accesso senza dispositivo, l'aggiornamento dell'hardware va valutato in fase di analisi preliminare.

---

## 4. Nota tecnica determinante: la sequenza del check-in

### 4.1 La richiesta

> L'ospite apre la porta della camera e il sistema effettua il check-in.

### 4.2 Perché non è realizzabile in questa forma

**Ragione normativa.** In Italia il check-in non è un semplice cambio di stato nel gestionale: è il momento in cui l'identità dell'ospite viene registrata e trasmessa alla Questura tramite **Alloggiati Web entro 24 ore**. L'apertura di una porta dimostra che *è stata utilizzata una credenziale*. Non dimostra nulla sull'identità della persona. Lo stesso vale per il calcolo dell'imposta di soggiorno e per le rilevazioni ISTAT.

**Ragione operativa.** La serratura segnala un evento di credenziale, non una persona. Il personale delle pulizie, la manutenzione, un accompagnatore che arriva per primo o una chiave master producono tutti il medesimo segnale.

**Ragione amministrativa.** Il check-in nel gestionale apre il conto e avvia l'addebito di tariffe e imposte. Attivarlo da un evento fisico ambiguo genera errori di fatturazione che emergono al momento dell'emissione dei documenti, quando la correzione è più onerosa.

### 4.3 La sequenza corretta

L'evento porta diventa il **momento di completamento di un arrivo già predisposto**, non il check-in in sé. Tutto ciò che ha rilevanza legale avviene prima che l'ospite raggiunga la struttura.

```
T-48h   Invio del link di pre-arrivo (SMS / WhatsApp / email)
           ↓
T-48h   L'ospite completa il check-in online:
           documento d'identità, dati di registrazione,
           orario di arrivo previsto, autorizzazione cauzione
           ↓
        Validazione dei dati → comunicazione Alloggiati predisposta
           ↓
T-24h   Assegnazione camera nel gestionale · stato prenotazione = PRONTA
           ↓
T-4h    Emissione della credenziale digitale tramite il sistema serrature,
           valida dall'orario minimo di arrivo fino alla partenza
           ↓
        L'ospite arriva, non passa dal ricevimento, apre la camera
           ↓
        Evento porta ricevuto → arrivo CONFERMATO
           ↓
        Check-in registrato nel gestionale · conto aperto
        · comunicazione Alloggiati inviata · imposta di soggiorno calcolata
        · messaggio di benvenuto · climatizzazione in comfort
        · pulizie notificate "camera occupata"
```

**Ciò che la proprietà desidera:** l'ospite va direttamente in camera senza fermarsi al ricevimento.
**Ciò che ottiene:** esattamente questo — con piena conformità, tracciabilità completa e senza attivazioni errate causate da una chiave di servizio.

### 4.4 Controlli di sicurezza sull'evento porta

- Solo una credenziale **emessa per quella specifica prenotazione** completa l'arrivo. Le credenziali di servizio e master sono ignorate a questo fine.
- Se il check-in online non è stato completato, la chiave digitale non viene emessa e l'ospite si presenta normalmente al ricevimento. **Il percorso tradizionale non viene mai rimosso.**
- Finestra di tolleranza configurabile: un evento porta molto anticipato rispetto all'orario previsto genera una segnalazione, non un completamento automatico.
- Il completamento manuale dal cruscotto è sempre disponibile e prevale su qualunque automatismo.

---

## 5. Architettura

### 5.1 Impostazione

```
┌──────────── Piattaforma BookOne (infrastruttura UE) ────────────┐
│                                                                  │
│   Cruscotto web            Servizi applicativi                   │
│         │                          │                             │
│         └────── Base dati ─────────┘                             │
│                     │                                            │
│     ┌───────────────┼───────────────┬──────────────┐             │
│     │               │               │              │             │
│  Connettore    Connettore       Broker MQTT    Concierge         │
│  Ericsoft      serrature         (UE)          telefonico        │
└─────┼───────────────┼───────────────┼────────────────────────────┘
      │               │               │
   Ericsoft    Sistema serrature   Gateway di struttura
               (sistema di          (Zigbee / Thread / Modbus)
                riferimento)              │
                                Presenza · Termostati
                                Perdite · Finestre
```

### 5.2 Componenti

| Livello | Soluzione | Note |
|---|---|---|
| Serrature | Salto, ASSA ABLOY Hospitality, Dormakaba | Integrazione tramite API del produttore. La scelta segue il sistema già installato. **Modello con tastierino numerico richiesto per l'accesso tramite codice** |
| Credenziale digitale | SDK del produttore (Bluetooth, NFC dove supportato) | Emessa nell'app web dell'ospite o nel wallet del telefono |
| Credenziale a codice | Codice numerico generato dal sistema del produttore serrature | Metodo indipendente da qualunque dispositivo dell'ospite |
| Rilevazione presenza | Sensori **mmWave** | Non sensori a infrarossi: questi ultimi segnalano "vuoto" con ospite fermo o addormentato |
| Climatizzazione | Termostati wireless, oppure interfacciamento fan-coil esistenti via Modbus | Retrofit senza opere murarie |
| Protezione | Sensori perdita acqua, umidità, contatto finestra | Protocollo Zigbee |
| Gateway | Unità dedicata per struttura | Bufferizzazione locale: le camere funzionano anche con connessione internet assente |
| Trasmissione dati | MQTT su TLS verso broker in UE | Credenziali dedicate per struttura |
| Archiviazione | Base dati in regione UE | |

### 5.3 Comportamento in caso di guasto

Requisito non negoziabile del progetto.

| Guasto | Comportamento |
|---|---|
| Piattaforma non raggiungibile | Serrature e camere funzionano normalmente sul sistema del produttore. Nessun impatto sull'ospite |
| API del produttore serrature non disponibili | Le chiavi digitali non vengono emesse; il ricevimento utilizza le tessere fisiche. Segnalazione automatica |
| Gateway offline | I sensori bufferizzano localmente; la climatizzazione mantiene l'ultima impostazione; i dati vengono recuperati alla riconnessione |
| Telefono dell'ospite scarico, smarrito o senza Bluetooth | **Codice numerico personale sul tastierino**, già in possesso dell'ospite. In alternativa, tessera fisica al ricevimento. Nessun impatto sull'accesso |
| Assenza di alimentazione | Le serrature funzionano a batteria interna; sblocco meccanico di emergenza sempre presente |

**Non deve mai esistere una condizione in cui un ospite non può accedere alla propria camera a causa di un'indisponibilità del nostro sistema.**

---

## 6. Protezione dei dati e conformità

**Residenza dei dati.** Tutto il trattamento e l'archiviazione avvengono su infrastruttura in territorio UE. Viene mantenuto un registro dei sub-responsabili, allegato al contratto.

**Selezione dei dispositivi come requisito di conformità.** Vengono impiegati esclusivamente dispositivi con interfaccia locale. I dispositivi che trasmettono dati a piattaforme cloud extra-UE sono esclusi a prescindere dal costo, poiché comprometterebbero la residenza dei dati indipendentemente da dove risieda la nostra infrastruttura.

**Dati di presenza.** Registrati come stato della camera (occupata / libera) con marca temporale. Nessun tracciato di movimento, nessuna analisi di permanenza, nessun conteggio di persone, nessuna inferenza comportamentale. Il flusso dei sensori contiene l'identificativo della camera, mai quello dell'ospite.

**Eventi di accesso.** Conservati per finalità di sicurezza e gestione contestazioni, per un periodo predefinito di 90 giorni, quindi cancellati definitivamente. Esportabili e cancellabili su richiesta dell'interessato.

**Documenti d'identità** acquisiti in fase di pre-arrivo: trasmessi per la comunicazione Alloggiati e cancellati dai nostri sistemi a conferma dell'invio avvenuto. Non costituiamo un archivio documentale.

**Esclusioni permanenti:** telecamere, microfoni, rilevazione audio, trattamenti biometrici, profilazione comportamentale degli ospiti. L'esclusione è dichiarata nella documentazione di prodotto e nell'informativa privacy fornita agli ospiti.

**Segmentazione di rete.** I dispositivi risiedono su una rete isolata, priva di instradamento verso la rete ospiti, la rete gestionale e la rete amministrativa della struttura.

---

## 7. Sicurezza, responsabilità e vincoli normativi

| Vincolo | Requisito |
|---|---|
| Normativa antincendio | Sblocco meccanico di emergenza su ogni porta, mai subordinato al software |
| Certificazione serrature | Esclusivamente hardware certificato per uso alberghiero, di produttori riconosciuti |
| Sistema di riferimento | Il sistema del produttore delle serrature resta l'unica fonte autoritativa dei diritti di accesso. La piattaforma ne riflette lo stato, non lo sostituisce |
| Installazione | Eseguita da elettricista qualificato e installatore certificato. Coordiniamo l'intervento, non eseguiamo opere su porte o impianti |
| Alloggiati Web | La correttezza delle comunicazioni resta obbligo della struttura. Forniamo il meccanismo di invio e il registro di tracciabilità; la titolarità dell'adempimento rimane in capo alla proprietà |
| Responsabilità contrattuale | Limitazione ai corrispettivi versati, esclusione dei danni indiretti, copertura assicurativa professionale attiva prima della prima installazione |

---

## 8. Fasi del progetto

| Fase | Contenuto | Durata | Condizione di passaggio |
|---|---|---|---|
| **0 — Analisi** | Rilievo serrature installate (produttore, modello, presenza di tastierino numerico, in rete o offline, disponibilità API), verifica integrazioni già presenti nel gestionale, rilievo rete e potenza termica | 2 settimane | Accesso alle API confermato |
| **1 — Accessi e arrivo** | Connettore serrature, emissione credenziali digitali e codici numerici, ricezione eventi porta, portale di pre-arrivo, completamento arrivo, invio Alloggiati | 8–10 settimane | Un ospite completa l'arrivo senza passare dal ricevimento, con smartphone o con codice |
| **2 — Presenza** | Sensori mmWave, gateway, raccolta dati, stato camere per le pulizie, cruscotto occupazione | 4–6 settimane | Le pulizie operano sullo stato reale delle camere |
| **3 — Comfort e protezione** | Climatizzazione su occupazione, rilevazione perdite e finestre, reportistica energetica | 4–6 settimane | Riduzione dei consumi misurata rispetto al periodo di riferimento |
| **4 — Consolidamento** | Documentazione, procedure operative, formazione del personale, messa a regime | 3–4 settimane | La struttura opera in autonomia |

**Durata complessiva indicativa: 5–7 mesi**, con rilasci progressivi in esercizio. Ogni fase produce un risultato utilizzabile e può essere sospesa senza compromettere quanto già realizzato.

### La Fase 0 è determinante

La quasi totalità delle strutture alberghiere dispone già di serrature elettroniche. La domanda decisiva è però un'altra: **sono collegate in rete con API disponibili, oppure sono offline con scrittura dei diritti su tessera?**

I sistemi offline non consentono l'emissione remota di credenziali digitali e richiedono la sostituzione dell'hardware, con un impatto sui costi di un ordine di grandezza superiore. **Nessuna quotazione è possibile prima di aver completato questa verifica.**

Seconda domanda della Fase 0: **il gestionale Ericsoft integra già il sistema di serrature installato?** In caso affermativo il percorso di integrazione può passare dal gestionale anziché direttamente dal produttore delle serrature, con costi e tempi sensibilmente inferiori.

Terza domanda: **le serrature dispongono di tastierino numerico?** Da questo dipende la possibilità di offrire l'accesso tramite codice, ossia il metodo che garantisce l'ingresso in camera anche senza smartphone (sezione 3.4).

---

## 9. Stima economica

### 9.1 Investimento in hardware e installazione

Riferimento per una struttura di 60 camere.

**Scenario A — serrature già in rete con API disponibili**

| Voce | Importo |
|---|---|
| Integrazione serrature (solo software) | — |
| Sensori di presenza, 60 camere @ €50–90 | €3.000 – €5.400 |
| Termostati wireless, 60 camere @ €60–150 | €3.600 – €9.000 |
| Sensori perdita e contatti finestra (posizionamento selettivo) | €800 – €2.000 |
| Gateway, rete, segmentazione | €1.500 – €3.500 |
| Installazione e messa in servizio | €3.000 – €6.000 |
| **Totale** | **€11.900 – €25.900** |

**Scenario B — serrature offline, da sostituire**

| Voce | Importo |
|---|---|
| Sostituzione serrature in rete, 60 porte @ €400–800 | €24.000 – €48.000 |
| Tutte le voci dello Scenario A | €11.900 – €25.900 |
| **Totale** | **€35.900 – €73.900** |

Lo Scenario B configura un intervento di natura diversa, più vicino a un investimento strutturale che a un progetto software. In tal caso raccomandiamo che sia il produttore delle serrature a condurre l'intervento, con il nostro ruolo limitato all'integrazione.

### 9.2 Sviluppo e integrazione

Le attività di sviluppo, integrazione, test e manutenzione della piattaforma rientrano nel **retainer mensile** definito nella proposta preliminare (Opzione 2). Non costituiscono un costo aggiuntivo rispetto a quello.

Se il progetto IoT venisse realizzato in forma autonoma, senza il retainer, l'impegno di sviluppo si colloca indicativamente in **8–12 mesi/persona**.

### 9.3 Costi ricorrenti

| Voce | Annuo |
|---|---|
| Piattaforma, infrastruttura, manutenzione connettori | €2.400 – €6.000 |
| Manutenzione hardware, batterie, sostituzioni | €500 – €1.500 |
| **Totale** | **€2.900 – €7.500** |

---

## 10. Ritorno economico

### 10.1 Risparmio energetico

La gestione climatica basata sull'occupazione produce tipicamente una **riduzione del 15–30%** sui consumi di riscaldamento e climatizzazione. Il meccanismo è semplice: le camere non vendute non vengono climatizzate, quelle vendute ma non ancora occupate restano in regime ridotto fino all'arrivo effettivo dell'ospite.

Su una struttura di 60 camere con spesa energetica annua di €60.000–90.000, il risparmio si colloca indicativamente tra **€9.000 e €27.000 all'anno**. La quantificazione precisa richiede l'analisi delle bollette degli ultimi 24 mesi.

### 10.2 Efficienza operativa

- Le pulizie non bussano su camere occupate e non verificano camere già libere
- Il ricevimento non gestisce code negli orari di punta né tessere smarrite
- La comunicazione Alloggiati non richiede più un'attività manuale quotidiana

### 10.3 Prevenzione danni

La rilevazione precoce di perdite d'acqua previene danni che, in un albergo, comportano non solo il costo del ripristino ma anche l'indisponibilità di camere in periodi di alta occupazione. È inoltre un elemento negoziabile con la compagnia assicurativa.

### 10.4 Conformità normativa

La direttiva europea sulla prestazione energetica nell'edilizia (**EPBD rifusa, UE 2024/1275**) introduce l'obbligo di sistemi di automazione e controllo per gli edifici non residenziali: **dal 2026 per impianti superiori a 290 kW, dal 2030 con soglia ridotta a 70 kW**. Il termine generale di recepimento per gli Stati membri era il 29 maggio 2026.

Una struttura alberghiera di 40–120 camere si colloca con ogni probabilità sopra la soglia dei 70 kW. **L'obbligo è quindi verosimilmente applicabile entro il 2030.**

Il progetto costituisce una base tecnica coerente con tale obbligo. *Le modalità di recepimento nazionale variano tra Stati membri: la verifica dell'applicabilità puntuale va effettuata con un termotecnico abilitato.*

### 10.5 Tempo di ritorno

Nello Scenario A, il ritorno dell'investimento si colloca indicativamente tra **2 e 4 anni** considerando il solo risparmio energetico, con tempi inferiori includendo efficienza operativa e beneficio assicurativo.

Nello Scenario B, la sostituzione delle serrature va valutata sui propri meriti — sicurezza, obsolescenza dell'impianto esistente, esperienza dell'ospite — prima di essere inclusa in questo calcolo.

---

## 11. Rischi e mitigazioni

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Il produttore delle serrature non concede l'accesso alle API | Blocca la Fase 1 | Verifica in Fase 0. Percorso alternativo tramite il gestionale se già integrato |
| Le serrature installate risultano offline | Costi triplicati | Verifica in Fase 0. Nessuna quotazione prima del rilievo |
| Un ospite non accede alla camera per un guasto | Grave, su reputazione e responsabilità | Tessera fisica sempre disponibile, sblocco meccanico, sistema del produttore autonomo |
| Accesso concesso a persona non autorizzata | Grave | Credenziali emesse esclusivamente entro le regole del produttore e vincolate alla prenotazione. Registro completo degli eventi |
| Comunicazione Alloggiati con dati errati | Esposizione legale della struttura | Validazione in fase di pre-arrivo, registro di tracciabilità, titolarità dell'adempimento contrattualmente in capo alla proprietà |
| Percezione della rilevazione presenza come sorveglianza | Reputazionale | Archiviazione del solo stato, informativa esplicita all'ospite, esclusione permanente di telecamere e microfoni |
| Portata wireless insufficiente | Ritardi in installazione | Rilievo in Fase 0, con particolare attenzione a murature spesse e strutture storiche |
| Ospiti non abituati alla chiave digitale | Adozione inferiore alle attese | Tre metodi di accesso in parallelo: codice numerico e tessera fisica restano sempre attivi. Nessuna imposizione all'ospite |
| Serrature prive di tastierino numerico | L'accesso senza smartphone richiede il passaggio al ricevimento | Verifica in Fase 0. Eventuale aggiornamento hardware da valutare in sede di analisi preliminare |

---

## 12. Cosa serve dalla proprietà

**Elementi bloccanti**

- [ ] Sistema serrature: produttore, modello, anno di installazione, collegamento in rete o offline, **presenza di tastierino numerico**
- [ ] Conferma scritta della disponibilità del produttore a concedere l'accesso alle API
- [ ] Stato della richiesta di integrazione con Ericsoft (dipendenza condivisa con il modulo concierge)
- [ ] Conferma che il check-in online pre-arrivo è accettabile sul piano operativo — l'intero flusso di arrivo vi si basa
- [ ] Conferma della disponibilità a mantenere permanentemente attivo il percorso tradizionale al ricevimento

**Elementi necessari per la quantificazione**

- [ ] Bollette energetiche degli ultimi 24 mesi e potenza termica installata
- [ ] Numero camere, piani, tipo di costruzione (spessore e materiale delle murature)
- [ ] Topologia della rete e disponibilità di segmentazione (VLAN)
- [ ] Flusso attuale di comunicazione dello stato camere tra ricevimento e pulizie
- [ ] Contatto del broker assicurativo, per valutare il beneficio sulla polizza
- [ ] Percentuale di ospiti con prenotazione diretta rispetto a portali (incide sulla fattibilità del pre-arrivo)

---

## 13. Prossimi passi

1. **Rilievo del sistema serrature** — attività di due giornate presso la struttura, che determina lo scenario di costo applicabile
2. **Avvio della richiesta di accesso API** presso il produttore delle serrature e presso Ericsoft, in quanto titolare della licenza è la struttura
3. **Analisi delle bollette energetiche** per la quantificazione del risparmio atteso
4. **Proposta operativa definitiva** con perimetro, tempi e importi consolidati

I punti 1 e 3 non comportano alcun impegno e possono essere avviati immediatamente. Il punto 2 è il vincolo temporale più lungo — i tempi di risposta sono nell'ordine di 2–5 mesi e non sono sotto il nostro controllo — e raccomandiamo quindi di avviarlo per primo.

---

## 14. Note

Le stime economiche contenute in questo documento sono ordini di grandezza a scopo di orientamento, elaborate sulla base di parametri di mercato e dell'esperienza nel settore. Non costituiscono offerta contrattuale.

Gli aspetti normativi richiamati — adempimenti verso la pubblica amministrazione, protezione dei dati personali, normativa antincendio, direttive europee sull'efficienza energetica — sono descritti a titolo di inquadramento tecnico e vanno validati con i consulenti legali, fiscali e tecnici competenti prima di qualsiasi impegno.

Le indicazioni relative a produttori e tecnologie sono orientative e verranno definite in funzione dell'impianto esistente presso la struttura.

---

**RT Holding Group GmbH**
Austria

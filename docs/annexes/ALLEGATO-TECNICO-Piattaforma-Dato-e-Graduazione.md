# BookOne Platform — Allegato tecnico: proprietà del dato e percorso di graduazione

**Architettura a doppia sorgente: il dato è nostro dal primo giorno, i sistemi esterni sono sorgenti di sincronizzazione**

| | |
|---|---|
| A cura di | RT Holding Group GmbH (Austria) |
| Documenti correlati | Allegato tecnico Concierge · Allegato tecnico Rooms · PRD BookOne Concierge |
| Destinatari | Direzione tecnica |
| Stato | **Decisione adottata** — D10, D11 (registro decisioni, sezione 8) |
| Data | Luglio 2026 |

---

## 1. La decisione

**La piattaforma possiede il proprio modello dei dati dal primo giorno. Ericsoft — e qualunque altro gestionale — è una sorgente di sincronizzazione, mai la base dati.**

Questo è il presupposto architetturale che rende possibile, in prospettiva, l'uso della piattaforma **senza alcuna integrazione**: il distacco dal sistema esistente diventa un cambio di sorgente, non una migrazione di prodotto.

```
Modalità INTEGRATA                    Modalità AUTONOMA
─────────────────────                 ─────────────────────
Ericsoft  = fonte autoritativa        Nostro core = fonte autoritativa
Nostro DB = proiezione                Il "connettore" è il nostro
            sincronizzata             motore interno, che implementa
Scritture → via connettore            la stessa interfaccia PmsAdapter
```

La logica applicativa — customer journey, concierge, camere, automazioni — dialoga esclusivamente con l'interfaccia e **non sa in quale modalità si trovi una struttura**. Il passaggio di una struttura dalla modalità integrata a quella autonoma non comporta alcuna modifica al codice applicativo.

---

## 2. Regole del modello dei dati

### 2.1 Identità propria

Ogni entità ha un **identificativo nostro (UUID)**. Gli identificativi dei sistemi esterni sono riferimenti, mai chiavi:

```ts
interface ExternalRef {
  system: 'ericsoft' | 'scrigno' | 'asa' | ...
  entityType: 'reservation' | 'guest' | 'room' | 'rate'
  externalId: string
  lastSyncedAt: Date
}
// Ogni entità canonica può avere 0..n riferimenti esterni.
// Zero riferimenti = entità nata nella piattaforma.
```

**Conseguenza:** un'entità può esistere senza alcun sistema esterno. È la condizione tecnica dell'autonomia.

### 2.2 Il modello canonico non è la forma di Ericsoft

Il modello (`Reservation`, `Guest`, `RoomType`, `RatePlan`, `Folio`, `Availability`) è definito sulla semantica del dominio alberghiero, non sulle strutture dati di un fornitore. I connettori traducono; il core non si adatta.

È la regola più facile da violare sotto pressione di consegna, ed è l'unica la cui violazione costa una riscrittura. In revisione del codice, qualunque campo del core che rifletta una peculiarità di Ericsoft è un difetto, anche se funziona.

### 2.3 Provenienza e registro eventi

Ogni scrittura registra la provenienza (`origin: 'sync' | 'platform' | 'reconciliation'`) e ogni variazione di stato è tracciata in un registro eventi append-only. Il registro serve tre scopi: diagnosi delle divergenze di sincronizzazione, base per la modalità ombra (sezione 4), e continuità del comportamento del prodotto tra le due modalità.

---

## 3. Autoritatività per dominio, non per struttura

La graduazione non è un interruttore unico. Ogni struttura ha una **mappa di autoritatività per dominio**:

```ts
interface AuthorityMap {
  reservations: 'external' | 'platform'
  availabilityAndRates: 'external' | 'platform'
  guestProfiles: 'external' | 'platform'
  folioAndFiscal: 'external' | 'platform'   // ultimo a passare, sempre
  housekeeping: 'external' | 'platform'
}
```

Regole di scrittura:

- Dominio `external` → le scritture passano dal connettore verso il gestionale; il nostro DB si aggiorna dalla conferma
- Dominio `platform` → le scritture avvengono nel core; il connettore, se ancora attivo, riflette verso l'esterno solo ciò che serve alla coerenza residua

**Vincolo di dipendenza:** `folioAndFiscal` non può passare a `platform` prima di `reservations` e `availabilityAndRates`. Il sistema lo impone, non la disciplina.

---

## 4. Modalità ombra e passaggio

Il passaggio di un dominio alla modalità autonoma segue sempre la stessa sequenza, per struttura:

| Fase | Contenuto | Uscita |
|---|---|---|
| **1 — Sincronizzata** | Il gestionale è autoritativo; il nostro DB è proiezione | Copertura completa del dominio nel modello canonico |
| **2 — Ombra** | Doppia scrittura: ogni operazione è eseguita sul gestionale e, in parallelo, simulata nel core. Riconciliazione notturna con registro delle divergenze | **Parità ≥ 99,9% su 90 giorni consecutivi**, incluse chiusure giornaliere |
| **3 — Passaggio** | In bassa stagione, per struttura. Il core diventa autoritativo; il gestionale resta in sola lettura per un periodo di reversibilità | 30 giorni senza divergenze bloccanti |
| **4 — Distacco** | Il connettore viene disattivato. La struttura è autonoma | — |

**La riconciliazione è un prodotto, non uno script.** Registro delle divergenze consultabile, classificazione (differenza di arrotondamento, fuso orario, logica), e tendenza della parità nel tempo. È l'evidenza oggettiva che sostituisce l'opinione nel decidere il passaggio — ed è ciò che si mostra al cliente per giustificare la fiducia.

**Reversibilità:** finché il gestionale è raggiungibile, il passaggio inverso è la stessa procedura in direzione opposta. La finestra di reversibilità è contrattuale, non solo tecnica.

---

## 5. La scala di graduazione

Percorso standard di una struttura, dal primo modulo all'autonomia completa:

| Gradino | Modulo | Cosa sostituisce | Autoritatività che cambia |
|---|---|---|---|
| 1 | Concierge + messaggistica | Nulla — pura aggiunta | — |
| 2 | Motore di prenotazione diretta + pagamenti | Il widget di prenotazione | — |
| 3 | Pre-arrivo + registrazione + Alloggiati | Un adempimento manuale quotidiano | `guestProfiles` |
| 4 | Pulizie + F&B + arrivo IoT | Carta e passaparola | `housekeeping` |
| 5 | Tariffe, disponibilità, sincronizzazione canali | Il cuore del gestionale | `reservations`, `availabilityAndRates` |
| 6 | **Fatturazione, fiscale, chiusura giornaliera** | **L'ultimo motivo di esistenza del gestionale** | `folioAndFiscal` |

I gradini 1–4 sono a basso rischio e reversibili. Il gradino 5 è il primo che tocca il cuore operativo e richiede la modalità ombra completa. **Il gradino 6 è un dirupo, non un pendio**: il giorno in cui il core diventa autoritativo sul fiscale, la piattaforma assume in un colpo solo SDI, corrispettivi, chiusura giornaliera e la relativa responsabilità legale.

---

## 6. Condizioni di attivazione del gradino 6

**Il gradino 6 non si avvia per entusiasmo, per richiesta di un cliente o per completezza. Si avvia quando tutte le condizioni seguenti sono verificate simultaneamente:**

| # | Condizione | Soglia |
|---|---|---|
| C1 | Strutture operative al gradino 5 | **≥ 25** |
| C2 | Parità in modalità ombra sul dominio fiscale | ≥ 99,9% per **6 mesi**, incluse due chiusure mensili e una chiusura d'anno osservate |
| C3 | Presidio normativo | Risorsa fiscale/compliance contrattualizzata (interna o consulenziale continuativa) |
| C4 | Sostenibilità | Sviluppo finanziato da ricavi ricorrenti della piattaforma, non da anticipi di clienti o promesse di investimento |
| C5 | Copertura | Assicurazione professionale estesa alla responsabilità da errore fiscale |
| C6 | Revisione formale | Aggiornamento scritto di questo documento e del registro decisioni |

**In assenza anche di una sola condizione, il gradino 6 resta chiuso** e le strutture operano indefinitamente al gradino 5 con il gestionale ridotto a motore fiscale. È una configurazione stabile, non un compromesso: il gestionale come "stampante fiscale" è già una vittoria commerciale completa.

*Motivazione della soglia C1: sotto le 25 strutture, il costo permanente del presidio fiscale (€130–180k/anno, riferimento nel documento costi PMS) supera il margine generato dal dominio fiscale stesso.*

---

## 7. Implicazioni per i progetti in corso

- **Connettore Ericsoft (Concierge e Rooms):** nessuna modifica alle interfacce. Cambia l'implementazione interna: le letture popolano il modello canonico con provenienza e riferimenti esterni, in modo che i dati raccolti oggi siano già il seme della modalità autonoma.
- **Motore di prenotazione (gradino 2):** le prenotazioni dirette nascono **nel nostro core** e vengono riflesse verso Ericsoft, non il contrario. È il primo dominio in cui la piattaforma è autoritativa fin dall'inizio, ed è il banco di prova della doppia sorgente.
- **Modulo Alloggiati (gradino 3):** già progettato per operare dal nostro dato di pre-arrivo; nessuna revisione necessaria.
- **Cruscotto:** deve esporre, per struttura, la mappa di autoritatività e lo stato di parità. La trasparenza sul "chi comanda su cosa" è anche un argomento commerciale.

---

## 8. Registro decisioni — nuove voci

| # | Decisione | Motivazione |
|---|---|---|
| **D10** | La piattaforma possiede il proprio modello dei dati dal primo giorno; i gestionali esterni sono sorgenti di sincronizzazione con autoritatività configurabile per dominio | Rende il distacco dai sistemi esistenti un cambio di sorgente anziché una migrazione; evita la riscrittura altrimenti necessaria in modalità autonoma |
| **D11** | Il dominio fiscale (gradino 6) è vincolato alle condizioni C1–C6 della sezione 6 e non può essere avviato prima della loro verifica simultanea e documentata | Il fiscale è l'area a maggiore complessità e regolamentazione; l'attivazione prematura espone a responsabilità legale senza copertura economica |
| D12 | Il motore di prenotazione diretta è il primo dominio ad autoritatività di piattaforma | Banco di prova della doppia sorgente su un dominio a basso rischio fiscale |

---

## 9. Rischi specifici di questa architettura

| Rischio | Mitigazione |
|---|---|
| Il modello canonico degenera nella forma di Ericsoft sotto pressione di consegna | Regola di revisione (2.2); il primo connettore diverso da Ericsoft è anche un test di pulizia del modello |
| La doppia scrittura in modalità ombra introduce divergenze silenziose | Riconciliazione notturna con registro; la parità è una metrica esposta, non un controllo occasionale |
| Un passaggio effettuato troppo presto per entusiasmo del cliente | Le soglie della sezione 4 e 6 sono nel sistema e nel contratto, non nella memoria |
| Ericsoft modifica o revoca l'accesso API dopo che strutture sono in modalità integrata | La proiezione canonica è già completa: l'evento accelera la graduazione anziché bloccarla. È la differenza strategica rispetto all'architettura senza dato proprio |
| Doppio onere di manutenzione (connettore + core) nei domini in transizione | La transizione per dominio è temporanea per costruzione; la mappa di autoritatività ne rende visibile la durata |

---

## 10. Sintesi

La proprietà del dato dal primo giorno costa qualcosa ora — il modello canonico va costruito con più cura, la sincronizzazione registra provenienza e riferimenti, la riconciliazione è un componente di prodotto. In cambio rende vere tre affermazioni che altrimenti sarebbero promesse:

1. **"Si integra con il vostro gestionale"** — modalità integrata, dal primo giorno
2. **"Potrete abbandonarlo gradualmente"** — la scala, un dominio alla volta, con evidenza oggettiva di parità
3. **"E un giorno non vi servirà più"** — modalità autonoma, quando le condizioni sono soddisfatte, senza migrazione

La terza affermazione resta vincolata alle condizioni del gradino 6. È l'unico punto in cui la prudenza non è negoziabile, ed è per questo che è una decisione registrata e non un'intenzione.

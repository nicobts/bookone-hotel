# Proposta preliminare — Hotel Sonja

**Valutazione di scenario: sistema gestionale alberghiero con AI, IoT e integrazioni**

| | |
|---|---|
| A cura di | RT Holding Group GmbH (Austria) |
| Destinatario | Hotel Sonja |
| Stato | **Bozza preliminare — documento di discussione** |
| Data | Luglio 2026 |

> **Nota sullo stato del documento.** Questa è una prima bozza di inquadramento, non un preventivo. I valori indicati sono ordini di grandezza di riferimento, destinati a rendere confrontabili le opzioni e a supportare la decisione su come proseguire. Ogni cifra andrà consolidata dopo una fase di analisi puntuale.

---

## 1. Scopo del documento

Nel corso dei nostri confronti sono emerse diverse esigenze, tutte legittime e tutte tecnicamente realizzabili:

- un sistema gestionale (PMS) più moderno e usabile dell'attuale
- funzionalità di intelligenza artificiale realmente integrate nei processi, non aggiunte a margine
- integrazione con piattaforme di terze parti (channel manager, POS, contabilità, revenue)
- integrazione IoT completa: gestione camere, controllo accessi, apertura porte, avvio automatico del check-in
- fatturazione, adempimenti fiscali e documentali a norma di legge
- il tutto in una prospettiva di sostituzione degli attuali fornitori (Ericsoft / Zucchetti)

Questo documento ha due obiettivi:

1. **Rendere esplicita la dimensione reale** di un progetto di questo tipo, in termini di costi, tempi, risorse e complessità.
2. **Presentare due percorsi di collaborazione concreti e alternativi**, con profili di rischio e di investimento molto diversi tra loro.

Riteniamo corretto essere trasparenti fin dall'inizio: la differenza tra le due opzioni non è di qualità, ma di **ambizione, capitale e orizzonte temporale**.

---

## 2. Cosa significa realmente costruire un PMS completo

Un gestionale alberghiero non è un software di prenotazione con qualche funzione in più. È l'infrastruttura operativa, fiscale e legale su cui la struttura lavora ogni giorno. Un albergo o ci lavora sopra interamente, o non ci lavora affatto: **non esiste una versione "minima" utilizzabile**.

Le aree di complessità sono le seguenti.

### 2.1 Motore prenotazioni e inventario
Disponibilità, tipologie camere, listini, tariffe derivate, restrizioni (minimum stay, closed to arrival), contingenti, gruppi, contratti negoziati. È il cuore matematico del sistema e ogni errore si traduce in overbooking o mancato ricavo.

### 2.2 Operatività front office
Planning camere, check-in e check-out, cambi camera, **chiusura giornaliera (night audit)**. La chiusura giornaliera è tecnicamente una transazione distribuita che non può mai completarsi a metà: se si interrompe, i conti del giorno successivo sono errati.

### 2.3 Fatturazione e adempimenti fiscali
Conti camera, divisione conti, acconti, no-show, **fatturazione elettronica via SDI**, corrispettivi telematici / registratore telematico. Se il progetto si estende all'Austria e alla Slovenia, si aggiungono RKSV e FURS: normative diverse, con calendari e certificazioni indipendenti.

### 2.4 Adempimenti verso la pubblica amministrazione
**Alloggiati Web** (comunicazione alla Questura entro 24 ore), imposta di soggiorno — che varia **per singolo comune**, non per regione — rilevazioni ISTAT e regionali. Nessuna di queste funzioni è un vantaggio competitivo: sono obblighi. Ma se non ci sono, il sistema non è vendibile.

### 2.5 Distribuzione
Sincronizzazione bidirezionale con il channel manager e certificazione presso i portali (Booking.com, Expedia). Non è un lavoro che si può accelerare: dipende da code di certificazione esterne.

### 2.6 Pagamenti
Autorizzazioni, cauzioni, tokenizzazione delle carte per le politiche di no-show, SCA/PSD2, gestione dei contestati. L'architettura va progettata fin dall'inizio per non entrare nel perimetro PCI più oneroso.

### 2.7 Integrazioni di terze parti
Serrature, POS, centralino, esportazione contabile, revenue management, domotica. Ogni integrazione richiede l'autorizzazione del fornitore, una certificazione, e successivamente **manutenzione permanente**: le API cambiano, i campi vengono deprecati, le autenticazioni ruotano.

### 2.8 Affidabilità operativa
Un errore in un sistema di prenotazione ristorante fa perdere un coperto. Un errore in un PMS significa che un cliente non riesce a fare il check-in alle 23:00, o che la struttura non può emettere una fattura. Serve **funzionamento anche in assenza di connettività**, disaster recovery, e assistenza telefonica multilingue su turni estesi.

### 2.9 Migrazione
Storico prenotazioni, conti, anagrafiche clienti, riformazione del personale. È l'ostacolo pratico principale al cambio di gestionale, più del prezzo.

---

## 3. Perché il vero ostacolo non è il software

Questo è il punto che riteniamo più importante condividere apertamente.

**Il vantaggio competitivo di Ericsoft e Zucchetti non è la qualità del codice.** È l'accumulo di trent'anni di conformità normativa, la base installata, e il rapporto consolidato con i commercialisti che già utilizzano l'ecosistema Zucchetti per la contabilità.

Ne derivano tre conseguenze concrete:

**L'AI non comprime i tempi che contano.** Gli strumenti di sviluppo assistito da intelligenza artificiale riducono realmente i costi di sviluppo — stimiamo tra il 40% e il 50% sulla parte di programmazione. Ma non riducono: i tempi di autorizzazione delle API da parte dei fornitori (2–5 mesi), le code di certificazione dei portali (3–5 mesi), e soprattutto **una stagione alta completa più una chiusura d'anno in esercizio parallelo** — dodici mesi incomprimibili, perché gli errori sulla chiusura giornaliera e sui casi fiscali limite emergono solo sotto carico reale e alle scadenze reali.

**La finestra commerciale è stretta.** Gli alberghi cambiano gestionale solo tra novembre e febbraio. Un ritardo non costa settimane: costa un anno.

**Un fornitore nuovo parte con uno svantaggio di fiducia.** Si chiede a una struttura di scommettere la propria stagione su un sistema senza storico. È un ostacolo superabile, ma va messo in conto nel piano commerciale.

---

## 4. Stima di riferimento: costi, tempi, risorse

Le stime seguenti includono già il beneficio dello sviluppo assistito da AI. Non sono preventivi.

### Scenario A — Sistema minimo vendibile

Solo Italia. Struttura singola, 30–120 camere. Tutto ciò che è acquistabile viene acquistato anziché sviluppato. Include il livello AI, perché è l'unico vero motivo per cui una struttura cambierebbe sistema.

| | |
|---|---|
| Effort di sviluppo | 25–28 mesi/persona |
| Team di picco | 2–3 persone |
| Primo ricavo | mese 20–26 |
| **Investimento** | **€350.000 – €520.000** |

### Scenario B — Prodotto competitivo, azienda internazionale strutturata e avviata

Mercato europeo. Multi-struttura e catene. Ecosistema completo di integrazioni. App ospite e personale. Organizzazione di supporto e assistenza.

| | |
|---|---|
| Effort di sviluppo | 95–130 mesi/persona |
| Team di picco | 11–15 persone |
| Primo ricavo | mese 30–36 |
| **Investimento** | **€2.600.000 – €4.300.000** |

**È importante chiarire che questo scenario non è un progetto di sviluppo software.** È la costituzione di un'azienda internazionale strutturata, con tutto ciò che comporta: un organico stabile su più funzioni (sviluppo, prodotto, assistenza, implementazione, vendita, amministrazione), presidio normativo e fiscale in ogni paese in cui si opera, un'organizzazione di supporto multilingue su turni estesi, una rete commerciale e di partner locali, certificazioni e adempimenti societari in più giurisdizioni.

Ogni nuovo paese europeo non aggiunge soltanto una traduzione: aggiunge un regime fiscale, un sistema di adempimenti verso la pubblica amministrazione, un calendario di certificazioni indipendente e una manutenzione normativa permanente. È questo, e non lo sviluppo del software, a determinare la dimensione dell'investimento e dell'organizzazione.

Uno scenario di questo tipo presuppone quindi capitale istituzionale, un team direzionale completo e un orizzonte di 5–7 anni. Lo riportiamo per completezza e come termine di paragone, non come proposta operativa immediata.

### Costo ricorrente permanente

Indipendente dallo sviluppo, e non si esaurisce mai:

| Voce | Annuo |
|---|---|
| Manutenzione fiscale Italia (SDI, RT, aggiornamenti normativi annuali) | €60k – €90k |
| Manutenzione adempimenti (Alloggiati, ISTAT, imposta di soggiorno per comune) | €40k – €60k |
| Ulteriori paesi europei, dallo scenario B (indicativo, per paese: €25k – €50k) | €50k – €110k |
| **Totale** | **€130.000 – €260.000 / anno** |

Equivale a 1,5–2,5 persone a tempo pieno, **in via permanente, senza produrre alcuna nuova funzionalità**. È la voce più frequentemente omessa nei piani di questo tipo, ed è quella che determina la sostenibilità nel lungo periodo.

### Sostenibilità economica

A un prezzo realistico per il mercato degli alberghi indipendenti italiani (€300–800 per struttura al mese), il punto di pareggio si colloca tra **100 e 250 strutture attive**. Con una velocità commerciale realistica — 15–25 strutture il primo anno, 40–60 il secondo — **il pareggio si raggiunge tra il quarto e il sesto anno**.

Questo è il dato che, a nostro avviso, deve orientare la scelta tra le due opzioni che seguono.

---

## 5. Opzione 1 — Progetto consortile con finanza agevolata

### Impostazione

Un progetto di questa dimensione non è sostenibile da una singola struttura, ma diventa realistico se il costo viene distribuito e parzialmente coperto da strumenti di finanza agevolata.

L'impostazione prevede:

1. **Costituzione di un gruppo di strutture partner** — alberghi indipendenti con esigenze omogenee (dimensione, mercato, tipologia), preferibilmente già in relazione tra loro tramite consorzi o associazioni di categoria. Il nucleo iniziale può partire da **6 strutture**, con l'obiettivo di arrivare progressivamente a 12–25.
2. **Definizione di un capitolato comune**, in modo che il prodotto risponda a esigenze condivise e non a personalizzazioni individuali.
3. **Accesso a strumenti di finanza agevolata** nazionali ed europei per la digitalizzazione e l'innovazione del comparto turistico.
4. **Sviluppo del prodotto** con le strutture partner come primi utilizzatori e come referenze commerciali.

### Strumenti di finanziamento da valutare

Le famiglie di strumenti potenzialmente applicabili sono le seguenti. **Disponibilità, dotazione e finestre di apertura vanno verificate puntualmente con un consulente specializzato**, poiché variano frequentemente:

- Bandi nazionali per la digitalizzazione e la competitività delle imprese turistiche
- Crediti d'imposta per investimenti in beni strumentali e transizione digitale/energetica
- Bandi regionali su fondi FESR — in particolare Bolzano, Trento, Veneto, Friuli Venezia Giulia
- Programmi europei per l'innovazione digitale delle PMI (Digital Europe, Horizon Europe, EIC)
- Strumenti per progetti di cooperazione transfrontaliera Italia–Austria e Italia–Slovenia, particolarmente pertinenti data la natura multi-paese del progetto
- Finanziamenti agevolati e strumenti di garanzia per l'innovazione

La copertura tipica di questi strumenti si colloca indicativamente tra il 30% e il 50% dell'investimento ammissibile.

### Modello economico: quota mensile per struttura

Il progetto non richiede alle strutture partner un esborso una tantum, che sarebbe difficile da sostenere e da giustificare a bilancio. Il modello è invece una **quota mensile per struttura, indicativamente €2.000 – €3.000**, che finanzia contemporaneamente due cose:

**1. Lo sviluppo della nuova piattaforma**, di cui le strutture partner sono committenti e primi utilizzatori, con condizioni di licenza privilegiate a regime.

**2. Un servizio continuativo di assistenza, consulenza e ottimizzazione** su tutti i flussi della struttura, attivo tutto l'anno e fin dal primo mese — non al termine dello sviluppo.

Questo secondo punto è, a nostro avviso, **il vero vantaggio del modello consortile** ed è ciò che lo distingue da un normale contratto di sviluppo software.

### Cosa comprende il servizio continuativo

Ogni struttura partner dispone di fatto di **un team IT dedicato**, condiviso tra i partner ma con referente e priorità proprie:

- Assistenza sui sistemi attualmente in uso, incluso Ericsoft — non si aspetta la nuova piattaforma per avere supporto
- Analisi e ottimizzazione dei flussi operativi: ricevimento, pulizie, ristorazione, amministrazione
- Risoluzione di problemi tecnici e di integrazione tra i sistemi esistenti
- Sviluppo di automazioni e moduli specifici sulle esigenze della singola struttura
- Proposte proattive di miglioramento su base periodica, non solo su richiesta
- Formazione del personale e documentazione dei processi
- Supporto nella scelta e nella valutazione di fornitori terzi

In sostanza: **le strutture partner non pagano per attendere un prodotto futuro. Ricevono valore operativo dal primo mese**, e nel frattempo il prodotto viene costruito sulle loro esigenze reali anziché su ipotesi.

### Ripartizione indicativa

Con una quota media di €2.500 per struttura al mese:

| Numero strutture | Ricavo annuo | Capacità del team |
|---|---|---|
| 6 (nucleo iniziale) | €180.000 | ~2 persone |
| 12 | €360.000 | ~4 persone |
| 20 | €600.000 | ~6 persone |
| 25 | €750.000 | ~8 persone |

Su un orizzonte di tre anni, un gruppo che cresca da 6 a 20 strutture genera indicativamente **€1.100.000 – €1.400.000**. Sommando una copertura da finanza agevolata del 30–40% e il conferimento di capitale e lavoro di RT Holding Group, si raggiunge la soglia necessaria a sostenere lo sviluppo della piattaforma.

**Per la singola struttura** l'impegno è quindi di €24.000 – €36.000 all'anno, a fronte di un servizio IT continuativo che, acquistato separatamente, costerebbe una cifra analoga — con in più la contitolarità di un progetto di piattaforma e condizioni privilegiate a regime.

### Perché 6 strutture è la soglia minima

Sotto le 6 strutture il modello non regge: la quota non sostiene un team stabile, e il servizio continuativo — che è la parte di valore immediato — non sarebbe erogabile con la qualità promessa. Sopra le 6 il nucleo è autosufficiente e può crescere in modo organico, aggiungendo capacità man mano che entrano nuovi partner.

Il limite superiore di 25 non è tecnico ma di governance: oltre quella soglia diventa difficile mantenere un capitolato condiviso senza che il progetto si frammenti in personalizzazioni individuali.

### Punti di forza

- **Valore operativo dal primo mese**, non al termine dello sviluppo
- Rischio distribuito su più soggetti
- Prodotto validato da più strutture fin dall'origine, quindi realmente commercializzabile
- Struttura di governance idonea ad attrarre investitori istituzionali successivi
- La partecipazione al bando è di per sé un test di solidità del progetto

### Punti di attenzione

- Tempi di istruttoria dei bandi: 6–12 mesi prima dell'avvio operativo
- Richiede una capacità di aggregazione delle strutture partner che va costruita
- Rendicontazione e obblighi amministrativi non trascurabili
- Necessita di un partner tecnico strutturato: **un team di 2–3 persone non è sufficiente per lo scenario B**

### Ruolo di Hotel Sonja

In questo scenario Hotel Sonja assumerebbe il ruolo di **struttura capofila**: definizione dei requisiti, coordinamento del gruppo partner, prima installazione e struttura di riferimento. Un ruolo che comporta condizioni economiche privilegiate a regime e visibilità nel progetto.

---

## 6. Opzione 2 — Collaborazione modulare sui sistemi esistenti

### Impostazione

Se Hotel Sonja desidera procedere autonomamente e con tempi rapidi, l'approccio corretto **non è sostituire Ericsoft, ma costruirci sopra**.

Si mantiene il gestionale attuale come sistema di riferimento — con tutta la sua conformità fiscale e i suoi adempimenti già funzionanti — e si sviluppano **moduli custom dedicati**, integrati tramite API, che intervengono in modo chirurgico sui processi dove la struttura perde effettivamente tempo e ricavi.

Il vantaggio non è solo economico. È che si elimina completamente:

- il rischio di migrazione
- il rischio di non conformità fiscale
- l'attesa di 20+ mesi prima di vedere un risultato
- la necessità di riformare il personale su un sistema nuovo

### Modello di collaborazione

| | |
|---|---|
| Formula | Retainer mensile |
| Importo indicativo | **€6.000 / mese** |
| Risorse allocate | 2–3 persone part-time (≈ 1 FTE equivalente) |
| Durata minima consigliata | 10–12 mesi, rinnovabile |
| Cadenza | Rilascio modulare continuo, revisione mensile delle priorità |

Il retainer copre analisi, sviluppo, integrazione, test e manutenzione dei moduli rilasciati. Non copre licenze di terze parti, hardware, o costi variabili di servizi esterni, che sono da concordare separatamente e in modo trasparente. In particolare, **l'hardware e l'installazione relativi al progetto IoT (Fasi 2 e 3) costituiscono un investimento a sé stante**, quantificato nel documento tecnico dedicato.

### Moduli realizzabili

L'ordine è indicativo e viene definito insieme, in base al ritorno atteso. Ogni modulo è indipendente e rilasciato in esercizio prima di iniziare il successivo.

**Fase 1 — Comunicazione e accoglienza**

| Modulo | Beneficio |
|---|---|
| Concierge telefonico AI | Nessuna chiamata persa fuori orario o durante i picchi al ricevimento. Ogni chiamata persa è una prenotazione diretta che finisce su un portale con il 15–20% di commissione |
| Check-in online pre-arrivo | Raccolta documenti e dati prima dell'arrivo, senza coda al ricevimento |
| Invio automatico Alloggiati Web | Elimina un adempimento quotidiano manuale e riduce il rischio di sanzione |

---

#### Fasi 2 e 3 — Progetto di integrazione IoT completa

> **Nota.** Le Fasi 2 e 3 non sono moduli isolati: costituiscono insieme un **progetto di integrazione IoT completo e strutturato**, finalizzato a realizzare una piattaforma di gestione camere, accessi e impianti pienamente integrata e operativa.
>
> Questo progetto è descritto in dettaglio nel documento tecnico dedicato **«BookOne Rooms — Connected room layer: occupancy, access, and contactless arrival»** (IOT-PROPOSAL), che ne definisce architettura, fasi, requisiti hardware, aspetti normativi e stima dei costi di installazione.
>
> **Punto importante:** questo progetto può essere sviluppato in modo autonomo e indipendente dal progetto di piattaforma descritto nell'Opzione 1, e si integra con i sistemi già in essere presso la struttura — incluso il gestionale Ericsoft. Non richiede quindi la sostituzione di alcun sistema esistente e può procedere con tempi e budget propri.
>
> Le tabelle seguenti riportano in sintesi i moduli previsti. Per il perimetro completo, i vincoli tecnici e le condizioni preliminari si rimanda al documento tecnico.

**Fase 2 — Accessi e camere**

| Modulo | Beneficio |
|---|---|
| Chiave digitale su smartphone | L'ospite raggiunge la camera direttamente. Nessuna tessera smarrita |
| Completamento arrivo da evento porta | Il check-in si completa automaticamente quando l'ospite apre la camera, dopo che l'identità è già stata registrata online |
| Stato camera e presenza | Le pulizie sanno quali camere sono occupate senza bussare |

**Fase 3 — Efficienza e risparmio**

| Modulo | Beneficio |
|---|---|
| Climatizzazione basata su occupazione | Riduzione tipica del 15–30% sui consumi di riscaldamento e climatizzazione |
| Rilevazione perdite e finestre aperte | Prevenzione danni, argomento negoziale con l'assicurazione |
| Reportistica energetica | Base per la conformità alla direttiva europea sull'efficienza energetica degli edifici (EPBD), che introduce obblighi progressivi per gli edifici non residenziali |

**Verifica preliminare determinante.** Il costo dell'intero progetto IoT dipende in modo decisivo da un solo elemento: se le serrature installate sono **collegate in rete con API** oppure **offline con scrittura su tessera**. Nel primo caso l'investimento in hardware si colloca indicativamente tra €12.000 e €26.000 per struttura; nel secondo, richiedendo la sostituzione delle serrature, sale a €36.000 – €74.000. È la prima verifica da effettuare e nessuna quotazione è possibile prima di averla completata.

---

**Fase 4 — Ottimizzazione operativa**

| Modulo | Beneficio |
|---|---|
| Riepilogo giornaliero arrivi/partenze al personale | Meno tempo in preparazione turno |
| Gestione integrata ristorante e mezza pensione | Area in cui i gestionali generalisti sono strutturalmente deboli |
| Cruscotto direzionale | Indicatori operativi ed economici in un'unica vista |

### Sequenza consigliata

Consigliamo di iniziare dal **concierge telefonico AI**, per tre ragioni:

1. È il modulo con il ritorno più rapido e più facilmente misurabile — le chiamate perse sono un dato oggettivo, non un'opinione
2. Non richiede alcuna integrazione con Ericsoft nella prima versione, quindi può partire immediatamente
3. Si attiva con una semplice deviazione di chiamata su mancata risposta: **non tocchiamo il numero principale della struttura e la configurazione è reversibile in un minuto**

Le fasi successive richiedono l'accesso alle API di Ericsoft, che è un elemento da verificare come prima attività (vedi sezione 8).

### Punti di forza

- Primi risultati operativi entro 6–10 settimane
- Investimento contenuto, con impegno limitato al periodo minimo concordato
- Nessun rischio sulla conformità fiscale, che resta in capo al gestionale attuale
- Ogni modulo è indipendente: si può fermare, cambiare priorità, o estendere
- Le soluzioni sono costruite sui processi specifici di Hotel Sonja, non su un prodotto generalista

### Punti di attenzione

- Si resta dipendenti da Ericsoft e dalle sue scelte tecnologiche
- Alcuni moduli richiedono l'autorizzazione del fornitore all'accesso API
- Non si costruisce un asset proprietario completo, ma un livello di ottimizzazione
- I limiti strutturali dell'attuale gestionale rimangono tali

---

## 7. Confronto sintetico

| | **Opzione 1 — Progetto consortile** | **Opzione 2 — Collaborazione modulare** |
|---|---|---|
| Obiettivo | Prodotto proprietario, sostituzione gestionale | Ottimizzazione dei processi sui sistemi esistenti |
| Investimento Hotel Sonja | €2.000 – €3.000 / mese | €6.000 / mese |
| Cosa comprende | Sviluppo piattaforma **+ servizio IT continuativo** | Sviluppo moduli custom dedicati |
| Investimento complessivo | €1,5M – €4,3M | Scalabile, interrompibile |
| Primi risultati operativi | **Dal primo mese** (servizio) · 20–30 mesi (piattaforma) | **6–10 settimane** |
| Rischio | Alto sulla piattaforma, contenuto sul servizio | Contenuto |
| Rischio fiscale e di migrazione | Significativo | **Nessuno** |
| Team richiesto | 11–15 persone a regime | 2–3 persone |
| Prerequisiti | Almeno 6 strutture partner + accesso a bandi | Nessuno per la fase 1 |
| Reversibilità | Media | **Alta** (oltre il periodo minimo) |

**Le due opzioni non sono alternative definitive.** L'Opzione 2 è il percorso naturale verso l'Opzione 1: i moduli sviluppati sui sistemi esistenti costituiscono la base tecnologica, l'esperienza di dominio e — soprattutto — le referenze operative necessarie per sostenere credibilmente un progetto consortile e una domanda di finanziamento.

Il nostro suggerimento è di considerare l'Opzione 2 come punto di partenza in ogni caso, e di valutare l'Opzione 1 quando i primi moduli avranno dimostrato risultati misurabili.

---

## 8. Verifiche preliminari

Alcuni elementi vanno chiariti prima di qualsiasi impegno formale. Sono attività rapide, ma condizionano l'intero percorso.

**Bloccanti**

- [ ] **Accesso alle API Ericsoft**: la richiesta di integrazione va presentata da Hotel Sonja in quanto titolare della licenza. I tempi di risposta sono nell'ordine di 2–5 mesi e non sono sotto il nostro controllo. È l'attività da avviare per prima.
- [ ] **Serrature installate**: marca, modello, e soprattutto se sono **collegate in rete con API** oppure offline con scrittura su tessera. È la differenza tra un progetto IoT da €12.000 e uno da €70.000 per struttura.
- [ ] **Ericsoft integra già le serrature installate?** In caso affermativo il percorso di integrazione può passare dal gestionale, con costi e complessità nettamente inferiori.

**Non bloccanti, ma necessari per quantificare**

- [ ] Volume di chiamate in entrata e percentuale di chiamate non risposte (dato estraibile dal centralino)
- [ ] Centralino attualmente in uso: cloud o on-premise, fornitore
- [ ] Bollette energetiche degli ultimi 24 mesi e potenza termica installata, per il modello di risparmio
- [ ] Numero camere, piani, tipo di costruzione (la muratura incide sulla portata dei dispositivi wireless)
- [ ] Le tre attività che oggi assorbono più tempo al ricevimento
- [ ] Presenza di ristorante e se serve anche clientela esterna

---

## 9. Prossimi passi proposti

1. **Incontro di allineamento** su questo documento, per capire quale direzione corrisponde effettivamente agli obiettivi della proprietà
2. **Avvio immediato della richiesta di accesso API a Ericsoft**, indipendentemente dall'opzione scelta: è il vincolo temporale più lungo e va sbloccato subito
3. **Analisi preliminare** presso la struttura (2 giornate) per completare le verifiche della sezione 8
4. **Proposta operativa definitiva** con perimetro, tempi e importi consolidati

---

## 10. Note

Le stime economiche contenute in questo documento sono ordini di grandezza a scopo di orientamento, elaborati sulla base dell'esperienza nel settore e di parametri di mercato. Non costituiscono offerta contrattuale.

I riferimenti a strumenti di finanza agevolata sono indicativi: disponibilità, dotazioni e finestre temporali variano frequentemente e vanno verificati con un consulente specializzato prima di qualsiasi pianificazione.

Gli aspetti fiscali, normativi e di conformità richiamati (fatturazione elettronica, adempimenti verso la pubblica amministrazione, protezione dei dati, direttive europee sull'efficienza energetica) sono descritti a titolo di inquadramento tecnico e vanno validati con i consulenti legali e fiscali competenti per ciascuna giurisdizione.

---

**RT Holding Group GmbH**
Austria

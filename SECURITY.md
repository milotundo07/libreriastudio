# Biblioteca dello Studio

Applicazione web local-first per catalogare una biblioteca personale. Ogni record rappresenta un **esemplare fisico**: la stessa edizione può quindi comparire più volte con codici inventario, collocazioni, condizioni e provenienze diverse.

L’app funziona come sito statico su GitHub Pages, è installabile come PWA e conserva i dati nel browser tramite IndexedDB. Non richiede account né un server per le funzioni fondamentali.

## Funzioni principali

- inserimento e modifica manuale;
- scansione ISBN-13 tramite fotocamera;
- verifica del checksum ISBN-10 e ISBN-13;
- ricerca parallela su Google Books e Open Library;
- integrazione SBN diretta o tramite proxy opzionale controllato;
- riconoscimento OCR della copertina eseguito nel browser;
- scelta manuale dell’edizione dopo il riconoscimento;
- più copie della stessa edizione;
- codice inventario univoco `BIB-000001`;
- ricerca senza distinzione tra accenti e con parole in ordine diverso;
- filtri per stato e stanza;
- cestino con ripristino;
- backup JSON versionato, comprese le copertine locali;
- importazione JSON o Excel verificata prima del salvataggio;
- importazione in una singola transazione IndexedDB;
- ripristino dell’archivio precedente all’ultima importazione;
- esportazione Excel con campi personalizzati in colonne separate;
- richiesta di memoria persistente al browser;
- interfaccia accessibile e responsive;
- installazione PWA e funzionamento offline delle funzioni locali;
- test automatici e deploy GitHub Pages tramite GitHub Actions.

## Avvio locale

Non aprire `index.html` con un doppio clic: moduli JavaScript, fotocamera e service worker richiedono un server HTTP.

```bash
npm run serve
```

Poi apri:

```text
http://localhost:4173
```

Per eseguire i controlli:

```bash
npm run check
npm test
```

Non sono necessarie dipendenze npm per usare o testare il progetto. Le librerie pesanti vengono caricate soltanto quando servono:

- `html5-qrcode` per la scansione;
- `Tesseract.js` per l’OCR;
- `SheetJS` per Excel.

Le versioni sono fissate in `src/config.js`.

## Pubblicazione in un nuovo repository GitHub

1. Crea un repository vuoto, per esempio `biblioteca-studio`.
2. Carica l’intero contenuto di questa cartella nella root.
3. Apri **Settings → Pages**.
4. In **Build and deployment**, scegli **GitHub Actions**.
5. Esegui un push sul branch `main`.

Il workflow `.github/workflows/pages.yml` pubblicherà automaticamente il sito.

Il workflow `.github/workflows/quality.yml` esegue controlli sintattici e test a ogni push e pull request.

## Migrazione dal vecchio progetto

La nuova applicazione usa lo stesso nome di database IndexedDB, `bibliotecaStudioDB`, e aggiorna lo schema dalla versione 1 alla versione 2.

Se pubblichi il progetto sullo **stesso dominio e percorso** del vecchio sito, i dati locali possono essere migrati automaticamente. Se usi un nuovo repository e quindi un nuovo URL GitHub Pages:

1. nel vecchio sito scarica `Backup JSON`;
2. apri il nuovo sito;
3. scegli **Dati e backup → Importa backup JSON**;
4. controlla il riepilogo;
5. scegli **Unisci** oppure **Sostituisci**.

I vecchi backup costituiti da un semplice array JSON restano accettati.

## Modello dei dati

Un record rappresenta un esemplare. I campi si dividono concettualmente in:

- **opera:** titolo, autore, titolo originale, soggetti;
- **edizione:** ISBN, editore, anno, traduttore, collana, formato;
- **esemplare:** codice inventario, numero copia, stanza, scaffale, condizione, provenienza e acquisizione.

L’app conserva questi dati in un singolo record per restare semplice e compatibile con Excel, ma non vieta ISBN duplicati. Il solo identificatore che deve restare unico è il codice inventario.

## Backup e sicurezza dei dati

I dati principali restano nel browser. Questo comporta un limite inevitabile: cancellare i dati del sito, cambiare browser o dispositivo può rendere l’archivio inaccessessibile.

Pratiche consigliate:

- concedere la memoria persistente da **Dati e backup**;
- scaricare regolarmente un backup JSON;
- conservare il backup in almeno due luoghi;
- usare Excel per consultazione e modifiche di massa, ma JSON come formato di ripristino più completo.

Prima di ogni importazione la versione corrente dell’archivio viene salvata localmente come snapshot. Il pulsante **Annulla ultima importazione** permette di ripristinarla.

L’importazione avviene in una sola transazione: in caso di errore, IndexedDB annulla l’intera operazione.

## Cataloghi e privacy

Le ricerche bibliografiche inviano ISBN, titolo o autore ai cataloghi interrogati:

- Google Books;
- Open Library;
- SBN, quando raggiungibile.

La fotografia della copertina non viene inviata a questi cataloghi. L’OCR viene eseguito nel browser; ai cataloghi vengono inviate soltanto le parole ricavate dall’immagine.

Il progetto non usa proxy CORS pubblici generici e non usa JSONP, perché entrambi permetterebbero a servizi terzi di osservare o eseguire codice nel contesto dell’app.

## SBN opzionale

Alcuni browser possono bloccare le richieste dirette verso SBN per le regole CORS. In quel caso l’app continua a funzionare con Google Books e Open Library.

Per abilitare SBN in modo affidabile:

1. distribuisci `optional-worker/worker.js` come Cloudflare Worker;
2. copia l’URL del Worker;
3. inseriscilo in `src/config.js`:

```js
export const CATALOG_PROXY_URL = "https://tuo-worker.workers.dev";
```

Il Worker accetta soltanto richieste HTTPS verso `opac.sbn.it/opacmobilegw/`. Non è un proxy aperto.

## Struttura del progetto

```text
.
├── index.html
├── styles.css
├── manifest.webmanifest
├── sw.js
├── icons/
├── src/
│   ├── app.js
│   ├── backup.js
│   ├── catalogs.js
│   ├── config.js
│   ├── db.js
│   ├── excel.js
│   ├── isbn.js
│   ├── model.js
│   ├── ocr.js
│   ├── scanner.js
│   └── utils.js
├── tests/
├── optional-worker/
└── .github/workflows/
```

## Limiti noti

- le ricerche online richiedono connessione;
- l’OCR può sbagliare su copertine illustrate, inclinate o con caratteri decorativi;
- la disponibilità e la qualità dei metadati dipendono dai cataloghi esterni;
- GitHub Pages non permette intestazioni HTTP personalizzate, quindi la Content Security Policy è dichiarata tramite meta tag;
- il service worker deve essere aggiornato modificando `CACHE_NAME` quando si vuole forzare il rinnovo completo della cache.

## Licenza

MIT. Vedi `LICENSE`.

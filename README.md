# Biblioteca dello Studio

Applicazione statica per GitHub Pages che permette di catalogare una biblioteca personale e riconoscere i libri tramite scansione del codice a barre ISBN.

## File da caricare nella root del repository

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

## Pubblicazione su GitHub Pages

1. Carica questi file direttamente nella cartella principale del repository.
2. Vai su **Settings → Pages**.
3. In **Build and deployment**, scegli **Deploy from a branch**.
4. Seleziona il branch `main` e la cartella `/ (root)`.
5. Salva.

L'app sarà disponibile all'indirizzo:

`https://milotundo07.github.io/libreriastudio/`

## Dati e backup

I libri vengono salvati nel browser tramite IndexedDB. Non vengono caricati su GitHub.

Usa regolarmente **Backup JSON**. Il file JSON può essere importato su un altro computer o telefono tramite il pulsante **Importa JSON**.

## Funzioni

- scansione ISBN/EAN-13 con fotocamera;
- riconoscimento tramite Open Library e Google Books;
- inserimento e modifica manuale;
- ricerca, filtri e ordinamento;
- collocazione per stanza e scaffale;
- stato e condizione del libro;
- campi personalizzati;
- esportazione JSON e CSV;
- importazione di backup JSON.

## Inserimento automatico tramite ISBN

Dopo la scansione, l'app cerca automaticamente il volume su Google Books e Open Library e lo salva subito nella biblioteca. Titolo, autore, editore, anno, pagine, lingua, categorie e copertina vengono compilati quando disponibili. La compilazione manuale è richiesta soltanto se l'ISBN non è presente nei cataloghi online.

## Ricerca ISBN robusta

La versione 5 usa JSONP per interrogare Google Books e Open Library direttamente da GitHub Pages, evitando i blocchi CORS dei browser mobili. Prova automaticamente sia ISBN-13 sia ISBN-10 e usa una seconda ricerca più ampia quando l'edizione non è indicizzata correttamente nel campo ISBN.

## Catalogo SBN per libri italiani

La versione 6 interroga anche il catalogo SBN, particolarmente utile per le edizioni italiane non presenti su Google Books o Open Library. L'app prova l'accesso diretto e, se il browser lo blocca per CORS, usa due proxy di riserva. Il solo dato inviato ai cataloghi è il codice ISBN.

## Riconoscimento dalla copertina

Per i libri privi di codice a barre è disponibile il pulsante “Riconosci copertina”. L'app esegue OCR direttamente nel browser con Tesseract.js, usa le parole lette per cercare su SBN, Google Books e Open Library, quindi mostra le edizioni più probabili. Dopo la selezione il libro viene aggiunto con un codice interno progressivo nel formato `BIB-000001`.

## Riconoscimento automatico senza ISBN

La versione 8 interpreta separatamente le righe OCR della copertina per ricavare autore, titolo e collana o editore. Esegue più ricerche strutturate su SBN, Google Books e Open Library e aggiunge automaticamente il risultato più coerente. Se nessun catalogo restituisce una scheda convincente, crea comunque il volume dai dati OCR, gli assegna un codice interno BIB e lo contrassegna come scheda da verificare.

## Catalogazione avanzata v9

La funzione prestiti è stata rimossa. Ogni volume riceve un codice inventario interno e può essere descritto con campi strutturati aggiuntivi:

- titolo originale e lingua originale;
- traduttore, curatore e altri responsabili;
- luogo di pubblicazione, edizione e ristampa;
- collana e numero nella collana;
- classificazione Dewey, categorie e soggetti;
- formato, legatura e dimensioni;
- collocazione fisica;
- condizione, provenienza, dedica o ex libris;
- data, fonte e prezzo di acquisizione;
- stato della scheda: Completa, Da verificare o Incompleta.

L'esportazione CSV include tutti i nuovi campi. I dati salvati dalle versioni precedenti restano leggibili e ricevono automaticamente un codice inventario quando l'app viene aperta.

## Versione 11 — Excel locale e avvio robusto

La libreria Excel è ora inclusa direttamente nel progetto (`jszip.min.js`) e non viene più caricata da un servizio esterno. L'app si avvia anche se i servizi opzionali per scanner o OCR non sono raggiungibili: quei moduli vengono caricati soltanto quando si usa la relativa funzione.

- `Esporta Excel` crea un vero file `.xlsx` con una riga per libro e una colonna per ogni informazione.
- `Importa Excel` ricostruisce la biblioteca da un file `.xlsx` esportato dall'app.
- È supportata anche l'importazione `.csv` con intestazioni identiche.
- Il foglio `Biblioteca` include intestazioni, filtro automatico e prima riga bloccata.
- Il foglio `Istruzioni` spiega la struttura.

Per questa versione va caricato su GitHub anche il file `jszip.min.js`.

## Correzione versione 12

La versione 11 si bloccava durante l'inizializzazione perché il pulsante
`Backup JSON` faceva riferimento alla funzione `exportJson`, rimossa
accidentalmente. La versione 12 ripristina la funzione e aggiunge un controllo
degli elementi essenziali dell'interfaccia prima dell'avvio.

Restano disponibili:

- scansione ISBN;
- riconoscimento dalla copertina;
- inserimento manuale;
- catalogazione avanzata;
- backup e importazione JSON;
- esportazione e importazione Excel.


## Versione 13 — archivio completo

Funzioni aggiunte:

- etichette QR locali e stampabili, leggibili dallo scanner dell’app;
- controllo duplicati e unione delle schede;
- completamento online dei dati mancanti;
- normalizzazione dei nomi degli autori, categorie, etichette e liste;
- selezione e modifica multipla;
- filtri avanzati;
- raggruppamento per scaffale e per opera/edizione;
- indicatore dei campi mancanti;
- inventario rapido di stanza e scaffale con ISBN o codice inventario;
- codice inventario personalizzabile;
- stampa della singola scheda o dell’intero catalogo, anche come PDF dal browser;
- statistiche su autori, editori, categorie, decenni, lingue, provenienze e letture;
- valore stimato della collezione;
- stato di lettura, voto, data e recensione;
- liste, collezioni ed etichette;
- backup automatici locali e annullamento dell’ultima modifica;
- installazione come PWA e funzionamento offline del catalogo.

La sincronizzazione cloud reale non è inclusa perché GitHub Pages non dispone di un database privato o di autenticazione. Il trasferimento tra dispositivi continua a funzionare tramite JSON ed Excel.

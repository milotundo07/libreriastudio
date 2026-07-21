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

